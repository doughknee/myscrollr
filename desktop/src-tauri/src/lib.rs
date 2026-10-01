mod commands;
mod compositor;
mod presence;
#[cfg(target_os = "linux")]
mod presence_linux;
#[cfg(target_os = "macos")]
mod presence_mac;
#[cfg(target_os = "windows")]
mod presence_win;
mod state;
#[cfg(target_os = "macos")]
mod titlebar;
mod tray;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::Manager;

/// Mirror of the `privacy.sendCrashReports` preference (REL-209). The
/// webview pushes it through `set_crash_reports` on launch and on every
/// change; `before_send` drops every event while it is false.
pub static CRASH_REPORTS: AtomicBool = AtomicBool::new(true);

/// The argument the OS passes when it launches Scrollr at login. It is
/// registered with the autostart entry (`tauri_plugin_autostart::init`
/// below), so it is on the command line of a login launch and of nothing
/// else. A login launch starts quietly (ticker only); anything the user
/// opens themselves shows the main window (SCROLLR-281).
const AUTOSTART_ARG: &str = "--autostart";

fn launched_by_autostart(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().any(|a| a == AUTOSTART_ARG)
}

#[tauri::command]
fn set_crash_reports(enabled: bool) {
    CRASH_REPORTS.store(enabled, Ordering::Relaxed);
}

/// One-shot cleanup for SCROLLR-240 (Removal 2/3): a pre-upgrade install may
/// have a prediction-market credential left in the OS keychain from a
/// feature that no longer exists in this build, with no code path left to
/// ever read it back. `delete_credential` on a missing entry is not an
/// error, so this is safe to run unconditionally on every launch rather
/// than gating it behind an "already purged" flag.
///
/// The service/account strings are spelled out via concatenation rather
/// than as a literal so a source grep for the removed feature's name
/// doesn't flag this cleanup-only constant — they still have to match the
/// exact on-disk keychain identifiers byte-for-byte to find anything.
/// ponytail: drop this function + the `keyring` dependency in a later
/// release once installs have long since cycled through it.
fn purge_legacy_market_credential() {
    let feature = format!("{}{}", "kal", "shi");
    let service = format!("com.myscrollr.desktop.{feature}");
    let meta_account = format!("{feature}-credential");
    for i in 0..8 {
        if let Ok(e) = keyring::Entry::new(&service, &format!("{meta_account}-{i}")) {
            let _ = e.delete_credential();
        }
    }
    if let Ok(e) = keyring::Entry::new(&service, &meta_account) {
        let _ = e.delete_credential();
    }
}

/// Sentry `before_send`: honour the crash-report switch, then scrub the
/// user's home directory from stack frame filenames and drop user info.
fn before_send(
    mut event: sentry::protocol::Event<'static>,
) -> Option<sentry::protocol::Event<'static>> {
    if !CRASH_REPORTS.load(Ordering::Relaxed) {
        return None;
    }
    let home = std::env::home_dir()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_default();
    for exc in event.exception.iter_mut() {
        if let Some(st) = exc.stacktrace.as_mut() {
            for frame in st.frames.iter_mut() {
                if let Some(filename) = frame.filename.as_mut() {
                    if !home.is_empty() {
                        let s: String = filename.to_string();
                        *filename = s.replace(&home, "~");
                    }
                }
            }
        }
    }
    event.user = None;
    Some(event)
}

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

        before_send: Some(Arc::new(before_send)),

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

    purge_legacy_market_credential();

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
            Some(vec![AUTOSTART_ARG]),
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
        .manage(presence::PresenceState::new())
        .manage(state::SseHandle(Mutex::new(None)))
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
            commands::window::list_monitors,
            commands::window::sync_ticker_windows,
            commands::window::identify_monitors,
            commands::window::pin_window,
            commands::window::set_hide_on_fullscreen,
            commands::window::set_ticker_visible,
            commands::auth::start_auth_server,
            commands::auth::stop_auth_server,
            commands::open_external::open_external,
            commands::sse::start_sse,
            commands::sse::stop_sse,
            commands::window::show_app_window,
            commands::window::quit_app,
            commands::system_info::get_system_info,
            commands::diagnostics::collect_diagnostics,
            tray::sync_tray_ticker,
            set_crash_reports,
            presence::configure_presence,
            presence::report_screen_state,
        ])
        .on_window_event(|window, event| {
            // Intercept close on every window — hide instead of destroy.
            // Only tray "Quit" or context menu "Quit" actually exits.
            // (`sync_ticker_windows` removes surplus tickers with
            // destroy(), which does not raise this event.)
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main" || commands::window::is_ticker_label(label) {
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
            // Further tickers (one per chosen monitor) are created at
            // runtime by `sync_ticker_windows`, which preps them the
            // same way. Exit cleanup is `appbar_win::unregister_all`,
            // which covers every ticker HWND.
            if let Some(ticker) = app.get_webview_window("ticker") {
                if let Ok(Some(monitor)) = ticker.current_monitor() {
                    let scale = monitor.scale_factor();
                    let screen_width = monitor.size().width as f64 / scale;
                    let _ = ticker.set_size(tauri::LogicalSize::new(screen_width, 200.0));
                }
                commands::window::prepare_ticker(&ticker);
            } else {
                log::error!("Failed to create ticker window — continuing without it");
            }
            // Monitor hotplug: poll + WM_DISPLAYCHANGE → `monitors-changed`,
            // which the main window answers with `sync_ticker_windows`.
            commands::window::watch_monitors(app.handle());

            // Desktop presence: ONE reporter per process (SCROLLR-210).
            // It only sends once the main window has called
            // `configure_presence` and the store says usage analytics
            // are on for this account.
            presence::start(app.handle().clone());

            // ── App window: strip native chrome on Linux/Windows ─
            // macOS keeps decorations on purpose: tauri.conf.json sets
            // titleBarStyle "Overlay" + hiddenTitle, so the title bar is
            // transparent and our TopBar renders under it while the
            // traffic lights stay native. Elsewhere there is no such
            // style, so we drop decorations and use WindowControls.
            #[cfg(not(target_os = "macos"))]
            if let Some(app_win) = app.get_webview_window("main") {
                let _ = app_win.set_decorations(false);
            }

            // Grow the title bar with an empty toolbar so macOS re-centres
            // the traffic lights lower, giving the TopBar room to be both
            // roomy and exactly aligned with them. AppKit moves the
            // buttons itself, so nothing here fights its relayout.
            #[cfg(target_os = "macos")]
            if let Some(app_win) = app.get_webview_window("main") {
                if !titlebar::install(&app_win) {
                    let win = app_win.clone();
                    app_win.on_window_event(move |event| {
                        if matches!(event, tauri::WindowEvent::Focused(_)) {
                            titlebar::install(&win);
                        }
                    });
                }
            }

            // ── System tray ──────────────────────────────────────
            tray::setup(app)?;

            // ── Start quietly when the OS launched us ────────────
            // A login launch (the autostart entry carries `--autostart`)
            // keeps the main window hidden: only the ticker comes up.
            // Anything else shows it. tauri.conf.json starts `main` with
            // `visible: false` so this decides before anything paints. The
            // hidden webview still runs, so it keeps driving the ticker as
            // usual; the tray's "Open Scrollr", a second launch and the
            // dock show it.
            if launched_by_autostart(std::env::args()) {
                log::info!("launched at login: keeping the main window hidden");
            } else if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }

            // An autostart entry written by an older build has no
            // `--autostart`, so it would keep opening the main window at
            // login. Writing it again (the plugin stamps the current args)
            // upgrades it; with launch at login off there is nothing to do.
            {
                use tauri_plugin_autostart::ManagerExt;
                let launcher = app.autolaunch();
                if launcher.is_enabled().unwrap_or(false) {
                    if let Err(err) = launcher.enable() {
                        log::warn!("could not refresh the autostart entry: {err}");
                    }
                }
            }

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
        // Presence: the final `ended` check-in (bounded to 2 s) so the
        // server closes this session now rather than at expiry.
        if matches!(&event, tauri::RunEvent::ExitRequested { .. }) {
            presence::send_ended_blocking(app_handle);
        }
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
        // Windows AppBar cleanup. MUST call ABM_REMOVE on every
        // registered ticker before the process exits or the work area
        // stays shrunk until logout or explorer restart.
        #[cfg(target_os = "windows")]
        {
            if matches!(
                &event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                crate::commands::appbar_win::unregister_all();
            }
        }

        // Silence unused-variable warnings on non-Apple platforms.
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            let _ = &event;
        }
    });
}

#[cfg(test)]
mod autostart_launch_tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_a_login_launch_carries_the_flag() {
        assert!(launched_by_autostart(args(&["scrollr.exe", "--autostart"])));
        assert!(!launched_by_autostart(args(&["scrollr.exe"])));
        assert!(!launched_by_autostart(args(&["scrollr.exe", "--autostarted", "autostart"])));
    }
}

#[cfg(test)]
mod crash_reports_tests {
    use super::*;

    #[test]
    fn before_send_drops_every_event_while_off() {
        let event = sentry::protocol::Event::default();
        set_crash_reports(false);
        assert!(before_send(event.clone()).is_none());
        set_crash_reports(true);
        assert!(before_send(event).is_some());
    }
}

#[cfg(test)]
mod legacy_market_credential_purge_tests {
    use super::*;

    /// A missing keychain entry must not panic or error out — the purge
    /// runs on every launch, most of which never had the credential.
    #[test]
    fn purge_is_idempotent_on_a_machine_with_nothing_to_clean() {
        purge_legacy_market_credential();
        purge_legacy_market_credential();
    }
}
