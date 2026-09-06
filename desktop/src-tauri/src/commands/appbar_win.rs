//! Windows Shell AppBar integration (POC slice).
//!
//! Registers the ticker window as a Shell AppBar so maximized windows
//! respect its space. POC scope: register / unregister / set_position
//! only — no WndProc subclass, no fullscreen-app handling.
//!
//! Lifecycle:
//!   register()     -> ABM_NEW
//!   set_position() -> GetMonitorInfo(rcWork) -> ABM_SETPOS
//!   unregister()   -> ABM_REMOVE
//!
//! Placement is by the bar's OWN monitor's work area, never by
//! ABM_QUERYPOS: the shell stacks same-edge appbars across the whole
//! virtual desktop, so with a sibling ticker holding the top edge of
//! another monitor QUERYPOS hands the second bar the space BELOW where
//! the sibling would be (REL-202). ABM_SETPOS is kept so the reservation
//! exists for maximized-window accounting.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::UI::Shell::{
    SHAppBarMessage, ABE_BOTTOM, ABE_TOP, ABM_ACTIVATE, ABM_NEW, ABM_REMOVE, ABM_SETPOS,
    ABM_WINDOWPOSCHANGED, APPBARDATA,
};
use windows_sys::Win32::UI::WindowsAndMessaging::WM_USER;

/// Callback message ID for AppBar notifications. Must be >= WM_USER.
/// We don't handle these yet in the POC; the system needs a valid ID
/// to register us.
const APPBAR_CALLBACK_MSG: u32 = WM_USER + 1;

/// HWNDs currently registered as AppBars — one per ticker window, so
/// several tickers (one per monitor) can each reserve their edge.
/// Prevents double-register/unregister per window.
static REGISTERED: Mutex<Vec<isize>> = Mutex::new(Vec::new());

fn registered() -> MutexGuard<'static, Vec<isize>> {
    REGISTERED.lock().unwrap_or_else(|p| p.into_inner())
}

/// The rect the shell last reserved for each registered HWND. A
/// monitor's work area already excludes it, so `edge_rect` adds it back
/// before placing the bar — otherwise every same-edge re-position
/// (height change, hotplug re-sync) would drift one bar-height inward.
static RESERVED: Mutex<Vec<(isize, RECT)>> = Mutex::new(Vec::new());

fn reserved() -> MutexGuard<'static, Vec<(isize, RECT)>> {
    RESERVED.lock().unwrap_or_else(|p| p.into_inner())
}

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
    let hwnd = hwnd_of(window)?;
    if registered().contains(&(hwnd as isize)) {
        return Ok(());
    }

    let mut data: APPBARDATA = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
    data.hWnd = hwnd;
    data.uCallbackMessage = APPBAR_CALLBACK_MSG;

    let result = unsafe { SHAppBarMessage(ABM_NEW, &mut data) };
    if result == 0 {
        return Err("SHAppBarMessage(ABM_NEW) failed".into());
    }
    registered().push(hwnd as isize);
    log::info!("[AppBar] registered, hwnd={hwnd:?}");

    // Install the style-stripping subclass FIRST so subsequent style
    // change attempts by tao get intercepted. Then force the initial
    // styling (corners, border, shadow).
    let _ = install_style_subclass(window);
    let _ = force_systembar_appearance(window);
    Ok(())
}

/// Unregister this window's AppBar. Idempotent.
pub fn unregister(window: &tauri::Window) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    let was_registered = {
        let mut reg = registered();
        let before = reg.len();
        reg.retain(|&h| h != hwnd as isize);
        reg.len() != before
    };
    if was_registered {
        remove(hwnd);
        log::info!("[AppBar] unregistered hwnd={hwnd:?}");
    }
    Ok(())
}

/// ABM_REMOVE every registered AppBar. Called on exit: the shell keeps
/// the work area shrunk until logoff if a registration outlives us.
pub fn unregister_all() {
    let all = std::mem::take(&mut *registered());
    for h in &all {
        remove(*h as HWND);
    }
    log::info!("[AppBar] unregistered all ({})", all.len());
}

/// Defensive unregister called during app startup BEFORE any
/// register(). Clears any stale AppBar entry left over from a
/// previous session that crashed or was force-killed.
///
/// The shell tracks AppBar registrations by HWND. If a previous
/// Scrollr process registered the same HWND and never called
/// ABM_REMOVE, the work area stays shrunk until logoff or
/// explorer.exe restart. This call is a harmless no-op if there's
/// no stale entry. It bypasses REGISTERED (empty at startup).
pub fn force_unregister_stale(window: &tauri::Window) -> Result<(), String> {
    remove(hwnd_of(window)?);
    log::info!("[AppBar] force_unregister_stale (defensive startup cleanup)");
    Ok(())
}

/// ABM_REMOVE plus a reflow nudge: without ABM_WINDOWPOSCHANGED,
/// maximized windows can be slow to reclaim the space.
fn remove(hwnd: HWND) {
    reserved().retain(|(h, _)| *h != hwnd as isize);
    let mut data: APPBARDATA = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
    data.hWnd = hwnd;
    unsafe {
        SHAppBarMessage(ABM_REMOVE, &mut data);
        SHAppBarMessage(ABM_WINDOWPOSCHANGED, &mut data);
    }
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
    let hwnd = hwnd_of(window)?;
    if !registered().contains(&(hwnd as isize)) {
        return Err("AppBar not registered — call register() first".into());
    }
    let edge = match position {
        "top" => ABE_TOP,
        "bottom" => ABE_BOTTOM,
        _ => return Err(format!("invalid position: {position}")),
    };

    // Where the bar goes: this monitor's work area (taskbar-adjusted by
    // the shell) at the chosen edge, less nothing but our own previous
    // reservation. Not ABM_QUERYPOS — see the module doc.
    let requested = RECT {
        left: physical_x,
        top: physical_y,
        right: physical_x + physical_width,
        bottom: physical_y + physical_height,
    };
    let mut mi: MONITORINFO = unsafe { std::mem::zeroed() };
    mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    let ok = unsafe {
        let hmon = MonitorFromRect(&requested, MONITOR_DEFAULTTONEAREST);
        GetMonitorInfoW(hmon, &mut mi)
    };
    if ok == 0 {
        return Err("GetMonitorInfoW failed".into());
    }
    let own = reserved().iter().find(|(h, _)| *h == hwnd as isize).map(|(_, r)| *r);
    let rc = edge_rect(mi.rcWork, own, edge, physical_height);

    log::info!(
        "[AppBar] set_position edge={edge} work=({},{})-({},{}) own={:?} rect=({},{})-({},{})",
        mi.rcWork.left, mi.rcWork.top, mi.rcWork.right, mi.rcWork.bottom,
        own.map(|o| (o.left, o.top, o.right, o.bottom)),
        rc.left, rc.top, rc.right, rc.bottom
    );

    // Reserve the space. The shell may still hand back an adjusted rect;
    // we remember what it actually reserved (that is what its work area
    // excludes) but the window stays where we put it.
    let mut data: APPBARDATA = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
    data.hWnd = hwnd;
    data.uEdge = edge;
    data.rc = rc;
    let result = unsafe { SHAppBarMessage(ABM_SETPOS, &mut data) };
    if result == 0 {
        return Err("SHAppBarMessage(ABM_SETPOS) failed".into());
    }
    if (data.rc.left, data.rc.top, data.rc.right, data.rc.bottom)
        != (rc.left, rc.top, rc.right, rc.bottom)
    {
        log::warn!(
            "[AppBar] shell reserved ({},{})-({},{}) instead",
            data.rc.left, data.rc.top, data.rc.right, data.rc.bottom
        );
    }
    {
        let mut res = reserved();
        res.retain(|(h, _)| *h != hwnd as isize);
        res.push((hwnd as isize, data.rc));
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

    // Move the window LAST: a work-area change makes the shell shove
    // windows out of the newly reserved band, our own included, so a
    // move before ABM_SETPOS ends up one bar-height off. Win32
    // SetWindowPos rather than Tauri's set_size/set_position: the latter
    // applies AdjustWindowRectEx, which adds back the non-client margins
    // we strip (+16 horizontal, +9 vertical bleed past the requested rect).
    use windows_sys::Win32::UI::WindowsAndMessaging::{SWP_NOACTIVATE, SWP_NOZORDER};
    let ok = unsafe {
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            rc.left,
            rc.top,
            rc.right - rc.left,
            rc.bottom - rc.top,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
    if ok == 0 {
        return Err("SetWindowPos failed".into());
    }

    // Re-apply styling after geometry settles. DWM attributes
    // sometimes don't take effect on the first call before the
    // window's swap chain has been positioned.
    let _ = force_systembar_appearance(window);

    Ok(())
}

/// A bar of `height` px on `edge` of a monitor whose work area is `work`.
/// `own` is the rect the shell currently reserves for this same bar; the
/// work area excludes it, so it is given back before placing — a stale
/// `own` on the other edge (or a different monitor) does not touch it.
/// Width is the work area's: a left/right taskbar keeps its column.
fn edge_rect(work: RECT, own: Option<RECT>, edge: u32, height: i32) -> RECT {
    let mut w = work;
    if let Some(o) = own {
        let same_monitor = o.left < w.right && o.right > w.left;
        if edge == ABE_TOP && same_monitor && o.bottom == w.top {
            w.top = o.top;
        }
        if edge == ABE_BOTTOM && same_monitor && o.top == w.bottom {
            w.bottom = o.bottom;
        }
    }
    let (top, bottom) = if edge == ABE_TOP {
        (w.top, w.top + height)
    } else {
        (w.bottom - height, w.bottom)
    };
    RECT { left: w.left, top, right: w.right, bottom }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT { left, top, right, bottom }
    }
    fn t(a: RECT) -> (i32, i32, i32, i32) {
        (a.left, a.top, a.right, a.bottom)
    }

    // Two 3440x1440 monitors, secondary at x=-3440, taskbar (48 px)
    // at the bottom of the primary.
    const PRIMARY_WORK: RECT = RECT { left: 0, top: 0, right: 3440, bottom: 1392 };
    const SECONDARY_WORK: RECT = RECT { left: -3440, top: 0, right: 0, bottom: 1440 };

    #[test]
    fn top_edge_sits_at_its_own_monitor_top() {
        assert_eq!(t(edge_rect(PRIMARY_WORK, None, ABE_TOP, 40)), (0, 0, 3440, 40));
        // The sibling's reservation on the primary is not in this work area.
        assert_eq!(t(edge_rect(SECONDARY_WORK, None, ABE_TOP, 40)), (-3440, 0, 0, 40));
    }

    #[test]
    fn bottom_edge_sits_above_the_taskbar() {
        assert_eq!(t(edge_rect(PRIMARY_WORK, None, ABE_BOTTOM, 40)), (0, 1352, 3440, 1392));
        assert_eq!(t(edge_rect(SECONDARY_WORK, None, ABE_BOTTOM, 40)), (-3440, 1400, 0, 1440));
    }

    #[test]
    fn same_edge_repeat_does_not_drift() {
        // Our own 40 px top reservation has shrunk the work area to 40.
        let shrunk = r(0, 40, 3440, 1392);
        let own = r(0, 0, 3440, 40);
        assert_eq!(t(edge_rect(shrunk, Some(own), ABE_TOP, 40)), (0, 0, 3440, 40));
        // Height change on the same edge: still from the true edge.
        assert_eq!(t(edge_rect(shrunk, Some(own), ABE_TOP, 60)), (0, 0, 3440, 60));
        // Bottom, over the taskbar.
        let shrunk = r(0, 0, 3440, 1352);
        let own = r(0, 1352, 3440, 1392);
        assert_eq!(t(edge_rect(shrunk, Some(own), ABE_BOTTOM, 40)), (0, 1352, 3440, 1392));
    }

    #[test]
    fn toggling_edges_ignores_the_stale_reservation() {
        // Was at the bottom (over the taskbar); now asked for top.
        let work = r(0, 0, 3440, 1352);
        let own = r(0, 1352, 3440, 1392);
        assert_eq!(t(edge_rect(work, Some(own), ABE_TOP, 40)), (0, 0, 3440, 40));
        // Was at the top; now asked for bottom.
        let work = r(0, 40, 3440, 1392);
        let own = r(0, 0, 3440, 40);
        assert_eq!(t(edge_rect(work, Some(own), ABE_BOTTOM, 40)), (0, 1352, 3440, 1392));
    }

    #[test]
    fn taskbar_at_top_stacks_the_bar_under_it() {
        let work = r(0, 48, 3440, 1440);
        assert_eq!(t(edge_rect(work, None, ABE_TOP, 40)), (0, 48, 3440, 88));
        // …and stays there on a repeat.
        let shrunk = r(0, 88, 3440, 1440);
        let own = r(0, 48, 3440, 88);
        assert_eq!(t(edge_rect(shrunk, Some(own), ABE_TOP, 40)), (0, 48, 3440, 88));
    }

    #[test]
    fn a_reservation_on_another_monitor_is_not_ours_to_give_back() {
        // Same y-band, different monitor (x ranges do not overlap).
        let own = r(-3440, 0, 0, 40);
        let work = r(0, 40, 3440, 1392);
        assert_eq!(t(edge_rect(work, Some(own), ABE_TOP, 40)), (0, 40, 3440, 80));
    }
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
use windows_sys::Win32::UI::WindowsAndMessaging::{WM_DISPLAYCHANGE, WM_STYLECHANGING};

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

    // A monitor came, went, or moved (Win+P, a cable, a resolution
    // change). Every top-level window gets this broadcast, so each
    // ticker re-checks; `check_monitors` emits once per real change.
    if msg == WM_DISPLAYCHANGE {
        crate::commands::window::check_monitors();
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