//! SCROLLR-8: the AppImage `AppRun` script exports a batch of env vars that
//! point into the mounted, read-only image (`LD_LIBRARY_PATH`,
//! `GIO_MODULE_DIR`, ...). `tauri-plugin-shell`'s `open()` shells out to
//! `xdg-open` with the *current* process environment, so inside an
//! AppImage `xdg-open` (and whatever browser it launches) inherits those
//! vars and fails to start — silently, since the process still exits 0.
//! The "Signing you in..." overlay then waits forever for a callback that
//! can never arrive.
//!
//! `open_external` spawns `xdg-open` with those vars stripped instead,
//! falling back to `$BROWSER` and then `gio open` if `xdg-open` itself is
//! missing. `env_remove` on a var that was never set is a no-op, so this
//! is safe on a non-AppImage Linux install too. Windows/macOS have no
//! AppImage-style env injection, so they keep going through the existing
//! plugin-shell opener unchanged.

use tauri::AppHandle;

/// Env vars the AppImage `AppRun` script injects, pointed at the mounted
/// image. Inherited by a naive `xdg-open`, they route dynamic linking and
/// GIO module discovery back into the (possibly already-unmounted) image
/// instead of the host system.
const APPIMAGE_ENV_VARS: &[&str] = &[
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "GIO_MODULE_DIR",
    "GDK_PIXBUF_MODULE_FILE",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GSETTINGS_SCHEMA_DIR",
    "PYTHONHOME",
    "APPDIR",
    "APPIMAGE",
    "OWD",
];

#[cfg(target_os = "linux")]
fn spawn_clean(program: &str, args: &[&str]) -> std::io::Result<std::process::Child> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    for var in APPIMAGE_ENV_VARS {
        cmd.env_remove(var);
    }
    cmd.spawn()
}

#[cfg(target_os = "linux")]
fn open_external_linux(url: &str) -> Result<(), String> {
    if spawn_clean("xdg-open", &[url]).is_ok() {
        return Ok(());
    }
    if let Ok(browser) = std::env::var("BROWSER") {
        if !browser.trim().is_empty() && spawn_clean(&browser, &[url]).is_ok() {
            return Ok(());
        }
    }
    spawn_clean("gio", &["open", url])
        .map(|_child| ())
        .map_err(|e| format!("open external url: no opener available: {e}"))
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn open_external(_app: AppHandle, url: String) -> Result<(), String> {
    open_external_linux(&url)
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell()
        .open(url, None)
        .map_err(|e| format!("open external url: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs on every platform (Windows included — no Linux box in CI/dev
    /// here) since it only inspects the pure constant, never spawns
    /// anything. This is the guard against a future edit silently
    /// dropping one of the AppImage-injected vars from the removal list.
    #[test]
    fn appimage_env_vars_cover_every_known_appimage_injection() {
        let expected = [
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "GIO_MODULE_DIR",
            "GDK_PIXBUF_MODULE_FILE",
            "GST_PLUGIN_SYSTEM_PATH",
            "GST_PLUGIN_SYSTEM_PATH_1_0",
            "GSETTINGS_SCHEMA_DIR",
            "PYTHONHOME",
            "APPDIR",
            "APPIMAGE",
            "OWD",
        ];
        for var in expected {
            assert!(
                APPIMAGE_ENV_VARS.contains(&var),
                "APPIMAGE_ENV_VARS is missing {var}"
            );
        }
        assert_eq!(
            APPIMAGE_ENV_VARS.len(),
            expected.len(),
            "APPIMAGE_ENV_VARS has unexpected extra entries"
        );
    }
}
