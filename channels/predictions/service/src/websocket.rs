//! Kalshi WebSocket ingestion: connect (signed upgrade), subscribe to the
//! `ticker` + `market_lifecycle_v2` channels, then a read loop that dispatches
//! on the message `type` field and coalesces high-frequency ticks before they
//! reach the `markets` table.
//!
//! Reconnect/backoff lives in `lib.rs`; this module returns on close/error so
//! the caller reconnects.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tokio::sync::Mutex;
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::protocol::{Message, WebSocketConfig},
};
use futures_util::{SinkExt, StreamExt};

use crate::database::{
    update_market_lifecycle, upsert_market, MarketUpsert, PgPool,
};
use crate::kalshi::{sign::Signer, ws};
use crate::log::{error, info, warn};
use crate::types::PredictionsHealth;

/// Maximum WebSocket message / frame size we will accept from Kalshi. Kalshi
/// ticker frames are small, but orderbook/lifecycle envelopes can be larger
/// than finance's tiny price events, so allow a generous 4 MiB ceiling.
const MAX_WS_MESSAGE_BYTES: usize = 4 << 20;

/// Per-ticker coalescing window. The first tick for a quiet market is written
/// immediately (leading edge — low latency); further ticks inside the window
/// are buffered as the newest snapshot and flushed once the window elapses
/// (trailing edge), so a market ticking 50x/sec writes ~1x/window WITHOUT ever
/// losing its final value.
const COALESCE_WINDOW: Duration = Duration::from_millis(750);

/// How often the read loop drains the trailing-edge buffer.
const FLUSH_INTERVAL: Duration = Duration::from_millis(200);

/// Kalshi WS message envelope. Only `type` is required to dispatch; the rest
/// of the payload lives under `msg` and is parsed per-type. Data messages also
/// carry a per-subscription `sid` + monotonic `seq` we use for gap detection.
#[derive(Debug, Deserialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    msg: serde_json::Value,
    /// Subscription id (present on data messages). Each channel subscription
    /// gets its own id with its own independent `seq` sequence.
    #[serde(default)]
    sid: Option<u64>,
    /// Monotonic per-`sid` sequence number; a forward jump means we missed
    /// messages and must resnapshot. (Kalshi documents this.)
    #[serde(default)]
    seq: Option<u64>,
}

/// Outcome of checking an inbound message's `seq` against the expected next
/// value for its subscription.
#[derive(Debug, PartialEq, Eq)]
enum SeqOutcome {
    /// In order (or the first message seen for this sid).
    Ok,
    /// A replayed/out-of-order message we've already advanced past — ignore.
    Duplicate,
    /// A forward gap — messages were missed; the caller should resnapshot.
    Gap,
}

/// Track the per-`sid` sequence and classify `seq`. On `Ok` (and the first
/// message for a sid) the expected-next value is advanced. On a `Gap` the
/// expected map is left untouched — the caller reconnects, which establishes a
/// fresh subscription (new sid) and a clean sequence.
fn track_seq(expected: &mut HashMap<u64, u64>, sid: u64, seq: u64) -> SeqOutcome {
    match expected.get(&sid).copied() {
        None => {
            expected.insert(sid, seq.wrapping_add(1));
            SeqOutcome::Ok
        }
        Some(exp) => {
            if seq == exp {
                expected.insert(sid, seq.wrapping_add(1));
                SeqOutcome::Ok
            } else if seq < exp {
                SeqOutcome::Duplicate
            } else {
                SeqOutcome::Gap
            }
        }
    }
}

/// `ticker` channel payload. All fields optional/defaulted so a payload shape
/// change never fails the whole batch.
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

/// Field-wise merge of two sparse ticker deltas: `newer` wins where it
/// carries a value, `older` fills the gaps. Kalshi ticker messages are
/// deltas (a trade tick carries last_price; a book tick may carry only
/// bid/ask or volume), so replacing a buffered snapshot wholesale would
/// silently drop the fields the newer message doesn't repeat.
fn merge_ticker(older: TickerMsg, newer: TickerMsg) -> TickerMsg {
    TickerMsg {
        market_ticker: newer.market_ticker,
        yes_bid_dollars: newer.yes_bid_dollars.or(older.yes_bid_dollars),
        yes_ask_dollars: newer.yes_ask_dollars.or(older.yes_ask_dollars),
        last_price_dollars: newer.last_price_dollars.or(older.last_price_dollars),
        price_dollars: newer.price_dollars.or(older.price_dollars),
        volume_fp: newer.volume_fp.or(older.volume_fp),
        open_interest_fp: newer.open_interest_fp.or(older.open_interest_fp),
    }
}

/// `market_lifecycle_v2` channel payload.
#[derive(Debug, Deserialize, Default)]
struct LifecycleMsg {
    #[serde(default)]
    market_ticker: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    result: Option<String>,
}

/// Parse a `*_dollars` decimal string into integer cents (0–100), rounding.
fn dollars_to_cents(s: Option<&str>) -> Option<i32> {
    s.and_then(|v| v.trim().parse::<f64>().ok())
        .map(|d| (d * 100.0).round() as i32)
}

/// Parse a `*_fp` decimal count string into a floored integer.
fn fp_to_int(s: Option<&str>) -> Option<i64> {
    s.and_then(|v| v.trim().parse::<f64>().ok())
        .map(|f| f.floor() as i64)
}

/// Build a `MarketUpsert` from a coalesced ticker snapshot. Returns `None`
/// when the snapshot carries no displayed numeric fields at all.
fn ticker_to_upsert(t: &TickerMsg) -> Option<MarketUpsert> {
    let yes_price = dollars_to_cents(
        t.last_price_dollars
            .as_deref()
            .or(t.price_dollars.as_deref()),
    );
    let yes_bid = dollars_to_cents(t.yes_bid_dollars.as_deref());
    let yes_ask = dollars_to_cents(t.yes_ask_dollars.as_deref());
    let volume = fp_to_int(t.volume_fp.as_deref());
    let open_interest = fp_to_int(t.open_interest_fp.as_deref());

    if yes_price.is_none()
        && yes_bid.is_none()
        && yes_ask.is_none()
        && volume.is_none()
        && open_interest.is_none()
    {
        return None;
    }

    let mut up = MarketUpsert::new(&t.market_ticker);
    up.yes_price = yes_price;
    up.yes_bid = yes_bid;
    up.yes_ask = yes_ask;
    up.volume = volume;
    up.open_interest = open_interest;
    Some(up)
}

/// Persist one coalesced ticker snapshot, updating the health/batch counters on
/// an actual change. Shared by the leading-edge write and the trailing-edge
/// drain so both paths behave identically.
async fn flush_ticker(
    pool: &Arc<PgPool>,
    health_state: &Arc<Mutex<PredictionsHealth>>,
    ticker: &TickerMsg,
    batch_number: &mut u64,
    error_count: &mut u64,
    last_error: &mut Option<String>,
) {
    let Some(upsert) = ticker_to_upsert(ticker) else {
        return;
    };
    // create_missing=false: the ticker firehose covers EVERY open Kalshi
    // market. Only the curated catalog sweep creates rows -- an unknown
    // ticker here would insert a title-less row flagged primary and flood
    // the public feed + CDC with the whole Kalshi universe.
    match upsert_market(pool, &upsert, false).await {
        Ok(true) => {
            *batch_number += 1;
            let mut health = health_state.lock().await;
            health.update_health(
                String::from("connected"),
                *batch_number,
                *error_count,
                last_error.clone(),
            );
        }
        // No-op tick (no displayed field changed) — nothing to persist.
        Ok(false) => {}
        Err(e) => {
            *error_count += 1;
            let m = format!("upsert_market failed for {}: {e:#}", ticker.market_ticker);
            warn!("{m}");
            *last_error = Some(m);
        }
    }
}

/// Connect, subscribe, and run the read loop. Returns `Ok(())` on a clean
/// server-side close and `Err` on connect/transport failure, so `lib.rs` can
/// reconnect and fold the error into health.
pub(crate) async fn connect(
    ws_url: String,
    signer: Signer,
    pool: Arc<PgPool>,
    health_state: Arc<Mutex<PredictionsHealth>>,
) -> Result<(), anyhow::Error> {
    // Cap message and frame sizes so a misbehaving server can't stream an
    // unbounded blob into memory. `WebSocketConfig` is `#[non_exhaustive]` in
    // tungstenite 0.28 so we have to use the builder methods.
    let ws_config = WebSocketConfig::default()
        .max_message_size(Some(MAX_WS_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_WS_MESSAGE_BYTES));

    let request = ws::signed_ws_request(&ws_url, &signer)?;
    let (ws_stream, _) = connect_async_with_config(request, Some(ws_config), false)
        .await
        .map_err(|e| {
            error!("Failed to connect to Kalshi WebSocket: {}", e);
            e
        })?;
    info!("WebSocket client connected to Kalshi");

    // Mark connected and reset error fields on a fresh connection.
    {
        let mut health = health_state.lock().await;
        let batch = health.batch_number;
        health.update_health(String::from("connected"), batch, 0, None);
    }

    let (mut writer, mut reader) = ws_stream.split();

    // Subscribe to ticker + lifecycle over the whole market universe. Done
    // inline so a failure surfaces to the caller rather than vanishing.
    let sub = ws::subscribe_all(1, &["ticker", "market_lifecycle_v2"]);
    writer
        .send(Message::Text(sub.to_string().into()))
        .await
        .map_err(|e| anyhow::anyhow!("failed to send subscribe command: {e}"))?;
    info!("Subscribed to Kalshi channels: ticker, market_lifecycle_v2");

    // Coalescing state. `last_write` = the instant we last persisted a market;
    // `pending` = the newest buffered snapshot for a market that ticked again
    // inside its window, awaiting the trailing-edge drain. A FLUSH_INTERVAL
    // timer drains `pending` so the final value of a tick burst is never lost.
    let mut last_write: HashMap<String, Instant> = HashMap::new();
    let mut pending: HashMap<String, TickerMsg> = HashMap::new();
    let mut flush_tick = tokio::time::interval(FLUSH_INTERVAL);
    flush_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let mut batch_number: u64 = {
        let h = health_state.lock().await;
        h.batch_number
    };
    let mut error_count: u64 = 0;
    let mut last_error: Option<String> = None;

    // Per-subscription expected-next `seq`, for gap detection (plan §9). A
    // forward gap means we missed messages; we break to reconnect, which
    // re-subscribes (fresh snapshot) and lets the catalog sweep reconcile.
    let mut expected_seq: HashMap<u64, u64> = HashMap::new();

    loop {
        tokio::select! {
            // Trailing-edge drain: persist buffered snapshots whose window has
            // elapsed, so a market that goes quiet after a burst still gets its
            // final value written.
            _ = flush_tick.tick() => {
                let now = Instant::now();
                let ready: Vec<String> = pending
                    .keys()
                    .filter(|k| {
                        last_write
                            .get(*k)
                            .is_none_or(|w| now.duration_since(*w) >= COALESCE_WINDOW)
                    })
                    .cloned()
                    .collect();
                for key in ready {
                    if let Some(t) = pending.remove(&key) {
                        flush_ticker(
                            &pool, &health_state, &t,
                            &mut batch_number, &mut error_count, &mut last_error,
                        ).await;
                        last_write.insert(key, now);
                    }
                }
            }

            // Inbound WebSocket frames.
            maybe_msg = reader.next() => {
                let Some(msg) = maybe_msg else {
                    // Stream ended without an explicit close frame.
                    info!("Kalshi WebSocket stream ended");
                    break;
                };

                let msg = match msg {
                    Ok(m) => m,
                    Err(e) => {
                        let m = format!("Error receiving Kalshi message: {e}");
                        error!("{m}");
                        last_error = Some(m);
                        error_count += 1;
                        break;
                    }
                };

                if msg.is_close() {
                    error!("Kalshi server closed connection");
                    last_error = Some(String::from("Server closed connection"));
                    break;
                }

                if !msg.is_text() {
                    // Ping/Pong/Binary frames carry no market data.
                    continue;
                }

                let text = msg.to_string();
                let envelope: WsEnvelope = match serde_json::from_str(&text) {
                    Ok(e) => e,
                    Err(_) => {
                        warn!("Unparseable Kalshi WS message: {text}");
                        continue;
                    }
                };

                // Sequence-gap detection on data messages (those carrying both
                // sid + seq). A gap means we missed updates → break to reconnect
                // and resnapshot; a duplicate/replay is skipped.
                if let (Some(sid), Some(seq)) = (envelope.sid, envelope.seq) {
                    match track_seq(&mut expected_seq, sid, seq) {
                        SeqOutcome::Ok => {}
                        SeqOutcome::Duplicate => {
                            warn!("Ignoring out-of-order Kalshi WS message on sid {sid} (seq {seq})");
                            continue;
                        }
                        SeqOutcome::Gap => {
                            let m = format!(
                                "Kalshi WS sequence gap on sid {sid} (got seq {seq}); reconnecting to resnapshot"
                            );
                            warn!("{m}");
                            last_error = Some(m);
                            break;
                        }
                    }
                }

                match envelope.msg_type.as_str() {
                    "subscribed" => {
                        info!("Kalshi subscription acknowledged: {text}");
                    }
                    "ticker" => {
                        let ticker: TickerMsg = match serde_json::from_value(envelope.msg) {
                            Ok(t) => t,
                            Err(e) => {
                                warn!("Failed to parse ticker payload: {e}");
                                continue;
                            }
                        };
                        if ticker.market_ticker.is_empty() {
                            continue;
                        }

                        let now = Instant::now();
                        let within_window = last_write
                            .get(&ticker.market_ticker)
                            .is_some_and(|w| now.duration_since(*w) < COALESCE_WINDOW);

                        if within_window {
                            // Inside the window: merge into the buffered
                            // snapshot (deltas are sparse -- replacing would
                            // drop fields the newer tick doesn't repeat); the
                            // trailing-edge drain persists it once the window
                            // elapses (no intermediate write, no loss).
                            let key = ticker.market_ticker.clone();
                            let merged = match pending.remove(&key) {
                                Some(buffered) => merge_ticker(buffered, ticker),
                                None => ticker,
                            };
                            pending.insert(key, merged);
                        } else {
                            // Leading edge: persist immediately for low
                            // latency, folding in any buffered delta first.
                            let key = ticker.market_ticker.clone();
                            let merged = match pending.remove(&key) {
                                Some(buffered) => merge_ticker(buffered, ticker),
                                None => ticker,
                            };
                            flush_ticker(
                                &pool, &health_state, &merged,
                                &mut batch_number, &mut error_count, &mut last_error,
                            ).await;
                            last_write.insert(key, now);
                        }
                    }
                    "market_lifecycle_v2" => {
                        let life: LifecycleMsg = match serde_json::from_value(envelope.msg) {
                            Ok(l) => l,
                            Err(e) => {
                                warn!("Failed to parse lifecycle payload: {e}");
                                continue;
                            }
                        };
                        if life.market_ticker.is_empty() {
                            continue;
                        }
                        match update_market_lifecycle(
                            &pool,
                            &life.market_ticker,
                            life.status.as_deref(),
                            life.result.as_deref(),
                        )
                        .await
                        {
                            Ok(changed) => {
                                if changed {
                                    batch_number += 1;
                                    let mut health = health_state.lock().await;
                                    health.update_health(
                                        String::from("connected"),
                                        batch_number,
                                        error_count,
                                        last_error.clone(),
                                    );
                                }
                            }
                            Err(e) => {
                                error_count += 1;
                                let m = format!(
                                    "update_market_lifecycle failed for {}: {e:#}",
                                    life.market_ticker
                                );
                                warn!("{m}");
                                last_error = Some(m);
                            }
                        }
                    }
                    "error" => {
                        error!("Kalshi WS error message: {text}");
                        last_error = Some(format!("Kalshi WS error: {text}"));
                        error_count += 1;
                    }
                    other => {
                        warn!("Unhandled Kalshi WS message type '{other}': {text}");
                    }
                }
            }
        }
    }

    // Drain any buffered snapshots so a market's final value is never lost when
    // the connection drops.
    for (_key, ticker) in pending.drain() {
        flush_ticker(
            &pool, &health_state, &ticker,
            &mut batch_number, &mut error_count, &mut last_error,
        ).await;
    }

    info!("Kalshi WebSocket read loop completed.");

    // Mark disconnected so the bridge loop / reconnect logic reacts.
    {
        let mut health = health_state.lock().await;
        health.update_health(
            String::from("disconnected"),
            batch_number,
            error_count,
            last_error.clone(),
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_seq_advances_in_order() {
        let mut exp = HashMap::new();
        assert_eq!(track_seq(&mut exp, 7, 1), SeqOutcome::Ok); // first seen
        assert_eq!(track_seq(&mut exp, 7, 2), SeqOutcome::Ok);
        assert_eq!(track_seq(&mut exp, 7, 3), SeqOutcome::Ok);
    }

    #[test]
    fn track_seq_detects_forward_gap() {
        let mut exp = HashMap::new();
        assert_eq!(track_seq(&mut exp, 1, 10), SeqOutcome::Ok); // first → expect 11
        assert_eq!(track_seq(&mut exp, 1, 11), SeqOutcome::Ok);
        // Jump from 12 to 15 → missed 12,13,14.
        assert_eq!(track_seq(&mut exp, 1, 15), SeqOutcome::Gap);
    }

    #[test]
    fn track_seq_ignores_duplicates_and_replays() {
        let mut exp = HashMap::new();
        assert_eq!(track_seq(&mut exp, 2, 5), SeqOutcome::Ok); // expect 6
        assert_eq!(track_seq(&mut exp, 2, 6), SeqOutcome::Ok); // expect 7
        assert_eq!(track_seq(&mut exp, 2, 5), SeqOutcome::Duplicate); // replay
        assert_eq!(track_seq(&mut exp, 2, 6), SeqOutcome::Duplicate);
        // Still in order afterwards.
        assert_eq!(track_seq(&mut exp, 2, 7), SeqOutcome::Ok);
    }

    #[test]
    fn track_seq_is_independent_per_sid() {
        let mut exp = HashMap::new();
        assert_eq!(track_seq(&mut exp, 1, 1), SeqOutcome::Ok);
        assert_eq!(track_seq(&mut exp, 2, 100), SeqOutcome::Ok); // different sid, own sequence
        assert_eq!(track_seq(&mut exp, 1, 2), SeqOutcome::Ok);
        assert_eq!(track_seq(&mut exp, 2, 101), SeqOutcome::Ok);
        assert_eq!(track_seq(&mut exp, 2, 200), SeqOutcome::Gap);
    }

    #[test]
    fn dollars_and_fp_parsing() {
        assert_eq!(dollars_to_cents(Some("0.62")), Some(62));
        assert_eq!(dollars_to_cents(Some("1.00")), Some(100));
        assert_eq!(dollars_to_cents(None), None);
        assert_eq!(fp_to_int(Some("33896.00")), Some(33896));
        assert_eq!(fp_to_int(Some("12.9")), Some(12));
    }
}
