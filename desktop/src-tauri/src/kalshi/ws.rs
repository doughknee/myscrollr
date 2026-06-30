//! Kalshi WebSocket helpers — builds the signed upgrade request and the
//! subscribe envelope for the user's authenticated read-only channels
//! (`market_positions`, `fill`, `user_orders`). The reconnect/read loop lives
//! in `commands::kalshi`.
//!
//! Copied in spirit from `channels/predictions/service/src/kalshi/ws.rs`; this
//! copy subscribes to the *user-data* channels rather than the public market
//! feed. All of these channels are read-only subscriptions.

use anyhow::{Context, Result};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};

use super::sign::Signer;
use super::WS_PATH;

/// The authenticated, read-only WS channels we subscribe to for live portfolio
/// updates. None of these can mutate the account.
pub const USER_CHANNELS: &[&str] = &["market_positions", "fill", "user_orders"];

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

/// Builds a subscribe command envelope for the user-data channels.
pub fn subscribe_user(id: u64) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "cmd": "subscribe",
        "params": { "channels": USER_CHANNELS },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscribe_envelope_lists_only_read_only_channels() {
        let env = subscribe_user(1);
        let channels = env["params"]["channels"].as_array().unwrap();
        let names: Vec<&str> = channels.iter().map(|c| c.as_str().unwrap()).collect();
        assert_eq!(names, vec!["market_positions", "fill", "user_orders"]);
        // Guard: no order-mutating channel ever sneaks in here.
        assert!(!names.iter().any(|n| n.contains("create") || n.contains("cancel")));
    }
}
