use crate::commands::diagnostics::{monitors, pick_monitor, MonitorInfo};
use crate::compositor::{self, Compositor};
use std::sync::{Mutex, MutexGuard};
use tauri::{Emitter, Manager};

/// Every attached monitor in logical coordinates, primary flagged.
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

    let mut live = Vec::new();
    for i in 0..wanted.len().max(1) {
        let label = ticker_label(i);
        if app.get_webview_window(&label).is_some() {
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
        live.push(label);
    }

    for (label, win) in app.webview_windows() {
        if is_ticker_label(&label) && !live.contains(&label) {
            #[cfg(target_os = "windows")]
            let _ = crate::commands::appbar_win::unregister(&win.as_ref().window());
            let _ = win.destroy();
            log::info!("[ticker] destroyed {label}");
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

    let current = || {
        let m = window.current_monitor().ok().flatten()?;
        Some(MonitorInfo::from_monitor(&m, false))
    };
    let target = monitor
        .or_else(|| monitor_for_label(window.label()))
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
                let phys_x = (monitor_x * scale).round() as i32;
                let phys_y = (new_y * scale).round() as i32;
                let phys_w = (screen_width * scale).round() as i32;
                let phys_h = (win_height * scale).round() as i32;
                return appbar_win::set_position(
                    &window, &position, phys_x, phys_y, phys_w, phys_h,
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
        MonitorInfo {
            name: name.into(),
            x: 0.0,
            y: 0.0,
            width: 3440.0,
            height: 1440.0,
            scale_factor: 1.0,
            is_primary,
        }
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
}
