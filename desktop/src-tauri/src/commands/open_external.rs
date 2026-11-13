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
fn spawn_clean(program: &str, args: &[&str]) -> std::io::Result<()> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    for var in APPIMAGE_ENV_VARS {
        cmd.env_remove(var);
    }
    let child = cmd.spawn()?;
    reap_detached(child);
    Ok(())
}

/// D2-9: a spawned opener that is never waited on stays a zombie until
/// Scrollr exits. Wait on a throwaway thread so the command returns at once.
#[cfg(target_os = "linux")]
fn reap_detached(mut child: std::process::Child) {
    let _ = std::thread::Builder::new()
        .name("reap-opener".into())
        .spawn(move || {
            let _ = child.wait();
        });
}

/// SCROLLR-449 (SC-5): the one gate every platform branch goes through.
/// Only absolute http(s) URLs with a host may reach the OS opener; anything
/// else (`file:`, UNC paths, `javascript:`, `ms-settings:`, bare paths)
/// could launch a local program or a registered app handler. The raw string
/// is checked for whitespace and control characters first because
/// `Url::parse` silently strips tabs and newlines.
fn validate_external_url(raw: &str) -> Result<(), String> {
    if raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("open external url: invalid characters".into());
    }
    let parsed = url::Url::parse(raw).map_err(|_| "open external url: not an absolute url".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().unwrap_or("").is_empty() {
        return Err("open external url: only http and https links are allowed".into());
    }
    Ok(())
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
        .map_err(|e| format!("open external url: no opener available: {e}"))
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn open_external(_app: AppHandle, url: String) -> Result<(), String> {
    validate_external_url(&url)?;
    open_external_linux(&url)
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    validate_external_url(&url)?;
    app.shell()
        .open(url, None)
        .map_err(|e| format!("open external url: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_absolute_http_and_https_urls_pass() {
        for ok in [
            "https://github.com/apps/scrollr-desktop/installations/new?state=y",
            "http://localhost:5174/callback?x=1",
            "https://auth.myscrollr.com/oidc/auth?client_id=a&redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2F",
        ] {
            assert!(validate_external_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "file:///C:/Windows/System32/calc.exe",
            r"\\server\share\x.exe",
            "javascript:alert(1)",
            r"C:\Windows\System32\calc.exe",
            "/usr/bin/xcalc",
            "ms-settings:privacy",
            "https://",
            "https://a.com/ b",
            "https://a.com/\n",
            "",
        ] {
            assert!(validate_external_url(bad).is_err(), "{bad:?}");
        }
    }

    /// D2-9: the opener's child must not linger as a zombie (state `Z` in
    /// `/proc/<pid>/stat`) once it has exited.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_finished_opener_is_reaped() {
        let child = std::process::Command::new("true").spawn().unwrap();
        let stat = format!("/proc/{}/stat", child.id());
        reap_detached(child);
        for _ in 0..100 {
            if std::fs::read_to_string(&stat).is_err() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("child was never reaped");
    }

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
