use crate::commands::diagnostics::{monitors, pick_monitor, MonitorInfo};
use crate::compositor::{self, Compositor};
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::{Emitter, Manager};

/// Every attached monitor, logical and physical rects, primary flagged.
/// The `name` values are what `position_ticker`'s `monitor` takes.
#[tauri::command]
pub fn list_monitors(app: tauri::AppHandle) -> Vec<MonitorInfo> {
    monitors(&app)
}

// ── One ticker window per chosen monitor ─────────────────────────
//
// `window.tickerMonitors` (prefs) names the screens. The main window
// owns the `sync_ticker_windows` call (see routes/__root.tsx): there is
// exactly one of it and it outlives every ticker, whereas each ticker
// would otherwise fire the sync — including the one being closed by it.
//
// Window `i` is labelled `ticker` / `ticker-2` / `ticker-3`… and titled
// "Scrollr Ticker" / "Scrollr Ticker 2"…: the Wayland shims in
// compositor/ find windows BY TITLE, so every ticker needs its own.

/// `label → monitor name`, rewritten by every `sync_ticker_windows`.
/// `position_ticker` reads it when its caller omits `monitor`: each
/// ticker positions itself from shared prefs and does not otherwise
/// know which screen it was created for.
static TICKER_MONITORS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

fn ticker_monitors() -> MutexGuard<'static, Vec<(String, String)>> {
    TICKER_MONITORS.lock().unwrap_or_else(|p| p.into_inner())
}

fn monitor_for_label(label: &str) -> Option<String> {
    ticker_monitors()
        .iter()
        .find(|(l, _)| l == label)
        .map(|(_, m)| m.clone())
}

/// A copy of the `label → monitor name` map (for diagnostics).
pub fn ticker_monitor_map() -> Vec<(String, String)> {
    ticker_monitors().clone()
}

// ── Monitor hotplug ──────────────────────────────────────────────
//
// Tauri has no monitor-changed event. `check_monitors` compares the
// attached set with the last one seen and emits `monitors-changed` to
// every window when it differs; the main window answers by re-running
// `sync_ticker_windows` against the unchanged pref (routes/__root.tsx),
// Settings › Window by re-listing. Two things drive it: a 5 s poll
// (every platform) and WM_DISPLAYCHANGE in the ticker's AppBar
// subclass (Windows, instant). Both funnel through the same last-seen
// state, so the burst of WM_DISPLAYCHANGE a Win+P switch produces
// emits once per real change, not once per message.

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static LAST_MONITORS: Mutex<Option<Vec<MonitorInfo>>> = Mutex::new(None);

/// Records `now`; true when it differs from the previous set. The first
/// observation only records — launch is not a hotplug.
fn monitors_changed(last: &mut Option<Vec<MonitorInfo>>, now: Vec<MonitorInfo>) -> bool {
    let changed = last.as_ref().is_some_and(|l| *l != now);
    *last = Some(now);
    changed
}

/// Re-enumerate and emit `monitors-changed` if the set moved. Safe from
/// any thread, including the ticker's window proc.
pub fn check_monitors() {
    let Some(app) = APP.get() else { return };
    let now = monitors(app);
    let changed = monitors_changed(&mut LAST_MONITORS.lock().unwrap_or_else(|p| p.into_inner()), now);
    if changed {
        log::info!("[ticker] monitor set changed");
        let _ = app.emit("monitors-changed", ());
    }
}

/// Record the launch-time set and start the poll. Once, from setup.
pub fn watch_monitors(app: &tauri::AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    check_monitors();
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        check_monitors();
    });
}

/// Serialises `sync_ticker_windows`: hotplug can fire it twice in quick
/// succession, and two syncs building the same `ticker-N` at once is a
/// duplicate-label error. The later caller enumerates after the earlier
/// one finished, so the final set is the current one.
static SYNC: Mutex<()> = Mutex::new(());

pub fn is_ticker_label(label: &str) -> bool {
    label == "ticker" || label.starts_with("ticker-")
}

fn ticker_label(i: usize) -> String {
    if i == 0 { "ticker".into() } else { format!("ticker-{}", i + 1) }
}

fn ticker_title(i: usize) -> String {
    if i == 0 { "Scrollr Ticker".into() } else { format!("Scrollr Ticker {}", i + 1) }
}

/// The chosen monitors that are attached, in the chosen order, deduped;
/// none left (empty pref, or everything unplugged) means the primary.
/// Empty only when nothing can be enumerated at all.
fn choose_monitors(chosen: &[String], attached: &[MonitorInfo]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for name in chosen {
        if attached.iter().any(|m| &m.name == name) && !out.contains(name) {
            out.push(name.clone());
        }
    }
    if out.is_empty() {
        out.extend(pick_monitor(attached, "").map(|m| m.name.clone()));
    }
    out
}

/// One-time setup shared by the config-created `ticker` and the
/// runtime-created `ticker-N` windows.
pub fn prepare_ticker(win: &tauri::WebviewWindow) {
    // Force the WebView2 surface dark so the area outside the HTML
    // body never flashes white.
    let _ = win.set_background_color(Some(tauri::webview::Color(20, 20, 32, 255)));
    // Clear any AppBar registration a crashed session left on this
    // HWND. Harmless no-op when there is none.
    #[cfg(target_os = "windows")]
    let _ = crate::commands::appbar_win::force_unregister_stale(&win.as_ref().window());
}

/// Make the set of ticker windows match `monitors`: create the missing
/// `ticker-N`, destroy the surplus (releasing their AppBar edge), and
/// poke the survivors with `ticker-reposition` so each re-derives its
/// geometry from the new `label → monitor` map. Returns the live labels.
///
/// `async` on purpose: a sync command runs on the main thread, and
/// building a window from there deadlocks on Windows (Tauri docs).
#[tauri::command]
pub async fn sync_ticker_windows(app: tauri::AppHandle, monitors: Vec<String>) -> Result<Vec<String>, String> {
    let _serial = SYNC.lock().unwrap_or_else(|p| p.into_inner());
    let wanted = choose_monitors(&monitors, &crate::commands::diagnostics::monitors(&app));
    *ticker_monitors() = wanted
        .iter()
        .enumerate()
        .map(|(i, m)| (ticker_label(i), m.clone()))
        .collect();

    let template = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "ticker")
        .cloned()
        .ok_or("no ticker window in tauri.conf.json")?;

    let live: Vec<String> = (0..wanted.len().max(1)).map(ticker_label).collect();

    // Surplus first: a window whose monitor vanished has been shoved
    // onto a surviving screen by the OS, AppBar reservation and all,
    // and a survivor re-querying its edge while that reservation
    // stands gets pushed down by one bar height.
    for (label, win) in app.webview_windows() {
        if is_ticker_label(&label) && !live.contains(&label) {
            #[cfg(target_os = "windows")]
            let _ = crate::commands::appbar_win::unregister(&win.as_ref().window());
            let _ = win.destroy();
            log::info!("[ticker] destroyed {label}");
        }
    }

    for (i, label) in live.iter().enumerate() {
        if app.get_webview_window(label).is_some() {
            let _ = app.emit_to(label.as_str(), "ticker-reposition", ());
        } else {
            let mut cfg = template.clone();
            cfg.label = label.clone();
            cfg.title = ticker_title(i);
            let win = tauri::WebviewWindowBuilder::from_config(&app, &cfg)
                .and_then(|b| b.build())
                .map_err(|e| format!("create {label} failed: {e}"))?;
            prepare_ticker(&win);
            log::info!("[ticker] created {label} for {:?}", wanted.get(i));
        }
    }
    Ok(live)
}

/// Snap the ticker window to a screen edge and stretch it to full monitor width.
/// Sets x = monitor left edge, width = monitor width, y = top or bottom edge.
///
/// `monitor` names the target screen (see `list_monitors`). An unknown
/// name lands on the primary; omitted uses the screen `sync_ticker_windows`
/// assigned to this window's label, else the monitor it is currently on.
///
/// Wayland compositors ignore GTK's `set_position()` and may ignore `set_size()`.
/// We detect the compositor and use native IPC:
///   Hyprland → `hyprctl dispatch movewindowpixel` + `resizewindowpixel`
///   Sway     → `swaymsg move absolute position` + `resize set`
///   KDE/KWin → `qdbus6` D-Bus scripting API → frameGeometry
///   Fallback → GTK set_size + set_position (works on macOS/Windows/X11)
#[tauri::command]
pub fn position_ticker(
    window: tauri::Window,
    position: String,
    height: Option<f64>,
    monitor: Option<String>,
) -> Result<(), String> {
    // Validate inputs
    if position != "top" && position != "bottom" {
        return Err(format!("invalid position: {position}"));
    }
    if let Some(h) = height {
        if !h.is_finite() || !(1.0..=10_000.0).contains(&h) {
            return Err("height out of range".into());
        }
    }

    // A ticker the last sync dropped from its map is on its way out:
    // its own JS can still fire this between the sync's AppBar
    // unregister and the destroy, and registering then leaves the
    // shell reserving an edge for a dead HWND until logoff. (The map
    // is only empty before the first sync, when `ticker` positions
    // itself at launch.)
    let assigned = monitor_for_label(window.label());
    if is_ticker_label(window.label()) && assigned.is_none() && !ticker_monitors().is_empty() {
        return Err(format!("{} is being removed", window.label()));
    }

    let current = || {
        let m = window.current_monitor().ok().flatten()?;
        Some(MonitorInfo::from_monitor(&m, false))
    };
    let target = monitor
        .or(assigned)
        .as_deref()
        .and_then(|name| pick_monitor(&monitors(window.app_handle()), name).cloned())
        .or_else(current)
        .ok_or("no monitor found")?;

    let scale = target.scale_factor;
    let screen_width = target.width;
    let screen_height = target.height;
    let monitor_x = target.x;
    let monitor_y = target.y;

    // Use explicit height if provided; otherwise read from window.
    // On Wayland, a preceding set_size() may not have propagated yet,
    // so callers should always pass the desired height.
    let win_height = match height {
        Some(h) => h,
        None => {
            let size = window
                .outer_size()
                .map_err(|e| format!("outer_size failed: {e}"))?;
            size.height as f64 / scale
        }
    };

    let new_y = if position == "top" {
        monitor_y
    } else {
        monitor_y + screen_height - win_height
    };

    // Wayland compositors ignore GTK set_position/set_size — use native IPC.
    // Pass height so compositor sets full geometry atomically.
    match compositor::detect() {
        Compositor::Hyprland => {
            compositor::hyprland::position(&window, monitor_x, new_y, screen_width, win_height)
        }
        Compositor::Sway => {
            compositor::sway::position(&window, monitor_x, new_y, screen_width, win_height)
        }
        Compositor::Kwin(qdbus) => {
            compositor::kwin::position(&window, monitor_x, new_y, screen_width, win_height, qdbus)
        }
        Compositor::Fallback => {
            // -- Windows AppBar POC -----------------------------------
            // Always-on. Registers the ticker as a Shell AppBar so
            // maximized windows respect its space. To be gated
            // behind a user preference in the productionized version.
            #[cfg(target_os = "windows")]
            {
                use crate::commands::appbar_win;
                appbar_win::register(&window)?;
                // The monitor's own physical rect, not logical × scale:
                // on a 300 % screen the logical x is a third and would
                // round-trip inexactly (REL-203). Only the bar height
                // is ours to scale.
                let phys_h = (win_height * scale).round() as i32;
                let phys_y = if position == "top" {
                    target.physical_y
                } else {
                    target.physical_y + target.physical_height as i32 - phys_h
                };
                return appbar_win::set_position(
                    &window,
                    &position,
                    target.physical_x,
                    phys_y,
                    target.physical_width as i32,
                    phys_h,
                );
            }

            // GTK (macOS, X11, GNOME) + Windows non-AppBar fallback
            #[allow(unreachable_code)]
            {
                let _ = window.set_size(tauri::LogicalSize::new(screen_width, win_height));
                window
                    .set_position(tauri::LogicalPosition::new(monitor_x, new_y))
                    .map_err(|e| format!("set_position failed: {e}"))
            }
        }
    }
}

// ── Identify: flash each screen's number on it ───────────────────
//
// Settings › Monitors numbers the screens in `list_monitors` order;
// this shows that number on each one for a moment (Windows' own
// "Identify" button) so the user can tell which switch is which
// without a ticker being on it. One tiny always-on-top window per
// monitor, `identify-N`, destroyed after `IDENTIFY_MS`.

const IDENTIFY_MS: u64 = 1500;
/// Tile side in logical px — scaled by the screen's own factor so it
/// looks the same size on every screen.
const IDENTIFY_SIZE: f64 = 220.0;

/// `(x, y, w, h)` of the tile, centred on `m`, in physical pixels.
fn identify_tile(m: &MonitorInfo) -> (i32, i32, i32, i32) {
    let side = (IDENTIFY_SIZE * m.scale_factor).round() as i32;
    (
        m.physical_x + (m.physical_width as i32 - side) / 2,
        m.physical_y + (m.physical_height as i32 - side) / 2,
        side,
        side,
    )
}

/// `async` for the same reason as `sync_ticker_windows`: window
/// creation from the main thread deadlocks on Windows.
#[tauri::command]
pub async fn identify_monitors(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("identify-1").is_some() {
        return Ok(()); // already flashing
    }
    let list = monitors(&app);
    for (i, m) in list.iter().enumerate() {
        let n = i + 1;
        let (x, y, w, h) = identify_tile(m);
        let win = tauri::WebviewWindowBuilder::new(
            &app,
            format!("identify-{n}"),
            tauri::WebviewUrl::App("identify.html".into()),
        )
        // The page has no script of its own (CSP); this runs before
        // it and fills in the number.
        .initialization_script(format!(
            "document.addEventListener('DOMContentLoaded',()=>{{document.getElementById('n').textContent='{n}'}})"
        ))
        .title(format!("Scrollr Display {n}"))
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| format!("identify-{n}: {e}"))?;
        let _ = win.set_background_color(Some(tauri::webview::Color(20, 20, 32, 255)));
        // Physical, after build: the builder's logical position would
        // be resolved against the wrong scale on a mixed-DPI desktop.
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
        let _ = win.show();
    }
    let count = list.len();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(IDENTIFY_MS));
        for n in 1..=count {
            if let Some(w) = app.get_webview_window(&format!("identify-{n}")) {
                let _ = w.destroy();
            }
        }
    });
    Ok(())
}

// ── Pin (always-on-top) via compositor IPC ───────────────────────
//
// Wayland compositors ignore GTK's `set_keep_above()` at runtime
// (Tauri's `setAlwaysOnTop()` is a no-op on most Wayland compositors).
// We detect the compositor and use its native IPC instead:
//   Hyprland → `hyprctl dispatch pin address:0x...`
//   Sway     → `swaymsg [title="..."] sticky enable/disable`
//   KDE/KWin → `qdbus6` D-Bus scripting API → keepAbove
//   Fallback → GTK set_always_on_top (works on GNOME/X11)

#[tauri::command]
pub fn pin_window(window: tauri::Window, pinned: bool) -> Result<(), String> {
    match compositor::detect() {
        Compositor::Hyprland => compositor::hyprland::pin(&window, pinned),
        Compositor::Sway => compositor::sway::pin(&window, pinned),
        Compositor::Kwin(qdbus) => compositor::kwin::pin(&window, pinned, qdbus),
        Compositor::Fallback => window
            .set_always_on_top(pinned)
            .map_err(|e| format!("set_always_on_top failed: {e}")),
    }
}

#[tauri::command]
pub fn show_app_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.show().map_err(|e| format!("show failed: {e}"))?;
        w.set_focus().map_err(|e| format!("focus failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Toggle the "hide ticker when a fullscreen app appears" preference.
/// Windows-only. On non-Windows this is a no-op.
#[tauri::command]
pub fn set_hide_on_fullscreen(_value: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::commands::appbar_win::set_hide_on_fullscreen(_value);
    }
    Ok(())
}

/// Inform the AppBar layer that the ticker has been shown or hidden.
/// On hide we call ABM_REMOVE so the work area stops being reserved
/// (otherwise turning the ticker off leaves a permanent dead zone
/// where the ticker used to be). On show we re-register; the
/// subsequent position_ticker call will resize the AppBar properly.
///
/// Windows-only. Idempotent (register/unregister both guard
/// against double-calls internally).
#[tauri::command]
pub fn set_ticker_visible(_window: tauri::Window, _visible: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use crate::commands::appbar_win;
        // On show there is nothing to do proactively — the next
        // position_ticker call registers the AppBar lazily.
        if !_visible {
            let _ = appbar_win::unregister(&_window);
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    fn mon(name: &str, is_primary: bool) -> MonitorInfo {
        MonitorInfo::new(name.into(), (0, 0), (3440, 1440), 1.0, is_primary)
    }

    #[test]
    fn identify_tile_is_centred_in_physical_pixels() {
        // 300 % screen right of the primary: the tile is 3× bigger and
        // sits at that screen's physical centre, not at 1/3 of it.
        let d3 = MonitorInfo::new("d3".into(), (3440, 0), (3840, 2160), 3.0, false);
        assert_eq!(identify_tile(&d3), (3440 + 1920 - 330, 1080 - 330, 660, 660));
        let d2 = MonitorInfo::new("d2".into(), (-3440, 0), (3440, 1440), 1.0, false);
        assert_eq!(identify_tile(&d2), (-3440 + 1720 - 110, 720 - 110, 220, 220));
    }

    #[test]
    fn labels_and_titles_are_unique_per_index() {
        assert_eq!(ticker_label(0), "ticker");
        assert_eq!(ticker_label(1), "ticker-2");
        assert_eq!(ticker_title(0), "Scrollr Ticker");
        assert_eq!(ticker_title(2), "Scrollr Ticker 3");
        assert!(is_ticker_label("ticker") && is_ticker_label("ticker-7"));
        assert!(!is_ticker_label("main") && !is_ticker_label("tickerX"));
    }

    #[test]
    fn choose_monitors_keeps_attached_chosen_else_primary() {
        let attached = [mon(r"\.\DISPLAY1", false), mon(r"\.\DISPLAY2", true)];
        let two = [r"\.\DISPLAY1".to_string(), r"\.\DISPLAY2".to_string()];
        assert_eq!(choose_monitors(&two, &attached), two.to_vec());
        // empty pref = primary = today's behaviour
        assert_eq!(choose_monitors(&[], &attached), vec![r"\.\DISPLAY2".to_string()]);
        // unplugged names drop out; duplicates collapse
        let stale = ["gone".to_string(), r"\.\DISPLAY1".to_string(), r"\.\DISPLAY1".to_string()];
        assert_eq!(choose_monitors(&stale, &attached), vec![r"\.\DISPLAY1".to_string()]);
        assert_eq!(choose_monitors(&["gone".to_string()], &attached), vec![r"\.\DISPLAY2".to_string()]);
        // nothing enumerable: no mapping, caller still keeps one window
        assert!(choose_monitors(&two, &[]).is_empty());
    }

    #[test]
    fn monitors_changed_ignores_first_observation_and_repeats() {
        let two = vec![mon(r"\.\DISPLAY1", false), mon(r"\.\DISPLAY2", true)];
        let one = vec![mon(r"\.\DISPLAY2", true)];
        let mut last = None;
        assert!(!monitors_changed(&mut last, two.clone()), "launch is not a hotplug");
        assert!(!monitors_changed(&mut last, two.clone()), "same set, no event");
        assert!(monitors_changed(&mut last, one.clone()), "unplugged");
        assert!(monitors_changed(&mut last, two), "plugged back in");
        // primary moving counts too: the fallback screen follows it
        let mut moved = one.clone();
        moved[0].is_primary = false;
        assert!(monitors_changed(&mut Some(one), moved));
    }
}
