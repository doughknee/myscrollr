mod commands;
mod compositor;
mod kalshi;
mod state;
mod tray;

use std::sync::{atomic::AtomicBool, Arc, Mutex};
use tauri::Manager;

/// Initialize the Sentry client for the Rust process. Returns a guard
/// that flushes events on drop — the caller MUST keep it alive for the
/// lifetime of the program (i.e. bind it to a local in `run()`).
///
/// Privacy: send_default_pii=false, all user info stripped in before_send,
/// home directory paths scrubbed from stack frame filenames.
///
/// DSN is read at COMPILE TIME via option_env!. If not set (local dev,
/// debug builds), Sentry is effectively disabled — the guard is still
/// returned to keep the call site uniform, but no events are sent.
fn init_sentry() -> sentry::ClientInitGuard {
    sentry::init(sentry::ClientOptions {
        dsn: option_env!("SENTRY_DSN_RUST").and_then(|s| s.parse().ok()),
        release: Some(format!("scrollr-desktop@{}", env!("CARGO_PKG_VERSION")).into()),
        environment: Some(
            if cfg!(debug_assertions) {
                "development"
            } else {
                "production"
            }
            .into(),
        ),

        send_default_pii: false,
        attach_stacktrace: true,
        max_breadcrumbs: 50,

        traces_sample_rate: 0.1,

        before_send: Some(std::sync::Arc::new(|mut event| {
            // Strip the user's home directory from stack frame filenames.
            let home = dirs::home_dir()
                .map(|h| h.to_string_lossy().into_owned())
                .unwrap_or_default();
            for exc in event.exception.iter_mut() {
                if let Some(st) = exc.stacktrace.as_mut() {
                    for frame in st.frames.iter_mut() {
                        if let Some(filename) = frame.filename.as_mut() {
                            if !home.is_empty() {
                                let s: String = filename.to_string();
                                *filename = s.replace(&home, "~").into();
                            }
                        }
                    }
                }
            }
            event.user = None;
            Some(event)
        })),

        ..Default::default()
    })
}

pub fn run() {
    // Sentry init MUST happen before any plugin or async runtime starts.
    // The returned guard flushes events on Drop — keep it alive for the
    // whole function.
    let _sentry_guard = init_sentry();

    sentry::configure_scope(|scope| {
        scope.set_tag("runtime", "rust-core");
        scope.set_tag("platform", std::env::consts::OS);
    });

    // Windows: claim the main thread for STA (Single-Threaded Apartment)
    // mode before any plugin can initialize COM in MTA mode. Plugins like
    // tauri-plugin-http (via native-tls/WinHTTP) and tauri-plugin-mcp-bridge
    // (via WebSocket server) can trigger MTA initialization, which conflicts
    // with tao's OleInitialize requirement for drag-and-drop support.
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        unsafe {
            CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        }
    }

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Use the plugin's default version comparator (`remote.version >
        // current_version`). An earlier build overrode this with `>=` so that
        // same-version patched rebuilds would be detected, with the JS side
        // suppressing false positives via pub_date comparison. That design
        // was fundamentally fragile: any drift between server and stored
        // pub_date (re-uploaded asset, regenerated latest.json, formatter
        // differences) caused the "Update available" toast to fire on every
        // launch, and on Windows the resulting `downloadAndInstall` re-ran
        // the MSI/NSIS installer for an already-installed version and
        // crashed the app. To ship a patched rebuild now, bump the patch
        // version (e.g. 1.0.15 -> 1.0.16) — that's how every other Tauri
        // app handles it. See PR replacing commits 30d7bdd and 2479de3.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .max_file_size(5_000_000) // 5 MB per log file
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the main window when a second instance is attempted
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

    // MCP bridge is opt-in (feature `dev-mcp-bridge`), dev-only, and
    // excluded on Windows — its WebSocket server is architecturally
    // incompatible with Windows COM threading. Release builds never
    // link the crate at all; development builds only pull it in when
    // explicitly enabled with `--features dev-mcp-bridge`.
    #[cfg(all(
        feature = "dev-mcp-bridge",
        debug_assertions,
        not(target_os = "windows")
    ))]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    let app = builder
        .manage(state::SseHandle(Mutex::new(None)))
        .manage(state::KalshiStreamHandle(Mutex::new(None)))
        .manage(state::AuthServerRunning(Arc::new(Mutex::new(false))))
        .manage(state::AuthServerStop(Arc::new(AtomicBool::new(false))))
        .manage(state::SysInfoState(Arc::new(state::SysInfoInner {
            sys: Mutex::new(sysinfo::System::new()),
            components: Mutex::new(sysinfo::Components::new_with_refreshed_list()),
            networks: Mutex::new(sysinfo::Networks::new_with_refreshed_list()),
            static_info: Mutex::new(None),
        })))
        .invoke_handler(tauri::generate_handler![
            commands::window::position_ticker,
            commands::window::pin_window,
            commands::window::set_hide_on_fullscreen,
            commands::window::set_ticker_visible,
            commands::auth::start_auth_server,
            commands::auth::stop_auth_server,
            commands::sse::start_sse,
            commands::sse::stop_sse,
            commands::kalshi::kalshi_connect,
            commands::kalshi::kalshi_status,
            commands::kalshi::kalshi_disconnect,
            commands::kalshi::kalshi_portfolio,
            commands::kalshi::kalshi_start_user_stream,
            commands::kalshi::kalshi_stop_user_stream,
            commands::window::show_app_window,
            commands::window::quit_app,
            commands::system_info::get_system_info,
            commands::diagnostics::collect_diagnostics,
            tray::sync_tray_pin,
        ])
        .on_window_event(|window, event| {
            // Intercept close on both windows — hide instead of destroy.
            // Only tray "Quit" or context menu "Quit" actually exits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main" || label == "ticker" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // ── Ticker window setup ──────────────────────────────
            // Size the ticker to fill the screen width. Visibility is
            // managed by the JS side based on the showTicker preference;
            // tauri.conf.json starts the window with `visible: false`.
            if let Some(ticker) = app.get_webview_window("ticker") {
                if let Ok(Some(monitor)) = ticker.current_monitor() {
                    let scale = monitor.scale_factor();
                    let screen_width = monitor.size().width as f64 / scale;
                    let _ = ticker.set_size(tauri::LogicalSize::new(screen_width, 200.0));
                }
                // Force WebView2 surface background to dark so the
                // area outside the HTML body doesn't show as white.
                let _ = ticker.set_background_color(Some(tauri::webview::Color(20, 20, 32, 255)));

                // Defensive: clear any stale AppBar registration from
                // a previous session that crashed without calling
                // ABM_REMOVE. Harmless no-op if there's no stale entry.
                #[cfg(target_os = "windows")]
                {
                    let _ = crate::commands::appbar_win::force_unregister_stale(
                        &ticker.as_ref().window(),
                    );
                }
            } else {
                log::error!("Failed to create ticker window — continuing without it");
            }

            // ── App window: strip native chrome on Linux/Windows ─
            // macOS keeps native decorations (traffic lights). On
            // other platforms we use our custom TitleBar component.
            #[cfg(not(target_os = "macos"))]
            if let Some(app_win) = app.get_webview_window("main") {
                let _ = app_win.set_decorations(false);
            }

            // ── System tray ──────────────────────────────────────
            tray::setup(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Run the app loop. We intercept RunEvent::Reopen on macOS/iOS —
    // fires when the user clicks the dock icon while no Scrollr windows
    // are visible, e.g. after closing the main window via the red-X.
    // This is what makes "click Scrollr in the dock = main window
    // appears" Just Work on Mac.
    //
    // RunEvent::Reopen does NOT exist on non-Apple platforms — it's
    // gated behind `#[cfg(any(target_os = "macos", target_os = "ios"))]`
    // upstream in tauri. We must gate our match arm the same way or
    // the Windows/Linux build fails with E0599 ("no variant named
    // Reopen found for enum RunEvent"). Windows/Linux equivalent
    // re-activation is handled by tauri-plugin-single-instance
    // (handler registered above): a second launch attempt while the
    // app is already running shows the main window.
    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        }
        // Windows AppBar cleanup. MUST call ABM_REMOVE before the
        // process exits or the work area stays shrunk until logout
        // or explorer restart.
        #[cfg(target_os = "windows")]
        {
            if matches!(
                &event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(ticker) = app_handle.get_webview_window("ticker") {
                    let _ = crate::commands::appbar_win::unregister(&ticker.as_ref().window());
                }
            }
        }

        // Silence unused-variable warnings on non-Apple platforms.
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            let _ = &app_handle;
            let _ = &event;
        }
    });
}
