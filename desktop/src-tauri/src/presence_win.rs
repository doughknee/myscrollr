//! Windows signals for the presence reporter (SCROLLR-210).
//!
//! Three native sources, each mapped onto the reporter's fixed vocabulary
//! and nothing else:
//!
//! * Session lock / unlock — `WM_WTSSESSION_CHANGE` delivered to a hidden
//!   message window registered with `WTSRegisterSessionNotification`. Only
//!   `WTS_SESSION_LOCK` and `WTS_SESSION_UNLOCK` are interpreted; console
//!   and remote connect/disconnect are not a lock and leave the state as
//!   it was.
//! * Display on / off — `GUID_CONSOLE_DISPLAY_STATE` through a power-setting
//!   callback: 0 = off (asleep), 1 = on (awake), 2 = dimmed (awake).
//! * Suspend / resume — a suspend-resume callback. Suspend sends the final
//!   `ended` check-in within two seconds; resume lets the loop start again.
//! * Idle — `GetLastInputInfo`, polled by the loop: the number of seconds
//!   since the last keyboard or mouse event, never what the event was.
//!
//! The initial session state is `unlocked`: a user session that launches a
//! desktop app is not locked at that moment, and Windows offers no query for
//! the current lock state, only the transitions.

use std::ffi::c_void;
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use std::time::Duration;

use tauri::AppHandle;
use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Power::{
    PowerRegisterSuspendResumeNotification, PowerSettingRegisterNotification,
    DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, POWERBROADCAST_SETTING,
};
use windows_sys::Win32::System::RemoteDesktop::WTSRegisterSessionNotification;
use windows_sys::Win32::System::SystemServices::GUID_CONSOLE_DISPLAY_STATE;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    TranslateMessage, DEVICE_NOTIFY_CALLBACK, MSG, PBT_APMRESUMEAUTOMATIC,
    PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, PBT_POWERSETTINGCHANGE, WM_WTSSESSION_CHANGE,
    WNDCLASSW, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK,
};

use crate::presence::{
    DISPLAY_ASLEEP, DISPLAY_AWAKE, DISPLAY_STATE, SESSION_LOCKED, SESSION_STATE, SESSION_UNLOCKED,
};

const NOTIFY_FOR_THIS_SESSION: u32 = 0;

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Map one WTS session-change reason to the reporter's state, or None when
/// the reason says nothing about the lock (connect / disconnect events).
pub fn session_state_for(reason: u32) -> Option<u8> {
    match reason {
        WTS_SESSION_LOCK => Some(SESSION_LOCKED),
        WTS_SESSION_UNLOCK => Some(SESSION_UNLOCKED),
        _ => None,
    }
}

/// Map GUID_CONSOLE_DISPLAY_STATE data: 0 off, 1 on, 2 dimmed.
pub fn display_state_for(data: u32) -> Option<u8> {
    match data {
        0 => Some(DISPLAY_ASLEEP),
        1 | 2 => Some(DISPLAY_AWAKE),
        _ => None,
    }
}

/// Seconds since the last input, from the tick count Windows keeps.
pub fn idle_for() -> Option<Duration> {
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if ok == 0 {
        return None;
    }
    let now = unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount() };
    Some(Duration::from_millis(now.wrapping_sub(info.dwTime) as u64))
}

/// Install every hook. Called once from `presence::start`.
pub fn install(app: AppHandle) {
    if APP.set(app).is_err() {
        return;
    }
    SESSION_STATE.store(SESSION_UNLOCKED, Ordering::Relaxed);
    register_power_callbacks();
    std::thread::Builder::new()
        .name("scrollr-presence-win".into())
        .spawn(message_loop)
        .ok();
}

unsafe extern "system" fn power_setting_callback(_ctx: *const c_void, kind: u32, setting: *const c_void) -> u32 {
    if kind == PBT_POWERSETTINGCHANGE && !setting.is_null() {
        let s = &*(setting as *const POWERBROADCAST_SETTING);
        if guid_eq(&s.PowerSetting, &GUID_CONSOLE_DISPLAY_STATE) && s.DataLength >= 4 {
            let data = std::ptr::read_unaligned(s.Data.as_ptr() as *const u32);
            if let Some(state) = display_state_for(data) {
                DISPLAY_STATE.store(state, Ordering::Relaxed);
                log::info!("[presence] display {}", crate::presence::display_word(state));
            }
        }
    }
    0
}

unsafe extern "system" fn suspend_resume_callback(_ctx: *const c_void, kind: u32, _setting: *const c_void) -> u32 {
    match kind {
        PBT_APMSUSPEND => {
            log::info!("[presence] suspend: sending ended check-in");
            if let Some(app) = APP.get() {
                crate::presence::send_ended_blocking(app);
            }
        }
        PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => {
            log::info!("[presence] resume");
            if let Some(app) = APP.get() {
                crate::presence::resumed(app);
            }
        }
        _ => {}
    }
    0
}

fn guid_eq(a: &GUID, b: &GUID) -> bool {
    a.data1 == b.data1 && a.data2 == b.data2 && a.data3 == b.data3 && a.data4 == b.data4
}

fn register_power_callbacks() {
    unsafe {
        let mut display_params = DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(power_setting_callback),
            Context: std::ptr::null_mut(),
        };
        let mut display_handle: *mut c_void = std::ptr::null_mut();
        let err = PowerSettingRegisterNotification(
            &GUID_CONSOLE_DISPLAY_STATE,
            DEVICE_NOTIFY_CALLBACK,
            &mut display_params as *mut _ as *mut c_void,
            &mut display_handle,
        );
        if err != 0 {
            log::warn!("[presence] display state notifications unavailable (error {err}); display stays unknown");
        }
        let mut suspend_params = DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(suspend_resume_callback),
            Context: std::ptr::null_mut(),
        };
        let mut suspend_handle: *mut c_void = std::ptr::null_mut();
        let err = PowerRegisterSuspendResumeNotification(
            DEVICE_NOTIFY_CALLBACK,
            &mut suspend_params as *mut _ as *mut c_void,
            &mut suspend_handle,
        );
        if err != 0 {
            log::warn!("[presence] suspend/resume notifications unavailable (error {err}); sleep will expire naturally");
        }
        // Handles are intentionally kept for the life of the process.
    }
}

unsafe extern "system" fn session_wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_WTSSESSION_CHANGE {
        if let Some(state) = session_state_for(wparam as u32) {
            SESSION_STATE.store(state, Ordering::Relaxed);
            log::info!("[presence] session {}", crate::presence::session_word(state));
        }
        return 0;
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// A hidden top-level window (not message-only: broadcasts like session
/// change need a real window) with its own message pump.
fn message_loop() {
    unsafe {
        let class_name = wide("ScrollrPresenceSignals");
        let hinstance = GetModuleHandleW(std::ptr::null());
        let class = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(session_wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };
        if RegisterClassW(&class) == 0 {
            log::warn!("[presence] could not register the signal window class; session state stays as launched");
            return;
        }
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hinstance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            log::warn!("[presence] could not create the signal window; session state stays as launched");
            return;
        }
        if WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) == 0 {
            log::warn!("[presence] session notifications unavailable; session state stays as launched");
        }
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{WTS_CONSOLE_DISCONNECT, WTS_REMOTE_CONNECT};

    #[test]
    fn only_lock_and_unlock_change_the_session_state() {
        assert_eq!(session_state_for(WTS_SESSION_LOCK), Some(SESSION_LOCKED));
        assert_eq!(session_state_for(WTS_SESSION_UNLOCK), Some(SESSION_UNLOCKED));
        assert_eq!(session_state_for(WTS_CONSOLE_DISCONNECT), None);
        assert_eq!(session_state_for(WTS_REMOTE_CONNECT), None);
    }

    #[test]
    fn display_state_follows_the_console_display_guid_values() {
        assert_eq!(display_state_for(0), Some(DISPLAY_ASLEEP));
        assert_eq!(display_state_for(1), Some(DISPLAY_AWAKE));
        assert_eq!(display_state_for(2), Some(DISPLAY_AWAKE));
        assert_eq!(display_state_for(7), None);
    }

    #[test]
    fn idle_reads_a_duration_on_a_real_desktop() {
        // GetLastInputInfo fails only without an interactive session (CI
        // service accounts); either answer is acceptable, a panic is not.
        let _ = idle_for();
    }
}
