//! Tauri commands for the client-side Kalshi account link.
//!
//! ARCHITECTURE (privacy/legal — do not change without review): the user's
//! Kalshi credentials live ONLY on this machine. These commands read the PEM
//! the user dragged in, validate it by making a signed read-only call, and
//! store it in the OS keychain (`kalshi::store`). The PEM is NEVER returned to
//! the webview, NEVER logged, NEVER sent to Sentry, and NEVER transmitted to
//! Scrollr servers. All Kalshi access here is READ-ONLY (portfolio reads +
//! read-only WS subscriptions); there is no code path that places or cancels
//! orders.

use crate::kalshi::{
    model::Portfolio,
    rest::RestClient,
    sign::Signer,
    store::{self, CredentialStatus, StoredCredential},
    ws, KalshiEnv,
};
use crate::state::KalshiStreamHandle;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio::sync::watch;

/// Result of a successful connect — only NON-SECRET fields.
#[derive(Serialize)]
pub struct ConnectResult {
    pub key_id: String,
    pub env: String,
    pub balance_cents: i64,
}

/// Map a raw Kalshi/transport error into plain-language copy for the wizard.
/// The input is an error string we built ourselves (REST status + Kalshi error
/// body) — it never contains the PEM or signature.
fn friendly_connect_error(err: &str) -> String {
    if err.contains("HTTP 401") || err.contains("HTTP 403") {
        "We couldn't connect with that file and ID. Double-check the Key ID \
         matches the connection file you just downloaded, then try again."
            .into()
    } else if err.contains("returned HTTP") {
        "Kalshi rejected the connection. Make sure your Key ID and connection \
         file are from the same account and haven't been deleted."
            .into()
    } else {
        "We couldn't reach Kalshi. Check your internet connection and try again."
            .into()
    }
}

/// Build a signed read-only REST client from the stored credential.
fn client_from_store() -> Result<RestClient, String> {
    let cred = store::load()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Not connected".to_string())?;
    let signer = Signer::from_pem(cred.key_id.clone(), &cred.pem).map_err(|e| e.to_string())?;
    RestClient::new(cred.env(), signer).map_err(|e| e.to_string())
}

/// Connect the user's Kalshi account.
///
/// `pem_path` is a local filesystem path to the private-key file the user
/// dragged in (we read it here in Rust — the PEM never travels through JS).
/// `key_id` is the Key ID the user typed. We validate the pair by making a
/// signed `GET /portfolio/balance`, and only persist on success.
#[tauri::command]
pub async fn kalshi_connect(
    key_id: String,
    pem_path: String,
    env: Option<String>,
) -> Result<ConnectResult, String> {
    let key_id = key_id.trim().to_string();
    if key_id.is_empty() {
        return Err("Please enter your Key ID from Kalshi.".into());
    }

    // Read the dragged-in file from the user's disk. We deliberately read it in
    // Rust (not JS) so the secret never crosses the webview boundary.
    let pem = std::fs::read_to_string(&pem_path)
        .map_err(|_| "We couldn't open that file. Please drag in the connection file you downloaded from Kalshi.".to_string())?;

    let env = KalshiEnv::parse(env.as_deref().unwrap_or("prod"));

    let signer = Signer::from_pem(key_id.clone(), &pem).map_err(|_| {
        "That file doesn't look like a Kalshi connection file. Make sure you \
         dragged in the file Kalshi downloaded when you created the connection."
            .to_string()
    })?;
    let client = RestClient::new(env, signer).map_err(|e| e.to_string())?;

    // The balance call both validates the credential and gives us the figure
    // to confirm back to the user.
    let balance_cents = client
        .balance_cents()
        .await
        .map_err(|e| friendly_connect_error(&e.to_string()))?;

    // Persist only after a verified, authenticated read succeeds. Keychain
    // errors are OS-level (e.g. "os error 122") and never contain the PEM, so
    // it's safe to surface the cause to help diagnose device-specific issues.
    store::save(&StoredCredential {
        key_id: key_id.clone(),
        env: env.as_str().to_string(),
        pem,
    })
    .map_err(|e| {
        format!("Your account checked out, but Scrollr couldn't save the connection securely on this device: {e:#}")
    })?;

    Ok(ConnectResult {
        key_id,
        env: env.as_str().to_string(),
        balance_cents,
    })
}

/// Non-secret connection status for the UI (connected?, key id, env).
#[tauri::command]
pub fn kalshi_status() -> Result<CredentialStatus, String> {
    store::status().map_err(|e| e.to_string())
}

/// Disconnect: stop the live stream and wipe the credential from the keychain.
#[tauri::command]
pub async fn kalshi_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    stop_stream_internal(&app);
    store::delete().map_err(|e| e.to_string())?;
    app.emit(
        "kalshi-stream-status",
        serde_json::json!({ "status": "disconnected" }),
    )
    .ok();
    Ok(())
}

/// Read-only snapshot of the user's portfolio (balance, positions, recent
/// fills, resting orders).
#[tauri::command]
pub async fn kalshi_portfolio() -> Result<Portfolio, String> {
    let client = client_from_store()?;
    client.portfolio().await.map_err(|e| e.to_string())
}

// ── Authenticated, read-only live stream ─────────────────────────

/// Start the authenticated WS stream (market_positions / fill / user_orders).
/// Emits `kalshi-user-event` (raw Kalshi WS frames) and `kalshi-stream-status`
/// to the webview. Cancels any existing stream first.
#[tauri::command]
pub async fn kalshi_start_user_stream(app: tauri::AppHandle) -> Result<(), String> {
    stop_stream_internal(&app);

    let cred = store::load()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Not connected".to_string())?;

    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let state = app.state::<KalshiStreamHandle>();
        *state.0.lock().map_err(|e| format!("lock: {e}"))? = Some(cancel_tx);
    }

    tokio::spawn(user_stream_loop(app, cred, cancel_rx));
    Ok(())
}

/// Stop the authenticated WS stream.
#[tauri::command]
pub async fn kalshi_stop_user_stream(app: tauri::AppHandle) -> Result<(), String> {
    stop_stream_internal(&app);
    app.emit(
        "kalshi-stream-status",
        serde_json::json!({ "status": "disconnected" }),
    )
    .ok();
    Ok(())
}

fn stop_stream_internal(app: &tauri::AppHandle) {
    let state = app.state::<KalshiStreamHandle>();
    let sender = state
        .0
        .lock()
        .unwrap_or_else(|p| {
            log::warn!("KalshiStreamHandle mutex was poisoned, recovering");
            p.into_inner()
        })
        .take();
    if let Some(tx) = sender {
        let _ = tx.send(true);
    }
}

/// The reconnecting read loop for the authenticated user-data WS. Mirrors the
/// SSE loop's backoff/cancel pattern. Never logs credential material.
async fn user_stream_loop(
    app: tauri::AppHandle,
    cred: StoredCredential,
    mut cancel_rx: watch::Receiver<bool>,
) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let ws_url = cred.env().ws_url();
    let mut backoff_secs = 1u64;
    let mut sub_id = 1u64;

    loop {
        if *cancel_rx.borrow() {
            break;
        }

        // Sign a fresh upgrade request each attempt (the signature is
        // timestamped and single-use).
        let signer = match Signer::from_pem(cred.key_id.clone(), &cred.pem) {
            Ok(s) => s,
            Err(_) => {
                app.emit(
                    "kalshi-stream-status",
                    serde_json::json!({ "status": "error", "message": "bad credential" }),
                )
                .ok();
                break;
            }
        };
        let request = match ws::signed_ws_request(ws_url, &signer) {
            Ok(r) => r,
            Err(_) => {
                app.emit(
                    "kalshi-stream-status",
                    serde_json::json!({ "status": "error" }),
                )
                .ok();
                break;
            }
        };

        match tokio_tungstenite::connect_async(request).await {
            Ok((mut stream, _)) => {
                backoff_secs = 1;
                // Tell the frontend to resnapshot via REST, then go live.
                app.emit(
                    "kalshi-stream-status",
                    serde_json::json!({ "status": "connected" }),
                )
                .ok();

                let sub = ws::subscribe_user(sub_id);
                sub_id += 1;
                if stream
                    .send(Message::Text(sub.to_string().into()))
                    .await
                    .is_err()
                {
                    // Failed to subscribe — back off before reconnecting. A
                    // bare `continue` skips the sleep at the loop bottom and
                    // hammers Kalshi with signed handshakes, risking a
                    // rate-limit on the user's own credential.
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)) => {}
                        _ = cancel_rx.changed() => break,
                    }
                    backoff_secs = (backoff_secs * 2).min(30);
                    continue;
                }

                loop {
                    tokio::select! {
                        msg = stream.next() => {
                            match msg {
                                Some(Ok(Message::Text(t))) => {
                                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(t.as_str()) {
                                        app.emit("kalshi-user-event", v).ok();
                                    }
                                }
                                Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                                Some(Ok(Message::Close(_))) | None => break,
                                Some(Ok(_)) => {}
                                Some(Err(_)) => break,
                            }
                        }
                        _ = cancel_rx.changed() => {
                            let _ = stream.close(None).await;
                            app.emit(
                                "kalshi-stream-status",
                                serde_json::json!({ "status": "disconnected" }),
                            ).ok();
                            return;
                        }
                    }
                }
            }
            Err(_) => {
                app.emit(
                    "kalshi-stream-status",
                    serde_json::json!({ "status": "error" }),
                )
                .ok();
            }
        }

        if *cancel_rx.borrow() {
            break;
        }

        app.emit(
            "kalshi-stream-status",
            serde_json::json!({ "status": "reconnecting" }),
        )
        .ok();

        // Exponential backoff: 1s, 2s, 4s, … 30s max, cancellable.
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)) => {}
            _ = cancel_rx.changed() => break,
        }
        backoff_secs = (backoff_secs * 2).min(30);
    }

    app.emit(
        "kalshi-stream-status",
        serde_json::json!({ "status": "disconnected" }),
    )
    .ok();
}
