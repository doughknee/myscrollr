//! Kalshi Trade API v2 client.
//!
//! Verified against docs.kalshi.com (2026-06). Notes that shaped this code:
//! - All prices are `*_dollars` decimal STRINGS and counts are `*_fp` decimal
//!   strings; the legacy bare-integer fields (`yes_bid`, `last_price`,
//!   `volume`, …) were removed from REST + WS payloads ~Apr 2026. We model
//!   only the string fields.
//! - Every request (REST and the WS upgrade) is independently signed with
//!   RSA-PSS over `timestamp_ms + METHOD + path` (path includes the
//!   `/trade-api/v2` prefix and excludes any query string). See `sign`.

pub mod model;
pub mod rest;
pub mod sign;
pub mod ws;

/// REST host (no path). Production, dedicated external-API host.
pub const PROD_REST_BASE: &str = "https://external-api.kalshi.com";
/// REST host (no path). Demo environment — demo keys only work here.
pub const DEMO_REST_BASE: &str = "https://external-api.demo.kalshi.co";

/// WebSocket URL (full, includes the ws path). Production.
pub const PROD_WS_URL: &str = "wss://external-api-ws.kalshi.com/trade-api/ws/v2";
/// WebSocket URL (full, includes the ws path). Demo.
pub const DEMO_WS_URL: &str = "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2";

/// Path prefix for REST requests — part of the signed message, no query.
pub const API_PREFIX: &str = "/trade-api/v2";
/// Path signed for the WebSocket upgrade (distinct from `API_PREFIX`).
pub const WS_PATH: &str = "/trade-api/ws/v2";

/// Returns `(rest_base, ws_url)` for the selected environment.
pub fn endpoints(demo: bool) -> (&'static str, &'static str) {
    if demo {
        (DEMO_REST_BASE, DEMO_WS_URL)
    } else {
        (PROD_REST_BASE, PROD_WS_URL)
    }
}
