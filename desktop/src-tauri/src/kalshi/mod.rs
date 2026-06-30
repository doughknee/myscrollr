//! Client-side Kalshi Trade API access for the desktop app.
//!
//! IMPORTANT — privacy/legal architecture (do not change without review):
//! the user's Kalshi credentials (Key ID + RSA private key) live ONLY on the
//! user's machine. The desktop's own Rust backend holds the key (in the OS
//! keychain via `store`), signs requests locally (`sign`), and talks to Kalshi
//! directly. Credentials are NEVER transmitted to or stored on Scrollr
//! servers/Postgres. Kalshi's Developer Agreement (§3.1/3.2/3.6/3.7) prohibits
//! a third party storing/using another member's keys server-side; on-device is
//! the only permitted model.
//!
//! READ-ONLY: this module only ever issues GET requests against the user's
//! portfolio (balance/positions/fills/orders) and subscribes to read-only WS
//! channels. It MUST NEVER place or cancel orders.

pub mod model;
pub mod rest;
pub mod sign;
pub mod store;
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

/// Which Kalshi environment a credential targets. Keys are environment
/// specific — a prod key only works against prod, a demo key against demo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KalshiEnv {
    Prod,
    Demo,
}

impl KalshiEnv {
    /// Parse the string the frontend sends; defaults to prod for anything
    /// that is not explicitly "demo" (the user's real key is a prod key).
    pub fn parse(s: &str) -> Self {
        if s.eq_ignore_ascii_case("demo") {
            KalshiEnv::Demo
        } else {
            KalshiEnv::Prod
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            KalshiEnv::Prod => "prod",
            KalshiEnv::Demo => "demo",
        }
    }

    pub fn rest_base(self) -> &'static str {
        match self {
            KalshiEnv::Prod => PROD_REST_BASE,
            KalshiEnv::Demo => DEMO_REST_BASE,
        }
    }

    pub fn ws_url(self) -> &'static str {
        match self {
            KalshiEnv::Prod => PROD_WS_URL,
            KalshiEnv::Demo => DEMO_WS_URL,
        }
    }
}
