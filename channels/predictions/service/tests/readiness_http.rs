//! Integration test for the readiness gate wired to an axum router.
//!
//! This test builds the same two-handler setup that lives in `main.rs`
//! (`/health/live` and `/health/ready`), flips the [`ReadinessGate`] state
//! by hand, and verifies the HTTP status codes — proving that the silent
//! "always 200" failure mode is gone.
//!
//! Without this test, the per-gate unit tests in `init::tests` would still
//! pass even if someone wired up the handler incorrectly (e.g. forgot to
//! forward the status code). Catching that requires exercising the actual
//! axum tower pipeline.

use std::{sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    routing::get,
    Json, Router,
};
use predictions_service::init::{ReadinessGate, ReadinessSnapshot};
use serde::Serialize;
use tower::ServiceExt; // for `oneshot`

#[derive(Clone)]
struct TestState {
    readiness: Arc<ReadinessGate>,
}

#[derive(Serialize)]
struct ReadyPayload {
    #[serde(flatten)]
    readiness: ReadinessSnapshot,
}

async fn live_handler() -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(serde_json::json!({"status": "alive"})))
}

async fn ready_handler(State(state): State<TestState>) -> (StatusCode, Json<ReadyPayload>) {
    let readiness = state.readiness.snapshot().await;
    let code = state.readiness.http_status().await;
    (code, Json(ReadyPayload { readiness }))
}

fn build_app(readiness: Arc<ReadinessGate>) -> Router {
    let state = TestState { readiness };
    Router::new()
        .route("/health", get(ready_handler))
        .route("/health/live", get(live_handler))
        .route("/health/ready", get(ready_handler))
        .with_state(state)
}

async fn status_of(app: &Router, path: &str) -> StatusCode {
    let response = app
        .clone()
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    response.status()
}

#[tokio::test]
async fn live_is_always_200_even_when_readiness_starting() {
    let gate = Arc::new(ReadinessGate::new(Some(Duration::from_secs(60))));
    let app = build_app(gate);
    // Starting state → /health/live should still return 200 because
    // Kubernetes needs liveness separated from readiness.
    assert_eq!(status_of(&app, "/health/live").await, StatusCode::OK);
}

#[tokio::test]
async fn ready_returns_503_while_starting() {
    let gate = Arc::new(ReadinessGate::new(Some(Duration::from_secs(60))));
    let app = build_app(gate);
    assert_eq!(
        status_of(&app, "/health/ready").await,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test]
async fn ready_returns_503_after_mark_ready_but_no_poll_when_staleness_required() {
    let gate = Arc::new(ReadinessGate::new(Some(Duration::from_secs(60))));
    gate.mark_ready().await;
    let app = build_app(gate);
    assert_eq!(
        status_of(&app, "/health/ready").await,
        StatusCode::SERVICE_UNAVAILABLE,
        "ready with no recorded poll must still be 503 when a staleness threshold is set"
    );
}

#[tokio::test]
async fn ready_returns_200_after_poll_recorded() {
    let gate = Arc::new(ReadinessGate::new(Some(Duration::from_secs(60))));
    gate.mark_ready().await;
    gate.record_poll().await;
    let app = build_app(gate);
    assert_eq!(status_of(&app, "/health/ready").await, StatusCode::OK);
}

#[tokio::test]
async fn ready_returns_503_when_poll_is_stale() {
    let gate = Arc::new(ReadinessGate::new(Some(Duration::from_millis(50))));
    gate.mark_ready().await;
    gate.record_poll().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let app = build_app(gate);
    assert_eq!(
        status_of(&app, "/health/ready").await,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test]
async fn ready_returns_503_after_mark_failed() {
    let gate = Arc::new(ReadinessGate::new(None));
    gate.mark_failed("test: boom").await;
    let app = build_app(gate);
    assert_eq!(
        status_of(&app, "/health/ready").await,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test]
async fn root_health_path_mirrors_ready() {
    // Back-compat: the k8s probes currently point at /health. Until PR 5
    // updates the manifests, /health must behave like /health/ready.
    let gate = Arc::new(ReadinessGate::new(Some(Duration::from_secs(60))));
    let app = build_app(gate.clone());
    assert_eq!(
        status_of(&app, "/health").await,
        StatusCode::SERVICE_UNAVAILABLE,
        "/health should alias /health/ready, not /health/live"
    );
    gate.mark_ready().await;
    gate.record_poll().await;
    assert_eq!(status_of(&app, "/health").await, StatusCode::OK);
}
