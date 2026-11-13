use crate::state::SseHandle;
use tauri::{Emitter, Manager};
use tokio::sync::watch;

/// The server sends a `: ping` comment every 15 s
/// (`api/internal/platform/constants.go`, `SSEHeartbeatInterval`). Three
/// missed pings means the connection is dead even if TCP has not noticed,
/// as after a sleep (D2-5): reconnect instead of saying "live" for hours.
const IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

/// The next chunk of `stream`, or `None` if it ended or sent nothing for
/// `idle` (any bytes reset the wait, pings included).
async fn next_or_idle<S>(stream: &mut S, idle: std::time::Duration) -> Option<S::Item>
where
    S: futures_util::Stream + Unpin,
{
    use futures_util::StreamExt;
    match tokio::time::timeout(idle, stream.next()).await {
        Ok(item) => item,
        Err(_) => {
            log::warn!("SSE stream silent for {}s, reconnecting", idle.as_secs());
            None
        }
    }
}

/// Connect to the SSE endpoint and stream CDC events to the webview.
/// Cancels any existing SSE connection first. Runs in a background
/// tokio task with automatic reconnection and exponential backoff.
#[tauri::command]
pub async fn start_sse(app: tauri::AppHandle, token: String, api_base: String) -> Result<(), String> {
    // Cancel any existing connection
    stop_sse_internal(&app);

    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let state = app.state::<SseHandle>();
        *state.0.lock().map_err(|e| format!("lock: {e}"))? = Some(cancel_tx);
    }

    let sse_url = format!("{}/events", api_base.trim_end_matches('/'));
    tokio::spawn(sse_loop(app, token, sse_url, cancel_rx));
    Ok(())
}

/// Disconnect from the SSE endpoint.
#[tauri::command]
pub async fn stop_sse(app: tauri::AppHandle) -> Result<(), String> {
    stop_sse_internal(&app);
    app.emit("sse-status", serde_json::json!({ "status": "disconnected" })).ok();
    Ok(())
}

fn stop_sse_internal(app: &tauri::AppHandle) {
    let state = app.state::<SseHandle>();
    let sender = state.0.lock().unwrap_or_else(|p| {
        log::warn!("SseHandle mutex was poisoned, recovering");
        p.into_inner()
    }).take();
    if let Some(tx) = sender {
        let _ = tx.send(true);
    }
}

/// Main SSE loop: connect → stream → reconnect on error.
async fn sse_loop(
    app: tauri::AppHandle,
    token: String,
    sse_url: String,
    mut cancel_rx: watch::Receiver<bool>,
) {
    let client = reqwest::Client::new();
    let mut backoff_secs = 1u64;
    let mut consecutive_overflows = 0u32;
    const MAX_CONSECUTIVE_OVERFLOWS: u32 = 3;

    loop {
        if *cancel_rx.borrow() {
            break;
        }

        let response = client
            .get(&sse_url)
            .header("Accept", "text/event-stream")
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await;

        match response {
            Ok(res) if res.status().is_success() => {
                app.emit(
                    "sse-status",
                    serde_json::json!({ "status": "connected" }),
                )
                .ok();
                backoff_secs = 1; // Reset on success

                let mut stream = res.bytes_stream();
                let mut buffer: Vec<u8> = Vec::new();
                let mut overflow = false;
                const MAX_BUFFER: usize = 10 * 1024 * 1024; // 10 MB

                loop {
                    tokio::select! {
                        chunk = next_or_idle(&mut stream, IDLE_TIMEOUT) => {
                            match chunk {
                                Some(Ok(bytes)) => {
                                    buffer.extend_from_slice(&bytes);
                                    if buffer.len() > MAX_BUFFER {
                                        log::warn!("SSE buffer exceeded {MAX_BUFFER} bytes, reconnecting");
                                        buffer.clear();
                                        overflow = true;
                                        break;
                                    }
                                    // Process complete SSE frames (delimited by \n\n)
                                    for frame in take_frames(&mut buffer) {
                                        process_sse_frame(&app, &frame);
                                    }
                                }
                                Some(Err(_)) => break, // Stream error, reconnect
                                None => break,         // Stream ended or went silent
                            }
                        }
                        _ = cancel_rx.changed() => {
                            break; // Cancelled
                        }
                    }
                }

                if overflow {
                    consecutive_overflows += 1;
                } else {
                    consecutive_overflows = 0;
                }
            }
            Ok(res) if res.status() == 401 => {
                // Token expired — notify JS so it can refresh and restart
                app.emit(
                    "sse-status",
                    serde_json::json!({ "status": "auth-expired" }),
                )
                .ok();
                break; // Don't retry with a bad token
            }
            Ok(res) => {
                app.emit(
                    "sse-status",
                    serde_json::json!({
                        "status": "error",
                        "code": res.status().as_u16()
                    }),
                )
                .ok();
            }
            Err(e) => {
                app.emit(
                    "sse-status",
                    serde_json::json!({
                        "status": "disconnected",
                        "error": e.to_string()
                    }),
                )
                .ok();
            }
        }

        // Check cancellation before sleeping
        if *cancel_rx.borrow() {
            break;
        }

        // Abort after repeated buffer overflows (likely a misbehaving server)
        if consecutive_overflows >= MAX_CONSECUTIVE_OVERFLOWS {
            log::error!(
                "SSE connection aborted after {MAX_CONSECUTIVE_OVERFLOWS} consecutive buffer overflows"
            );
            app.emit(
                "sse-status",
                serde_json::json!({
                    "status": "error",
                    "message": "Connection aborted: server sending oversized data"
                }),
            )
            .ok();
            break;
        }

        app.emit(
            "sse-status",
            serde_json::json!({ "status": "reconnecting" }),
        )
        .ok();

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
        tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(30);
    }
}

/// Remove every complete frame (ending in a blank line) from `buffer` and
/// return it decoded. The buffer holds raw bytes and is decoded only here,
/// per frame, so a multibyte character split across two network chunks is
/// never cut: a newline byte cannot occur inside a multibyte UTF-8 sequence.
fn take_frames(buffer: &mut Vec<u8>) -> Vec<String> {
    let mut frames = Vec::new();
    while let Some(pos) = buffer.windows(2).position(|w| w == b"\n\n") {
        frames.push(String::from_utf8_lossy(&buffer[..pos]).into_owned());
        buffer.drain(..pos + 2);
    }
    frames
}

#[cfg(test)]
mod tests {
    use super::{next_or_idle, take_frames};
    use std::time::Duration;

    #[test]
    fn silent_stream_gives_up_and_a_chunk_does_not() {
        tauri::async_runtime::block_on(async {
            let mut silent = futures_util::stream::pending::<u8>();
            assert_eq!(next_or_idle(&mut silent, Duration::from_millis(20)).await, None);

            let mut ping = futures_util::stream::iter([b':']);
            assert_eq!(next_or_idle(&mut ping, Duration::from_millis(20)).await, Some(b':'));
        });
    }

    #[test]
    fn multibyte_character_split_across_chunks_survives() {
        let text = "data: {\"t\":\"€ café 日本\"}";
        let full = format!("{text}\n\n").into_bytes();
        // Split inside the 3-byte euro sign.
        let cut = full.iter().position(|&b| b == 0xE2).unwrap() + 1;
        let mut buf = full[..cut].to_vec();
        assert!(take_frames(&mut buf).is_empty());
        buf.extend_from_slice(&full[cut..]);
        assert_eq!(take_frames(&mut buf), vec![text.to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn keeps_partial_frame_and_splits_several() {
        let mut buf = b"data: 1\n\ndata: 2\n\ndata: 3".to_vec();
        assert_eq!(take_frames(&mut buf), vec!["data: 1", "data: 2"]);
        assert_eq!(buf, b"data: 3");
    }
}

/// Parse a single SSE frame and emit data events to the webview.
fn process_sse_frame(app: &tauri::AppHandle, frame: &str) {
    for line in frame.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if let Ok(payload) = serde_json::from_str::<serde_json::Value>(data) {
                app.emit("sse-event", payload).ok();
            }
        }
        // Lines starting with ':' are comments (heartbeats) — ignore
        // Lines starting with 'retry:' set reconnect interval — we use our own backoff
    }
}
