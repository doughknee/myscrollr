use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::database::PgPool;
use crate::init::{fatal_env, log_flush_and_exit};
use crate::kalshi::{self, rest::RestClient, sign::Signer};

/// A market entry from configs/markets.json (the seed catalog).
///
/// The seed is only metadata/fallback — the dynamic REST sweep in `lib.rs`
/// is the real populate. Enabled tickers are loaded from the DB at runtime.
#[derive(Debug, Deserialize, Clone)]
pub struct TrackedMarketConfig {
    pub ticker: String,
    pub title: String,
    pub category: String,
    #[serde(default)]
    pub series_ticker: Option<String>,
}

/// Shared service state: the Kalshi signed REST client + signing key, the
/// DB pool, and the set of currently-enabled market tickers (loaded from DB).
#[derive(Clone)]
pub struct PredictionsState {
    /// The Kalshi RSA-PSS signer (key id + private key). Cheap to clone.
    pub signer: Signer,
    /// Signed REST client for the catalog sweep.
    pub rest: RestClient,
    /// REST base host for the selected environment.
    pub rest_base: String,
    /// Full WebSocket URL for the selected environment.
    pub ws_url: String,
    /// `true` when running against the Kalshi demo environment.
    pub demo: bool,
    /// Enabled market tickers loaded from the DB at construction time.
    pub subscriptions: Vec<String>,
    pub pool: Arc<PgPool>,
}

impl PredictionsState {
    pub async fn new(pool: Arc<PgPool>) -> Self {
        // Required Kalshi credentials. `fatal_env` exits(1) so Kubernetes
        // restarts the pod and the misconfiguration is visible, rather than
        // panicking inside a spawned task and leaving a zombie pod.
        let key_id = fatal_env("KALSHI_API_KEY_ID");

        // Private key may be supplied inline (KALSHI_PRIVATE_KEY) or via a
        // path (KALSHI_PRIVATE_KEY_PATH). Mirror the probe's resolution order.
        let pem = match std::env::var("KALSHI_PRIVATE_KEY") {
            Ok(p) if !p.trim().is_empty() => p,
            _ => {
                let path = fatal_env("KALSHI_PRIVATE_KEY_PATH");
                match std::fs::read_to_string(&path) {
                    Ok(contents) => contents,
                    Err(e) => {
                        eprintln!("[FATAL] Failed to read KALSHI_PRIVATE_KEY_PATH ({path}): {e:#}");
                        log_flush_and_exit(1);
                    }
                }
            }
        };

        let demo = std::env::var("KALSHI_ENV")
            .map(|v| v.eq_ignore_ascii_case("demo"))
            .unwrap_or(false);
        let (rest_base, ws_url) = kalshi::endpoints(demo);

        let signer = match Signer::from_pem(key_id, &pem) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[FATAL] Failed to load Kalshi signing key: {e:#}");
                log_flush_and_exit(1);
            }
        };

        let rest = match RestClient::new(rest_base, signer.clone()) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[FATAL] Failed to build Kalshi REST client: {e:#}");
                log_flush_and_exit(1);
            }
        };

        // Load enabled tickers from the database (source of truth at runtime).
        let subscriptions = crate::database::get_enabled_markets(pool.clone()).await;

        Self {
            signer,
            rest,
            rest_base: rest_base.to_string(),
            ws_url: ws_url.to_string(),
            demo,
            subscriptions,
            pool,
        }
    }
}

/// Build a signed REST client from env WITHOUT the fatal-exit behavior of
/// `PredictionsState::new`. Used by the health server's `/internal/
/// candlesticks` proxy (v1.1.4): when creds are absent the endpoint
/// degrades to 503 instead of taking the whole process down before init
/// ever runs.
pub fn try_rest_client_from_env() -> anyhow::Result<RestClient> {
    use anyhow::Context;
    let key_id = std::env::var("KALSHI_API_KEY_ID").context("KALSHI_API_KEY_ID unset")?;
    let pem = match std::env::var("KALSHI_PRIVATE_KEY") {
        Ok(p) if !p.trim().is_empty() => p,
        _ => {
            let path = std::env::var("KALSHI_PRIVATE_KEY_PATH")
                .context("neither KALSHI_PRIVATE_KEY nor KALSHI_PRIVATE_KEY_PATH set")?;
            std::fs::read_to_string(&path)
                .with_context(|| format!("read KALSHI_PRIVATE_KEY_PATH ({path})"))?
        }
    };
    let demo = std::env::var("KALSHI_ENV")
        .map(|v| v.eq_ignore_ascii_case("demo"))
        .unwrap_or(false);
    let (rest_base, _ws_url) = kalshi::endpoints(demo);
    let signer = Signer::from_pem(key_id, &pem)?;
    RestClient::new(rest_base, signer)
}

/// Health payload surfaced through `/health/ready`. The readiness bridge loop
/// in `main.rs` reads `connection_status == "connected"` and `batch_number`,
/// so those two fields must stay present and named exactly.
#[derive(Serialize)]
pub struct PredictionsHealth {
    pub status: String,
    pub connection_status: String,
    pub batch_number: u64,
    pub error_count: u64,
    pub last_error: Option<String>,
}

impl Default for PredictionsHealth {
    fn default() -> Self {
        Self::new()
    }
}

impl PredictionsHealth {
    pub fn new() -> Self {
        Self {
            status: String::from("healthy"),
            connection_status: String::from("disconnected"),
            batch_number: 0,
            error_count: 0,
            last_error: None,
        }
    }

    pub(crate) fn update_health(
        &mut self,
        connection_status: String,
        batch_number: u64,
        error_count: u64,
        last_error: Option<String>,
    ) {
        self.connection_status = connection_status;
        self.batch_number = batch_number;
        self.error_count = error_count;
        self.last_error = last_error;
    }

    pub fn get_health(&self) -> Self {
        Self {
            status: self.status.clone(),
            connection_status: self.connection_status.clone(),
            batch_number: self.batch_number,
            error_count: self.error_count,
            last_error: self.last_error.clone(),
        }
    }
}
