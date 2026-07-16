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
/// (Kalshi also runs a demo environment at external-api.demo.kalshi.co;
/// the app targeted prod-only in practice, so the env plumbing was
/// removed — reintroduce a KalshiEnv enum here if demo keys are ever
/// needed for testing.)
pub const PROD_REST_BASE: &str = "https://external-api.kalshi.com";

/// WebSocket URL (full, includes the ws path). Production.
pub const PROD_WS_URL: &str = "wss://external-api-ws.kalshi.com/trade-api/ws/v2";

/// Path prefix for REST requests — part of the signed message, no query.
pub const API_PREFIX: &str = "/trade-api/v2";
/// Path signed for the WebSocket upgrade (distinct from `API_PREFIX`).
pub const WS_PATH: &str = "/trade-api/ws/v2";
