//! Linux signals for the presence reporter (SCROLLR-211).
//!
//! Everything goes over D-Bus, and everything is best-effort: a machine
//! without systemd/logind, without a session bus, or with a desktop that
//! implements none of the freedesktop interfaces reports `unknown` for the
//! fields it cannot read. Nothing is guessed.
//!
//! * Session lock / unlock — logind's `LockedHint` on the current session
//!   object (resolved once via `GetSessionByPID`), read at startup and then
//!   watched through `PropertiesChanged` on the session interface. Watching
//!   the property rather than the Lock/Unlock signals means a transition
//!   that happened while the watcher was down still shows up in the next
//!   read.
//! * Suspend / resume — the `PrepareForSleep(bool)` signal on
//!   `org.freedesktop.login1.Manager`: `true` sends the final `ended`
//!   check-in before the machine goes down; `false` lets the loop start a
//!   fresh interval.
//! * Idle — the desktop's reported idle time, polled every few seconds:
//!   `org.freedesktop.ScreenSaver.GetActiveTime` (KDE, Xfce, Cinnamon; at
//!   either well-known path) or GNOME's `org.gnome.Mutter.IdleMonitor`
//!   `Idletime` property. The first source that answers is kept; one that
//!   stops answering (a restarted screen locker) is re-probed. The value is
//!   elapsed time since the last input, never what the input was, and its
//!   staleness is bounded by the poll interval. Desktops exposing neither
//!   interface report `unknown`.
//! * Display sleep has no reliable cross-desktop signal and stays
//!   `unknown`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::Context;
use futures_util::StreamExt;
use tauri::AppHandle;

use crate::presence::{SESSION_LOCKED, SESSION_STATE, SESSION_UNLOCKED};

/// How often the desktop's idle time is re-read. The idle threshold is
/// five minutes; a few seconds of staleness does not move it.
const IDLE_POLL_INTERVAL: Duration = Duration::from_secs(10);

const LOGIN1_SERVICE: &str = "org.freedesktop.login1";
const LOGIN1_MANAGER_PATH: &str = "/org/freedesktop/login1";
const LOGIN1_SESSION_INTERFACE: &str = "org.freedesktop.login1.Session";

/// Cached idle reading in whole seconds; `u64::MAX` = the platform cannot
/// say (the sentinel never collides with a real reading).
static IDLE_SECONDS: AtomicU64 = AtomicU64::new(u64::MAX);

/// Seconds since the last input as last read by the poller, or None where
/// no desktop interface provides it.
pub fn idle_for() -> Option<Duration> {
    idle_duration_for_cached(IDLE_SECONDS.load(Ordering::Relaxed))
}

/// Map the cached reading to a Duration; the sentinel is not an answer.
pub fn idle_duration_for_cached(cached_seconds: u64) -> Option<Duration> {
    match cached_seconds {
        u64::MAX => None,
        secs => Some(Duration::from_secs(secs)),
    }
}

/// Map logind's `LockedHint` to the reporter's session state.
pub fn session_state_for_locked_hint(locked: bool) -> u8 {
    if locked { SESSION_LOCKED } else { SESSION_UNLOCKED }
}

/// What a `PrepareForSleep` signal tells the reporter to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SleepAction {
    /// Going down: send the final `ended` check-in now.
    SendEnded,
    /// Back up: clear the ended flag so the next tick starts fresh.
    Resumed,
}

pub fn sleep_action_for(prepare_for_sleep: bool) -> SleepAction {
    if prepare_for_sleep { SleepAction::SendEnded } else { SleepAction::Resumed }
}

/// Extract `LockedHint` from a `PropertiesChanged` payload: only the
/// session interface's own key, only when it is a boolean.
pub fn locked_hint_from_changed(
    interface: &str,
    changed: &HashMap<String, zbus::zvariant::OwnedValue>,
) -> Option<bool> {
    if interface != LOGIN1_SESSION_INTERFACE {
        return None;
    }
    let value = changed.get("LockedHint")?;
    bool::try_from(value.clone()).ok()
}

/// Install every watcher. Called once from `presence::start`. Each source
/// fails independently into `unknown`; none of them is fatal.
pub fn install(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = watch_login1(&app).await {
            log::info!("[presence] linux: logind signals unavailable ({e:#}); session and suspend stay unknown");
        }
    });
    tauri::async_runtime::spawn(async move {
        poll_idle_time().await;
    });
}

/// Session lock and suspend/resume both come from logind on the system
/// bus. One connection serves both; the lock watcher is a child task so a
/// session that logind does not know (containers, SSH) does not take the
/// suspend signal down with it.
async fn watch_login1(app: &AppHandle) -> anyhow::Result<()> {
    let conn = zbus::Connection::system().await.context("connect to the system bus")?;
    let manager = zbus::Proxy::new(&conn, LOGIN1_SERVICE, LOGIN1_MANAGER_PATH, "org.freedesktop.login1.Manager")
        .await
        .context("logind manager proxy")?;

    {
        let conn = conn.clone();
        let manager = manager.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = watch_locked_hint(&conn, &manager).await {
                log::info!("[presence] linux: session lock watch unavailable ({e:#}); session reports unknown");
            }
        });
    }

    let mut stream = manager
        .receive_signal("PrepareForSleep")
        .await
        .context("subscribe to PrepareForSleep")?;
    while let Some(msg) = stream.next().await {
        let flag: bool = match msg.body().deserialize() {
            Ok(flag) => flag,
            Err(e) => {
                log::debug!("[presence] linux: PrepareForSleep body unreadable: {e}");
                continue;
            }
        };
        match sleep_action_for(flag) {
            SleepAction::SendEnded => {
                log::info!("[presence] suspend: sending ended check-in");
                crate::presence::send_ended_blocking(app);
            }
            SleepAction::Resumed => {
                log::info!("[presence] resume");
                crate::presence::resumed(app);
            }
        }
    }
    Ok(())
}

/// Read the current session's `LockedHint` once, then follow its changes.
async fn watch_locked_hint(conn: &zbus::Connection, manager: &zbus::Proxy<'_>) -> anyhow::Result<()> {
    let path: zbus::zvariant::OwnedObjectPath = manager
        .call("GetSessionByPID", &std::process::id())
        .await
        .context("resolve this session via GetSessionByPID")?;
    let session = zbus::Proxy::new(conn, LOGIN1_SERVICE, path.as_str(), LOGIN1_SESSION_INTERFACE)
        .await
        .context("session proxy")?;
    if let Ok(locked) = session.get_property::<bool>("LockedHint").await {
        let state = session_state_for_locked_hint(locked);
        SESSION_STATE.store(state, Ordering::Relaxed);
        log::info!("[presence] session {}", crate::presence::session_word(state));
    }
    let props = zbus::Proxy::new(conn, LOGIN1_SERVICE, path.as_str(), "org.freedesktop.DBus.Properties")
        .await
        .context("session properties proxy")?;
    let mut stream = props
        .receive_signal("PropertiesChanged")
        .await
        .context("subscribe to PropertiesChanged")?;
    while let Some(msg) = stream.next().await {
        let body = msg.body();
        let parsed = body.deserialize::<(String, HashMap<String, zbus::zvariant::OwnedValue>, Vec<String>)>();
        let Ok((interface, changed, _invalidated)) = parsed else {
            continue;
        };
        if let Some(locked) = locked_hint_from_changed(&interface, &changed) {
            let state = session_state_for_locked_hint(locked);
            SESSION_STATE.store(state, Ordering::Relaxed);
            log::info!("[presence] session {}", crate::presence::session_word(state));
        }
    }
    Ok(())
}

/// The desktop idle source that answered a probe, with its proxy kept for
/// polling. Proxies are cheap handles; the connection outlives them.
enum IdleSource {
    /// org.freedesktop.ScreenSaver, GetActiveTime -> seconds.
    ScreenSaver(zbus::Proxy<'static>),
    /// org.gnome.Mutter.IdleMonitor, Idletime -> milliseconds.
    MutterIdleMonitor(zbus::Proxy<'static>),
}

impl IdleSource {
    async fn read_seconds(&self) -> Option<u64> {
        match self {
            IdleSource::ScreenSaver(proxy) => {
                let secs: u32 = proxy.call("GetActiveTime", &()).await.ok()?;
                Some(u64::from(secs))
            }
            IdleSource::MutterIdleMonitor(proxy) => {
                let millis: u64 = proxy.get_property("Idletime").await.ok()?;
                Some(millis / 1000)
            }
        }
    }
}

/// Try the known idle interfaces, most standard first. A proxy is only
/// kept when an actual read succeeds — creating one never touches the bus,
/// so the read is what proves the service exists.
async fn probe_idle_source(conn: &zbus::Connection) -> Option<IdleSource> {
    for path in ["/org/freedesktop/ScreenSaver", "/ScreenSaver"] {
        if let Ok(proxy) = zbus::Proxy::new(conn, "org.freedesktop.ScreenSaver", path, "org.freedesktop.ScreenSaver").await
        {
            if proxy.call::<_, _, u32>("GetActiveTime", &()).await.is_ok() {
                log::info!("[presence] linux: idle from org.freedesktop.ScreenSaver at {path}");
                return Some(IdleSource::ScreenSaver(proxy));
            }
        }
    }
    if let Ok(proxy) = zbus::Proxy::new(
        conn,
        "org.gnome.Mutter.IdleMonitor",
        "/org/gnome/Mutter/IdleMonitor",
        "org.gnome.Mutter.IdleMonitor",
    )
    .await
    {
        if proxy.get_property::<u64>("Idletime").await.is_ok() {
            log::info!("[presence] linux: idle from org.gnome.Mutter.IdleMonitor");
            return Some(IdleSource::MutterIdleMonitor(proxy));
        }
    }
    None
}

async fn poll_idle_time() {
    let conn = match zbus::Connection::session().await {
        Ok(conn) => conn,
        Err(e) => {
            log::info!("[presence] linux: no session bus ({e}); input reports unknown");
            return;
        }
    };
    let mut source: Option<IdleSource> = None;
    let mut interval = tokio::time::interval(IDLE_POLL_INTERVAL);
    loop {
        interval.tick().await;
        if source.is_none() {
            source = probe_idle_source(&conn).await;
            if source.is_none() {
                continue;
            }
        }
        if let Some(active) = &source {
            match active.read_seconds().await {
                Some(secs) => IDLE_SECONDS.store(secs, Ordering::Relaxed),
                None => {
                    // The source went away; drop back to unknown and re-probe.
                    IDLE_SECONDS.store(u64::MAX, Ordering::Relaxed);
                    source = None;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locked_hint_maps_to_the_session_states() {
        assert_eq!(session_state_for_locked_hint(true), SESSION_LOCKED);
        assert_eq!(session_state_for_locked_hint(false), SESSION_UNLOCKED);
    }

    #[test]
    fn prepare_for_sleep_true_ends_and_false_resumes() {
        assert_eq!(sleep_action_for(true), SleepAction::SendEnded);
        assert_eq!(sleep_action_for(false), SleepAction::Resumed);
    }

    #[test]
    fn only_the_session_interfaces_locked_hint_is_read() {
        let mut changed = HashMap::new();
        changed.insert("LockedHint".to_string(), zbus::zvariant::OwnedValue::from(true));
        assert_eq!(locked_hint_from_changed(LOGIN1_SESSION_INTERFACE, &changed), Some(true));

        // The same key on another interface is not our lock state.
        assert_eq!(locked_hint_from_changed("org.freedesktop.login1.Manager", &changed), None);

        // A different key leaves the state alone.
        let mut other = HashMap::new();
        other.insert("Active".to_string(), zbus::zvariant::OwnedValue::from(false));
        assert_eq!(locked_hint_from_changed(LOGIN1_SESSION_INTERFACE, &other), None);

        // A non-boolean value is not a lock state.
        let mut wrong_type = HashMap::new();
        wrong_type.insert("LockedHint".to_string(), zbus::zvariant::OwnedValue::from(7u32));
        assert_eq!(locked_hint_from_changed(LOGIN1_SESSION_INTERFACE, &wrong_type), None);
    }

    #[test]
    fn the_cached_idle_reading_maps_unknown_and_seconds() {
        assert_eq!(idle_duration_for_cached(u64::MAX), None);
        assert_eq!(idle_duration_for_cached(0), Some(Duration::from_secs(0)));
        // Below and at the 5-minute threshold (input_word itself is tested
        // in presence.rs).
        assert_eq!(crate::presence::input_word(idle_duration_for_cached(299)), "recent");
        assert_eq!(crate::presence::input_word(idle_duration_for_cached(300)), "idle");
    }
}
