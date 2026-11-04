mod log;
mod provider;
mod store;
#[cfg(test)]
mod tests;

use anyhow::{Context, Result};
use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use chrono::Utc;
use redis::AsyncCommands;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use std::{
    env,
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
    time::Duration,
};
use tokio::time::{MissedTickBehavior, interval, timeout};

const INVALIDATION: &str = r#"{"data":[{"action":"update","record":{},"changes":{},"metadata":{"table_name":"election_results"}}]}"#;

async fn publish(redis: &redis::Client, id: i32) -> Result<()> {
    let mut conn = redis.get_multiplexed_async_connection().await?;
    let _: usize = conn
        .publish(format!("cdc:elections:{id}"), INVALIDATION)
        .await?;
    Ok(())
}

#[derive(Clone)]
struct Health {
    enabled: bool,
    last_cycle: Arc<AtomicI64>,
}

async fn ready(State(state): State<Health>) -> (StatusCode, Json<Value>) {
    let last = state.last_cycle.load(Ordering::Relaxed);
    let ok = !state.enabled || (last > 0 && Utc::now().timestamp() - last < 90);
    let status = if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(json!({"ready":ok,"polling_disabled":!state.enabled})),
    )
}

async fn run() -> Result<()> {
    let _ = log::init_async_logger("");
    let state = Health {
        enabled: env::var("ELECTIONS_BETA_ENABLED").as_deref() == Ok("true"),
        last_cycle: Arc::new(AtomicI64::new(0)),
    };
    if state.enabled {
        let db = PgPoolOptions::new()
            .max_connections(3)
            .acquire_timeout(Duration::from_secs(4))
            .connect(&env::var("DATABASE_URL").context("DATABASE_URL required")?)
            .await?;
        let redis = redis::Client::open(env::var("REDIS_URL").context("REDIS_URL required")?)?;
        let races = provider::catalog()?;
        let http = provider::client()?;
        let pulse = state.last_cycle.clone();
        tokio::spawn(async move {
            let mut ticks = interval(Duration::from_secs(10));
            ticks.set_missed_tick_behavior(MissedTickBehavior::Skip);
            loop {
                ticks.tick().await;
                let mut healthy = true;
                for race in &races {
                    let update = async {
                        if let Some(lease) = store::claim(&db, race.id).await? {
                            let result =
                                provider::fetch(&http, race, lease.source_updated_at).await;
                            let outcome = store::complete(&db, race, lease, result).await?;
                            if let Some(err) = outcome.upstream_error {
                                log::warn!("Race {} provider check failed: {}", race.id, err);
                            }
                            if outcome.changed {
                                publish(&redis, race.id).await?;
                            }
                        }
                        anyhow::Ok(())
                    };
                    // Two bounded 12-second HTTP reads plus database and Redis I/O.
                    match timeout(Duration::from_secs(35), update).await {
                        Ok(Ok(())) => {}
                        err => {
                            healthy = false;
                            log::error!("Race {} worker cycle failed: {:?}", race.id, err);
                            sentry::capture_message(
                                "Election worker cycle failed",
                                sentry::Level::Error,
                            );
                        }
                    }
                }
                pulse.store(
                    if healthy { Utc::now().timestamp() } else { 0 },
                    Ordering::Relaxed,
                );
            }
        });
    }
    log::info!(
        "Election ingester listening on port 3005 (polling={})",
        state.enabled
    );
    let app = Router::new()
        .route("/health", get(|| async { Json(json!({"status":"up"})) }))
        .route("/health/ready", get(ready))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3005").await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            if let Ok(mut term) =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            {
                tokio::select! { _ = term.recv() => {}, _ = tokio::signal::ctrl_c() => {} }
                return;
            }
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

fn main() -> Result<()> {
    // Only fixed operational messages are captured; no provider/DB payload or account context.
    let _guard = sentry::init((
        env::var("SENTRY_DSN").ok(),
        sentry::ClientOptions {
            send_default_pii: false,
            max_breadcrumbs: 0,
            release: Some(format!("scrollr-elections-svc@{}", env!("CARGO_PKG_VERSION")).into()),
            before_send: Some(Arc::new(|mut event| {
                event.request = None;
                event.user = None;
                Some(event)
            })),
            ..Default::default()
        },
    ));
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run())
}
