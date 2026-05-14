use anyhow::{Context, Result};
use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use dotenvy::dotenv;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use rss_service::{
    database::initialize_pool,
    init::{fatal, spawn_supervised, ReadinessGate, ReadinessSnapshot},
    log::init_async_logger,
    start_rss_service, RssHealth,
};

/// RSS polls on a 5-minute loop. Staleness = 2x that, giving one full cycle
/// of runway before the pod drops out of the ready pool.
const INGEST_INTERVAL: Duration = Duration::from_secs(300);
const MAX_POLL_STALENESS: Duration = Duration::from_secs(300 * 2);

/// How often the bridge loop checks `RssHealth.last_poll` for progress.
const READINESS_BRIDGE_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Clone)]
struct AppState {
    health: Arc<Mutex<RssHealth>>,
    readiness: Arc<ReadinessGate>,
}

#[derive(Serialize)]
struct ReadyPayload {
    #[serde(flatten)]
    readiness: ReadinessSnapshot,
    health: RssHealth,
}

/// Initialize Sentry. The returned guard MUST live for the lifetime of
/// the process — Drop flushes pending events on shutdown. Sentry MUST
/// initialize before the Tokio runtime starts (the crate's docs forbid
/// `#[tokio::main]` for this reason).
///
/// Privacy posture (see docs/superpowers/plans/2026-05-12-sentry-rollout.md):
/// - send_default_pii=false: no IPs, no auto-attached user info
/// - before_send strips request bodies, headers, query strings, user
/// - stack frame filenames have $HOME scrubbed to ~
fn init_sentry() -> sentry::ClientInitGuard {
    sentry::init((
        std::env::var("SENTRY_DSN").ok(),
        sentry::ClientOptions {
            release: Some(
                format!("scrollr-rss-svc@{}", env!("CARGO_PKG_VERSION")).into(),
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

    // Sentry init — MUST happen before the Tokio runtime starts. Guard's
    // Drop flushes events on shutdown.
    //
    // init_async_logger is intentionally NOT called here — it uses
    // tokio::spawn internally and panics with "there is no reactor running"
    // if called outside a Tokio runtime. It runs at the top of run_service().
    let _sentry_guard = init_sentry();
    sentry::configure_scope(|scope| {
        scope.set_tag("service", "scrollr-rss-svc");
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
    // a Tokio 1.x runtime".
    let _ = init_async_logger("./logs");

    let health = Arc::new(Mutex::new(RssHealth::new()));
    let readiness = Arc::new(ReadinessGate::new(Some(MAX_POLL_STALENESS)));

    // Cancellation token for coordinated shutdown
    let cancel = CancellationToken::new();

    // Start HTTP server immediately. Liveness always 200, readiness 503
    // until init + first poll.
    let state = AppState {
        health: health.clone(),
        readiness: readiness.clone(),
    };
    let app = Router::new()
        .route("/health", get(health_ready_handler))
        .route("/health/live", get(health_live_handler))
        .route("/health/ready", get(health_ready_handler))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3004".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .context("bind health server")?;
    println!("RSS Service listening on {} (connecting to DB...)", addr);

    // Spawn background task for DB connection + init + ingest loop.
    // Supervised so a panic inside the task takes the process down.
    let health_bg = health.clone();
    let readiness_bg = readiness.clone();
    let cancel_bg = cancel.clone();
    spawn_supervised("rss-init", async move {
        const RETRIES: u32 = 5;
        let mut remaining = RETRIES;
        let pool = loop {
            match initialize_pool().await {
                Ok(p) => break Arc::new(p),
                Err(e) if remaining == 0 => {
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

        // Build HTTP client once and reuse across all cycles for connection pooling.
        // reqwest's builder failing means the TLS stack is broken — no fallback,
        // just exit so Kubernetes surfaces the problem.
        //
        // The default Accept header is critical: some CDN-fronted feeds will
        // serve an HTML error page when no Accept is set. Advertising RSS/Atom
        // mime types first pushes those CDNs into returning the XML we want.
        let mut default_headers = HeaderMap::new();
        default_headers.insert(
            ACCEPT,
            HeaderValue::from_static(
                "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
            ),
        );
        default_headers.insert(
            USER_AGENT,
            HeaderValue::from_static("Scrollr/1.0 RSS Fetcher (+https://myscrollr.com)"),
        );

        let http_client = match reqwest::Client::builder()
            .default_headers(default_headers)
            .timeout(std::time::Duration::from_secs(15))
            .connect_timeout(std::time::Duration::from_secs(5))
            .gzip(true)
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                sentry::capture_message(
                    &format!("Failed to build reqwest client: {e:#}"),
                    sentry::Level::Fatal,
                );
                fatal(&readiness_bg, format!("Failed to build reqwest client: {e:#}")).await;
            }
        };

        // DB is up, client is built. Mark ready — /health/ready stays 503
        // until the first ingest cycle records a poll timestamp.
        readiness_bg.mark_ready().await;

        // Bridge loop: forward RssHealth.last_poll to readiness gate.
        let bridge_health = health_bg.clone();
        let bridge_readiness = readiness_bg.clone();
        let bridge_cancel = cancel_bg.clone();
        tokio::spawn(async move {
            let mut last_seen = None;
            loop {
                tokio::select! {
                    _ = bridge_cancel.cancelled() => break,
                    _ = tokio::time::sleep(READINESS_BRIDGE_INTERVAL) => {
                        let snap = bridge_health.lock().await.get_health();
                        if let Some(ts) = snap.last_poll
                            && last_seen != Some(ts)
                        {
                            bridge_readiness.record_poll().await;
                            last_seen = Some(ts);
                        }
                    }
                }
            }
        });

        // Periodic ingest loop.
        println!("Starting periodic RSS ingest loop (5 minute interval)...");
        let mut cycle: u64 = 0;
        loop {
            tokio::select! {
                _ = cancel_bg.cancelled() => {
                    println!("RSS ingest loop shutting down...");
                    break;
                }
                _ = async {
                    start_rss_service(pool.clone(), health_bg.clone(), &http_client, cycle).await;
                    cycle += 1;
                    tokio::time::sleep(INGEST_INTERVAL).await;
                } => {}
            }
        }
    });

    let cancel_for_shutdown = cancel.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            println!("RSS Service received shutdown signal");
            cancel_for_shutdown.cancel();
        })
        .await
        .context("serve health endpoints")?;

    println!("RSS Service shut down gracefully");
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

/// Liveness probe: 200 as long as the process is up.
async fn health_live_handler() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(serde_json::json!({"status": "alive"})))
}

/// Readiness probe: 200 only when init succeeded AND the first poll cycle
/// completed within `MAX_POLL_STALENESS`.
async fn health_ready_handler(
    State(state): State<AppState>,
) -> (StatusCode, Json<ReadyPayload>) {
    let readiness = state.readiness.snapshot().await;
    let code = state.readiness.http_status().await;
    let health = state.health.lock().await.get_health();
    (code, Json(ReadyPayload { readiness, health }))
}
