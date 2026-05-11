use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use dotenv::dotenv;
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use sports_service::{
    database::initialize_pool,
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

#[tokio::main]
async fn main() {
    dotenv().ok();
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
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
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
        let rate_limiter = Arc::new(RateLimiter::new_per_league(&leagues, 7500));

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

        // ── Daily reset: rate budgets at UTC midnight ─────────────────────
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
                        rl_reset.reset_daily(&leagues_reset, 7500);
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
        .unwrap();

    println!("Sports Service shut down gracefully");
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
