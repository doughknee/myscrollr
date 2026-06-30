//! Standalone LIVE Kalshi bridge for the desktop app (dev tool, infra-free).
//!
//! Streams real Kalshi prediction-market data straight to the desktop with
//! ZERO infrastructure — no Postgres, Redis, Sequin, or Logto. It reuses the
//! proven `predictions_service::kalshi` client (RSA-PSS signing, REST, WS),
//! holds the live `Prediction` set in memory, and serves the exact JSON shapes
//! the desktop already expects:
//!
//!   GET /public/feed  -> {"data":{"predictions":[…]}}
//!   GET /dashboard    -> {"data":{"predictions":[…]},"channels":[…]}
//!   GET /events       -> SSE; each frame is {"data":[{action,record,metadata}]}
//!
//! All routes are UNAUTHENTICATED (any Authorization header is ignored) and
//! served with permissive CORS so the Tauri webview can fetch cross-origin.
//!
//! Run:
//!   KALSHI_API_KEY_ID=<uuid> \
//!   KALSHI_PRIVATE_KEY_PATH=/path/to/key.pem \
//!   cargo run --bin serve_bridge
//!
//! Optional: KALSHI_ENV=demo (default prod); PORT (default 3005);
//! KALSHI_PRIVATE_KEY may carry the PEM inline instead of a path.

use std::{convert::Infallible, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::{
    extract::State,
    response::{
        sse::{Event, KeepAlive, Sse},
        Json,
    },
    routing::{get, put},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{broadcast, RwLock};
use tokio_stream::wrappers::BroadcastStream;
use tokio_tungstenite::tungstenite::Message;

use predictions_service::kalshi::{
    self,
    model::Market,
    rest::RestClient,
    sign::Signer,
    ws,
};

/// How many of the highest-volume primary markets to seed the feed with.
const FEED_CAP: usize = 80;
/// Per-page limit for the initial `GET /markets` sweep.
const PAGE_LIMIT: u32 = 200;
/// Safety stop so a misbehaving cursor can't paginate forever.
const MAX_PAGES: u32 = 50;
/// Broadcast channel depth — generous so a slow SSE client doesn't drop ticks.
const BROADCAST_CAPACITY: usize = 2048;

// ─── desktop-facing Prediction (snake_case JSON, matches CONTRACT.md) ────────

/// One tracked Kalshi market, shaped EXACTLY like the desktop `Prediction`
/// interface (`desktop/src/types/index.ts`). Prices are integer cents 0–100.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Prediction {
    id: String,
    source: String,
    ticker: String,
    event_ticker: String,
    category: String,
    title: String,
    subtitle: String,
    yes_price: i64,
    yes_bid: i64,
    yes_ask: i64,
    prev_yes_price: i64,
    volume: i64,
    open_interest: i64,
    status: String,
    result: String,
    close_time: String,
    link: String,
    updated_at: String,
}

/// Shared, ordered-by-volume map of ticker -> Prediction.
type Feed = Arc<RwLock<IndexMap<String, Prediction>>>;

#[derive(Clone)]
struct AppState {
    feed: Feed,
    /// Each update broadcasts the updated Prediction to all SSE subscribers.
    updates: broadcast::Sender<Prediction>,
}

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
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3005);

    let (rest_base, ws_url) = kalshi::endpoints(demo);
    let signer = Signer::from_pem(key_id, &pem).context("load signing key")?;
    let rest = RestClient::new(rest_base, signer.clone())?;

    println!(
        "== serve_bridge ==  LIVE Kalshi  env={}  rest={}  port={}",
        if demo { "demo" } else { "prod" },
        rest_base,
        port
    );

    let (updates, _) = broadcast::channel::<Prediction>(BROADCAST_CAPACITY);
    let state = AppState {
        feed: Arc::new(RwLock::new(IndexMap::new())),
        updates,
    };

    // Background task: initial REST sweep + live WS streaming (with reconnect).
    tokio::spawn(stream_task(
        state.clone(),
        rest,
        signer,
        ws_url.to_string(),
    ));

    // Permissive CORS — the Tauri webview fetches from a different origin.
    let cors = tower_http::cors::CorsLayer::permissive();

    let app = Router::new()
        .route("/public/feed", get(public_feed))
        .route("/dashboard", get(dashboard))
        .route("/events", get(events))
        .route("/predictions/catalog", get(predictions_catalog))
        .route("/users/me/channels/predictions", put(update_channel))
        .layer(cors)
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("bind {addr}"))?;
    println!("[bridge] listening on http://{addr}  (routes: /public/feed /dashboard /events /predictions/catalog)");

    axum::serve(listener, app).await.context("axum serve")?;
    Ok(())
}

// ─── background streaming: REST sweep then WS deltas ─────────────────────────

async fn stream_task(state: AppState, rest: RestClient, signer: Signer, ws_url: String) {
    // 1) Initial REST sweep so the feed is populated before the WS streams.
    match initial_sweep(&rest).await {
        Ok(predictions) => {
            let count = predictions.len();
            {
                let mut feed = state.feed.write().await;
                for p in predictions {
                    feed.insert(p.ticker.clone(), p);
                }
            }
            println!("[bridge] initial sweep complete: {count} live predictions loaded");
        }
        Err(e) => {
            eprintln!("[bridge] initial sweep failed: {e:#}");
        }
    }

    // 2) WS reconnect loop: stream ticker deltas onto the in-memory feed.
    loop {
        if let Err(e) = ws_stream_once(&state, &signer, &ws_url).await {
            eprintln!("[bridge] WS stream ended: {e:#} — reconnecting in 5s");
        } else {
            eprintln!("[bridge] WS stream closed — reconnecting in 5s");
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

/// Seed the feed from `GET /events?with_nested_markets=true&status=open`,
/// then filter noise (KXMVE* + zero-volume), sort by volume desc, keep the
/// first market per event (is_primary), and cap at the highest-volume
/// `FEED_CAP` primaries.
///
/// We sweep `/events` rather than `/markets` because the live `/markets`
/// universe is dominated by tens of thousands of zero-volume `KXMVE*`
/// multivariate contracts that Kalshi returns *first* and unsorted — 50 pages
/// of `/markets` never reach a liquid market. `/events` is the curated,
/// human-readable grouping and carries each event's category + nested markets,
/// so it gets us to tradeable contracts immediately.
async fn initial_sweep(rest: &RestClient) -> Result<Vec<Prediction>> {
    let mut all: Vec<Market> = Vec::new();
    // Remember each market's event category/title for nicer display buckets.
    let mut event_meta: std::collections::HashMap<String, (Option<String>, String)> =
        std::collections::HashMap::new();
    let mut cursor = String::new();
    let mut pages = 0u32;

    loop {
        let query = if cursor.is_empty() {
            format!("limit={PAGE_LIMIT}&status=open&with_nested_markets=true")
        } else {
            format!("limit={PAGE_LIMIT}&status=open&with_nested_markets=true&cursor={cursor}")
        };

        let resp = rest
            .get_events(&query)
            .await
            .context("REST /events sweep page")?;
        for ev in resp.events {
            let cat = ev.category.clone();
            let title = ev.title.clone();
            for m in ev.markets {
                event_meta.insert(m.ticker.clone(), (cat.clone(), title.clone()));
                all.push(m);
            }
        }
        pages += 1;

        if resp.cursor.is_empty() {
            break;
        }
        // Stop early once we have comfortably more qualifying (non-KXMVE,
        // positive-volume) markets than the feed cap — no need to drain the
        // whole universe just to pick the top FEED_CAP by volume.
        let qualifying = all
            .iter()
            .filter(|m| !m.ticker.starts_with("KXMVE"))
            .filter(|m| fp_volume(m.volume_fp.as_deref()) > 0)
            .count();
        if qualifying >= FEED_CAP * 4 {
            break;
        }
        cursor = resp.cursor;
        tokio::time::sleep(Duration::from_millis(250)).await;
        if pages >= MAX_PAGES {
            eprintln!("[bridge] sweep hit {MAX_PAGES}-page cap; stopping pagination");
            break;
        }
    }

    println!(
        "[bridge] sweep fetched {} markets across {pages} event pages",
        all.len()
    );

    // Filter: drop KXMVE* multivariate tickers and zero-volume markets.
    let mut markets: Vec<Market> = all
        .into_iter()
        .filter(|m| !m.ticker.starts_with("KXMVE"))
        .filter(|m| fp_volume(m.volume_fp.as_deref()) > 0)
        .collect();

    // Sort by volume descending so the most-liquid markets win is_primary.
    markets.sort_by(|a, b| {
        fp_volume(b.volume_fp.as_deref()).cmp(&fp_volume(a.volume_fp.as_deref()))
    });

    // First (highest-volume) market per event is the representative.
    let mut seen_events: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<Prediction> = Vec::with_capacity(FEED_CAP);
    for m in &markets {
        let is_primary = seen_events.insert(m.event_ticker.clone());
        if !is_primary {
            continue;
        }
        let meta = event_meta.get(&m.ticker);
        out.push(market_to_prediction(m, meta));
        if out.len() >= FEED_CAP {
            break;
        }
    }

    Ok(out)
}

/// Connect the signed WS once, subscribe to `ticker`, and apply deltas to the
/// feed until the stream closes. Returns on close/error so the caller retries.
async fn ws_stream_once(state: &AppState, signer: &Signer, ws_url: &str) -> Result<()> {
    let req = ws::signed_ws_request(ws_url, signer)?;
    let (mut socket, _resp) = tokio_tungstenite::connect_async(req)
        .await
        .context("WebSocket connect")?;
    println!("[bridge] WS connected — subscribing to `ticker`");

    let sub = ws::subscribe_all(1, &["ticker"]);
    socket
        .send(Message::Text(sub.to_string().into()))
        .await
        .context("send subscribe")?;

    while let Some(msg) = socket.next().await {
        match msg.context("ws read")? {
            Message::Text(t) => {
                if let Some(updated) = apply_ticker(state, t.as_str()).await {
                    // Best-effort broadcast; lagging/absent subscribers are fine.
                    let _ = state.updates.send(updated);
                }
            }
            Message::Close(c) => {
                eprintln!("[bridge] WS closed by server: {c:?}");
                break;
            }
            Message::Ping(_) | Message::Pong(_) | Message::Binary(_) | Message::Frame(_) => {}
        }
    }
    Ok(())
}

/// Kalshi WS envelope: only `type` is needed to dispatch; payload is under `msg`.
#[derive(Debug, Deserialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    msg: serde_json::Value,
}

/// `ticker` channel payload (mirrors `websocket.rs::TickerMsg`).
#[derive(Debug, Deserialize, Default)]
struct TickerMsg {
    #[serde(default)]
    market_ticker: String,
    #[serde(default)]
    yes_bid_dollars: Option<String>,
    #[serde(default)]
    yes_ask_dollars: Option<String>,
    #[serde(default)]
    last_price_dollars: Option<String>,
    #[serde(default)]
    price_dollars: Option<String>,
    #[serde(default)]
    volume_fp: Option<String>,
    #[serde(default)]
    open_interest_fp: Option<String>,
}

/// Parse a `ticker` message and update the matching Prediction in place.
/// Returns the updated Prediction (to broadcast) only when one was matched.
async fn apply_ticker(state: &AppState, text: &str) -> Option<Prediction> {
    let envelope: WsEnvelope = serde_json::from_str(text).ok()?;
    if envelope.msg_type != "ticker" {
        return None;
    }
    let t: TickerMsg = serde_json::from_value(envelope.msg).ok()?;
    if t.market_ticker.is_empty() {
        return None;
    }

    let mut feed = state.feed.write().await;
    let p = feed.get_mut(&t.market_ticker)?;

    // yes_price: prefer last/price; fall back to the bid/ask midpoint.
    let new_yes = cents(t.last_price_dollars.as_deref().or(t.price_dollars.as_deref()))
        .or_else(|| midpoint_cents(t.yes_bid_dollars.as_deref(), t.yes_ask_dollars.as_deref()))
        .unwrap_or(p.yes_price);

    p.prev_yes_price = p.yes_price;
    p.yes_price = new_yes;
    if let Some(b) = cents(t.yes_bid_dollars.as_deref()) {
        p.yes_bid = b;
    }
    if let Some(a) = cents(t.yes_ask_dollars.as_deref()) {
        p.yes_ask = a;
    }
    if let Some(v) = fp_opt(t.volume_fp.as_deref()) {
        p.volume = v;
    }
    if let Some(oi) = fp_opt(t.open_interest_fp.as_deref()) {
        p.open_interest = oi;
    }
    p.updated_at = now_rfc3339();

    Some(p.clone())
}

// ─── HTTP handlers ───────────────────────────────────────────────────────────

/// Snapshot the feed (volume-ordered) into a Vec<Prediction>.
async fn snapshot(state: &AppState) -> Vec<Prediction> {
    state.feed.read().await.values().cloned().collect()
}

async fn public_feed(State(state): State<AppState>) -> Json<serde_json::Value> {
    let predictions = snapshot(&state).await;
    Json(json!({ "data": { "predictions": predictions } }))
}

async fn dashboard(State(state): State<AppState>) -> Json<serde_json::Value> {
    let predictions = snapshot(&state).await;
    Json(json!({
        "data": { "predictions": predictions },
        "channels": [{
            "id": 1,
            "channel_type": "predictions",
            "enabled": true,
            "ticker_enabled": true,
            "config": {},
            "display": {},
            "logto_sub": "demo",
            "created_at": now_rfc3339(),
            "updated_at": now_rfc3339(),
        }],
    }))
}

/// GET /predictions/catalog — the market-picker source for the config page.
/// Derived from the live feed so it always matches what's on screen.
async fn predictions_catalog(State(state): State<AppState>) -> Json<serde_json::Value> {
    let entries: Vec<serde_json::Value> = snapshot(&state)
        .await
        .into_iter()
        .map(|p| {
            json!({
                "ticker": p.ticker,
                "title": p.title,
                "category": p.category,
                "series_ticker": p.event_ticker,
            })
        })
        .collect();
    Json(json!(entries))
}

/// PUT /users/me/channels/predictions — accept and ignore the config save so
/// the demo's configure page succeeds (the bridge has no persistence). Returns
/// a channel object shaped like the one `/dashboard` emits so the desktop's
/// `authFetch<Channel>` parses it cleanly.
async fn update_channel() -> Json<serde_json::Value> {
    Json(json!({
        "id": 1,
        "channel_type": "predictions",
        "enabled": true,
        "ticker_enabled": true,
        "config": {},
        "display": {},
        "logto_sub": "demo",
        "created_at": now_rfc3339(),
        "updated_at": now_rfc3339(),
    }))
}

/// SSE stream: each Prediction update becomes ONE event whose `data` is the
/// CDC envelope the desktop's `useDashboardCDC` parses.
async fn events(
    State(state): State<AppState>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let rx = state.updates.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|res| async move {
        let prediction = res.ok()?;
        let envelope = json!({
            "data": [{
                "action": "update",
                "record": prediction,
                "metadata": { "table_name": "markets" },
            }],
        });
        Some(Ok(Event::default().data(envelope.to_string())))
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// ─── conversion / parsing helpers (mirror lib.rs) ────────────────────────────

/// `meta` is the optional `(event_category, event_title)` captured from the
/// `/events` sweep, used to enrich the display bucket/title when present.
fn market_to_prediction(
    m: &Market,
    meta: Option<&(Option<String>, String)>,
) -> Prediction {
    // Prefer the event's own category from Kalshi; fall back to our derived
    // bucket. Map Kalshi's category strings onto the CONTRACT buckets.
    let category = meta
        .and_then(|(c, _)| c.clone())
        .filter(|c| !c.is_empty())
        .map(|c| normalize_category(&c))
        .unwrap_or_else(|| derive_category(&m.ticker, &m.event_ticker));

    let yes_price = cents(m.last_price_dollars.as_deref()).unwrap_or(0);
    // Title: market sub-title, else the event title, else the ticker.
    let title = m
        .yes_sub_title
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| meta.map(|(_, t)| t.clone()).filter(|t| !t.is_empty()))
        .unwrap_or_else(|| m.ticker.clone());

    Prediction {
        id: format!("kalshi:{}", m.ticker),
        source: "kalshi".to_string(),
        ticker: m.ticker.clone(),
        event_ticker: m.event_ticker.clone(),
        category,
        title,
        subtitle: m.yes_sub_title.clone().unwrap_or_default(),
        yes_price,
        yes_bid: cents(m.yes_bid_dollars.as_deref()).unwrap_or(0),
        yes_ask: cents(m.yes_ask_dollars.as_deref()).unwrap_or(0),
        prev_yes_price: cents(m.previous_price_dollars.as_deref()).unwrap_or(yes_price),
        volume: fp_volume(m.volume_fp.as_deref()),
        open_interest: fp_opt(m.open_interest_fp.as_deref()).unwrap_or(0),
        status: m.status.clone().unwrap_or_default(),
        result: m.result.clone().unwrap_or_default(),
        close_time: m.close_time.clone().unwrap_or_default(),
        // Link uses the bare ticker per the desktop contract.
        link: format!("https://kalshi.com/markets/{}", m.ticker),
        updated_at: now_rfc3339(),
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// `*_dollars` string -> integer cents (0–100), rounded.
fn cents(s: Option<&str>) -> Option<i64> {
    s.and_then(|v| v.trim().parse::<f64>().ok())
        .map(|d| (d * 100.0).round() as i64)
}

/// Bid/ask midpoint in cents, when both legs are present.
fn midpoint_cents(bid: Option<&str>, ask: Option<&str>) -> Option<i64> {
    let b = bid.and_then(|v| v.trim().parse::<f64>().ok())?;
    let a = ask.and_then(|v| v.trim().parse::<f64>().ok())?;
    Some((((a + b) / 2.0) * 100.0).round() as i64)
}

/// `*_fp` count string -> floored i64, or 0 when absent/unparseable.
fn fp_volume(s: Option<&str>) -> i64 {
    s.and_then(|v| v.trim().parse::<f64>().ok())
        .map(|f| f.floor() as i64)
        .unwrap_or(0)
}

/// `*_fp` count string -> Some(floored i64) only when present and parseable.
fn fp_opt(s: Option<&str>) -> Option<i64> {
    s.and_then(|v| v.trim().parse::<f64>().ok())
        .map(|f| f.floor() as i64)
}

/// Map Kalshi's event `category` string onto a CONTRACT display bucket
/// (Politics / Sports / Economics / Weather / Crypto / World / Other).
fn normalize_category(c: &str) -> String {
    let u = c.to_uppercase();
    if u.contains("POLITIC") {
        "Politics".to_string()
    } else if u.contains("SPORT") {
        "Sports".to_string()
    } else if u.contains("ECONOMIC") || u.contains("FINANC") {
        "Economics".to_string()
    } else if u.contains("CLIMATE") || u.contains("WEATHER") {
        "Weather".to_string()
    } else if u.contains("CRYPTO") {
        "Crypto".to_string()
    } else if u.contains("WORLD") {
        "World".to_string()
    } else {
        // Unknown Kalshi label — keep its human form as the bucket.
        c.to_string()
    }
}

/// Derive a display category bucket (mirrors `lib.rs::derive_category`).
fn derive_category(ticker: &str, event_ticker: &str) -> String {
    let t = ticker.to_uppercase();
    let e = event_ticker.to_uppercase();
    let has = |needle: &str| t.contains(needle) || e.contains(needle);

    if has("KXWC") {
        return "World".to_string();
    }
    if has("KXPGA") || has("KXATP") || has("KXNFL") || has("KXNBA") || has("KXMLB") {
        return "Sports".to_string();
    }
    if has("FED") || has("CPI") || has("GDP") || has("RATE") || has("INFLATION") {
        return "Economics".to_string();
    }
    if has("ELECTION") || has("PRES") || has("SENATE") || has("GOV") || has("POL") {
        return "Politics".to_string();
    }
    if has("HIGH") || has("TEMP") || has("WEATHER") || has("RAIN") || has("SNOW") {
        return "Weather".to_string();
    }
    if has("BTC") || has("CRYPTO") || has("BITCOIN") || has("ETHEREUM") || has("KXETH") {
        return "Crypto".to_string();
    }
    "Other".to_string()
}
