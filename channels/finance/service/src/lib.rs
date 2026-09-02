use std::{sync::Arc, time::Duration, fs};

use chrono::{Timelike, Utc};
use futures_util::future::join_all;
use reqwest::Client;
use tokio::{sync::Mutex, time::{self, sleep}};
use crate::log::{error, info, warn};
use crate::database::{
    PgPool, insert_symbol, update_previous_close, update_trade, get_tracked_symbols,
    seed_tracked_symbols, get_symbols_without_exchange, get_all_enabled_symbols,
    update_symbol_exchange_link,
};

use crate::{types::{FinanceHealth, FinanceState, QuoteResponse, TrackedSymbolConfig, TwelveDataStocksResponse}, websocket::connect};

pub mod types;
mod websocket;
pub mod log;
pub mod database;
pub mod init;

pub async fn start_finance_services(pool: Arc<PgPool>, health_state: Arc<Mutex<FinanceHealth>>) {
    info!("Starting finance service...");

    // Seed from JSON if database is empty, or update name/category for existing symbols
    let existing = get_tracked_symbols(pool.clone()).await;
    if let Ok(file_contents) = fs::read_to_string("./configs/subscriptions.json")
        && let Ok(entries) = serde_json::from_str::<Vec<TrackedSymbolConfig>>(&file_contents)
    {
        if existing.is_empty() {
            info!("Database tracked_symbols is empty, seeding from local config...");
        } else {
            info!("Syncing name/category metadata for tracked symbols...");
        }
        let _ = seed_tracked_symbols(pool.clone(), entries).await;
    }

    // Local dev has no TwelveData key by default. Mirror the sports ingester:
    // stay up, skip polling, and let core keep serving the symbols already in
    // Postgres. Seeding above still runs, so a fresh database gets its symbol
    // rows. Outside development `FinanceState::new` still exits via
    // `fatal_env`, so a real deploy cannot silently stop ingesting.
    if !should_poll(
        std::env::var("ENVIRONMENT").ok().as_deref(),
        std::env::var("TWELVEDATA_API_KEY").ok().as_deref(),
    ) {
        info!("TWELVEDATA_API_KEY not set; not polling. Existing database rows are still served.");
        return;
    }

    // Initialization with database-driven state
    let state = FinanceState::new(Arc::clone(&pool)).await;
    initialize_symbols(state.clone()).await;
    
    // Fetch exchange metadata for symbols that don't have it yet
    fetch_exchange_metadata(state.clone()).await;
    
    update_all_previous_closes(state.clone()).await;

    // Spawn background task to verify/refresh exchange metadata every 24 hours
    let bg_state = state.clone();
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(86400)).await; // 24 hours
            info!("[ TwelveData ] Running background exchange metadata verification...");
            verify_exchange_metadata(bg_state.clone()).await;
        }
    });

    // Spawn background task to refresh previous closes daily, shortly after
    // the US market closes. We target 21:30 UTC (~16:30 ET / 17:30 EDT), which
    // is comfortably after the 4:00pm ET close and after TwelveData's official
    // previous_close values have settled. Without this, previous_close only
    // refreshes when the pod restarts, causing the stale numbers users see.
    let prev_close_state = state.clone();
    tokio::spawn(async move {
        loop {
            sleep(duration_until_next_utc(21, 30)).await;
            info!("[ TwelveData ] Running daily previous close refresh...");
            update_all_previous_closes(prev_close_state.clone()).await;
        }
    });

    loop {
        match connect(state.subscriptions.clone(), state.api_key.clone(), state.client.clone(), pool.clone(), health_state.clone()).await {
            Ok(()) => {
                error!("WebSocket disconnected, attempting reconnect in 5 minutes...");
            }
            Err(e) => {
                // Surface connect() failures in the health payload so the
                // /health/ready response actually reflects the pod's state.
                // The previous version only logged to stderr, which meant
                // a pod stuck in a connect-fail loop looked fine to humans
                // scraping /health/ready.
                {
                    let mut h = health_state.lock().await;
                    h.error_count += 1;
                    h.last_error = Some(format!("{e:#}"));
                }
                error!("WebSocket connect failed: {e:#}, retrying in 5 minutes...");
            }
        }
        sleep(Duration::from_secs(300)).await;
    }
}

async fn initialize_symbols(state: FinanceState) {
    info!("Ensuring symbols exist in trades table...");
    for symbol in state.subscriptions {
        let _ = insert_symbol(state.pool.clone(), symbol).await;
    }
    info!("[ TwelveData ] Symbol initialization complete")
}

pub async fn update_all_previous_closes(state: FinanceState) {
    info!("Updating previous closes for {} symbols...", state.subscriptions.len());

    // TwelveData Pro tier: 610 API credits/min, 500 WS symbols.
    // Batch 8 at a time with 1s delay to stay within limits.
    let batch_size = 8;
    for batch in state.subscriptions.chunks(batch_size) {
        time::sleep(Duration::from_millis(1_000)).await;
        let futures: Vec<_> = batch.iter().map(|symbol| {
            let client = state.client.clone();
            let api_key = state.api_key.clone();
            let pool = &state.pool;
            async move {
                let quote_response = get_quote(symbol.to_string(), client, &api_key).await;
                match quote_response {
                    Ok(quote) => {
                        let pc = quote.previous_close_f64();
                        if pc > 0.0 {
                            let _ = update_previous_close(pool.clone(), symbol.to_string(), pc).await;
                        }

                        let close = quote.close_f64();
                        if close > 0.0 {
                            let change = quote.change_f64();
                            let pct = quote.percent_change_f64();
                            let direction = if change >= 0.0 { "up" } else { "down" };
                            let _ = update_trade(
                                pool.clone(),
                                symbol.to_string(),
                                close,
                                change,
                                pct,
                                direction,
                                None,
                            ).await;
                        } else {
                            warn!("[ TwelveData ] Skipping price update for {}: close is 0", symbol);
                        }
                    }
                    Err(e) => warn!("[ TwelveData ] Quote Error for {}: {e}", symbol),
                }
            }
        }).collect();
        join_all(futures).await;
    }
    info!("[ TwelveData ] Previous closes update complete.");
}

/// Returns the `Duration` until the next occurrence of `hour:minute` UTC.
/// If the target time has already passed today, returns the duration until
/// that time tomorrow.
fn duration_until_next_utc(hour: u32, minute: u32) -> Duration {
    let now = Utc::now();
    let target_secs_of_day = (hour * 3600 + minute * 60) as i64;
    let now_secs_of_day =
        (now.hour() * 3600 + now.minute() * 60 + now.second()) as i64;
    let mut delta = target_secs_of_day - now_secs_of_day;
    if delta <= 0 {
        delta += 86_400;
    }
    Duration::from_secs(delta as u64)
}

pub(crate) async fn get_quote(symbol: String, client: Arc<Client>, api_key: &str) -> anyhow::Result<QuoteResponse> {
    let rest_base = std::env::var("TWELVEDATA_REST_URL")
        .unwrap_or_else(|_| "https://api.twelvedata.com".to_string());
    let url = format!(
        "{}/quote?symbol={}&apikey={}",
        rest_base, symbol, api_key
    );
    let response = client.get(&url).send().await?.text().await?;
    let data: QuoteResponse = serde_json::from_str(&response)?;
    if data.is_error() {
        let msg = data.message.as_deref().unwrap_or("unknown error");
        let code = data.code.unwrap_or(0);
        anyhow::bail!("TwelveData API error {code}: {msg}");
    }
    Ok(data)
}

// =============================================================================
// Exchange Metadata
// =============================================================================

/// Generates a Google Finance URL for a symbol.
/// - Crypto (contains '/'): BTC/USD -> https://www.google.com/finance/quote/BTC-USD
/// - Stock with exchange: AAPL + NASDAQ -> https://www.google.com/finance/quote/AAPL:NASDAQ
/// - Fallback: https://www.google.com/search?q=SYMBOL+stock
fn generate_google_finance_link(symbol: &str, exchange: Option<&str>) -> String {
    if symbol.contains('/') {
        // Crypto: BTC/USD -> BTC-USD
        let cleaned = symbol.replace('/', "-");
        format!("https://www.google.com/finance/quote/{}", cleaned)
    } else if let Some(ex) = exchange {
        // Stock with exchange
        format!("https://www.google.com/finance/quote/{}:{}", symbol, ex)
    } else {
        // Fallback: Google search
        format!("https://www.google.com/search?q={}+stock", symbol)
    }
}

/// Fetches exchange info from TwelveData /stocks endpoint for a single symbol.
/// Returns None if the symbol is not found (crypto, delisted, etc.)
async fn fetch_stock_exchange(
    symbol: &str,
    client: Arc<Client>,
    api_key: &str,
) -> Option<String> {
    let rest_base = std::env::var("TWELVEDATA_REST_URL")
        .unwrap_or_else(|_| "https://api.twelvedata.com".to_string());
    
    // Must include country=United States to get US exchanges (otherwise returns first alphabetical)
    let url = format!(
        "{}/stocks?symbol={}&country=United%20States&apikey={}",
        rest_base, symbol, api_key
    );
    
    match client.get(&url).send().await {
        Ok(resp) => match resp.text().await {
            Ok(text) => {
                match serde_json::from_str::<TwelveDataStocksResponse>(&text) {
                    Ok(data) if !data.data.is_empty() => {
                        Some(data.data[0].exchange.clone())
                    }
                    _ => None,
                }
            }
            Err(_) => None,
        },
        Err(_) => None,
    }
}

/// Fetches exchange metadata for symbols that don't have it yet.
/// Called at startup - fast path if all symbols already have exchange data.
async fn fetch_exchange_metadata(state: FinanceState) {
    let symbols = get_symbols_without_exchange(state.pool.clone()).await;
    
    if symbols.is_empty() {
        info!("[ TwelveData ] All symbols already have exchange metadata.");
        return;
    }
    
    info!("[ TwelveData ] Fetching exchange metadata for {} symbols...", symbols.len());
    
    // Batch 50 at a time with 5-second delays to stay well under 610 req/min limit
    let batch_size = 50;
    let mut processed = 0;
    
    for batch in symbols.chunks(batch_size) {
        let futures: Vec<_> = batch.iter().map(|symbol| {
            let client = state.client.clone();
            let api_key = state.api_key.clone();
            let pool = state.pool.clone();
            let symbol = symbol.clone();
            
            async move {
                // Crypto symbols contain '/' - no need to call TwelveData
                let (exchange, link) = if symbol.contains('/') {
                    let link = generate_google_finance_link(&symbol, None);
                    (None, link)
                } else {
                    // Stock - fetch exchange from TwelveData
                    let exchange = fetch_stock_exchange(&symbol, client, &api_key).await;
                    let link = generate_google_finance_link(&symbol, exchange.as_deref());
                    (exchange, link)
                };
                
                if let Err(e) = update_symbol_exchange_link(
                    pool,
                    &symbol,
                    exchange.as_deref(),
                    &link,
                ).await {
                    warn!("[ TwelveData ] Failed to update exchange/link for {}: {}", symbol, e);
                }
            }
        }).collect();
        
        join_all(futures).await;
        processed += batch.len();
        
        // Only delay if there are more batches to process
        if processed < symbols.len() {
            time::sleep(Duration::from_secs(5)).await;
        }
    }
    
    info!("[ TwelveData ] Exchange metadata fetch complete for {} symbols.", symbols.len());
}

/// Background verification task - re-fetches exchange data for all symbols.
/// Runs every 24 hours to catch any changes or fix previous failures.
async fn verify_exchange_metadata(state: FinanceState) {
    let symbols = get_all_enabled_symbols(state.pool.clone()).await;
    
    if symbols.is_empty() {
        return;
    }
    
    info!("[ TwelveData ] Verifying exchange metadata for {} symbols...", symbols.len());
    
    let batch_size = 50;
    let mut processed = 0;
    
    for batch in symbols.chunks(batch_size) {
        let futures: Vec<_> = batch.iter().map(|symbol| {
            let client = state.client.clone();
            let api_key = state.api_key.clone();
            let pool = state.pool.clone();
            let symbol = symbol.clone();
            
            async move {
                let (exchange, link) = if symbol.contains('/') {
                    let link = generate_google_finance_link(&symbol, None);
                    (None, link)
                } else {
                    let exchange = fetch_stock_exchange(&symbol, client, &api_key).await;
                    let link = generate_google_finance_link(&symbol, exchange.as_deref());
                    (exchange, link)
                };
                
                let _ = update_symbol_exchange_link(pool, &symbol, exchange.as_deref(), &link).await;
            }
        }).collect();
        
        join_all(futures).await;
        processed += batch.len();
        
        if processed < symbols.len() {
            time::sleep(Duration::from_secs(5)).await;
        }
    }
    
    info!("[ TwelveData ] Exchange metadata verification complete.");
}

/// Whether this process should poll TwelveData.
///
/// Extracted from `run` so it can be tested. Local dev deliberately runs with
/// a blank key: the service stays up, skips polling, and serves whatever
/// `make seed` put in Postgres. That promise is written in the generated
/// `channels/finance/.env` and in docs/LOCAL_SETUP.md, and it has been broken
/// before — the service used to require the key and exit, so a fresh checkout
/// could not boot (67c8d68e).
///
/// The other half matters just as much: OUTSIDE development a blank key must
/// NOT be tolerated, or a misconfigured production deploy would silently stop
/// ingesting while looking healthy.
pub fn should_poll(environment: Option<&str>, api_key: Option<&str>) -> bool {
    let have_key = api_key.map(|k| !k.trim().is_empty()).unwrap_or(false);
    if have_key {
        return true;
    }
    // No key: only development is allowed to carry on without one.
    environment != Some("development")
}

#[cfg(test)]
mod keyless_tests {
    use super::should_poll;

    #[test]
    fn development_without_a_key_does_not_poll() {
        assert!(!should_poll(Some("development"), None));
        assert!(!should_poll(Some("development"), Some("")));
        assert!(!should_poll(Some("development"), Some("   ")));
    }

    #[test]
    fn development_with_a_key_still_polls() {
        assert!(should_poll(Some("development"), Some("real-key")));
    }

    #[test]
    fn production_without_a_key_must_not_be_tolerated() {
        // Reaching polling with no key is what makes the caller fatal out.
        // Silently skipping here would mean a production deploy stops
        // ingesting and still reports itself healthy.
        assert!(should_poll(Some("production"), None));
        assert!(should_poll(Some("production"), Some("")));
    }

    #[test]
    fn unset_environment_fails_closed() {
        assert!(should_poll(None, None));
    }
}
