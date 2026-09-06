use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Wry,
};

/// State slot for the "Show ticker" tray item. The frontend owns
/// `prefs.ticker.showTicker` as the source of truth, so this holds a
/// handle it updates via `sync_tray_ticker` whenever the pref flips.
pub struct ShowTickerItem(pub Mutex<Option<CheckMenuItem<Wry>>>);

/// Build the system tray with menu items and event handlers.
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItemBuilder::with_id("open", "Open Scrollr").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    // Same words as the settings row and the ticker's right-click menu.
    // Built checked (the pref's default); JS settles it at launch.
    let show_ticker = CheckMenuItemBuilder::with_id("show_ticker", "Show ticker")
        .checked(true)
        .build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let report_bug = MenuItemBuilder::with_id("report_bug", "Report a Bug").build(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[
            &open,
            &sep1,
            &show_ticker,
            &sep2,
            &report_bug,
            &sep3,
            &quit,
        ])
        .build()?;

    // Park the CheckMenuItem in app state so `sync_tray_ticker` can settle
    // its checkmark when the frontend flips prefs.ticker.showTicker.
    app.manage(ShowTickerItem(Mutex::new(Some(show_ticker.clone()))));

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
            "show_ticker" => {
                // JS owns prefs.ticker.showTicker — emit and let it toggle.
                // Don't mutate the CheckMenuItem here: the OS already
                // flipped it visually and JS's `sync_tray_ticker` echo is
                // authoritative.
                let _ = app.emit("toggle-ticker", ());
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

/// Update the "Show ticker" tray checkmark to match the given state.
/// Called from JS whenever `prefs.ticker.showTicker` changes, so the
/// tray, the right-click menu and the settings row all agree.
#[tauri::command]
pub fn sync_tray_ticker(state: tauri::State<'_, ShowTickerItem>, shown: bool) {
    if let Ok(slot) = state.0.lock() {
        if let Some(item) = slot.as_ref() {
            let _ = item.set_checked(shown);
        }
    }
}
