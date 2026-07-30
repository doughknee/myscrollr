//! macOS: a taller title bar, so the traffic lights sit lower.
//!
//! The window runs `titleBarStyle: "Overlay"` (see tauri.conf.json): the
//! close/minimise/zoom buttons stay native, the title bar is transparent,
//! and our TopBar renders underneath it. AppKit centres those buttons in
//! a stock 28pt title bar — 14pt from the top of the window — and our
//! chrome row starts at that same top edge. So a row centred on the same
//! line can be at most 28px tall, and has to be smaller than that to
//! carry any margin. Exact alignment and a roomy row are mutually
//! exclusive at 28pt; that is arithmetic, not a tuning problem.
//!
//! Attaching an `NSToolbar` breaks the tie. macOS grows the title bar to
//! fit it and **re-centres the traffic lights in the taller bar itself**.
//! The buttons are moved by AppKit, on its own terms — we never touch
//! their frames — so hit-testing, hover tracking and the relayout it does
//! on every frame of a window drag all keep working.
//!
//! That last part is the whole point, and it was learned the hard way.
//! Moving the buttons ourselves — via `setFrameOrigin`, the route
//! Electron's `WindowButtonsProxy` takes — fails four separate ways,
//! because AppKit maintains four separate things about them:
//!
//! - Offsetting from their *current* frames accumulates, so they creep
//!   further down on every window focus. Absolute positions fix that.
//! - AppKit re-lays the title bar out on resize, and a correction applied
//!   afterwards is a frame late, so dragging an edge flickers.
//! - Hit-testing clips to the parent's bounds while drawing does not, so
//!   buttons nudged past the container render fine but go dead to clicks,
//!   with the webview underneath swallowing them.
//! - Hover tracking stays wherever AppKit installed it. Reparenting the
//!   buttons into a container of our own severs it outright: clicks keep
//!   working, the hover glyphs never appear.
//!
//! Fixing all four still leaves the flicker, because AppKit re-lays the
//! title bar out on *every frame* of a window drag — measured at ~1,180
//! events in a few seconds, 85% of them clobbering our position before we
//! ran. Correcting after the fact cannot win that race, whether applied
//! inline or posted to the next run-loop turn. Growing the bar sidesteps
//! it entirely: there is nothing to correct.
//!
//! The toolbar is empty and has no baseline separator, so it contributes
//! height and nothing visible. Our TopBar draws the actual chrome.

use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSToolbar, NSWindow, NSWindowToolbarStyle};
use tauri::WebviewWindow;

/// Install an empty unified toolbar so the title bar grows and macOS
/// re-centres the traffic lights inside it.
///
/// Idempotent: a window that already has a toolbar is left alone, so this
/// is safe to call from a retry path.
///
/// Returns whether the window now has a toolbar. `false` means the
/// NSWindow wasn't reachable yet and the caller should try again.
pub fn install(window: &WebviewWindow) -> bool {
    // NSToolbar is main-thread-only. Tauri's setup and window-event
    // callbacks run there; bail rather than risk a UI call off-thread.
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let Ok(ptr) = window.ns_window() else {
        return false;
    };
    if ptr.is_null() {
        return false;
    }

    // SAFETY: `ns_window()` hands back the NSWindow this webview is hosted
    // in, and Tauri keeps it alive for the window's lifetime. We only
    // borrow it for the duration of this call and never store it.
    let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };

    if ns_window.toolbar().is_some() {
        return true;
    }

    // No items are ever added, so the toolbar draws nothing. (Its baseline
    // separator would have been the one exception, but the property is
    // deprecated and a no-op on modern macOS — a transparent title bar
    // doesn't draw one anyway.)
    let toolbar = NSToolbar::init(NSToolbar::alloc(mtm));
    ns_window.setToolbar(Some(&toolbar));
    // UnifiedCompact over Unified: same single-line layout, shorter bar.
    // Measured on this machine — Unified gives a 52pt title bar with the
    // lights centred at 26pt, UnifiedCompact 38pt centred at 19pt.
    ns_window.setToolbarStyle(NSWindowToolbarStyle::UnifiedCompact);

    true
}
