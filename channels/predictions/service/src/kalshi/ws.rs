//! Kalshi WebSocket helpers — builds the signed upgrade request and the
//! subscribe envelope. Reconnect/backoff and the read loop live in the service
//! (`websocket.rs` / `lib.rs`); this module is the connection primitive shared
//! with the standalone probe.

use anyhow::{Context, Result};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};

use super::sign::Signer;
use super::WS_PATH;

/// Builds a WebSocket upgrade `Request` carrying the three signed
/// `KALSHI-ACCESS-*` headers. The WS handshake signs the WS path
/// (`/trade-api/ws/v2`), which is distinct from the REST prefix.
pub fn signed_ws_request(url: &str, signer: &Signer) -> Result<Request> {
    let (timestamp, signature) = signer.sign("GET", WS_PATH)?;
    let mut req = url
        .into_client_request()
        .context("build websocket upgrade request")?;
    let headers = req.headers_mut();
    headers.insert(
        HeaderName::from_static("kalshi-access-key"),
        HeaderValue::from_str(signer.key_id()).context("key id header")?,
    );
    headers.insert(
        HeaderName::from_static("kalshi-access-timestamp"),
        HeaderValue::from_str(&timestamp).context("timestamp header")?,
    );
    headers.insert(
        HeaderName::from_static("kalshi-access-signature"),
        HeaderValue::from_str(&signature).context("signature header")?,
    );
    Ok(req)
}

/// Builds a subscribe command envelope for one or more channels over the whole
/// market universe (no market selector → all markets).
pub fn subscribe_all(id: u64, channels: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "cmd": "subscribe",
        "params": { "channels": channels },
    })
}

/// Builds a subscribe command scoped to specific market tickers.
pub fn subscribe_markets(id: u64, channels: &[&str], market_tickers: &[String]) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "cmd": "subscribe",
        "params": { "channels": channels, "market_tickers": market_tickers },
    })
}
