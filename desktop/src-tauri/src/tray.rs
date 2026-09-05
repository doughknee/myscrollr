use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Wry,
};

/// State slot for the "Pin on Top" tray menu item. The frontend owns
/// `prefs.window.pinned` as the source of truth, so this holds a handle
/// we can update via `sync_tray_pin` whenever the frontend state flips.
pub struct PinTrayItem(pub Mutex<Option<CheckMenuItem<Wry>>>);

/// Build the system tray with menu items and event handlers.
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItemBuilder::with_id("open", "Open Scrollr").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let toggle_ticker = MenuItemBuilder::with_id("toggle_ticker", "Toggle Ticker").build(app)?;
    let pin_on_top = CheckMenuItemBuilder::with_id("pin_on_top", "Always on Top")
        .checked(false)
        .build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let report_bug = MenuItemBuilder::with_id("report_bug", "Report a Bug").build(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[
            &open,
            &sep1,
            &toggle_ticker,
            &pin_on_top,
            &sep2,
            &report_bug,
            &sep3,
            &quit,
        ])
        .build()?;

    // Park the CheckMenuItem in app state so the `sync_tray_pin` command
    // can update its checkmark when the frontend flips prefs.window.pinned.
    app.manage(PinTrayItem(Mutex::new(Some(pin_on_top.clone()))));

    // Monochrome icon for the system tray. On macOS, icon_as_template(true)
    // tells the OS to tint it white/black to match the menu bar appearance.
    let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .map_err(|e| format!("failed to load tray icon: {e}"))?;

    TrayIconBuilder::new()
        .tooltip("Scrollr")
        .icon(tray_icon)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "toggle_ticker" => {
                // JS owns prefs.ticker.showTicker — emit and let it toggle.
                let _ = app.emit("toggle-ticker", ());
            }
            "pin_on_top" => {
                // Same pattern as toggle_ticker. The frontend listener
                // flips prefs.window.pinned, invokes pin_window, then calls
                // sync_tray_pin to settle our checkmark. Don't mutate the
                // CheckMenuItem here — the OS already toggled it visually
                // and JS's echo is authoritative.
                let _ = app.emit("toggle-pin", ());
            }
            "report_bug" => {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
                let _ = app.emit("navigate-to", "/support");
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            // Left-click tray icon opens/focuses the app window
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Update the "Pin on Top" tray checkmark to match the given state.
/// Called from JS whenever `prefs.window.pinned` changes, so the tray
/// menu and the right-click menu stay visually consistent.
#[tauri::command]
pub fn sync_tray_pin(state: tauri::State<'_, PinTrayItem>, pinned: bool) {
    if let Ok(slot) = state.0.lock() {
        if let Some(item) = slot.as_ref() {
            let _ = item.set_checked(pinned);
        }
    }
}
