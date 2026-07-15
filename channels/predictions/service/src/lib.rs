//! Scrollr predictions channel ingestion service.
//!
//! Library surface used by both the service binary (`main.rs`) and the
//! standalone `kalshi_probe` dev binary. The `kalshi` module is the
//! self-contained Kalshi Trade API v2 client (RSA-PSS signing, REST, WS).
//!
//! `start_predictions_services` is the entry point the supervised init task
//! calls: it seeds the catalog from `./configs/markets.json`, runs an initial
//! + periodic REST catalog sweep, and then a reconnect loop around the signed
//! Kalshi WebSocket.

use std::{fs, sync::Arc, time::Duration};

use tokio::{sync::Mutex, time::sleep};

use crate::database::{
    record_poll_error, record_poll_success, reconcile_sweep_selection, seed_tracked_markets,
    update_market_lifecycle, upsert_market, upsert_tracked_market, MarketUpsert, PgPool,
};
use crate::kalshi::model::Market;
use crate::log::{error, info, warn};
use crate::types::{PredictionsHealth, PredictionsState, TrackedMarketConfig};

pub mod kalshi;

pub mod types;
pub mod database;
pub mod init;
pub mod log;
mod websocket;

/// How often the REST catalog sweep refreshes the tracked-market universe.
const CATALOG_SWEEP_INTERVAL: Duration = Duration::from_secs(15 * 60);

/// Base flat reconnect backoff. Jitter is added per attempt. The readiness
/// staleness window in `main.rs` (5 min) is well over 2x this, as required.
const RECONNECT_BACKOFF: Duration = Duration::from_secs(60);

/// Per-page limit for the `GET /events` catalog sweep (events max is 200).
const EVENTS_PAGE_LIMIT: u32 = 200;

/// Cap on how many of the most-liquid markets the sweep ingests, so we keep
/// the ticker to the liquid head rather than the long tail. Sized for
/// ~120 events at two outcomes each (v1.1.4 event cards).
const CATALOG_MAX_MARKETS: usize = 240;

/// How many outcomes each event keeps (v1.1.4): the desktop renders
/// Kalshi-style event cards with the top two legs. Rank 1 is `is_primary`
/// for back-compat with pre-1.1.4 consumers.
const MARKETS_PER_EVENT: u32 = 2;

/// Per-request ticker batch for the dropped-market settlement recheck
/// (v1.1.5). Kalshi's `GET /markets?tickers=` accepts a CSV; keep batches
/// small to stay well inside URL-length and rate limits.
const RECHECK_CHUNK: usize = 50;

/// If a single reconcile demotes more rows than this, skip the settlement
/// recheck for that cycle. A normal sweep drops a few dozen markets; a
/// four-digit demotion is the one-time post-deploy backlog (or a Kalshi-side
/// catalog upheaval), where per-ticker rechecks would be thousands of
/// pointless signed calls about ancient markets.
const RECHECK_SKIP_THRESHOLD: usize = 500;

pub async fn start_predictions_services(
    pool: Arc<PgPool>,
    health_state: Arc<Mutex<PredictionsHealth>>,
) {
    info!("Starting predictions service...");

    // Seed/sync the tracked_markets catalog from the local config. Idempotent
    // upsert on every boot — seeds an empty table and syncs metadata. The
    // dynamic REST sweep below is the real populate; this is fallback metadata.
    if let Ok(file_contents) = fs::read_to_string("./configs/markets.json") {
        match serde_json::from_str::<Vec<TrackedMarketConfig>>(&file_contents) {
            Ok(entries) => {
                info!("Seeding {} tracked markets from local config...", entries.len());
                if let Err(e) = seed_tracked_markets(pool.clone(), entries).await {
                    warn!("Failed to seed tracked_markets from config: {e:#}");
                }
            }
            Err(e) => warn!("Failed to parse configs/markets.json: {e:#}"),
        }
    } else {
        warn!("configs/markets.json not found; relying on REST sweep only");
    }

    // Build state (loads enabled tickers from DB, builds the signed clients).
    let state = PredictionsState::new(Arc::clone(&pool)).await;
    info!(
        "Predictions state ready (env={}, {} enabled tickers loaded)",
        if state.demo { "demo" } else { "prod" },
        state.subscriptions.len()
    );

    // Initial catalog sweep so the markets table is populated before the WS
    // starts streaming deltas onto it.
    catalog_sweep(&state).await;

    // Periodic catalog refresh on a background timer.
    let sweep_state = state.clone();
    tokio::spawn(async move {
        loop {
            sleep(CATALOG_SWEEP_INTERVAL).await;
            info!("[ Kalshi ] Running periodic catalog sweep...");
            catalog_sweep(&sweep_state).await;
        }
    });

    // Reconnect loop: connect over the signed WS, fold connect errors into
    // health, and back off ~60s + jitter between attempts.
    let mut attempt: u32 = 0;
    loop {
        let connect_result = websocket::connect(
            state.ws_url.clone(),
            state.signer.clone(),
            pool.clone(),
            health_state.clone(),
        )
        .await;

        match connect_result {
            Ok(()) => {
                error!("Kalshi WebSocket disconnected, reconnecting after backoff...");
            }
            Err(e) => {
                // Surface connect() failures in the health payload so the
                // /health/ready response reflects a stuck connect loop.
                {
                    let mut h = health_state.lock().await;
                    h.error_count += 1;
                    h.last_error = Some(format!("{e:#}"));
                }
                error!("Kalshi WebSocket connect failed: {e:#}, retrying after backoff...");
            }
        }

        attempt = attempt.saturating_add(1);
        let jitter = Duration::from_millis(jitter_ms(attempt));
        sleep(RECONNECT_BACKOFF + jitter).await;
    }
}

/// Cheap, dependency-free jitter (0..=15000ms) derived from the attempt count
/// and the wall clock. Keeps reconnects from thundering after a Kalshi-side
/// outage without pulling in the `rand` distribution machinery here.
fn jitter_ms(attempt: u32) -> u64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_millis() as u64)
        .unwrap_or(0);
    (now.wrapping_add(attempt as u64 * 619)) % 15_000
}

/// Paginate `GET /markets`, filter noise (KXMVE* multivariate + zero-volume),
/// sort by volume desc, derive a display category, and upsert into both the
/// `markets` display table and the `tracked_markets` catalog.
async fn catalog_sweep(state: &PredictionsState) {
    info!("[ Kalshi ] Catalog sweep starting...");

    // Use GET /events?with_nested_markets=true rather than GET /markets: the
    // raw /markets?status=open feed is dominated by ~10k zero-volume KXMVE*
    // multivariate contracts that fill the first many pages, so the noise
    // filter below would drop the whole sweep to zero. The events endpoint
    // returns the curated, human-readable grouping carrying a per-event
    // category, the event's TITLE (the human question — stored per market
    // row since v1.1.4 so the desktop can headline it), plus the event's
    // nested markets — exactly what a ticker wants.
    // (Each tuple is (market, event_category, event_title).)
    let mut all: Vec<(Market, Option<String>, String)> = Vec::new();
    let mut cursor = String::new();
    let mut pages = 0u32;

    loop {
        let query = if cursor.is_empty() {
            format!("limit={EVENTS_PAGE_LIMIT}&with_nested_markets=true&status=open")
        } else {
            format!(
                "limit={EVENTS_PAGE_LIMIT}&with_nested_markets=true&status=open&cursor={cursor}"
            )
        };

        match state.rest.get_events(&query).await {
            Ok(resp) => {
                for ev in resp.events {
                    let cat = ev.category.clone().filter(|c| !c.is_empty());
                    for mut m in ev.markets {
                        if m.event_ticker.is_empty() {
                            m.event_ticker = ev.event_ticker.clone();
                        }
                        all.push((m, cat.clone(), ev.title.clone()));
                    }
                }
                pages += 1;
                if resp.cursor.is_empty() {
                    break;
                }
                cursor = resp.cursor;
                // Be polite to the rate limiter between pages.
                sleep(Duration::from_millis(250)).await;
                // Safety stop so a misbehaving cursor can't loop forever.
                if pages >= 50 {
                    warn!("[ Kalshi ] Catalog sweep hit 50-page cap; stopping pagination");
                    break;
                }
            }
            Err(e) => {
                warn!("[ Kalshi ] Catalog sweep page fetch failed: {e:#}");
                break;
            }
        }
    }

    info!(
        "[ Kalshi ] Catalog sweep fetched {} markets across {pages} event pages",
        all.len()
    );

    // Filter: drop KXMVE* multivariate tickers and zero-volume markets, sort
    // by volume descending so the most-liquid markets rank first.
    let mut markets: Vec<(Market, Option<String>, String)> = all
        .into_iter()
        .filter(|(m, _, _)| !m.ticker.starts_with("KXMVE"))
        .filter(|(m, _, _)| fp_volume(m.volume_fp.as_deref()) > 0)
        .collect();

    markets.sort_by(|(a, _, _), (b, _, _)| {
        fp_volume(b.volume_fp.as_deref()).cmp(&fp_volume(a.volume_fp.as_deref()))
    });

    // v1.1.4: keep the top MARKETS_PER_EVENT outcomes per event (rank 1 =
    // is_primary), capped to the liquid head overall. Volume order means
    // an event's rank-1 leg is always its most-liquid one.
    let mut event_counts: std::collections::HashMap<String, u32> =
        std::collections::HashMap::new();
    let mut selected: Vec<(Market, Option<String>, String, u32)> = Vec::new();
    for (m, cat, ev_title) in markets {
        let count = event_counts.entry(m.event_ticker.clone()).or_insert(0);
        if *count >= MARKETS_PER_EVENT {
            continue;
        }
        *count += 1;
        selected.push((m, cat, ev_title, *count));
        if selected.len() >= CATALOG_MAX_MARKETS {
            break;
        }
    }

    let mut persisted = 0u64;

    for (m, ev_category, ev_title, rank) in &selected {
        // Prefer Kalshi's human-readable event category; fall back to the
        // ticker-prefix heuristic when an event carries none.
        let category = ev_category
            .clone()
            .unwrap_or_else(|| derive_category(&m.ticker, &m.event_ticker));

        // Rank 1 (highest-volume leg of its event) stays the representative.
        let is_primary = *rank == 1;

        let series = series_prefix(&m.ticker);
        let title = m
            .yes_sub_title
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| m.ticker.clone());

        let upsert = MarketUpsert {
            ticker: m.ticker.clone(),
            event_ticker: non_empty(&m.event_ticker),
            series_ticker: series.clone(),
            category: Some(category.clone()),
            title: Some(title.clone()),
            subtitle: m.yes_sub_title.clone(),
            yes_price: cents(m.last_price_dollars.as_deref()),
            yes_bid: cents(m.yes_bid_dollars.as_deref()),
            yes_ask: cents(m.yes_ask_dollars.as_deref()),
            volume: Some(fp_volume(m.volume_fp.as_deref())),
            volume_24h: fp_opt(m.volume_24h_fp.as_deref()),
            open_interest: fp_opt(m.open_interest_fp.as_deref()),
            status: m.status.clone(),
            result: m.result.clone(),
            is_primary: Some(is_primary),
            open_time: parse_ts(m.open_time.as_deref()),
            close_time: parse_ts(m.close_time.as_deref()),
            link: Some(market_link(series.as_deref(), &m.event_ticker)),
            event_title: non_empty(ev_title),
            event_rank: Some(*rank as i16),
            in_sweep: Some(true),
        };

        match upsert_market(&state.pool, &upsert, true).await {
            Ok(_) => {
                persisted += 1;
                if let Err(e) = upsert_tracked_market(
                    &state.pool,
                    &m.ticker,
                    &title,
                    &category,
                    series.as_deref(),
                )
                .await
                {
                    warn!("[ Kalshi ] Failed to upsert tracked_market {}: {e:#}", m.ticker);
                    record_poll_error(&state.pool, &m.ticker, &format!("{e:#}")).await;
                } else {
                    record_poll_success(&state.pool, &m.ticker).await;
                }
            }
            Err(e) => {
                warn!("[ Kalshi ] Failed to upsert market {}: {e:#}", m.ticker);
                record_poll_error(&state.pool, &m.ticker, &format!("{e:#}")).await;
            }
        }
    }

    info!("[ Kalshi ] Catalog sweep complete: {persisted} markets persisted");

    // Reconciliation (v1.1.5): demote every row that is no longer part of
    // the selection so the feed stops serving dead markets. Runs AFTER the
    // upsert loop, so a market that re-entered the selection was already
    // re-promoted (in_sweep: Some(true)) and is never demoted here.
    let selected_ids: Vec<String> = selected
        .iter()
        .map(|(m, _, _, _)| format!("kalshi:{}", m.ticker))
        .collect();
    match reconcile_sweep_selection(&state.pool, &selected_ids).await {
        Ok(dropped) if dropped.is_empty() => {}
        Ok(dropped) => {
            info!("[ Kalshi ] Sweep reconcile: {} rows demoted", dropped.len());
            recheck_dropped_markets(state, dropped).await;
        }
        Err(e) => warn!("[ Kalshi ] Sweep reconcile failed: {e:#}"),
    }
}

/// REST-check the real status of markets that just dropped out of the sweep
/// selection, so settlements land even though (a) settled markets vanish
/// from the open-events sweep and (b) the `market_lifecycle_v2` WS message
/// may have been missed (pod restart, reconnect gap). This is what keeps
/// "Resolved today" honest — without it a settled market's row stays
/// frozen at status='active' forever.
async fn recheck_dropped_markets(state: &PredictionsState, dropped: Vec<String>) {
    if dropped.len() > RECHECK_SKIP_THRESHOLD {
        info!(
            "[ Kalshi ] Skipping settlement recheck for {} demoted markets (> {RECHECK_SKIP_THRESHOLD}; bulk backlog, not fresh settlements)",
            dropped.len()
        );
        return;
    }

    let mut updated = 0u64;
    for chunk in dropped.chunks(RECHECK_CHUNK) {
        let query = format!("tickers={}&limit={RECHECK_CHUNK}", chunk.join(","));
        match state.rest.get_markets(&query).await {
            Ok(resp) => {
                for m in resp.markets {
                    if m.ticker.is_empty() {
                        continue;
                    }
                    match update_market_lifecycle(
                        &state.pool,
                        &m.ticker,
                        m.status.as_deref(),
                        m.result.as_deref(),
                    )
                    .await
                    {
                        Ok(true) => updated += 1,
                        Ok(false) => {}
                        Err(e) => warn!(
                            "[ Kalshi ] Recheck lifecycle write failed for {}: {e:#}",
                            m.ticker
                        ),
                    }
                }
            }
            Err(e) => warn!("[ Kalshi ] Recheck fetch failed for a chunk of {}: {e:#}", chunk.len()),
        }
        // Same politeness delay as the sweep pagination.
        sleep(Duration::from_millis(250)).await;
    }
    if updated > 0 {
        info!("[ Kalshi ] Settlement recheck: {updated} demoted markets updated");
    }
}

// ─── parsing / derivation helpers ────────────────────────────────────────

fn non_empty(s: &str) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

/// `*_dollars` string -> integer cents (0–100), rounded.
fn cents(s: Option<&str>) -> Option<i32> {
    s.and_then(|v| v.trim().parse::<f64>().ok())
        .map(|d| (d * 100.0).round() as i32)
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

/// Parse an RFC3339 timestamp into a UTC `DateTime`.
fn parse_ts(s: Option<&str>) -> Option<chrono::DateTime<chrono::Utc>> {
    s.and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

/// Derive the series prefix from a ticker. Kalshi tickers look like
/// `SERIES-EVENT-OUTCOME` (e.g. `KXPGAWINNER-26MASTERS-SCHEF`); the series is
/// the segment before the first `-`.
fn series_prefix(ticker: &str) -> Option<String> {
    ticker.split('-').next().map(|s| s.to_string()).filter(|s| !s.is_empty())
}

/// Build the Kalshi market link.
fn market_link(series: Option<&str>, event_ticker: &str) -> String {
    match series {
        Some(s) if !s.is_empty() && !event_ticker.is_empty() => {
            format!("https://kalshi.com/markets/{s}/{event_ticker}")
        }
        _ => "https://kalshi.com/markets".to_string(),
    }
}

/// Derive a display category bucket from the ticker / series prefix.
///
/// Buckets (per CONTRACT.md): Politics / Sports / Economics / Weather /
/// Crypto / World / Other.
fn derive_category(ticker: &str, event_ticker: &str) -> String {
    let t = ticker.to_uppercase();
    let e = event_ticker.to_uppercase();
    let has = |needle: &str| t.contains(needle) || e.contains(needle);

    // World Cup is both World and Sports; CONTRACT lists KXWC*->World/Sports.
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
    // Crypto: match on distinctive whole tokens, not bare substrings — "ETH"
    // would otherwise fire inside words like "SOMETHING".
    if has("BTC") || has("CRYPTO") || has("BITCOIN") || has("ETHEREUM") || has("KXETH") {
        return "Crypto".to_string();
    }
    "Other".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cents_rounds_dollars() {
        assert_eq!(cents(Some("0.6200")), Some(62));
        assert_eq!(cents(Some("0.625")), Some(63)); // rounds
        assert_eq!(cents(Some("1.00")), Some(100));
        assert_eq!(cents(None), None);
        assert_eq!(cents(Some("garbage")), None);
    }

    #[test]
    fn fp_volume_floors() {
        assert_eq!(fp_volume(Some("33896.00")), 33896);
        assert_eq!(fp_volume(Some("12.99")), 12);
        assert_eq!(fp_volume(None), 0);
        assert_eq!(fp_volume(Some("bad")), 0);
    }

    #[test]
    fn category_buckets() {
        assert_eq!(derive_category("KXWCWINNER-26", "KXWCWINNER"), "World");
        assert_eq!(derive_category("KXPGAWINNER-26", "X"), "Sports");
        assert_eq!(derive_category("FEDDECISION-26", "X"), "Economics");
        assert_eq!(derive_category("KXPRESELECTION", "X"), "Politics");
        assert_eq!(derive_category("HIGHTEMPNYC", "X"), "Weather");
        assert_eq!(derive_category("BTCPRICE", "X"), "Crypto");
        assert_eq!(derive_category("SOMETHINGELSE", "X"), "Other");
    }

    #[test]
    fn series_and_link() {
        assert_eq!(series_prefix("KXPGA-26MASTERS-SCHEF").as_deref(), Some("KXPGA"));
        assert_eq!(
            market_link(Some("KXPGA"), "26MASTERS"),
            "https://kalshi.com/markets/KXPGA/26MASTERS"
        );
        assert_eq!(market_link(None, ""), "https://kalshi.com/markets");
    }
}
