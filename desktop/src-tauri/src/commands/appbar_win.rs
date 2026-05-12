//! Windows Shell AppBar integration (POC slice).
//!
//! Registers the ticker window as a Shell AppBar so maximized windows
//! respect its space. POC scope: register / unregister / set_position
//! only — no WndProc subclass, no fullscreen-app handling.
//!
//! Lifecycle:
//!   register()     -> ABM_NEW
//!   set_position() -> ABM_QUERYPOS -> ABM_SETPOS
//!   unregister()   -> ABM_REMOVE

use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::UI::Shell::{
    SHAppBarMessage, ABE_BOTTOM, ABE_TOP, ABM_ACTIVATE, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE,
    ABM_SETPOS, ABM_WINDOWPOSCHANGED, APPBARDATA,
};
use windows_sys::Win32::UI::WindowsAndMessaging::WM_USER;

/// Callback message ID for AppBar notifications. Must be >= WM_USER.
/// We don't handle these yet in the POC; the system needs a valid ID
/// to register us.
const APPBAR_CALLBACK_MSG: u32 = WM_USER + 1;

/// Tracks AppBar registration. Prevents double-register/unregister.
static REGISTERED: AtomicBool = AtomicBool::new(false);

/// Whether to hide the ticker when a fullscreen app appears.
/// Default: true (taskbar-like behavior). When false, ticker stays
/// visible on top of fullscreen apps — content under the ticker
/// will be visually clipped, which is the user's chosen tradeoff.
static HIDE_ON_FULLSCREEN: AtomicBool = AtomicBool::new(true);

/// Update the hide-on-fullscreen preference. Called from JS via
/// the set_hide_on_fullscreen Tauri command.
pub fn set_hide_on_fullscreen(value: bool) {
    HIDE_ON_FULLSCREEN.store(value, Ordering::Relaxed);
    log::info!("[AppBar] hide_on_fullscreen = {value}");
}



fn hwnd_of(window: &tauri::Window) -> Result<HWND, String> {
    window
        .hwnd()
        .map(|h| h.0 as HWND)
        .map_err(|e| format!("failed to get HWND: {e}"))
}

/// Register the ticker as a Shell AppBar. Idempotent.
pub fn register(window: &tauri::Window) -> Result<(), String> {
    if REGISTERED.load(Ordering::Relaxed) {
        return Ok(());
    }
    let hwnd = hwnd_of(window)?;

    let mut data: APPBARDATA = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
    data.hWnd = hwnd;
    data.uCallbackMessage = APPBAR_CALLBACK_MSG;

    let result = unsafe { SHAppBarMessage(ABM_NEW, &mut data) };
    if result == 0 {
        return Err("SHAppBarMessage(ABM_NEW) failed".into());
    }
    REGISTERED.store(true, Ordering::Relaxed);
    log::info!("[AppBar] registered, hwnd={hwnd:?}");

    // Install the style-stripping subclass FIRST so subsequent style
    // change attempts by tao get intercepted. Then force the initial
    // styling (corners, border, shadow).
    let _ = install_style_subclass(window);
    let _ = force_systembar_appearance(window);
    Ok(())
}

/// Unregister the AppBar. Idempotent.
pub fn unregister(window: &tauri::Window) -> Result<(), String> {
    if !REGISTERED.load(Ordering::Relaxed) {
        return Ok(());
    }
    let hwnd = hwnd_of(window)?;

    let mut data: APPBARDATA = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
    data.hWnd = hwnd;

    unsafe {
        SHAppBarMessage(ABM_REMOVE, &mut data);
        // Force the shell to reflow now that our slot is gone. Without
        // this, maximized windows can be slow to reclaim the space.
        let mut wpc_data: APPBARDATA = std::mem::zeroed();
        wpc_data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
        wpc_data.hWnd = hwnd;
        SHAppBarMessage(ABM_WINDOWPOSCHANGED, &mut wpc_data);
    }
    REGISTERED.store(false, Ordering::Relaxed);
    log::info!("[AppBar] unregistered");
    Ok(())
}

/// Defensive unregister called during app startup BEFORE any
/// register(). Clears any stale AppBar entry left over from a
/// previous session that crashed or was force-killed.
///
/// The shell tracks AppBar registrations by HWND. If a previous
/// Scrollr process registered the same HWND and never called
/// ABM_REMOVE, the work area stays shrunk until logoff or
/// explorer.exe restart. This call is a harmless no-op if there's
/// no stale entry.
///
/// We bypass the REGISTERED atomic (which is false at startup) and
/// don't update it — the next register() call will set it cleanly.
pub fn force_unregister_stale(window: &tauri::Window) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    let mut data: APPBARDATA = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
    data.hWnd = hwnd;
    unsafe { SHAppBarMessage(ABM_REMOVE, &mut data) };
    log::info!("[AppBar] force_unregister_stale (defensive startup cleanup)");
    Ok(())
}

/// Set the AppBar position. Caller must register() first.
/// Coordinates are PHYSICAL pixels.
pub fn set_position(
    window: &tauri::Window,
    position: &str,
    physical_x: i32,
    physical_y: i32,
    physical_width: i32,
    physical_height: i32,
) -> Result<(), String> {
    if !REGISTERED.load(Ordering::Relaxed) {
        return Err("AppBar not registered — call register() first".into());
    }
    let hwnd = hwnd_of(window)?;
    let edge = match position {
        "top" => ABE_TOP,
        "bottom" => ABE_BOTTOM,
        _ => return Err(format!("invalid position: {position}")),
    };

    let mut data: APPBARDATA = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
    data.hWnd = hwnd;
    data.uEdge = edge;
    data.rc = RECT {
        left: physical_x,
        top: physical_y,
        right: physical_x + physical_width,
        bottom: physical_y + physical_height,
    };

    // Let the shell adjust our requested rect if it conflicts with
    // another appbar (e.g. the taskbar on the same edge).
    unsafe { SHAppBarMessage(ABM_QUERYPOS, &mut data) };

    // Re-clamp height after the shell may have adjusted left/top/right.
    match edge {
        ABE_TOP => {
            data.rc.bottom = data.rc.top + physical_height;
        }
        ABE_BOTTOM => {
            data.rc.top = data.rc.bottom - physical_height;
        }
        _ => unreachable!(),
    }

    log::info!(
        "[AppBar] set_position edge={edge} rect=({},{})-({},{})",
        data.rc.left, data.rc.top, data.rc.right, data.rc.bottom
    );

    let result = unsafe { SHAppBarMessage(ABM_SETPOS, &mut data) };
    if result == 0 {
        return Err("SHAppBarMessage(ABM_SETPOS) failed".into());
    }

    // Tell the shell our window is now in its final position and it
    // should notify other top-level windows (maximized ones especially)
    // to recompute their bounds against the new work area. Without
    // this, maximized windows lag a toggle cycle behind the AppBar
    // changing — visible as a "ghost" of the previous reserved
    // region until the next reflow event.
    unsafe {
        let mut activate_data: APPBARDATA = std::mem::zeroed();
        activate_data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
        activate_data.hWnd = hwnd;
        SHAppBarMessage(ABM_ACTIVATE, &mut activate_data);

        let mut wpc_data: APPBARDATA = std::mem::zeroed();
        wpc_data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
        wpc_data.hWnd = hwnd;
        SHAppBarMessage(ABM_WINDOWPOSCHANGED, &mut wpc_data);
    }

    // Move the window to the rect the shell granted us. Use Win32
    // SetWindowPos directly rather than Tauri's set_size/set_position,
    // because the latter applies AdjustWindowRectEx which adds back
    // the non-client margins we just stripped (was producing +16
    // horizontal, +9 vertical bleed past the requested rect).
    use windows_sys::Win32::UI::WindowsAndMessaging::{SWP_NOZORDER, SWP_NOACTIVATE};
    unsafe {
        let w = data.rc.right - data.rc.left;
        let h = data.rc.bottom - data.rc.top;
        let ok = SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            data.rc.left,
            data.rc.top,
            w,
            h,
            SWP_NOZORDER | SWP_NOACTIVATE,
        );
        if ok == 0 {
            return Err("SetWindowPos failed".into());
        }
    }

    // Re-apply styling after geometry settles. DWM attributes
    // sometimes don't take effect on the first call before the
    // window's swap chain has been positioned.
    let _ = force_systembar_appearance(window);

    Ok(())
}

// ─── Force system-bar window styling ─────────────────────────────
//
// The default Tauri window has WS_OVERLAPPEDWINDOW (caption, thick
// frame, sysmenu, min/max boxes) even with `decorations: false`,
// because tauri.conf only suppresses the *visual* chrome — the style
// bits stay set. For the ticker to look like a real system bar:
//
//  1. Strip ALL of WS_OVERLAPPEDWINDOW (forces WS_POPUP equivalent)
//  2. Tell DWM not to round corners (Windows 11)
//  3. Tell DWM not to paint a border color (Windows 11)
//  4. Tell DWM not to render the non-client area (kills the shadow)
//
// SWP_FRAMECHANGED is required after style changes so Windows
// recomputes the non-client area with the new style.

use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute,
    DWMWA_NCRENDERING_POLICY,
    DWMWA_WINDOW_CORNER_PREFERENCE,
    DWMNCRP_DISABLED,
    DWMWCP_DONOTROUND,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
    GWL_STYLE, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE,
    WS_BORDER, WS_CAPTION, WS_DLGFRAME, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU,
    WS_THICKFRAME,
};

// DWM attributes not exposed as constants by windows-sys 0.59 at the
// version we pin. Values are stable in the Windows SDK headers.
const DWMWA_BORDER_COLOR: u32 = 34;
const DWMWA_COLOR_NONE: u32 = 0xFFFFFFFE;

/// Force the ticker window into "system bar" mode.
///
/// Idempotent. Must be called AFTER the HWND exists. Safe to call
/// repeatedly — re-calling after geometry changes is harmless.
pub fn force_systembar_appearance(window: &tauri::Window) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;

    unsafe {
        // 1. Strip decoration bits from both regular style and ex-style.
        // The WndProc subclass keeps the strip permanent against
        // tao's apply_diff() re-asserting bits on state changes.
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GWL_EXSTYLE, WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME,
            WS_EX_STATICEDGE, WS_EX_TOOLWINDOW, WS_EX_WINDOWEDGE,
        };
        let style_strip: isize = (WS_CAPTION
            | WS_THICKFRAME
            | WS_BORDER
            | WS_DLGFRAME
            | WS_SYSMENU
            | WS_MINIMIZEBOX
            | WS_MAXIMIZEBOX) as isize;
        let exstyle_strip: isize = (WS_EX_TOOLWINDOW
            | WS_EX_WINDOWEDGE
            | WS_EX_CLIENTEDGE
            | WS_EX_DLGMODALFRAME
            | WS_EX_STATICEDGE) as isize;

        let cur_style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let cur_exstyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_style = cur_style & !style_strip;
        let new_exstyle = cur_exstyle & !exstyle_strip;

        let mut frame_changed = false;
        if new_style != cur_style {
            SetWindowLongPtrW(hwnd, GWL_STYLE, new_style);
            frame_changed = true;
        }
        if new_exstyle != cur_exstyle {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_exstyle);
            frame_changed = true;
        }
        if frame_changed {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0, 0, 0, 0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
            log::info!(
                "[AppBar] stripped style 0x{cur_style:X}->0x{new_style:X} exstyle 0x{cur_exstyle:X}->0x{new_exstyle:X}"
            );
        }

        // 2. Windows 11: square corners. Idempotent.
        let corner: i32 = DWMWCP_DONOTROUND;
        let hr = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &corner as *const i32 as *const _,
            std::mem::size_of::<i32>() as u32,
        );
        if hr != 0 {
            log::warn!("[AppBar] corner-pref DwmSetWindowAttribute failed: 0x{hr:X}");
        }

        // 2b. Windows 11: zero out the auto-drawn frame border. DWM
        // renders a 1px highlight at the top edge of EVERY top-level
        // window for accessibility/visibility, even decoration-less
        // ones. Setting frame-border-thickness to 0 removes it.
        const DWMWA_VISIBLE_FRAME_BORDER_THICKNESS: u32 = 37;
        let frame_thickness: u32 = 0;
        let hr = DwmSetWindowAttribute(
            hwnd,
            DWMWA_VISIBLE_FRAME_BORDER_THICKNESS,
            &frame_thickness as *const u32 as *const _,
            std::mem::size_of::<u32>() as u32,
        );
        if hr != 0 {
            log::warn!("[AppBar] frame-thickness DwmSetWindowAttribute failed: 0x{hr:X}");
        }

        // 3. Windows 11: no accent-color border (the cyan glow some
        // themes draw on focused windows).
        let no_color: u32 = DWMWA_COLOR_NONE;
        let hr = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &no_color as *const u32 as *const _,
            std::mem::size_of::<u32>() as u32,
        );
        if hr != 0 {
            log::warn!("[AppBar] border-color DwmSetWindowAttribute failed: 0x{hr:X}");
        }

        // 4. Windows 11: explicitly disable the system backdrop.
        // This is what kills the drop shadow on Win11. The older
        // DWMWA_NCRENDERING_POLICY approach only works on
        // pre-Win11 systems and silently no-ops on Win11.
        const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
        const DWMSBT_NONE: i32 = 1;
        let backdrop: i32 = DWMSBT_NONE;
        let hr = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &backdrop as *const i32 as *const _,
            std::mem::size_of::<i32>() as u32,
        );
        if hr != 0 {
            log::warn!("[AppBar] backdrop-type DwmSetWindowAttribute failed: 0x{hr:X}");
        }

        // 5. Legacy fallback for non-Win11 systems: disable
        // non-client rendering. On Win11 this is a no-op because
        // there's no non-client area after the style strip.
        let policy: i32 = DWMNCRP_DISABLED;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY as u32,
            &policy as *const i32 as *const _,
            std::mem::size_of::<i32>() as u32,
        );
    }

    Ok(())
}

// ─── WndProc subclass: strip decoration bits permanently ─────────
//
// Tauri's underlying windowing layer (tao) re-asserts WS_CAPTION |
// WS_SYSMENU | WS_THICKFRAME on every internal window state change
// — including ones we trigger like set_size and set_position.
// Stripping styles via a one-shot SetWindowLongPtrW call doesn't
// stick because the next apply_diff() reverts it.
//
// Solution: subclass the WndProc and intercept WM_STYLECHANGING.
// Windows sends this message BEFORE actually applying the new style,
// giving us a chance to modify the proposed style in-place.

use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::Shell::{
    DefSubclassProc, SetWindowSubclass,
};
use windows_sys::Win32::UI::WindowsAndMessaging::WM_STYLECHANGING;

const SUBCLASS_ID: usize = 0xA9B_0001;

// STYLESTRUCT layout from Windows SDK:
//   DWORD styleOld;
//   DWORD styleNew;
// We modify styleNew in place to strip decoration bits.
#[repr(C)]
struct StyleStruct {
    style_old: u32,
    style_new: u32,
}

unsafe extern "system" fn appbar_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid_subclass: usize,
    _dw_ref_data: usize,
) -> LRESULT {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        WM_NCCALCSIZE,
        WS_BORDER, WS_CAPTION, WS_DLGFRAME, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
        WS_SYSMENU, WS_THICKFRAME, WS_EX_TOOLWINDOW, WS_EX_WINDOWEDGE,
        WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE,
        GWL_STYLE, GWL_EXSTYLE,
    };

    // WM_NCCALCSIZE with wparam=TRUE: Windows is asking us to compute
    // the new client rect for the window. lparam points to
    // NCCALCSIZE_PARAMS whose rgrc[0] arrives as the proposed window
    // rect. Returning 0 without modifying rgrc[0] tells Windows
    // "client rect = window rect" — no non-client area.
    //
    // Without this, even with all decoration style bits stripped,
    // Windows insets the client rect by the original frame size
    // (8px left/right, 9px top in our case) and paints the gap
    // with the window class's background brush (white).
    if msg == WM_NCCALCSIZE && wparam != 0 {
        return 0;
    }

    // AppBar callback: Windows notifies us of system events that affect
    // our reserved-space behavior. The critical one is ABN_FULLSCREENAPP,
    // sent when ANY fullscreen application enters or leaves fullscreen.
    // We hide the ticker so fullscreen video / games don't get clipped.
    if msg == APPBAR_CALLBACK_MSG {
        use windows_sys::Win32::UI::Shell::ABN_FULLSCREENAPP;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE,
        };
        if wparam as u32 == ABN_FULLSCREENAPP {
            let entering = lparam != 0;
            let should_hide = HIDE_ON_FULLSCREEN.load(Ordering::Relaxed);
            if entering {
                if should_hide {
                    ShowWindow(hwnd, SW_HIDE);
                    log::info!("[AppBar] fullscreen app entered — hiding ticker");
                } else {
                    log::info!("[AppBar] fullscreen app entered — staying visible (user pref)");
                }
            } else {
                // Always ensure visible when fullscreen exits, in case
                // the user toggled the pref while a fullscreen app was
                // running with the old "hide" behavior.
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                if should_hide {
                    log::info!("[AppBar] fullscreen app left — restoring ticker");
                }
            }
        }
        return 0;
    }
    const STYLE_STRIP: u32 = WS_CAPTION
        | WS_THICKFRAME
        | WS_BORDER
        | WS_DLGFRAME
        | WS_SYSMENU
        | WS_MINIMIZEBOX
        | WS_MAXIMIZEBOX;
    const EXSTYLE_STRIP: u32 = WS_EX_TOOLWINDOW
        | WS_EX_WINDOWEDGE
        | WS_EX_CLIENTEDGE
        | WS_EX_DLGMODALFRAME
        | WS_EX_STATICEDGE;

    if msg == WM_STYLECHANGING {
        let ss = lparam as *mut StyleStruct;
        if !ss.is_null() {
            if wparam as isize == GWL_STYLE as isize {
                (*ss).style_new &= !STYLE_STRIP;
            } else if wparam as isize == GWL_EXSTYLE as isize {
                (*ss).style_new &= !EXSTYLE_STRIP;
            }
        }
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// Install the style-stripping subclass on the ticker HWND.
/// Idempotent — Windows tolerates repeat SetWindowSubclass calls.
pub fn install_style_subclass(window: &tauri::Window) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    unsafe {
        SetWindowSubclass(hwnd, Some(appbar_subclass_proc), SUBCLASS_ID, 0);
    }
    log::info!("[AppBar] style-strip subclass installed");
    Ok(())
}