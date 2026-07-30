use std::{collections::HashMap, sync::{Arc, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};

use reqwest::Client;
use tokio::{net::TcpStream, sync::{Mutex, RwLock}, time};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::protocol::{Message, WebSocketConfig},
};
use futures_util::{SinkExt, StreamExt, stream::{self, SplitSink, SplitStream}};
use crate::{database::{PgPool, DatabaseTradeData, Utc, get_trades, insert_symbol, update_previous_close, update_trade}, log::{error, info, warn}};

/// Maximum WebSocket message / frame size we will accept from TwelveData.
/// The real feed sends ~200 byte price events; anything larger is either a
/// protocol error or a hostile server trying to pin memory. 1 MiB is a huge
/// safety margin — more than enough for malformed but legitimate messages.
const MAX_WS_MESSAGE_BYTES: usize = 1 << 20;

use crate::{get_quote, types::{FinanceHealth, PriceEvent, TradeData, WebSocketState}};

const UPDATE_BATCH_SIZE: usize = 10;
const UPDATE_BATCH_TIMEOUT: u64 = 1000;
const UPDATE_BATCH_SIZE_DELAY: u64 = 500;

const LOG_THROTTLE_INTERVAL: Duration = Duration::from_secs(5);

/// Interval between heartbeat messages sent to TwelveData (30 seconds).
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

pub(crate) async fn connect(subscriptions: Vec<String>, api_key: String, client: Arc<Client>, pool: Arc<PgPool>, health_state: Arc<Mutex<FinanceHealth>>) -> Result<(), anyhow::Error> {
    let state = Arc::new(RwLock::new(WebSocketState::new()));

    let ws_base = std::env::var("TWELVEDATA_WS_URL")
        .unwrap_or_else(|_| "wss://ws.twelvedata.com/v1/quotes/price".to_string());
    let url = format!("{}?apikey={}", ws_base, api_key);

    // Cap message and frame sizes so a misbehaving server can't stream an
    // unbounded blob into memory. TwelveData events are tiny (~200B).
    // `WebSocketConfig` is `#[non_exhaustive]` in tungstenite 0.28 so we
    // have to use the builder methods instead of struct-literal syntax.
    let ws_config = WebSocketConfig::default()
        .max_message_size(Some(MAX_WS_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_WS_MESSAGE_BYTES));

    let (ws_stream, _) = connect_async_with_config(url, Some(ws_config), false).await.map_err(|e| {
        error!("Failed to connect to TwelveData WebSocket: {}", e);
        e
    })?;
    info!("WebSocket client connected to TwelveData");

    // Set connection status to connected
    {
        let mut health = health_state.lock().await;
        health.update_health(
            String::from("connected"),
            0,
            0,
            None,
        );
    }

    let (writer, reader) = ws_stream.split();
    let writer = Arc::new(Mutex::new(writer));

    // Subscribe to all symbols in one message. Done inline rather than
    // via `tokio::spawn` — the send is a few microseconds and we want its
    // failure to surface here instead of vanishing into a detached task.
    ws_send(Arc::clone(&writer), subscriptions).await?;

    // Spawn heartbeat task
    tokio::spawn(ws_heartbeat(Arc::clone(&writer)));

    ws_read(reader, Arc::clone(&state), client, api_key, pool, health_state.clone()).await;

    Ok(())
}

/// Send a single subscribe message for all symbols (TwelveData accepts comma-separated).
///
/// Returns an error when the send fails so the caller can surface the
/// failure through the readiness gate instead of quietly running without
/// any subscriptions.
async fn ws_send(
    writer: Arc<Mutex<SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>>>,
    subscriptions: Vec<String>,
) -> anyhow::Result<()> {
    let symbols_csv = subscriptions.join(",");
    let sub_msg = format!(
        r#"{{"action":"subscribe","params":{{"symbols":"{}"}}}}"#,
        symbols_csv
    );

    info!("Subscribing to {} symbols", subscriptions.len());

    let mut w = writer.lock().await;
    w.send(Message::Text(sub_msg.into()))
        .await
        .map_err(|e| anyhow::anyhow!("failed to send subscription message: {e}"))?;
    Ok(())
}

/// Send periodic heartbeats to keep the TwelveData connection alive.
async fn ws_heartbeat(writer: Arc<Mutex<SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>>>) {
    let heartbeat_msg = r#"{"action":"heartbeat"}"#;
    loop {
        time::sleep(HEARTBEAT_INTERVAL).await;
        let mut w = writer.lock().await;
        if let Err(e) = w.send(Message::Text(heartbeat_msg.into())).await {
            warn!("Heartbeat send failed (connection may be closing): {e}");
            break;
        }
    }
}

async fn ws_read(
    mut reader: SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
    state: Arc<RwLock<WebSocketState>>,
    client: Arc<Client>,
    api_key: String,
    pool: Arc<PgPool>,
    health_state: Arc<Mutex<FinanceHealth>>,
) {
    info!("Now listening for TwelveData price events...");

    loop {
        // Poll the batch timer without holding the state lock across the
        // await. We snapshot the deadline under a short read lock, then
        // sleep until that instant outside the lock. The previous version
        // did `read → is_some() → drop → write → unwrap()` which would
        // panic if another task cleared the timer in the gap. If the
        // deadline we sleep on is stale (timer was reset while we waited),
        // the post-wake check below treats a missing timer as a benign
        // spurious wake and falls through.
        let timer_deadline = state.read().await.batch_timer.as_ref().map(|t| t.deadline());
        let timer_branch = async {
            match timer_deadline {
                Some(deadline) => time::sleep_until(deadline).await,
                // No timer armed — park forever so select! picks another branch.
                None => std::future::pending::<()>().await,
            }
        };

        tokio::select! {
            biased;
            _ = timer_branch => {
                // After the sleep fires, re-check state under a single write
                // guard. The timer may have been reset (deadline pushed out)
                // or cleared entirely while we slept — in either case treat
                // this as a spurious wake and loop back to re-arm.
                let mut state_w = state.write().await;
                let fire_now = match state_w.batch_timer.as_ref() {
                    Some(t) => t.deadline() <= time::Instant::now(),
                    None => false,
                };
                if !fire_now {
                    continue;
                }
                state_w.batch_timer = None;

                if !state_w.is_processing_batch {
                    info!("Timer fired, processing batch.");
                    let state_clone = Arc::clone(&state);
                    drop(state_w);
                    tokio::spawn(process_batch(state_clone, client.clone(), api_key.clone(), pool.clone(), health_state.clone()));
                } else {
                    info!("Timer fired, but a batch is already in process. Waiting.");
                }
            }

            Some(msg) = reader.next() => {
                match msg {
                    Ok(msg) => {
                        if msg.is_text() {
                            let text = msg.to_string();
                            let event: Result<PriceEvent, serde_json::Error> = serde_json::from_str(&text);
                            match event {
                                Ok(ev) if ev.event == "price" => {
                                    // Real-time price update
                                    if let (Some(symbol), Some(price), Some(ts)) = (ev.symbol, ev.price, ev.timestamp) {
                                        let trade = TradeData {
                                            symbol,
                                            price,
                                            timestamp: ts,
                                            day_volume: ev.day_volume,
                                        };
                                        handle_trade_update(trade, &state).await;
                                    }
                                }
                                Ok(ev) if ev.event == "subscribe-status" => {
                                    info!("Subscription status: {}", text);
                                }
                                Ok(ev) if ev.event == "heartbeat" => {
                                    // Heartbeat acknowledged, nothing to do
                                }
                                Ok(ev) => {
                                    // Unknown event type — log it
                                    warn!("Unhandled event type '{}': {}", ev.event, text);
                                }
                                Err(_) => {
                                    // Could be an error object or unexpected format
                                    if text.contains("error") || text.contains("\"code\"") {
                                        let error_msg = text.clone();
                                        error!("Error message from TwelveData: {}", error_msg);
                                        state.write().await.last_error_message = Some(error_msg);
                                    } else {
                                        warn!("Unexpected message format: {}", text);
                                    }
                                }
                            }
                        } else if msg.is_close() {
                            error!("Server closed connection");
                            state.write().await.last_error_message = Some(String::from("Server closed connection"));
                            break;
                        }
                    }
                    Err(e) => {
                        let error_msg = format!("Error receiving message: {}", e);
                        error!("{}", error_msg);
                        state.write().await.last_error_message = Some(error_msg);
                        break;
                    }
                }
            }

            else => {
                break;
            }
        }
    }

    info!("WebSocket read loop completed.");

    // Update health status to disconnected
    {
        let state_read = state.read().await;
        let mut health = health_state.lock().await;
        let current_batch = health.batch_number;
        health.update_health(
            String::from("disconnected"),
            current_batch,
            state_read.stats.errors,
            state_read.last_error_message.clone(),
        );
    }

    if !state.read().await.update_queue.is_empty() {
        info!("Processing final batch before exit...");
        process_batch(state, client, api_key, pool, health_state).await;
    }
}

/// Queue a single trade update (TwelveData sends one price event per message).
async fn handle_trade_update(trade: TradeData, state_arc: &Arc<RwLock<WebSocketState>>) {
    let mut state = state_arc.write().await;

    // Validation: Ignore suspiciously long symbols
    if trade.symbol.len() > 20 {
        return;
    }

    let ref_in_queue = state.update_queue.get(&trade.symbol);

    if let Some(trade_in_queue) = ref_in_queue
        && trade_in_queue.timestamp >= trade.timestamp
    {
        return;
    }

    state.update_queue.insert(trade.symbol.clone(), trade);
    drop(state);
    schedule_batch_processing(state_arc).await;
}

async fn schedule_batch_processing(state_arc: &Arc<RwLock<WebSocketState>>) {
    let mut state = state_arc.write().await;

    let delay_ms = if state.update_queue.len() >= UPDATE_BATCH_SIZE {
        UPDATE_BATCH_SIZE_DELAY
    } else {
        UPDATE_BATCH_TIMEOUT
    };

    let new_delay = Duration::from_millis(delay_ms);

    if let Some(timer) = &mut state.batch_timer {
        timer.as_mut().reset(time::Instant::now() + new_delay);
    } else {
        info!(
            "Scheduling batch processing in {}ms (queue: {})",
            delay_ms,
            state.update_queue.len()
        );
        state.batch_timer = Some(Box::pin(time::sleep(new_delay)));
    }
}

async fn process_batch(state_arc: Arc<RwLock<WebSocketState>>, client: Arc<Client>, api_key: String, pool: Arc<PgPool>, health_state: Arc<Mutex<FinanceHealth>>) {
    let (trades, batch_num) = {
        let mut state = state_arc.write().await;

        if state.is_processing_batch || state.update_queue.is_empty() {
            info!("Skipping batch processing (processing: {}, queue: {})", state.is_processing_batch, state.update_queue.len());
            return;
        }

        state.is_processing_batch = true;

        let trades: Vec<TradeData> = state.update_queue.values().cloned().collect();
        state.update_queue.clear();

        state.stats.batches_processed += 1;
        let batch_num = state.stats.batches_processed;

        info!("Processing batch #{} with {} trades", batch_num, trades.len());

        (trades, batch_num)
    };

    let processed_count = Arc::new(AtomicU64::new(0));
    let error_count = Arc::new(AtomicU64::new(0));
    let batch_result: Result<(), anyhow::Error> = async {
        let all_trades = get_trades(pool.clone()).await;
        let trades_map = Arc::new(
            all_trades.into_iter().map(|t| (t.symbol.clone(), t)).collect::<HashMap<_, _>>()
        );

        let batch_size = 5;

        stream::iter(trades)
            .for_each_concurrent(batch_size, |trade| {
                let trades_map_clone = Arc::clone(&trades_map);
                let proc_clone = Arc::clone(&processed_count);
                let err_clone = Arc::clone(&error_count);
                let client_clone = Arc::clone(&client);
                let api_key_clone = api_key.clone();
                let pool_clone = Arc::clone(&pool);

                async move {
                    match process_single_trade(trade, trades_map_clone, client_clone, &api_key_clone, pool_clone).await {
                        Ok(_) => {
                            proc_clone.fetch_add(1, Ordering::SeqCst);
                        }
                        Err(e) => {
                            err_clone.fetch_add(1, Ordering::SeqCst);
                            warn!("Error processing trade: {}", e);
                        }
                    }
                }
            }
        ).await;

        Ok(())
    }.await;

    let mut state = state_arc.write().await;
    state.is_processing_batch = false;

    let processed = processed_count.load(Ordering::SeqCst);
    let errors = error_count.load(Ordering::SeqCst);

    match batch_result {
        Ok(_) => {
            state.stats.total_updates_processed += processed;
            state.stats.errors += errors;

            // Track last error if there were any errors in this batch
            if errors > 0 && state.last_error_message.is_none() {
                state.last_error_message = Some(format!("Batch #{} had {} errors processing trades", batch_num, errors));
            }

            let now = Instant::now();
            let should_log = state.last_log_time.is_none_or(|last| {
                now.duration_since(last) >= LOG_THROTTLE_INTERVAL
            });

            let mut health = health_state.lock().await;
            health.update_health(
                String::from("connected"),
                batch_num,
                state.stats.errors,
                state.last_error_message.clone(),
            );
            drop(health);

            if should_log {
                state.last_log_time = Some(now);
                info!("Batch #{} complete: {} processed, {} errors",
                    batch_num, processed, errors
                );
                info!("Total updates processed: {}", state.stats.total_updates_processed);
            }
        }
        Err(e) => {
            let error_msg = format!("Batch #{} processing error: {}", batch_num, e);
            warn!("{}", error_msg);
            state.stats.errors += 1;
            state.last_error_message = Some(error_msg);
        }
    }

    if !state.update_queue.is_empty() {
        info!("More trades queued ({}), scheduling next batch", state.update_queue.len());
        drop(state);
        schedule_batch_processing(&state_arc).await;
    }
}

async fn process_single_trade(trade: TradeData, trades_map: Arc<HashMap<String, DatabaseTradeData>>, client: Arc<Client>, api_key: &str, pool: Arc<PgPool>) -> anyhow::Result<()> {
    let (symbol, price, day_volume) = (trade.symbol, trade.price, trade.day_volume);

    let existing_record = trades_map.get(&symbol).cloned();
    let mut current_record = existing_record.unwrap_or_else(|| {
        info!("Inserting new symbol {}", symbol);

        let pool_clone = Arc::clone(&pool);
        let symbol_clone = symbol.clone();
        tokio::spawn(async move {
            let _ = insert_symbol(pool_clone, symbol_clone).await;
        });

        DatabaseTradeData {
            symbol: symbol.clone(),
            price,
            previous_close: 0.0,
            price_change: 0.0,
            percentage_change: 0.0,
            direction: String::from("up"),
            day_volume: 0,
            last_updated: Utc::now(),
        }
    });

    if current_record.previous_close <= 0.0 {
        info!("Fetching quote for {}", symbol);

        let mut determined_previous_close: Option<f64> = None;

        match get_quote(symbol.clone(), client, api_key).await {
            Ok(quote) => {
                let pc = quote.previous_close_f64();
                let cp = quote.close_f64();
                if pc > 0.0 {
                    determined_previous_close = Some(pc);
                } else if cp > 0.0 {
                    determined_previous_close = Some(cp);
                }
            }

            Err(e) => {
                error!("Quote API error for {}: {}", symbol, e);
            }
        }

        // Intentionally NO fallback to the current live price. Using the
        // live tick as "previous close" produces a permanently-incorrect
        // baseline that polluted change/percentage calculations for the
        // lifetime of the pod. If TwelveData can't give us a real previous
        // close right now, skip this trade — the daily refresh task in
        // lib.rs::update_all_previous_closes will fill it in on its next run.

        if let Some(pc) = determined_previous_close {
            current_record.previous_close = pc;
            let _ = update_previous_close(Arc::clone(&pool), symbol.clone(), pc).await;
        }
    }

    if current_record.previous_close <= 0.0 {
        warn!("Skipping {}, unable to determine previous close", symbol);
        return Ok(());
    }

    let previous_close = current_record.previous_close;
    let current_price = price;

    if current_price <= 0.0 {
        warn!("Invalid prices for {}: current={}", symbol, current_price);
        return Ok(());
    }

    let price_change = current_price - previous_close;
    let percentage_change = if previous_close == 0.0 {
        0.0
    } else {
        (price_change / previous_close) * 100.0
    };

    let direction = if price_change >= 0.0 { "up" } else { "down" };

    let _ = update_trade(
        Arc::clone(&pool),
        symbol.clone(),
        current_price,
        price_change,
        percentage_change,
        direction,
        day_volume,
    ).await;

    Ok(())
}
