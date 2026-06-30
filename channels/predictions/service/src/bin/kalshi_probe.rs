//! Standalone Kalshi live-data probe (dev tool, infra-free).
//!
//! Proves the real ingestion engine end-to-end against a real Kalshi account:
//! signs requests with the account's RSA key, pulls live open markets over
//! REST, then opens the authenticated WebSocket and streams live ticker
//! updates. Needs NO Postgres/Redis/Sequin — just network + the key.
//!
//! Run:
//!   KALSHI_API_KEY_ID=<uuid> \
//!   KALSHI_PRIVATE_KEY_PATH=/path/to/key.pem \
//!   cargo run --bin kalshi_probe
//!
//! Optional: KALSHI_ENV=demo to hit the demo environment; KALSHI_PRIVATE_KEY
//! may carry the PEM inline instead of a path.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use predictions_service::kalshi::{self, rest::RestClient, sign::Signer, ws};
use tokio_tungstenite::tungstenite::Message;

#[tokio::main]
async fn main() -> Result<()> {
    let key_id = std::env::var("KALSHI_API_KEY_ID")
        .context("set KALSHI_API_KEY_ID to your Kalshi API key id")?;

    let pem = match std::env::var("KALSHI_PRIVATE_KEY") {
        Ok(p) if !p.trim().is_empty() => p,
        _ => {
            let path = std::env::var("KALSHI_PRIVATE_KEY_PATH")
                .context("set KALSHI_PRIVATE_KEY (inline PEM) or KALSHI_PRIVATE_KEY_PATH")?;
            std::fs::read_to_string(&path).with_context(|| format!("read key file {path}"))?
        }
    };

    let demo = std::env::var("KALSHI_ENV").map(|v| v == "demo").unwrap_or(false);
    let (rest_base, ws_url) = kalshi::endpoints(demo);

    let signer = Signer::from_pem(key_id, &pem).context("load signing key")?;
    println!(
        "== Kalshi probe ==  env={}  rest={}",
        if demo { "demo" } else { "prod" },
        rest_base
    );

    // 1) REST: list a page of live open markets — proves request signing.
    let rest = RestClient::new(rest_base, signer.clone())?;
    let markets = rest
        .get_markets("limit=15&status=open")
        .await
        .context("REST /markets (auth or network failure)")?;

    println!(
        "\n[REST] GET /markets?status=open → {} markets (showing up to 15):",
        markets.markets.len()
    );
    println!(
        "  {:<30} {:>8} {:>8} {:>8} {:>12}  status",
        "ticker", "yes_bid", "yes_ask", "last", "volume"
    );
    for m in markets.markets.iter().take(15) {
        println!(
            "  {:<30} {:>8} {:>8} {:>8} {:>12}  {}",
            truncate(&m.ticker, 30),
            m.yes_bid_dollars.as_deref().unwrap_or("-"),
            m.yes_ask_dollars.as_deref().unwrap_or("-"),
            m.last_price_dollars.as_deref().unwrap_or("-"),
            m.volume_fp.as_deref().unwrap_or("-"),
            m.status.as_deref().unwrap_or("-"),
        );
    }

    // 2) WS: authenticated upgrade + live ticker stream — proves WS signing.
    println!("\n[WS] connect {ws_url}");
    let req = ws::signed_ws_request(ws_url, &signer)?;
    let (mut socket, _resp) = tokio_tungstenite::connect_async(req)
        .await
        .context("WebSocket connect (auth or network failure)")?;
    println!("[WS] connected. subscribing to `ticker` (all markets)…");

    let sub = ws::subscribe_all(1, &["ticker"]);
    socket
        .send(Message::Text(sub.to_string().into()))
        .await
        .context("send subscribe")?;

    let mut shown = 0usize;
    let deadline = tokio::time::sleep(std::time::Duration::from_secs(30));
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            _ = &mut deadline => {
                println!("[WS] 30s elapsed, stopping.");
                break;
            }
            msg = socket.next() => {
                let Some(msg) = msg else { println!("[WS] stream ended."); break; };
                match msg.context("ws read")? {
                    Message::Text(t) => {
                        println!("  ws> {}", t.as_str());
                        shown += 1;
                        if shown >= 15 {
                            println!("[WS] received 15 live messages.");
                            break;
                        }
                    }
                    Message::Close(c) => {
                        println!("[WS] closed by server: {c:?}");
                        break;
                    }
                    Message::Ping(_) | Message::Pong(_) | Message::Binary(_) | Message::Frame(_) => {}
                }
            }
        }
    }

    println!("\n✅ Probe OK — RSA-PSS signing, REST auth, and WS auth all working against live Kalshi.");
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}
