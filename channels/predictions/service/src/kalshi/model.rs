//! Kalshi REST/WS payload models (the subset the ingestion service reads).
//!
//! Every price is a `*_dollars` decimal string (e.g. "0.6200") and every count
//! is a `*_fp` decimal string (e.g. "33896.00"). We keep them as `String` here
//! and parse to typed values at the display/ingestion boundary; this is robust
//! to Kalshi's ongoing field evolution. All fields are optional/defaulted so a
//! payload shape change never fails deserialization of the whole batch.

use serde::Deserialize;

/// A tradable Kalshi market (one YES/NO contract).
#[derive(Debug, Deserialize, Default, Clone)]
pub struct Market {
    #[serde(default)]
    pub ticker: String,
    #[serde(default)]
    pub event_ticker: String,
    #[serde(default)]
    pub yes_sub_title: Option<String>,
    #[serde(default)]
    pub no_sub_title: Option<String>,
    /// Lifecycle enum: initialized|active|closed|determined|settled|…
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub yes_bid_dollars: Option<String>,
    #[serde(default)]
    pub yes_ask_dollars: Option<String>,
    #[serde(default)]
    pub no_bid_dollars: Option<String>,
    #[serde(default)]
    pub no_ask_dollars: Option<String>,
    #[serde(default)]
    pub last_price_dollars: Option<String>,
    #[serde(default)]
    pub previous_price_dollars: Option<String>,
    #[serde(default)]
    pub volume_fp: Option<String>,
    #[serde(default)]
    pub volume_24h_fp: Option<String>,
    #[serde(default)]
    pub open_interest_fp: Option<String>,
    #[serde(default)]
    pub open_time: Option<String>,
    #[serde(default)]
    pub close_time: Option<String>,
    /// Settlement outcome when settled: yes|no|scalar|"".
    #[serde(default)]
    pub result: Option<String>,
}

/// Response shape of `GET /trade-api/v2/markets`.
#[derive(Debug, Deserialize, Default)]
pub struct MarketsResponse {
    #[serde(default)]
    pub markets: Vec<Market>,
    /// Opaque cursor; empty string means no more pages.
    #[serde(default)]
    pub cursor: String,
}

/// A Kalshi event — groups related markets (the human-readable question).
#[derive(Debug, Deserialize, Default, Clone)]
pub struct EventData {
    #[serde(default)]
    pub event_ticker: String,
    #[serde(default)]
    pub series_ticker: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub sub_title: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// Present only when requested with `with_nested_markets=true`.
    #[serde(default)]
    pub markets: Vec<Market>,
}

/// Response shape of `GET /trade-api/v2/events`.
#[derive(Debug, Deserialize, Default)]
pub struct EventsResponse {
    #[serde(default)]
    pub events: Vec<EventData>,
    #[serde(default)]
    pub cursor: String,
}
