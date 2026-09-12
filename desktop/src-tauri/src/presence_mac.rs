//! macOS signals for the presence reporter (SCROLLR-211).
//!
//! Four native sources, each mapped onto the reporter's fixed vocabulary
//! and nothing else:
//!
//! * Session lock / unlock — the distributed notifications
//!   `com.apple.screenIsLocked` / `com.apple.screenIsUnlocked`, registered
//!   with DeliverImmediately so the callback still fires while the app is
//!   napped. Only those two names are interpreted; anything else leaves
//!   the state as it was.
//! * Display sleep / wake — `NSWorkspaceScreensDidSleepNotification` /
//!   `NSWorkspaceScreensDidWakeNotification` on the shared workspace's
//!   notification center.
//! * Suspend / resume — `NSWorkspaceWillSleepNotification` /
//!   `NSWorkspaceDidWakeNotification`. WillSleep sends the final `ended`
//!   check-in within two seconds; DidWake lets the loop start again.
//! * Idle — `CGEventSourceSecondsSinceLastEventType`, polled by the loop:
//!   seconds since the last keyboard or mouse event system-wide, never
//!   what the event was. Elapsed time needs no accessibility or
//!   input-monitoring permission.
//!
//! The initial session state is `unlocked`: a user session that launches a
//! GUI app is not locked at that moment, and macOS exposes the lock only
//! as transitions. Display starts `unknown` until the first sleep/wake
//! notification — macOS offers no "is the display on right now" query that
//! reads honestly here.

use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use std::time::Duration;

use objc2::rc::Retained;
use objc2::runtime::NSObject;
use objc2::{AnyThread, define_class, msg_send, sel};
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{
    NSDistributedNotificationCenter, NSNotification, NSNotificationSuspensionBehavior, NSString,
};
use tauri::AppHandle;

use crate::presence::{
    DISPLAY_ASLEEP, DISPLAY_AWAKE, DISPLAY_STATE, SESSION_LOCKED, SESSION_STATE, SESSION_UNLOCKED,
};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// What one OS notification means to the reporter. Every notification the
/// app observes resolves to exactly one of these; anything else is ignored
/// so an unrelated name can never masquerade as a state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OsSignal {
    SessionLocked,
    SessionUnlocked,
    DisplayAsleep,
    DisplayAwake,
    Suspending,
    Resumed,
}

/// Map a notification name to the reporter's signal, or None when the name
/// is not one we observe — the state is then left alone.
pub fn signal_for_name(name: &str) -> Option<OsSignal> {
    match name {
        "com.apple.screenIsLocked" => Some(OsSignal::SessionLocked),
        "com.apple.screenIsUnlocked" => Some(OsSignal::SessionUnlocked),
        "NSWorkspaceScreensDidSleepNotification" => Some(OsSignal::DisplayAsleep),
        "NSWorkspaceScreensDidWakeNotification" => Some(OsSignal::DisplayAwake),
        "NSWorkspaceWillSleepNotification" => Some(OsSignal::Suspending),
        "NSWorkspaceDidWakeNotification" => Some(OsSignal::Resumed),
        _ => None,
    }
}

/// The FFI value is a CFTimeInterval; a negative or non-finite reading is
/// not an answer, so the field reports unknown rather than a guess.
pub fn idle_duration_for(seconds_since_input: f64) -> Option<Duration> {
    if !seconds_since_input.is_finite() || seconds_since_input < 0.0 {
        return None;
    }
    Some(Duration::from_secs_f64(seconds_since_input))
}

/// Seconds since the last input, from CoreGraphics' HID event source.
pub fn idle_for() -> Option<Duration> {
    let seconds = unsafe {
        CGEventSourceSecondsSinceLastEventType(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE, K_CG_ANY_INPUT_EVENT_TYPE)
    };
    idle_duration_for(seconds)
}

// CGEventSource.h: kCGEventSourceStateHIDSystemState, the physical
// keyboard/mouse event source.
const K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: u32 = 1;
// CGEventTypes.h: kCGAnyInputEventType = (CGEventType)(~0).
const K_CG_ANY_INPUT_EVENT_TYPE: u32 = u32::MAX;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(source_state_id: u32, event_type: u32) -> f64;
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class holds no
    // state (unit ivars) and does not implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "ScrollrPresenceObserver"]
    pub struct PresenceObserver;

    impl PresenceObserver {
        #[unsafe(method(handlePresenceNotification:))]
        fn handle_presence_notification(&self, notification: &NSNotification) {
            let name = notification.name().to_string();
            match signal_for_name(&name) {
                Some(signal) => apply(signal),
                None => log::debug!("[presence] ignoring notification {name}"),
            }
        }
    }
);

impl PresenceObserver {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

/// One notification center callback: store the new state, and for the
/// sleep/wake pair run the reporter's ended/resume bookkeeping.
fn apply(signal: OsSignal) {
    match signal {
        OsSignal::SessionLocked => {
            SESSION_STATE.store(SESSION_LOCKED, Ordering::Relaxed);
            log::info!("[presence] session locked");
        }
        OsSignal::SessionUnlocked => {
            SESSION_STATE.store(SESSION_UNLOCKED, Ordering::Relaxed);
            log::info!("[presence] session unlocked");
        }
        OsSignal::DisplayAsleep => {
            DISPLAY_STATE.store(DISPLAY_ASLEEP, Ordering::Relaxed);
            log::info!("[presence] display asleep");
        }
        OsSignal::DisplayAwake => {
            DISPLAY_STATE.store(DISPLAY_AWAKE, Ordering::Relaxed);
            log::info!("[presence] display awake");
        }
        OsSignal::Suspending => {
            log::info!("[presence] suspend: sending ended check-in");
            if let Some(app) = APP.get() {
                crate::presence::send_ended_blocking(app);
            }
        }
        OsSignal::Resumed => {
            log::info!("[presence] resume");
            if let Some(app) = APP.get() {
                crate::presence::resumed(app);
            }
        }
    }
}

/// Install every hook. Called once from `presence::start`, which runs in
/// Tauri's setup on the main thread — NSWorkspace and the notification
/// centers expect that, and delivery needs the main run loop the app
/// already runs.
pub fn install(app: AppHandle) {
    if APP.set(app).is_err() {
        return;
    }
    // A GUI app that is launching is in an unlocked session; macOS exposes
    // only the transitions from here on.
    SESSION_STATE.store(SESSION_UNLOCKED, Ordering::Relaxed);
    let observer = PresenceObserver::new();

    // Session lock/unlock arrive as distributed notifications.
    let distributed = NSDistributedNotificationCenter::defaultCenter();
    for name in ["com.apple.screenIsLocked", "com.apple.screenIsUnlocked"] {
        let name = NSString::from_str(name);
        // SAFETY: `observer` outlives the process (leaked below) and the
        // selector is defined on its class with the matching signature.
        unsafe {
            distributed.addObserver_selector_name_object_suspensionBehavior(
                &observer,
                sel!(handlePresenceNotification:),
                Some(&name),
                None,
                NSNotificationSuspensionBehavior::DeliverImmediately,
            );
        }
    }

    // Suspend/resume and display sleep/wake arrive on the workspace center.
    let workspace = NSWorkspace::sharedWorkspace();
    let center = workspace.notificationCenter();
    for name in [
        "NSWorkspaceWillSleepNotification",
        "NSWorkspaceDidWakeNotification",
        "NSWorkspaceScreensDidSleepNotification",
        "NSWorkspaceScreensDidWakeNotification",
    ] {
        let name = NSString::from_str(name);
        // SAFETY: as above.
        unsafe {
            center.addObserver_selector_name_object(
                &observer,
                sel!(handlePresenceNotification:),
                Some(&name),
                None,
            );
        }
    }

    // Selector-based observers are not retained by the centers; the
    // reporter is a process-lifetime singleton, so the observer simply
    // lives forever.
    std::mem::forget(observer);
    log::info!("[presence] macOS signals installed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_lock_notifications_change_the_session_state() {
        assert_eq!(signal_for_name("com.apple.screenIsLocked"), Some(OsSignal::SessionLocked));
        assert_eq!(signal_for_name("com.apple.screenIsUnlocked"), Some(OsSignal::SessionUnlocked));
        // Near-miss names and other notifications leave the state alone.
        assert_eq!(signal_for_name("com.apple.screenIsLockedByRequest"), None);
        assert_eq!(signal_for_name("com.apple.sessionDidMoveFromConsole"), None);
        assert_eq!(signal_for_name(""), None);
    }

    #[test]
    fn display_sleep_notifications_map_to_the_display_states() {
        assert_eq!(signal_for_name("NSWorkspaceScreensDidSleepNotification"), Some(OsSignal::DisplayAsleep));
        assert_eq!(signal_for_name("NSWorkspaceScreensDidWakeNotification"), Some(OsSignal::DisplayAwake));
        // Session sleep is not display sleep.
        assert_eq!(signal_for_name("NSWorkspaceWillSleepNotification"), Some(OsSignal::Suspending));
        assert_eq!(signal_for_name("NSWorkspaceDidWakeNotification"), Some(OsSignal::Resumed));
        assert_eq!(signal_for_name("NSWorkspaceWillPowerOffNotification"), None);
    }

    #[test]
    fn idle_rejects_readings_that_are_not_elapsed_time() {
        assert_eq!(idle_duration_for(-1.0), None);
        assert_eq!(idle_duration_for(f64::NAN), None);
        assert_eq!(idle_duration_for(f64::INFINITY), None);
        assert_eq!(idle_duration_for(0.0), Some(Duration::from_secs(0)));
        assert_eq!(idle_duration_for(299.5), Some(Duration::from_millis(299_500)));
        // ...and the 5-minute threshold itself stays in presence.rs's
        // input_word, tested there.
        assert_eq!(crate::presence::input_word(idle_duration_for(299.0)), "recent");
        assert_eq!(crate::presence::input_word(idle_duration_for(300.0)), "idle");
    }

    #[test]
    fn idle_reads_a_duration_on_a_real_desktop() {
        // The HID event source answers on any logged-in session; on a
        // headless runner it may not. Either answer is acceptable, a panic
        // is not.
        let _ = idle_for();
    }
}
