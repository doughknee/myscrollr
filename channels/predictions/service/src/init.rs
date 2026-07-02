//! Service initialization and readiness tracking.
//!
//! Replaces the old silent-failure pattern where background init tasks could
//! die while `/health` kept returning HTTP 200. Every fatal condition now
//! either (a) sets [`ReadinessState::Failed`] and exits the process so
//! Kubernetes restarts the pod, or (b) flips `/health/ready` to return HTTP
//! 503 so probes can detect the problem.
//!
//! Copied into each Rust service (`finance`, `sports`, `rss`) rather than
//! extracted as a shared crate, to match the existing isolation philosophy
//! in AGENTS.md ("Module isolation is absolute. Each service owns its copy
//! of database.rs and log.rs.").

use std::{env, future::Future, panic::AssertUnwindSafe, time::Duration};

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use futures_util::FutureExt;
use serde::Serialize;
use tokio::sync::RwLock;

/// Single source of truth for whether the service should be receiving traffic.
/// Kubernetes readiness probes consult this via `/health/ready`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ReadinessState {
    /// Initial state. HTTP server is up but init (DB, migrations, config)
    /// has not finished. `/health/ready` returns 503.
    Starting,
    /// Init finished successfully. `/health/ready` returns 200 as long as
    /// background work stays fresh (see `max_poll_staleness`).
    Ready,
    /// Unrecoverable failure during init or runtime. `/health/ready` returns
    /// 503. The process is usually on its way to `exit(1)` when this is set;
    /// it is surfaced here so the last probe response before shutdown is
    /// accurate and debuggable.
    Failed { reason: String },
}

/// Readiness tracker shared between the main task and the health handler.
///
/// The gate records three things:
/// * The current [`ReadinessState`].
/// * `last_poll`: the timestamp of the last successful background poll (used
///   to detect frozen workers that are nominally `Ready`).
/// * `max_poll_staleness`: the threshold past which `Ready` silently becomes
///   "stale" (rendered as HTTP 503 by `/health/ready`). `None` means the
///   service has no polling loop and staleness does not apply.
#[derive(Debug)]
pub struct ReadinessGate {
    inner: RwLock<ReadinessInner>,
}

#[derive(Debug)]
struct ReadinessInner {
    state: ReadinessState,
    last_poll: Option<DateTime<Utc>>,
    max_poll_staleness: Option<Duration>,
}

/// Snapshot of the readiness gate returned by `/health/ready`. Flat JSON so
/// it can be merged into each service's own health payload without forcing
/// callers to drill into a nested object.
#[derive(Debug, Clone, Serialize)]
pub struct ReadinessSnapshot {
    pub state: ReadinessState,
    pub last_poll: Option<DateTime<Utc>>,
    pub max_poll_staleness_secs: Option<u64>,
    /// True when `state == Ready` but the newest poll is older than the
    /// staleness threshold. Derived for convenience — callers shouldn't have
    /// to recompute it.
    pub stale: bool,
}

impl ReadinessGate {
    /// Create a gate starting in [`ReadinessState::Starting`]. `max_poll_staleness`
    /// is the freshness window past which a `Ready` service flips to 503
    /// (typically ~2x the longest poll interval). Pass `None` for services
    /// that have no polling loop.
    pub fn new(max_poll_staleness: Option<Duration>) -> Self {
        Self {
            inner: RwLock::new(ReadinessInner {
                state: ReadinessState::Starting,
                last_poll: None,
                max_poll_staleness,
            }),
        }
    }

    /// Mark the service as ready to receive traffic. Usually called once, at
    /// the end of init, before the poll loops start.
    pub async fn mark_ready(&self) {
        self.inner.write().await.state = ReadinessState::Ready;
    }

    /// Mark the service as unrecoverably failed. `/health/ready` will return
    /// 503 until the process exits.
    pub async fn mark_failed(&self, reason: impl Into<String>) {
        self.inner.write().await.state = ReadinessState::Failed {
            reason: reason.into(),
        };
    }

    /// Record that a background poll cycle just completed successfully. Used
    /// by `/health/ready` to detect frozen workers.
    pub async fn record_poll(&self) {
        self.inner.write().await.last_poll = Some(Utc::now());
    }

    /// Snapshot for the health handler.
    pub async fn snapshot(&self) -> ReadinessSnapshot {
        let inner = self.inner.read().await;
        let stale = matches!(inner.state, ReadinessState::Ready)
            && inner
                .max_poll_staleness
                .zip(inner.last_poll)
                .is_some_and(|(max, last)| {
                    Utc::now().signed_duration_since(last).to_std().unwrap_or_default() > max
                });
        ReadinessSnapshot {
            state: inner.state.clone(),
            last_poll: inner.last_poll,
            max_poll_staleness_secs: inner.max_poll_staleness.map(|d| d.as_secs()),
            stale,
        }
    }

    /// Compute the HTTP status code `/health/ready` should return. 200 only
    /// when the service is `Ready` AND (no staleness threshold is set OR
    /// the last poll is within the threshold OR no poll has been recorded
    /// yet but the gate was only just marked ready — services without a
    /// poll loop set `max_poll_staleness` to `None` to skip this check).
    pub async fn http_status(&self) -> StatusCode {
        let snap = self.snapshot().await;
        match snap.state {
            ReadinessState::Starting | ReadinessState::Failed { .. } => {
                StatusCode::SERVICE_UNAVAILABLE
            }
            ReadinessState::Ready => {
                // If a staleness threshold is configured, require at least one
                // successful poll and enforce freshness. Services without a
                // poll loop pass `None` and are considered ready immediately.
                if snap.max_poll_staleness_secs.is_some()
                    && (snap.last_poll.is_none() || snap.stale)
                {
                    return StatusCode::SERVICE_UNAVAILABLE;
                }
                StatusCode::OK
            }
        }
    }
}

// ─── env-var helpers ─────────────────────────────────────────────────────

/// Read an environment variable or log + exit(1). Use for values that are
/// required for the service to do any work — there is no sensible fallback
/// and continuing would only hide the misconfiguration.
pub fn fatal_env(key: &str) -> String {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => v,
        Ok(_) => {
            eprintln!("[FATAL] Required environment variable is empty: {key}");
            log_flush_and_exit(1);
        }
        Err(_) => {
            eprintln!("[FATAL] Required environment variable is not set: {key}");
            log_flush_and_exit(1);
        }
    }
}

// ─── supervised task spawning ────────────────────────────────────────────

/// Spawn a tokio task that will take the entire process down on panic or
/// early return treated as fatal. Wraps the future with `catch_unwind` so a
/// panic in a spawned task no longer disappears silently — instead it logs
/// `{panic:?}` and calls `exit(1)`.
///
/// `name` is used only for log context.
pub fn spawn_supervised<F>(name: &'static str, fut: F) -> tokio::task::JoinHandle<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    tokio::spawn(async move {
        let result = AssertUnwindSafe(fut).catch_unwind().await;
        if let Err(panic) = result {
            eprintln!(
                "[FATAL] Supervised task '{name}' panicked: {:?}",
                panic_message(&panic)
            );
            log_flush_and_exit(1);
        }
    })
}

fn panic_message(panic: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = panic.downcast_ref::<String>() {
        s.clone()
    } else {
        format!("{:?}", panic)
    }
}

// ─── graceful process exit ───────────────────────────────────────────────

/// Sleep briefly so in-flight log messages can flush, then exit with the
/// given code. Used for [`fatal_env`] and [`spawn_supervised`] on panic.
///
/// The sleep gives the async logger's mpsc receiver a chance to drain; it
/// also guarantees Kubernetes sees at least one `/health/ready` 503 before
/// the pod goes away, which keeps restart loops easier to diagnose.
pub fn log_flush_and_exit(code: i32) -> ! {
    std::thread::sleep(Duration::from_secs(2));
    std::process::exit(code);
}

/// Mark a readiness gate as failed and then terminate the process after a
/// short grace period so Kubernetes restarts the pod. Unlike the old
/// `return;` pattern, this makes silent failure impossible.
///
/// The 5-second grace period lets at least one `readinessProbe` cycle
/// observe the 503 before the pod terminates, making outages visible in
/// `kubectl describe pod` output instead of just appearing as a restart
/// with no context.
pub async fn fatal(gate: &ReadinessGate, reason: impl Into<String>) -> ! {
    let reason = reason.into();
    eprintln!("[FATAL] {reason}");
    gate.mark_failed(reason).await;
    tokio::time::sleep(Duration::from_secs(5)).await;
    log_flush_and_exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn starting_returns_503() {
        let gate = ReadinessGate::new(Some(Duration::from_secs(60)));
        assert_eq!(gate.http_status().await, StatusCode::SERVICE_UNAVAILABLE);
        let snap = gate.snapshot().await;
        assert!(matches!(snap.state, ReadinessState::Starting));
        assert!(!snap.stale);
    }

    #[tokio::test]
    async fn ready_without_poll_returns_503_when_staleness_required() {
        let gate = ReadinessGate::new(Some(Duration::from_secs(60)));
        gate.mark_ready().await;
        // Ready but no poll has happened yet — 503 so probes don't route traffic
        // to a pod that hasn't done any real work.
        assert_eq!(gate.http_status().await, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn ready_without_staleness_config_returns_200_immediately() {
        let gate = ReadinessGate::new(None);
        gate.mark_ready().await;
        assert_eq!(gate.http_status().await, StatusCode::OK);
    }

    #[tokio::test]
    async fn ready_with_fresh_poll_returns_200() {
        let gate = ReadinessGate::new(Some(Duration::from_secs(60)));
        gate.mark_ready().await;
        gate.record_poll().await;
        assert_eq!(gate.http_status().await, StatusCode::OK);
        assert!(!gate.snapshot().await.stale);
    }

    #[tokio::test]
    async fn ready_with_stale_poll_returns_503() {
        let gate = ReadinessGate::new(Some(Duration::from_millis(50)));
        gate.mark_ready().await;
        gate.record_poll().await;
        // Wait past the staleness window
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(gate.http_status().await, StatusCode::SERVICE_UNAVAILABLE);
        assert!(gate.snapshot().await.stale);
    }

    #[tokio::test]
    async fn failed_always_returns_503() {
        let gate = ReadinessGate::new(None);
        gate.mark_failed("db init: boom").await;
        assert_eq!(gate.http_status().await, StatusCode::SERVICE_UNAVAILABLE);
        let snap = gate.snapshot().await;
        match snap.state {
            ReadinessState::Failed { reason } => assert_eq!(reason, "db init: boom"),
            other => panic!("expected Failed, got {other:?}"),
        }
    }
}
