use anyhow::{Context, Result};
use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use dotenv::dotenv;
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use sports_service::{
    database::{add_consumed, get_consumed_today, initialize_pool, prune_rate_budget, PgPool},
    init::{fatal, spawn_supervised, ReadinessGate, ReadinessSnapshot},
    init_sports_service,
    log::init_async_logger,
    poll_live, poll_schedule, poll_standings, poll_teams,
    RateLimiter, SportsHealth,
};

#[derive(Clone)]
struct AppState {
    health: Arc<Mutex<SportsHealth>>,
    readiness: Arc<ReadinessGate>,
}

#[derive(Serialize)]
struct ReadyPayload {
    #[serde(flatten)]
    readiness: ReadinessSnapshot,
    health: SportsHealth,
}

/// Interval for the schedule poll (upcoming games + cleanup).
const SCHEDULE_POLL_SECS: u64 = 30 * 60; // 30 minutes

/// Fastest "live" poll interval. Actual interval is adaptive (30s when
/// leagues_live > 0, 60s otherwise) but for staleness calculations we use
/// the widest reasonable gap.
const LIVE_POLL_MAX_INTERVAL_SECS: u64 = 60;

/// Maximum acceptable staleness before `/health/ready` returns 503. The
/// staleness threshold is deliberately 2x the widest expected gap between
/// successful polls, so transient rate-limits or a slow external API don't
/// flap readiness. If no poll has succeeded in this window something is
/// actually wrong.
const MAX_POLL_STALENESS_SECS: u64 = LIVE_POLL_MAX_INTERVAL_SECS * 2;

/// How often the bridge loop checks `SportsHealth.last_poll` and forwards
/// it to the readiness gate. Cheap, runs on a tight interval.
const READINESS_BRIDGE_INTERVAL: Duration = Duration::from_secs(10);

/// Daily request budget per api-sports.io sport host (Pro plan, 7,500/day).
/// Used by both the initial budget allocation and the UTC-midnight daily
/// reset. Keep these in lockstep — drift between them would silently corrupt
/// the per-league budget allocation.
const SPORTS_DAILY_QUOTA: u32 = 7500;

/// How often accumulated per-host request consumption is flushed to the
/// `sports_rate_budget` table. Batched rather than per-request to keep DB
/// write load negligible (at most one upsert per host per interval). An
/// unclean shutdown can lose up to one interval's worth of counts — small,
/// bounded slack compared to the full-quota reset this persistence prevents.
const BUDGET_FLUSH_INTERVAL_SECS: u64 = 60;

/// Persist accumulated per-host consumption to Postgres, attributed to the
/// current UTC day. On write failure the deltas are handed back to the
/// in-memory buffer so the next flush retries them — dropping them would
/// under-count after a restart and let the service overshoot the quota.
async fn flush_consumed(pool: &Arc<PgPool>, rate_limiter: &Arc<RateLimiter>) {
    let deltas = rate_limiter.take_consumed();
    if deltas.is_empty() {
        return;
    }
    let day = chrono::Utc::now().date_naive();
    if let Err(e) = add_consumed(pool, day, &deltas).await {
        eprintln!("[Rate Budget] Failed to persist consumed counts, will retry: {e:#}");
        for (host, n) in deltas {
            rate_limiter.note_consumed(&host, n);
        }
    }
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
                format!("scrollr-sports-svc@{}", env!("CARGO_PKG_VERSION")).into(),
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
        scope.set_tag("service", "scrollr-sports-svc");
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

    let health = Arc::new(Mutex::new(SportsHealth::new()));
    let readiness = Arc::new(ReadinessGate::new(Some(Duration::from_secs(
        MAX_POLL_STALENESS_SECS,
    ))));

    // Cancellation token for coordinated shutdown
    let cancel = CancellationToken::new();

    // Start HTTP server immediately so the k8s liveness probe has something
    // to talk to, but the readiness probe at /health/ready will return 503
    // until the init task calls `readiness.mark_ready()` AND the first
    // poll cycle completes.
    let state = AppState {
        health: health.clone(),
        readiness: readiness.clone(),
    };
    let app = Router::new()
        .route("/health", get(health_ready_handler))
        .route("/health/live", get(health_live_handler))
        .route("/health/ready", get(health_ready_handler))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3002".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .context("bind health server")?;
    println!("Sports Service listening on {} (connecting to DB...)", addr);

    // Spawn background init. `spawn_supervised` catches panics so a bug
    // inside init takes the process down instead of leaving a zombie pod.
    let health_bg = health.clone();
    let readiness_bg = readiness.clone();
    let cancel_bg = cancel.clone();
    spawn_supervised("sports-init", async move {
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

        // ── Initialize service (tables, migrations, seeding) ─────────────
        let (client, leagues) = match init_sports_service(&pool).await {
            Ok(result) => result,
            Err(e) => {
                sentry::capture_message(
                    &format!("Sports init failed: {e}"),
                    sentry::Level::Fatal,
                );
                // Misconfiguration: no leagues or missing API key. Exit so
                // Kubernetes surfaces the error and operator attention is
                // forced; the old behavior silently served /health as 200.
                fatal(&readiness_bg, format!("Sports init failed: {e}")).await;
            }
        };

        // Pro plan: 7,500 requests/day per sport host. Each league on a host
        // gets a reserved share of host_budget / N_leagues_on_host. Off-season
        // leagues donate their share to a per-host shared pool that any
        // in-season league can borrow from when its reserved budget is
        // exhausted. Prevents Champions League knockout nights from starving
        // Premier League polls.
        //
        // Budgets are seeded from today's persisted consumption so a pod
        // restart mid-day (deploy, OOM, node drain) resumes from the quota
        // actually remaining — the upstream counter only resets at UTC
        // midnight, while a fresh in-memory limiter would grant itself the
        // full 7,500 again.
        let consumed_today = get_consumed_today(&pool).await;
        if !consumed_today.is_empty() {
            println!(
                "[Rate Budget] Seeding budgets from persisted consumption: {:?}",
                consumed_today
            );
        }
        let rate_limiter = Arc::new(RateLimiter::new_per_league_seeded(
            &leagues,
            SPORTS_DAILY_QUOTA,
            &consumed_today,
        ));

        let client = Arc::new(client);
        let leagues = Arc::new(leagues);

        // Init finished. Mark ready — but /health/ready stays 503 until the
        // first poll records a timestamp via the bridge loop below.
        readiness_bg.mark_ready().await;

        // Bridge: watch SportsHealth.last_poll and forward to readiness
        // gate. Cheap + keeps the poll functions untouched.
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

        // ── Fast poll: live scores (today only, 30s live / 1min idle) ─────
        let pool_live = pool.clone();
        let client_live = client.clone();
        let leagues_live = leagues.clone();
        let health_live = health_bg.clone();
        let rl_live = rate_limiter.clone();
        let cancel_live = cancel_bg.clone();
        spawn_supervised("sports-live-poll", async move {
            println!("Starting live poll loop (adaptive intervals)...");
            loop {
                tokio::select! {
                    _ = cancel_live.cancelled() => {
                        println!("Live poll loop shutting down...");
                        break;
                    }
                    _ = async {
                        poll_live(&pool_live, &client_live, &leagues_live, &health_live, &rl_live).await;

                        // Adaptive interval: poll more frequently when there are live games
                        let interval = {
                            let h = health_live.lock().await;
                            if h.leagues_live > 0 {
                                30  // 30s when live games are happening
                            } else {
                                60  // 1 min when no live games
                            }
                        };

                        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
                    } => {}
                }
            }
        });

        // ── Slow poll: schedule + cleanup (today + 7 days, every 30 min) ──
        let pool_sched = pool.clone();
        let client_sched = client.clone();
        let leagues_sched = leagues.clone();
        let rl_sched = rate_limiter.clone();
        let cancel_sched = cancel_bg.clone();
        spawn_supervised("sports-schedule-poll", async move {
            println!("Starting schedule poll loop (every {} min)...", SCHEDULE_POLL_SECS / 60);
            // Run immediately on startup to populate the schedule
            poll_schedule(&pool_sched, &client_sched, &leagues_sched, &rl_sched).await;
            loop {
                tokio::select! {
                    _ = cancel_sched.cancelled() => {
                        println!("Schedule poll loop shutting down...");
                        break;
                    }
                    _ = async {
                        tokio::time::sleep(std::time::Duration::from_secs(SCHEDULE_POLL_SECS)).await;
                        poll_schedule(&pool_sched, &client_sched, &leagues_sched, &rl_sched).await;
                    } => {}
                }
            }
        });

        // ── Daily poll: standings (every 24 hours) ───────────────────────
        let pool_standings = pool.clone();
        let client_standings = client.clone();
        let leagues_standings = leagues.clone();
        let rl_standings = rate_limiter.clone();
        let cancel_standings = cancel_bg.clone();
        spawn_supervised("sports-standings-poll", async move {
            println!("Starting standings poll loop (daily)...");
            poll_standings(&pool_standings, &client_standings, &leagues_standings, &rl_standings).await;
            loop {
                tokio::select! {
                    _ = cancel_standings.cancelled() => {
                        println!("Standings poll loop shutting down...");
                        break;
                    }
                    _ = async {
                        tokio::time::sleep(std::time::Duration::from_secs(86400)).await;
                        poll_standings(&pool_standings, &client_standings, &leagues_standings, &rl_standings).await;
                    } => {}
                }
            }
        });

        // ── Weekly poll: teams (every 7 days) ────────────────────────────
        let pool_teams = pool.clone();
        let client_teams = client.clone();
        let leagues_teams = leagues.clone();
        let rl_teams = rate_limiter.clone();
        let cancel_teams = cancel_bg.clone();
        spawn_supervised("sports-teams-poll", async move {
            println!("Starting teams poll loop (weekly)...");
            poll_teams(&pool_teams, &client_teams, &leagues_teams, &rl_teams).await;
            loop {
                tokio::select! {
                    _ = cancel_teams.cancelled() => {
                        println!("Teams poll loop shutting down...");
                        break;
                    }
                    _ = async {
                        tokio::time::sleep(std::time::Duration::from_secs(604800)).await;
                        poll_teams(&pool_teams, &client_teams, &leagues_teams, &rl_teams).await;
                    } => {}
                }
            }
        });

        // ── Periodic flush: persist consumed counts to Postgres ──────────
        // Drains the RateLimiter's per-host consumption buffer into the
        // sports_rate_budget table so the counts survive a pod restart
        // (see the seeding above). Final flush on shutdown so a graceful
        // termination loses nothing.
        let pool_flush = pool.clone();
        let rl_flush = rate_limiter.clone();
        let cancel_flush = cancel_bg.clone();
        spawn_supervised("sports-budget-flush", async move {
            println!(
                "Starting rate-budget flush loop (every {}s)...",
                BUDGET_FLUSH_INTERVAL_SECS
            );
            loop {
                tokio::select! {
                    _ = cancel_flush.cancelled() => {
                        flush_consumed(&pool_flush, &rl_flush).await;
                        println!("Budget flush loop shutting down (final flush done)...");
                        break;
                    }
                    _ = tokio::time::sleep(Duration::from_secs(BUDGET_FLUSH_INTERVAL_SECS)) => {
                        flush_consumed(&pool_flush, &rl_flush).await;
                    }
                }
            }
        });

        // ── Daily reset: rate budgets at UTC midnight ─────────────────────
        let pool_reset = pool.clone();
        let leagues_reset = leagues.clone();
        let rl_reset = rate_limiter.clone();
        let cancel_reset = cancel_bg.clone();
        spawn_supervised("sports-budget-reset", async move {
            println!("Starting daily rate-budget reset loop (UTC midnight)...");
            loop {
                // Sleep until next UTC midnight
                let now = chrono::Utc::now();
                let tomorrow = (now + chrono::Duration::days(1))
                    .date_naive()
                    .and_hms_opt(0, 0, 0)
                    .expect("midnight is a valid time")
                    .and_utc();
                let wait_secs = (tomorrow - now).num_seconds().max(60) as u64;

                tokio::select! {
                    _ = cancel_reset.cancelled() => {
                        println!("Budget reset loop shutting down...");
                        break;
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(wait_secs)) => {
                        // Drain the consumption buffer before resetting. We're
                        // just past midnight here, so up to one flush-interval
                        // of pre-midnight requests lands in the new day's row —
                        // a small, conservative error (shrinks the new day's
                        // seed slightly on a later restart).
                        flush_consumed(&pool_reset, &rl_reset).await;
                        rl_reset.reset_daily(&leagues_reset, SPORTS_DAILY_QUOTA);
                        match prune_rate_budget(&pool_reset).await {
                            Ok(n) if n > 0 => println!("[Rate Budget] Pruned {n} old budget rows"),
                            Ok(_) => {}
                            Err(e) => eprintln!("[Rate Budget] Failed to prune old budget rows: {e:#}"),
                        }
                        println!("[Rate Budget] Daily reset completed at UTC midnight");
                    }
                }
            }
        });
    });

    let cancel_for_shutdown = cancel.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            println!("Sports Service received shutdown signal");
            cancel_for_shutdown.cancel();
        })
        .await
        .context("serve health endpoints")?;

    println!("Sports Service shut down gracefully");
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

/// Readiness probe: 200 only when DB init succeeded AND the first poll
/// cycle completed within `MAX_POLL_STALENESS_SECS`.
async fn health_ready_handler(
    State(state): State<AppState>,
) -> (StatusCode, Json<ReadyPayload>) {
    let readiness = state.readiness.snapshot().await;
    let code = state.readiness.http_status().await;
    let health = state.health.lock().await.get_health();
    (code, Json(ReadyPayload { readiness, health }))
}
