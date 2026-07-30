use std::{collections::HashMap, sync::Arc, time::{Duration, Instant}, pin::Pin};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::time::Sleep;
use crate::database::PgPool;
use crate::init::fatal_env;

/// A symbol entry from configs/subscriptions.json (categorized format).
#[derive(Debug, Deserialize, Clone)]
pub struct TrackedSymbolConfig {
    pub symbol: String,
    pub name: String,
    pub category: String,
    #[serde(default)]
    pub exchange: Option<String>,
}

/// TwelveData /stocks endpoint response.
#[derive(Debug, Deserialize)]
pub(crate) struct TwelveDataStocksResponse {
    pub data: Vec<TwelveDataStock>,
    #[allow(dead_code)]
    pub status: String,
}

/// A single stock entry from TwelveData /stocks endpoint.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct TwelveDataStock {
    pub symbol: String,
    pub exchange: String,
}

/// TwelveData WebSocket price event.
///
/// ```json
/// {"event":"price","symbol":"AAPL","price":150.75,"timestamp":1678886400,"day_volume":5000000}
/// ```
#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub(crate) struct PriceEvent {
    pub event: String,
    pub symbol: Option<String>,
    pub price: Option<f64>,
    pub timestamp: Option<u64>,
    pub day_volume: Option<u64>,
    /// Present on status/error events
    pub status: Option<String>,
    pub message: Option<String>,
}

/// Simplified trade data extracted from a PriceEvent for the update queue.
#[derive(Debug, Clone)]
pub(crate) struct TradeData {
    pub symbol: String,
    pub price: f64,
    pub timestamp: u64,
    pub day_volume: Option<u64>,
}

#[derive(Debug, Default)]
pub(crate) struct BatchStats {
    pub batches_processed: u64,
    pub total_updates_processed: u64,
    pub errors: u64,
}

/// TwelveData REST quote response.
///
/// Success example:
/// ```json
/// {"symbol":"AAPL","close":"150.75","previous_close":"149.50","change":"1.25","percent_change":"0.84",...}
/// ```
///
/// Error example (rate limit, bad symbol, etc.):
/// ```json
/// {"code":429,"message":"Too many requests","status":"error"}
/// ```
#[derive(Debug, Deserialize)]
pub(crate) struct QuoteResponse {
    pub close: Option<String>,
    pub previous_close: Option<String>,
    pub change: Option<String>,
    pub percent_change: Option<String>,
    /// Present on error responses (e.g. 400, 401, 429).
    pub code: Option<u16>,
    pub message: Option<String>,
    pub status: Option<String>,
}

impl QuoteResponse {
    /// Returns true when TwelveData returned an error instead of quote data.
    pub fn is_error(&self) -> bool {
        self.code.is_some() || self.status.as_deref() == Some("error")
    }

    pub fn close_f64(&self) -> f64 {
        self.close.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0.0)
    }
    pub fn previous_close_f64(&self) -> f64 {
        self.previous_close.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0.0)
    }
    pub fn change_f64(&self) -> f64 {
        self.change.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0.0)
    }
    pub fn percent_change_f64(&self) -> f64 {
        self.percent_change.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0.0)
    }
}

pub(crate) struct WebSocketState {
    pub update_queue: HashMap<String, TradeData>,
    pub batch_timer: Option<Pin<Box<Sleep>>>,
    pub is_processing_batch: bool,
    pub stats: BatchStats,
    pub last_log_time: Option<Instant>,
    pub last_error_message: Option<String>,
}

impl WebSocketState {
    pub fn new() -> Self {
        Self {
            update_queue: HashMap::new(),
            batch_timer: None,
            is_processing_batch: false,
            stats: BatchStats::default(),
            last_log_time: None,
            last_error_message: None,
        }
    }
}

#[derive(Clone)]
pub struct FinanceState {
    pub api_key: String,
    pub subscriptions: Vec<String>,
    pub client: Arc<Client>,
    pub pool: Arc<PgPool>,
}

impl FinanceState {
    pub async fn new(pool: Arc<PgPool>) -> Self {
        // `.expect()` here used to panic *inside a spawned tokio task*, which
        // did not kill the process — leaving the pod nominally healthy while
        // no finance work was happening. `fatal_env` exits(1) so Kubernetes
        // restarts the pod and the misconfiguration is visible.
        let api_key = fatal_env("TWELVEDATA_API_KEY");

        // TwelveData uses apikey as a query parameter, no custom headers needed.
        // A reqwest builder failure here would indicate a broken TLS/dns
        // subsystem — unrecoverable, exit rather than fall back silently.
        let client = match Client::builder()
            .timeout(Duration::from_millis(10_000))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[FATAL] Failed to build finance reqwest client: {e:#}");
                crate::init::log_flush_and_exit(1);
            }
        };

        // Load symbols from database instead of file
        let subscriptions = crate::database::get_tracked_symbols(pool.clone()).await;

        Self {
            api_key,
            subscriptions,
            client: Arc::new(client),
            pool,
        }
    }
}

#[derive(Serialize)]
pub struct FinanceHealth {
    pub status: String,
    pub connection_status: String,
    pub batch_number: u64,
    pub error_count: u64,
    pub last_error: Option<String>,
}

impl Default for FinanceHealth {
    fn default() -> Self {
        Self::new()
    }
}

impl FinanceHealth {
    pub fn new() -> Self {
        Self {
            status: String::from("healthy"),
            connection_status: String::from("disconnected"),
            batch_number: 0,
            error_count: 0,
            last_error: None,
        }
    }

    pub(crate) fn update_health(&mut self, connection_status: String, batch_number: u64, error_count: u64, last_error: Option<String>) {
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

#[cfg(test)]
mod tests {
    use super::*;


    #[test]
    fn test_quote_response_success() {
        let qr = QuoteResponse {
            close: Some("150.75".to_string()),
            previous_close: Some("149.50".to_string()),
            change: Some("1.25".to_string()),
            percent_change: Some("0.84".to_string()),
            code: None,
            message: None,
            status: Some("ok".to_string()),
        };
        assert!(!qr.is_error());
        assert!((qr.close_f64() - 150.75).abs() < 0.001);
        assert!((qr.previous_close_f64() - 149.50).abs() < 0.001);
        assert!((qr.change_f64() - 1.25).abs() < 0.001);
        assert!((qr.percent_change_f64() - 0.84).abs() < 0.001);
    }

    #[test]
    fn test_quote_response_error_by_code() {
        let qr = QuoteResponse {
            close: None, previous_close: None, change: None, percent_change: None,
            code: Some(429), message: Some("Rate limit".to_string()), status: None,
        };
        assert!(qr.is_error());
    }

    #[test]
    fn test_quote_response_error_by_status() {
        let qr = QuoteResponse {
            close: None, previous_close: None, change: None, percent_change: None,
            code: None, message: None, status: Some("error".to_string()),
        };
        assert!(qr.is_error());
    }

    #[test]
    fn test_quote_response_no_error() {
        let qr = QuoteResponse {
            close: None, previous_close: None, change: None, percent_change: None,
            code: None, message: None, status: Some("ok".to_string()),
        };
        assert!(!qr.is_error());
    }

    #[test]
    fn test_quote_response_missing_fields_defaults_to_zero() {
        let qr = QuoteResponse {
            close: Some("invalid".to_string()),
            previous_close: Some("".to_string()),
            change: None,
            percent_change: Some("N/A".to_string()),
            code: None, message: None, status: None,
        };
        assert_eq!(qr.close_f64(), 0.0);
        assert_eq!(qr.previous_close_f64(), 0.0);
        assert_eq!(qr.change_f64(), 0.0);
        assert_eq!(qr.percent_change_f64(), 0.0);
    }

    #[test]
    fn test_quote_response_negative_values() {
        let qr = QuoteResponse {
            close: Some("-5.50".to_string()),
            previous_close: Some("-5.00".to_string()),
            change: Some("-0.50".to_string()),
            percent_change: Some("-10.0".to_string()),
            code: None, message: None, status: None,
        };
        assert_eq!(qr.close_f64(), -5.50);
        assert_eq!(qr.previous_close_f64(), -5.00);
        assert_eq!(qr.change_f64(), -0.50);
        assert_eq!(qr.percent_change_f64(), -10.0);
    }

    #[test]
    fn test_quote_response_large_numbers() {
        let qr = QuoteResponse {
            close: Some("999999999.99".to_string()),
            previous_close: Some("1000000000.00".to_string()),
            change: Some("-0.01".to_string()),
            percent_change: Some("-0.000001".to_string()),
            code: None, message: None, status: None,
        };
        assert!((qr.close_f64() - 999999999.99).abs() < 0.001);
    }
}
