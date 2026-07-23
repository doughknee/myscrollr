use anyhow::{Context, Result};
use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use dotenv::dotenv;
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use predictions_service::{
    database::initialize_pool,
    init::{fatal, spawn_supervised, ReadinessGate, ReadinessSnapshot},
    kalshi::rest::RestClient,
    log::init_async_logger,
    start_predictions_services,
    types::{try_rest_client_from_env, PredictionsHealth},
};

/// Freshness window for `/health/ready`. If the WebSocket hasn't processed
/// any batches within this window the pod is marked NotReady so Kubernetes
/// stops routing traffic. The WS reconnect backoff is ~60s + jitter, so a
/// window longer than 2x that means ingest is genuinely broken.
const MAX_POLL_STALENESS: Duration = Duration::from_secs(5 * 60);

/// How often the bridge loop checks `PredictionsHealth.batch_number` for
/// progress and forwards it to the readiness gate. This is cheap (one
/// mutex-read + one RwLock-write) so it runs on a tight interval.
const READINESS_BRIDGE_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Clone)]
struct AppState {
    health: Arc<Mutex<PredictionsHealth>>,
    readiness: Arc<ReadinessGate>,
    /// Signed Kalshi client for the /internal/candlesticks proxy (v1.1.4).
    /// None when creds are absent — the endpoint answers 503 instead of
    /// blocking the health server from starting.
    rest: Option<Arc<RestClient>>,
}

/// Query params for `/internal/candlesticks`. The predictions Go API looks
/// up `series` from the markets table and forwards the time window; this
/// service is a pure signed pass-through.
#[derive(serde::Deserialize)]
struct CandlesticksParams {
    series: String,
    ticker: String,
    start_ts: i64,
    end_ts: i64,
    period_interval: u32,
}

#[derive(Serialize)]
struct ReadyPayload {
    #[serde(flatten)]
    readiness: ReadinessSnapshot,
    health: PredictionsHealth,
}

/// Initialize Sentry. The returned guard MUST live for the lifetime of
/// the process — Drop flushes pending events on shutdown.
///
/// Sentry MUST initialize BEFORE the Tokio runtime starts. The crate's
/// docs explicitly say `#[tokio::main]` is unsupported because the
/// implicit runtime construction would race the Sentry transport thread.
/// That's why this entire file uses a synchronous `main` that builds
/// the runtime by hand.
///
/// Privacy posture (see AGENTS.md "Error Monitoring — Sentry"):
/// - send_default_pii=false: no IPs, no auto-attached user info
/// - before_send strips request bodies, headers, query strings, user
/// - stack frame filenames have $HOME scrubbed to ~
fn init_sentry() -> sentry::ClientInitGuard {
    sentry::init((
        std::env::var("SENTRY_DSN").ok(),
        sentry::ClientOptions {
            release: Some(
                format!("scrollr-predictions-svc@{}", env!("CARGO_PKG_VERSION")).into(),
            ),
            environment: Some(
                std::env::var("ENVIRONMENT")
                    .unwrap_or_else(|_| "development".to_string())
                    .into(),
            ),
            traces_sample_rate: 0.1,
            attach_stacktrace: true,
            send_default_pii: false,
            max_breadcrumbs: 50,
            before_send: Some(std::sync::Arc::new(|mut event| {
                event.user = None;
                if let Some(req) = event.request.as_mut() {
                    req.cookies = None;
                    req.headers.clear();
                    req.data = None;
                    req.query_string = None;
                }
                let home = dirs::home_dir()
                    .map(|h| h.to_string_lossy().into_owned())
                    .unwrap_or_default();
                for exc in event.exception.iter_mut() {
                    if let Some(st) = exc.stacktrace.as_mut() {
                        for frame in st.frames.iter_mut() {
                            if let Some(filename) = frame.filename.as_mut() {
                                if !home.is_empty() {
                                    let s: String = filename.to_string();
                                    *filename = s.replace(&home, "~").into();
                                }
                            }
                        }
                    }
                }
                Some(event)
            })),
            ..Default::default()
        },
    ))
}

fn main() -> Result<()> {
    dotenv().ok();

    // Sentry init — MUST happen before the Tokio runtime starts. The
    // guard's Drop flushes events on shutdown, so bind it locally for
    // the lifetime of main.
    //
    // init_async_logger is intentionally NOT called here — it uses
    // tokio::spawn internally and panics with "there is no reactor running"
    // if called outside a Tokio runtime. It runs as the first line of
    // run_service() instead, inside the runtime built below.
    let _sentry_guard = init_sentry();
    sentry::configure_scope(|scope| {
        scope.set_tag("service", "scrollr-predictions-svc");
        if let Ok(sha) = std::env::var("GIT_SHA") {
            scope.set_tag("git_sha", sha);
        }
    });

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("build tokio runtime")?;

    runtime.block_on(run_service())
}

async fn run_service() -> Result<()> {
    // Logger init MUST be inside the Tokio runtime — init_async_logger
    // spawns background tasks. Calling it from sync main() panics with
    // "there is no reactor running, must be called from the context of
    // a Tokio 1.x runtime" (see commit log for the crash that caught this).
    let _ = init_async_logger("./logs");

    let health = Arc::new(Mutex::new(PredictionsHealth::new()));
    let readiness = Arc::new(ReadinessGate::new(Some(MAX_POLL_STALENESS)));

    // Cancellation token for coordinated shutdown
    let cancel = CancellationToken::new();

    // Start HTTP server immediately so the k8s liveness probe always has
    // something to talk to, but the readiness probe at /health/ready will
    // return 503 until `readiness.mark_ready()` is called from the init
    // task below.
    let rest = match try_rest_client_from_env() {
        Ok(c) => Some(Arc::new(c)),
        Err(e) => {
            eprintln!("[Candlesticks] Kalshi REST client unavailable ({e:#}); /internal/candlesticks will 503");
            None
        }
    };

    let state = AppState {
        health: health.clone(),
        readiness: readiness.clone(),
        rest,
    };
    let app = Router::new()
        .route("/health", get(health_ready_handler))
        .route("/health/live", get(health_live_handler))
        .route("/health/ready", get(health_ready_handler))
        .route("/internal/candlesticks", get(candlesticks_handler))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3005".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .context("bind health server")?;
    println!("Predictions Service listening on {} (connecting to DB...)", addr);

    // Spawn background task for DB connection + service init. Uses the
    // supervised wrapper so a panic inside init (e.g. a `.expect()` on a
    // missing env var someone forgot to convert) takes the whole process
    // down instead of leaving a zombie pod behind.
    let health_bg = health.clone();
    let readiness_bg = readiness.clone();
    let cancel_bg = cancel.clone();
    spawn_supervised("predictions-init", async move {
        const RETRIES: u32 = 5;
        let mut remaining = RETRIES;
        let pool = loop {
            match initialize_pool().await {
                Ok(p) => break Arc::new(p),
                Err(e) if remaining == 0 => {
                    // All retries exhausted. Capture to Sentry, then mark
                    // failed and exit so Kubernetes restarts the pod.
                    sentry_anyhow::capture_anyhow(&e);
                    fatal(
                        &readiness_bg,
                        format!("DB init failed after {RETRIES} retries: {e:#}"),
                    )
                    .await;
                }
                Err(e) => {
                    eprintln!(
                        "[DB] Connection attempt failed ({} remaining): {e:#}",
                        remaining
                    );
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    remaining -= 1;
                }
            }
        };

        // DB is up and migrations have succeeded. Readiness can flip to
        // `Ready` — but /health/ready will keep returning 503 until the
        // first batch is processed (staleness guard).
        readiness_bg.mark_ready().await;

        // Bridge loop: forward `record_poll()` whenever the websocket is
        // connected OR the batch counter advanced. The `OR` is deliberate:
        //
        //   - Active markets: batches flush as ticker updates come through;
        //     `progressed` fires and we record.
        //   - Quiet markets / overnight: no ticks, so `progressed` stays
        //     false but the websocket is still connected — we still record
        //     so the pod stays Ready. Without this, quiet pods would flap
        //     NotReady every MAX_POLL_STALENESS.
        //   - Startup: batch_number starts at 0, so `progressed` is false
        //     for the first iteration. `connected` becomes true once the
        //     subscribe handshake completes, typically within ~2s of the
        //     init task finishing. That's why we rely on the OR for the
        //     startup probe to pass within its window.
        //
        // The earlier "AND" variant broke all three cases because the
        // readiness gate returns 503 until `record_poll()` is called at
        // least once (see `init::ReadinessGate::http_status`), so a quiet
        // market could fail the k8s startup probe even though the service
        // was functioning correctly.
        //
        // Silent-wedge detection: a websocket that's TCP-alive but not
        // receiving messages is NOT caught by this bridge loop (by design
        // of the OR). The reconnect logic in `start_predictions_services`
        // handles it — tungstenite surfaces the stalled connection as an
        // error eventually (e.g. TCP keepalive failure) and we tear down
        // and reconnect with error_count incremented. Operators who want
        // stricter detection should watch `snap.batch_number` via the
        // `/health/ready` JSON payload and alert on flat-lining.
        let bridge_health = health_bg.clone();
        let bridge_readiness = readiness_bg.clone();
        let bridge_cancel = cancel_bg.clone();
        tokio::spawn(async move {
            let mut last_batch: u64 = 0;
            loop {
                tokio::select! {
                    _ = bridge_cancel.cancelled() => break,
                    _ = tokio::time::sleep(READINESS_BRIDGE_INTERVAL) => {
                        let snap = bridge_health.lock().await.get_health();
                        let connected = snap.connection_status == "connected";
                        let progressed = snap.batch_number > last_batch;

                        if connected || progressed {
                            bridge_readiness.record_poll().await;
                            last_batch = snap.batch_number;
                        }
                        // else: websocket is disconnected AND no progress.
                        // Don't record — staleness will fire after
                        // MAX_POLL_STALENESS and k8s pulls us from rotation.
                    }
                }
            }
        });

        // Start the background service (WebSocket). Shutdown is cooperative
        // via `cancel`.
        tokio::select! {
            _ = start_predictions_services(pool, health_bg) => {},
            _ = cancel_bg.cancelled() => {
                println!("Predictions background service shutting down...");
            }
        }
    });

    let cancel_for_shutdown = cancel.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            println!("Predictions Service received shutdown signal");
            cancel_for_shutdown.cancel();
        })
        .await
        .context("serve health endpoints")?;

    println!("Predictions Service shut down gracefully");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

/// Liveness probe: returns 200 as long as the process is running. Lets
/// Kubernetes tell apart "process crashed" (kill+restart) from "process is
/// up but not doing work" (stop routing traffic, but don't restart — a
/// restart won't fix a migration mismatch).
async fn health_live_handler() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(serde_json::json!({"status": "alive"})))
}

/// Signed pass-through to Kalshi's candlesticks endpoint (v1.1.4 — the
/// desktop detail-modal price chart). The Go API owns the DB lookup
/// (series ticker) and Redis caching; this handler only signs + forwards.
async fn candlesticks_handler(
    State(state): State<AppState>,
    axum::extract::Query(p): axum::extract::Query<CandlesticksParams>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(rest) = state.rest.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "kalshi credentials not configured"})),
        );
    };
    let query = format!(
        "start_ts={}&end_ts={}&period_interval={}",
        p.start_ts, p.end_ts, p.period_interval
    );
    match rest.get_candlesticks(&p.series, &p.ticker, &query).await {
        Ok(v) => (StatusCode::OK, Json(v)),
        Err(e) => {
            eprintln!("[Candlesticks] fetch failed for {}: {e:#}", p.ticker);
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "kalshi candlesticks fetch failed"})),
            )
        }
    }
}

/// Readiness probe: 200 only when init succeeded AND the WebSocket is
/// connected / has processed a batch within the staleness window. Returns
/// the service's own health payload in the body so humans can `curl | jq`
/// and see why.
async fn health_ready_handler(
    State(state): State<AppState>,
) -> (StatusCode, Json<ReadyPayload>) {
    let readiness = state.readiness.snapshot().await;
    let code = state.readiness.http_status().await;
    let health = state.health.lock().await.get_health();
    (code, Json(ReadyPayload { readiness, health }))
}
