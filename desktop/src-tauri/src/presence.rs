//! Desktop presence reporter (SCROLLR-210).
//!
//! ONE loop per process, owned by the Rust core rather than a webview: it has
//! to keep running while every ticker is hidden and the main window is
//! closed to the tray, it must stop on quit and on system suspend, and the
//! OS signals it reports (session lock, display sleep, idle input) only exist
//! natively. Webview timers throttle in hidden windows; a tokio interval does
//! not.
//!
//! Every ~30 s it POSTs `/users/me/presence` with what the app can see about
//! itself: an ephemeral session id minted at launch, the OS session /
//! input / display state, the ticker preference, and for each ticker window
//! whether it is visible and which catalog widget types it is rendering
//! (reported by the webview through `report_screen_state`). Nothing about
//! what those widgets contain is sent, and nothing identifies the machine.
//!
//! Consent and auth are read from the app store (`scrollr.json`) on every
//! tick — the webview writes both — so the reporter never keeps a token and
//! never runs for an account that turned usage analytics off.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Cadence and expiry match the server's contract
/// (docs/analytics/ADMIN_DASHBOARD.md): ~30 s check-ins, 90 s expiry.
pub const CHECK_IN_INTERVAL: Duration = Duration::from_secs(30);
/// No input for this long counts as idle. Measures elapsed time since input,
/// never what was typed. Idle does not stop ticker time counting.
pub const IDLE_AFTER: Duration = Duration::from_secs(5 * 60);
/// Suspend and exit give us little time; a short bound keeps them prompt.
const ENDED_TIMEOUT: Duration = Duration::from_secs(2);

// ── OS signal state (written by platform hooks, read by the loop) ─────────

pub const SESSION_UNKNOWN: u8 = 0;
pub const SESSION_UNLOCKED: u8 = 1;
pub const SESSION_LOCKED: u8 = 2;

pub const DISPLAY_UNKNOWN: u8 = 0;
pub const DISPLAY_AWAKE: u8 = 1;
pub const DISPLAY_ASLEEP: u8 = 2;

pub static SESSION_STATE: AtomicU8 = AtomicU8::new(SESSION_UNKNOWN);
pub static DISPLAY_STATE: AtomicU8 = AtomicU8::new(DISPLAY_UNKNOWN);

pub fn session_word(v: u8) -> &'static str {
    match v {
        SESSION_UNLOCKED => "unlocked",
        SESSION_LOCKED => "locked",
        _ => "unknown",
    }
}

pub fn display_word(v: u8) -> &'static str {
    match v {
        DISPLAY_AWAKE => "awake",
        DISPLAY_ASLEEP => "asleep",
        _ => "unknown",
    }
}

/// `recent` / `idle` / `unknown` from the seconds since the last input, or
/// None where the platform cannot say.
pub fn input_word(idle_for: Option<Duration>) -> &'static str {
    match idle_for {
        Some(d) if d >= IDLE_AFTER => "idle",
        Some(_) => "recent",
        None => "unknown",
    }
}

// ── Managed state ────────────────────────────────────────────────────────

#[derive(Default)]
pub struct PresenceInner {
    /// Set by the main window through `configure_presence`. None = not yet
    /// configured, so nothing is sent.
    pub api_base: Option<String>,
    pub enabled: bool,
    /// Per ticker window label: the catalog widget types it rendered last.
    pub screens: HashMap<String, Vec<String>>,
    pub session_id: String,
    pub seq: i64,
    /// True once `ended` went out (suspend or exit); a resume restarts.
    pub ended: bool,
}

pub struct PresenceState(pub Mutex<PresenceInner>);

impl PresenceState {
    pub fn new() -> Self {
        let mut inner = PresenceInner::default();
        inner.session_id = new_session_id();
        PresenceState(Mutex::new(inner))
    }
}

/// A random 32-hex id per launch. Never persisted, never derived from the
/// machine.
fn new_session_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ── Payload ──────────────────────────────────────────────────────────────

#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct Screen {
    pub screen: String,
    pub shown: bool,
    pub widgets: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct CheckIn {
    pub session_id: String,
    pub seq: i64,
    pub session: &'static str,
    pub input: &'static str,
    pub display: &'static str,
    pub ticker: &'static str,
    pub screens: Vec<Screen>,
    pub ended: bool,
}

/// One ticker window as the loop sees it: its label and whether the OS says
/// it is visible right now (which is also how the Windows fullscreen
/// auto-hide is observed — it hides the HWND without telling the webview).
pub struct WindowSnapshot {
    pub label: String,
    pub visible: bool,
}

/// Pure: builds the body from what the loop gathered. `show_ticker` is the
/// user's preference; a window is shown only when the preference is on AND
/// the OS reports it visible.
pub fn build_check_in(
    session_id: &str,
    seq: i64,
    session: u8,
    idle_for: Option<Duration>,
    display: u8,
    show_ticker: bool,
    windows: &[WindowSnapshot],
    reported: &HashMap<String, Vec<String>>,
    ended: bool,
) -> CheckIn {
    let mut screens: Vec<Screen> = windows
        .iter()
        .map(|w| Screen {
            screen: w.label.clone(),
            shown: show_ticker && w.visible,
            widgets: reported.get(&w.label).cloned().unwrap_or_default(),
        })
        .collect();
    screens.sort_by(|a, b| a.screen.cmp(&b.screen));
    let ticker = if !show_ticker {
        "disabled"
    } else if screens.iter().any(|s| s.shown) {
        "shown"
    } else {
        "hidden"
    };
    CheckIn {
        session_id: session_id.to_string(),
        seq,
        session: session_word(session),
        input: input_word(idle_for),
        display: display_word(display),
        ticker,
        screens,
        ended,
    }
}

// ── Commands ─────────────────────────────────────────────────────────────

/// The main window calls this once it knows the API base and whether this
/// build may report (never in demo mode). Idempotent.
#[tauri::command]
pub fn configure_presence(state: tauri::State<'_, PresenceState>, api_base: String, enabled: bool) {
    let mut inner = state.0.lock().unwrap_or_else(|p| p.into_inner());
    inner.api_base = Some(api_base.trim_end_matches('/').to_string());
    inner.enabled = enabled;
    log::info!("[presence] configured (enabled={enabled})");
}

/// A ticker window reports the catalog widget types it is rendering. Any
/// value the server does not know is dropped there; here the list is only
/// bounded and deduplicated.
#[tauri::command]
pub fn report_screen_state(
    window: tauri::Window,
    state: tauri::State<'_, PresenceState>,
    widgets: Vec<String>,
) {
    if !crate::commands::window::is_ticker_label(window.label()) {
        return;
    }
    let mut list: Vec<String> = widgets
        .into_iter()
        .filter(|w| !w.is_empty() && w.len() <= 64)
        .take(64)
        .collect();
    list.sort();
    list.dedup();
    let mut inner = state.0.lock().unwrap_or_else(|p| p.into_inner());
    inner.screens.insert(window.label().to_string(), list);
}

// ── The loop ─────────────────────────────────────────────────────────────

/// Start the reporter. Called once from setup; the task lives as long as
/// the process.
pub fn start(app: AppHandle) {
    #[cfg(target_os = "windows")]
    crate::presence_win::install(app.clone());
    #[cfg(target_os = "macos")]
    crate::presence_mac::install(app.clone());
    #[cfg(target_os = "linux")]
    crate::presence_linux::install(app.clone());

    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder().timeout(Duration::from_secs(10)).build() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[presence] http client: {e}");
                return;
            }
        };
        let mut interval = tokio::time::interval(CHECK_IN_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            if let Err(e) = tick(&app, &client, false).await {
                log::debug!("[presence] check-in skipped: {e}");
            }
        }
    });
    log::info!("[presence] reporter started ({}s)", CHECK_IN_INTERVAL.as_secs());
}

/// Send the final check-in on suspend or exit, within a short bound. Safe
/// from any thread; a no-op when nothing was ever sent.
pub fn send_ended_blocking(app: &AppHandle) {
    let client = match reqwest::Client::builder().timeout(ENDED_TIMEOUT).build() {
        Ok(c) => c,
        Err(_) => return,
    };
    let app = app.clone();
    let done = std::thread::spawn(move || {
        tauri::async_runtime::block_on(async move {
            if let Err(e) = tick(&app, &client, true).await {
                log::debug!("[presence] ended check-in skipped: {e}");
            }
        });
    });
    let _ = done.join();
}

/// Resume after suspend: the ended flag clears so the next tick starts a
/// fresh interval (the server credits nothing across the gap).
pub fn resumed(app: &AppHandle) {
    if let Some(state) = app.try_state::<PresenceState>() {
        let mut inner = state.0.lock().unwrap_or_else(|p| p.into_inner());
        inner.ended = false;
    }
}

/// What the store says about auth and consent, read fresh each tick.
struct StoreView {
    access_token: Option<String>,
    expires_at_ms: i64,
    consent_enabled: bool,
    show_ticker: bool,
}

fn read_store(app: &AppHandle) -> StoreView {
    use tauri_plugin_store::StoreExt;
    let store = app.store("scrollr.json").ok();
    let auth = store.as_ref().and_then(|s| s.get("scrollr:auth"));
    let settings = store.as_ref().and_then(|s| s.get("scrollr:settings"));
    StoreView {
        access_token: auth
            .as_ref()
            .and_then(|a| a.get("accessToken"))
            .and_then(|v| v.as_str())
            .filter(|t| !t.is_empty())
            .map(String::from),
        expires_at_ms: auth
            .as_ref()
            .and_then(|a| a.get("expiresAt"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        consent_enabled: settings
            .as_ref()
            .and_then(|s| s.pointer("/privacy/postHogAnalyticsDecision"))
            .and_then(|v| v.as_str())
            == Some("enabled"),
        show_ticker: settings
            .as_ref()
            .and_then(|s| s.pointer("/ticker/showTicker"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
    }
}

fn ticker_windows(app: &AppHandle) -> Vec<WindowSnapshot> {
    let mut out: Vec<WindowSnapshot> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| crate::commands::window::is_ticker_label(label))
        .map(|(label, win)| WindowSnapshot { visible: win.is_visible().unwrap_or(false), label })
        .collect();
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

fn user_agent() -> String {
    let os = match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        _ => "linux",
    };
    format!("Scrollr/{} ({os})", env!("CARGO_PKG_VERSION"))
}

/// Debug builds only report when asked to, so `tauri dev` never writes
/// presence into production.
fn allowed_in_this_build() -> bool {
    !cfg!(debug_assertions) || std::env::var("SCROLLR_PRESENCE_DEV").map(|v| v == "1").unwrap_or(false)
}

async fn tick(app: &AppHandle, client: &reqwest::Client, ended: bool) -> Result<(), String> {
    let state = app.try_state::<PresenceState>().ok_or("no presence state")?;
    let view = read_store(app);
    let (api_base, session_id, seq, screens) = {
        let mut inner = state.0.lock().unwrap_or_else(|p| p.into_inner());
        if !inner.enabled || !allowed_in_this_build() {
            return Err("disabled".into());
        }
        if ended && inner.ended {
            return Err("already ended".into());
        }
        // After suspend's `ended` the interval keeps ticking until the
        // process is frozen; a tick that slips through would re-create the
        // live session for a machine that is asleep. `resumed()` lifts this.
        if !ended && inner.ended {
            return Err("suspended".into());
        }
        let api_base = inner.api_base.clone().ok_or("not configured")?;
        if !view.consent_enabled {
            return Err("usage analytics off".into());
        }
        let token_ok = view.access_token.is_some() && view.expires_at_ms > now_ms();
        if !token_ok {
            // Ask the main window to refresh; the next tick reads the new
            // token from the store.
            let _ = app.emit_to("main", "presence-auth-expired", ());
            return Err("no valid token".into());
        }
        inner.seq += 1;
        if ended {
            inner.ended = true;
        }
        (api_base, inner.session_id.clone(), inner.seq, inner.screens.clone())
    };
    // The final check-in must not touch windows: on exit the main thread
    // is blocked inside the run loop, and `is_visible` waits on it. The
    // server credits the last interval from the state it already holds
    // and discards this payload's screens.
    let windows = if ended { Vec::new() } else { ticker_windows(app) };
    if !ended {
        let mut inner = state.0.lock().unwrap_or_else(|p| p.into_inner());
        inner.screens.retain(|label, _| windows.iter().any(|w| &w.label == label));
    }
    let body = build_check_in(
        &session_id,
        seq,
        SESSION_STATE.load(Ordering::Relaxed),
        idle_for(),
        DISPLAY_STATE.load(Ordering::Relaxed),
        view.show_ticker,
        &windows,
        &screens,
        ended,
    );
    let token = view.access_token.unwrap_or_default();
    let response = client
        .post(format!("{api_base}/users/me/presence"))
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", user_agent())
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    match response.status().as_u16() {
        200 | 204 => Ok(()),
        401 => {
            let _ = app.emit_to("main", "presence-auth-expired", ());
            Err("401".into())
        }
        code => Err(format!("status {code}")),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Seconds since the last keyboard or mouse input, where the platform can
/// say. Windows: GetLastInputInfo. macOS: CGEventSourceSecondsSinceLastEventType.
/// Linux: the desktop's screensaver idle time, or unknown where no
/// interface provides it.
fn idle_for() -> Option<Duration> {
    #[cfg(target_os = "windows")]
    {
        crate::presence_win::idle_for()
    }
    #[cfg(target_os = "macos")]
    {
        crate::presence_mac::idle_for()
    }
    #[cfg(target_os = "linux")]
    {
        crate::presence_linux::idle_for()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn windows(spec: &[(&str, bool)]) -> Vec<WindowSnapshot> {
        spec.iter().map(|(l, v)| WindowSnapshot { label: l.to_string(), visible: *v }).collect()
    }

    #[test]
    fn idle_is_elapsed_time_only() {
        assert_eq!(input_word(Some(Duration::from_secs(10))), "recent");
        assert_eq!(input_word(Some(IDLE_AFTER - Duration::from_secs(1))), "recent");
        assert_eq!(input_word(Some(IDLE_AFTER)), "idle");
        assert_eq!(input_word(None), "unknown");
    }

    #[test]
    fn unsupported_signals_stay_unknown() {
        assert_eq!(session_word(SESSION_UNKNOWN), "unknown");
        assert_eq!(display_word(DISPLAY_UNKNOWN), "unknown");
        assert_eq!(session_word(9), "unknown");
    }

    #[test]
    fn check_in_reports_each_screen_and_the_ticker_state() {
        let mut reported = HashMap::new();
        reported.insert("ticker".to_string(), vec!["sports_nfl".to_string(), "clock".to_string()]);
        reported.insert("ticker-9".to_string(), vec!["stale".to_string()]); // window gone
        let body = build_check_in(
            "abc",
            3,
            SESSION_UNLOCKED,
            Some(Duration::from_secs(1)),
            DISPLAY_AWAKE,
            true,
            &windows(&[("ticker-2", false), ("ticker", true)]),
            &reported,
            false,
        );
        assert_eq!(body.ticker, "shown");
        assert_eq!(body.screens.len(), 2);
        assert_eq!(body.screens[0].screen, "ticker");
        assert!(body.screens[0].shown);
        assert_eq!(body.screens[0].widgets, vec!["sports_nfl", "clock"]);
        assert_eq!(body.screens[1].screen, "ticker-2");
        assert!(!body.screens[1].shown);
        assert!(body.screens[1].widgets.is_empty());
        assert_eq!(body.seq, 3);
        assert!(!body.ended);
    }

    #[test]
    fn preference_off_is_disabled_and_os_hidden_is_hidden() {
        let reported = HashMap::new();
        let off = build_check_in("abc", 1, SESSION_UNKNOWN, None, DISPLAY_UNKNOWN, false, &windows(&[("ticker", true)]), &reported, false);
        assert_eq!(off.ticker, "disabled");
        assert!(!off.screens[0].shown, "the preference wins over the OS");
        let hidden = build_check_in("abc", 2, SESSION_LOCKED, None, DISPLAY_ASLEEP, true, &windows(&[("ticker", false)]), &reported, true);
        assert_eq!(hidden.ticker, "hidden");
        assert_eq!(hidden.session, "locked");
        assert_eq!(hidden.display, "asleep");
        assert!(hidden.ended);
        let none = build_check_in("abc", 3, SESSION_UNLOCKED, None, DISPLAY_AWAKE, true, &[], &reported, false);
        assert_eq!(none.ticker, "hidden");
        assert!(none.screens.is_empty());
    }

    #[test]
    fn session_ids_are_random_hex_and_never_reused() {
        let a = new_session_id();
        let b = new_session_id();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn user_agent_matches_the_server_parser() {
        let ua = user_agent();
        assert!(ua.starts_with("Scrollr/"));
        assert!(ua.ends_with("(windows)") || ua.ends_with("(macos)") || ua.ends_with("(linux)"));
    }
}
