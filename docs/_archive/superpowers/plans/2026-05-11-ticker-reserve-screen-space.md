# Ticker Reserve-Screen-Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Scrollr ticker behave like a system taskbar — on Windows, register as a Shell AppBar so maximized windows respect its space; on macOS, set window collection behavior so the ticker is visible across all Spaces and alongside fullscreen apps (true space reservation is not possible on macOS without private APIs).

**Architecture:** Add two new platform-conditional modules — `commands/appbar_win.rs` and `commands/macos_window.rs` — that handle native window registration. Wire them into the existing `position_ticker` and `pin_window` commands as additional branches alongside the existing Wayland compositor branches. The behavior is gated behind a new user preference `window.reserveSpace` (default `false`) so existing users keep the current overlay behavior unless they explicitly opt in. The macOS implementation always sets the "visible across Spaces and fullscreen" collection behavior when pinning is on, since it's the closest macOS analog and has no downside.

**Tech Stack:**
- Rust (Tauri v2), `windows-sys 0.59` (already a dependency — add `Win32_UI_Shell`, `Win32_UI_WindowsAndMessaging`, `Win32_Foundation` features)
- `objc2` + `objc2-app-kit` for macOS NSWindow collection behavior (new dependencies, target-gated)
- TypeScript (preferences plumbing in `desktop/src/preferences.ts`, settings UI in `desktop/src/components/settings/`)

**Out of scope:**
- Linux/Wayland reserve-space behavior (compositor-specific, separate plan)
- Auto-hide AppBar mode (`ABS_AUTOHIDE`) — initial release is fixed-position only
- Per-monitor AppBar (initial release pins to the monitor the ticker is currently on; multi-monitor edge cases noted but not solved here)

---

## File Structure

**New files:**
- `desktop/src-tauri/src/commands/appbar_win.rs` — Windows AppBar registration (`SHAppBarMessage` wrapper, custom `WndProc` subclass for callback messages, lifecycle: register / set position / unregister)
- `desktop/src-tauri/src/commands/macos_window.rs` — macOS NSWindow collection behavior (`canJoinAllSpaces`, `stationary`, `fullScreenAuxiliary`) and window level
- `desktop/src-tauri/src/commands/appbar_stub.rs` — empty stubs for Linux so callers don't need `#[cfg]` everywhere

**Modified files:**
- `desktop/src-tauri/Cargo.toml` — add `Win32_UI_Shell` / `Win32_UI_WindowsAndMessaging` features to `windows-sys`; add `objc2` + `objc2-app-kit` macOS target deps
- `desktop/src-tauri/src/commands/mod.rs` — register the new modules
- `desktop/src-tauri/src/commands/window.rs` — call `appbar_win::set_position` / `appbar_win::register` / `appbar_win::unregister` from `position_ticker` and `pin_window` when `reserve_space` is true; call `macos_window::apply_floating_behavior` from `pin_window` on macOS
- `desktop/src-tauri/src/lib.rs` — call `appbar_win::register_if_pref()` during setup; register an exit hook that calls `appbar_win::unregister()` so we don't orphan a registration
- `desktop/src/preferences.ts` — add `reserveSpace: boolean` to `WindowPrefs`, default `false`, plus migration
- `desktop/src/App.tsx` — pass `reserveSpace` to the Rust commands; re-invoke `position_ticker` when the pref toggles
- `desktop/src/components/settings/` — surface the toggle in the existing window/ticker settings panel

---

## Key Design Decisions

### Why a preference, not always-on?

The current `alwaysOnTop` overlay behavior has fans — users who want the ticker to float over their work without claiming screen real estate. The reserve-space mode is a real tradeoff: maximized windows get shorter. Make it opt-in.

### Windows: AppBar lifecycle

`SHAppBarMessage` is a stateful API. The kernel tracks our HWND as a registered AppBar across calls. We must:

1. Call `ABM_NEW` exactly once per HWND (the ticker's HWND).
2. Whenever the ticker moves/resizes (or the user toggles position top/bottom), call `ABM_QUERYPOS` → adjust → `ABM_SETPOS`.
3. Call `ABM_REMOVE` before the HWND is destroyed *and* when the user turns reserve-space mode off. Forgetting `ABM_REMOVE` leaves a "ghost reservation" that survives our process — the work area stays shrunk until reboot or explorer restart.
4. Re-register after the ticker window is hidden and re-shown (closing the ticker via `Hide Ticker` should release the reservation; re-showing should re-register).

We use `windows-sys` (already in `Cargo.toml`) rather than `windows`, matching the existing pattern in `lib.rs:17`. The `SHAppBarMessage` symbol lives in `Win32::UI::Shell`, the `HWND` type in `Win32::Foundation`, and the callback-message `WM_USER` constant + `SetWindowSubclass` in `Win32::UI::WindowsAndMessaging` / `Win32::UI::Shell`.

### Windows: Callback messages

`ABM_NEW` requires us to provide a `uCallbackMessage` ID (any value `>= WM_USER`, i.e. `>= 0x0400`). Windows then sends `WM_<that ID>` to our HWND's `WndProc` when:
- `ABN_FULLSCREENAPP` — a fullscreen app appeared (`wParam == 1`) or left (`wParam == 0`)
- `ABN_POSCHANGED` — another AppBar (or the taskbar) moved; we should re-query our position
- `ABN_STATECHANGE` — taskbar autohide/always-on-top state changed
- `ABN_WINDOWARRANGE` — Cascade/TileH/TileV is starting/ending

We subclass the ticker's `WndProc` via `SetWindowSubclass` (from `comctl32.dll`, exposed in `windows-sys` as `Win32::UI::Shell::SetWindowSubclass`). The subclass proc handles only our callback message and `WM_DESTROY` (to call `ABM_REMOVE`); everything else is forwarded to `DefSubclassProc`. On `ABN_FULLSCREENAPP`-on we set `WS_EX_TOPMOST` off so the fullscreen app isn't visually broken; on `-off` we re-enable.

### Windows: DPI

`SHAppBarMessage` works in **physical pixels**, not logical. Our existing `position_ticker` divides by `scale_factor()` to get logical coords; the AppBar call needs the raw physical rect. Plan accordingly.

### macOS: Collection behavior

`NSWindow` has a `collectionBehavior` bitmask that controls how the window interacts with Spaces, Mission Control, and fullscreen apps. The combination we want is:

```
NSWindowCollectionBehavior::CanJoinAllSpaces    // visible on every desktop
| NSWindowCollectionBehavior::Stationary         // doesn't slide during Mission Control
| NSWindowCollectionBehavior::FullScreenAuxiliary // can appear alongside fullscreen apps
| NSWindowCollectionBehavior::IgnoresCycle        // not in Cmd+` cycle
```

Combined with `NSStatusWindowLevel` (level 25 — same as the system menu bar, above `NSFloatingWindowLevel`), this gives the ticker maximum "always visible" behavior on macOS without using private SPI.

We apply these only when `pinned` is true. When `pinned` is false, we revert to default collection behavior and `NSNormalWindowLevel`.

### macOS: Why we don't reserve space

There is no public API for it. The Dock and menu bar use private CoreGraphics SPI (`CGSSetWindowLevel` with `kCGDockWindowLevel`, plus an undocumented "reserved area" mechanism). Apple rejects MAS submissions that use these. We're not shipping outside MAS *yet*, but we don't want to bake in an SPI dependency that breaks on macOS updates. The collection-behavior approach is supported and gets us 80% of the perceived behavior.

### Preference migration

Existing users have `WindowPrefs` without `reserveSpace`. The `loadPrefs` deep-merge at `desktop/src/preferences.ts:1150` already handles missing fields via `{ ...DEFAULT_WINDOW, ...source.window }`, so the new field gets the default `false` automatically. No explicit migration code needed.

---

## Task 1: Add Cargo dependencies and feature flags

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml:46-47`

- [ ] **Step 1: Update windows-sys features**

In `desktop/src-tauri/Cargo.toml`, replace the Windows target dependency block:

```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = [
    "Win32_System_Com",
    "Win32_Foundation",
    "Win32_UI_Shell",
    "Win32_UI_WindowsAndMessaging",
    "Win32_Graphics_Gdi",
] }
```

`Win32_Graphics_Gdi` is needed for the `RECT` type used by `APPBARDATA`. `Win32_UI_WindowsAndMessaging` is needed for `SetWindowSubclass`, `DefSubclassProc`, `WM_DESTROY`, and `WM_USER`.

- [ ] **Step 2: Add macOS target dependencies**

In the same file, immediately after the Windows block, add:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
objc2 = "0.5"
objc2-app-kit = { version = "0.2", features = [
    "NSWindow",
    "NSResponder",
    "NSApplication",
] }
objc2-foundation = "0.2"
```

These are the same versions Tauri 2 / tao uses internally so we won't get a duplicate-crate compile error.

- [ ] **Step 3: Verify the build compiles on all platforms**

Run from `desktop/`:
```sh
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: success on the host platform. Cross-compile checks happen in CI on tagged releases.

- [ ] **Step 4: Commit**

```sh
git add desktop/src-tauri/Cargo.toml
git commit -m "build(desktop): add windows-sys Shell features and macOS objc2 deps"
```

---

## Task 2: Scaffold the new command modules

**Files:**
- Create: `desktop/src-tauri/src/commands/appbar_win.rs`
- Create: `desktop/src-tauri/src/commands/macos_window.rs`
- Create: `desktop/src-tauri/src/commands/appbar_stub.rs`
- Modify: `desktop/src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Create the Linux/stub module**

Create `desktop/src-tauri/src/commands/appbar_stub.rs`:

```rust
//! Stub module for non-Windows platforms.
//! Lets callers invoke appbar functions unconditionally without
//! sprinkling `#[cfg]` at every call site.

#[allow(dead_code)]
pub fn register(_window: &tauri::Window) -> Result<(), String> {
    Ok(())
}

#[allow(dead_code)]
pub fn unregister(_window: &tauri::Window) -> Result<(), String> {
    Ok(())
}

#[allow(dead_code)]
pub fn set_position(
    _window: &tauri::Window,
    _position: &str,
    _physical_x: i32,
    _physical_y: i32,
    _physical_width: i32,
    _physical_height: i32,
) -> Result<(), String> {
    Ok(())
}
```

- [ ] **Step 2: Create the Windows module skeleton**

Create `desktop/src-tauri/src/commands/appbar_win.rs`:

```rust
//! Windows Shell AppBar integration.
//!
//! Registers the ticker window as a Shell AppBar so maximized
//! windows respect its space. The kernel tracks our HWND as a
//! registered AppBar across calls; we MUST call ABM_REMOVE before
//! the HWND is destroyed or the work area stays shrunk until
//! reboot / explorer restart.
//!
//! Lifecycle:
//!   register()    → ABM_NEW
//!   set_position() → ABM_QUERYPOS → ABM_SETPOS
//!   unregister()  → ABM_REMOVE

use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::UI::Shell::{
    SHAppBarMessage, ABE_BOTTOM, ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS,
    APPBARDATA,
};
use windows_sys::Win32::UI::WindowsAndMessaging::WM_USER;

/// Message ID Windows sends to our WndProc for AppBar notifications.
/// Must be >= WM_USER. Choice of offset is arbitrary; we pick 1
/// to keep it distinct from anything Tauri itself might use.
const APPBAR_CALLBACK_MSG: u32 = WM_USER + 1;

/// Tracks whether the ticker is currently registered as an AppBar.
/// Prevents double-register (which Windows tolerates but logs as
/// noise) and double-unregister (which is silently a no-op).
static REGISTERED: AtomicBool = AtomicBool::new(false);

/// Get the raw HWND from a tauri::Window.
fn hwnd_of(window: &tauri::Window) -> Result<HWND, String> {
    use tauri::Manager;
    window
        .hwnd()
        .map(|h| h.0 as HWND)
        .map_err(|e| format!("failed to get HWND: {e}"))
}

/// Register the ticker as a Shell AppBar.
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

    // TODO Task 4: subclass the WndProc to handle APPBAR_CALLBACK_MSG
    // and to call ABM_REMOVE on WM_DESTROY.
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

    unsafe { SHAppBarMessage(ABM_REMOVE, &mut data) };
    REGISTERED.store(false, Ordering::Relaxed);
    Ok(())
}

/// Set the AppBar position. Must be called after register().
///
/// Coordinates are PHYSICAL pixels (not logical). Caller is
/// responsible for multiplying by scale_factor.
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

    // ABM_QUERYPOS lets the shell adjust our requested rect
    // (e.g. if the taskbar is already on the same edge).
    unsafe { SHAppBarMessage(ABM_QUERYPOS, &mut data) };

    // Re-clamp width/height after the shell may have adjusted left/top.
    // For TOP edge, bottom = top + requested_height.
    // For BOTTOM edge, top = bottom - requested_height.
    match edge {
        ABE_TOP => {
            data.rc.bottom = data.rc.top + physical_height;
        }
        ABE_BOTTOM => {
            data.rc.top = data.rc.bottom - physical_height;
        }
        _ => unreachable!(),
    }

    let result = unsafe { SHAppBarMessage(ABM_SETPOS, &mut data) };
    if result == 0 {
        return Err("SHAppBarMessage(ABM_SETPOS) failed".into());
    }

    // Move the actual window to the rect the shell gave us.
    use tauri::PhysicalPosition;
    use tauri::PhysicalSize;
    window
        .set_position(tauri::Position::Physical(PhysicalPosition {
            x: data.rc.left,
            y: data.rc.top,
        }))
        .map_err(|e| format!("set_position failed: {e}"))?;
    window
        .set_size(tauri::Size::Physical(PhysicalSize {
            width: (data.rc.right - data.rc.left) as u32,
            height: (data.rc.bottom - data.rc.top) as u32,
        }))
        .map_err(|e| format!("set_size failed: {e}"))?;

    Ok(())
}
```

- [ ] **Step 3: Create the macOS module skeleton**

Create `desktop/src-tauri/src/commands/macos_window.rs`:

```rust
//! macOS NSWindow collection behavior + window level.
//!
//! There is no public macOS API for true screen-space reservation
//! (the Dock and menu bar use private CoreGraphics SPI we won't
//! ship). Instead we set the ticker to:
//!   - Appear on every Space (canJoinAllSpaces)
//!   - Not animate during Mission Control (stationary)
//!   - Appear alongside fullscreen apps (fullScreenAuxiliary)
//!   - Skip Cmd+` cycle (ignoresCycle)
//!   - Sit at NSStatusWindowLevel (level 25, same as menu bar)
//!
//! Combined this is the closest macOS analog to a system bar.

#![cfg(target_os = "macos")]

use objc2::msg_send;
use objc2::runtime::AnyObject;

/// NSWindowCollectionBehavior flags we use.
/// Values pulled from <AppKit/NSWindow.h>.
#[allow(non_upper_case_globals)]
mod behavior {
    pub const CanJoinAllSpaces: u64 = 1 << 0;
    pub const Stationary: u64 = 1 << 4;
    pub const IgnoresCycle: u64 = 1 << 6;
    pub const FullScreenAuxiliary: u64 = 1 << 8;
}

/// NSWindowLevel values. Standard headers expose these as constants;
/// we hard-code the numeric values to avoid pulling in the constants
/// crate.
#[allow(non_upper_case_globals)]
mod level {
    pub const NSNormalWindowLevel: i64 = 0;
    pub const NSStatusWindowLevel: i64 = 25;
}

/// Apply "always-visible, all-spaces, fullscreen-aux" behavior.
/// Called when `pinned` becomes true.
pub fn apply_floating_behavior(window: &tauri::Window) -> Result<(), String> {
    let ns_window = ns_window_of(window)?;
    let mask = behavior::CanJoinAllSpaces
        | behavior::Stationary
        | behavior::IgnoresCycle
        | behavior::FullScreenAuxiliary;
    unsafe {
        let _: () = msg_send![ns_window, setCollectionBehavior: mask];
        let _: () = msg_send![ns_window, setLevel: level::NSStatusWindowLevel];
    }
    Ok(())
}

/// Revert to default behavior. Called when `pinned` becomes false.
pub fn clear_floating_behavior(window: &tauri::Window) -> Result<(), String> {
    let ns_window = ns_window_of(window)?;
    unsafe {
        let _: () = msg_send![ns_window, setCollectionBehavior: 0u64];
        let _: () = msg_send![ns_window, setLevel: level::NSNormalWindowLevel];
    }
    Ok(())
}

fn ns_window_of(window: &tauri::Window) -> Result<*mut AnyObject, String> {
    let raw = window
        .ns_window()
        .map_err(|e| format!("ns_window failed: {e}"))?;
    Ok(raw as *mut AnyObject)
}
```

- [ ] **Step 4: Wire the new modules into the commands module**

Read the current `desktop/src-tauri/src/commands/mod.rs`:

```sh
cat desktop/src-tauri/src/commands/mod.rs
```

Then modify it to register the new modules. The file currently exports `auth`, `diagnostics`, `sse`, `system_info`, `window`. Append:

```rust
#[cfg(target_os = "windows")]
pub mod appbar_win;

#[cfg(not(target_os = "windows"))]
#[path = "appbar_stub.rs"]
pub mod appbar_win;

#[cfg(target_os = "macos")]
pub mod macos_window;
```

The `#[path]` trick re-uses the stub file as the `appbar_win` module on non-Windows so the rest of the code can `use crate::commands::appbar_win` unconditionally.

- [ ] **Step 5: Verify the project still compiles**

```sh
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```
Expected: success. The new modules are not yet called by anything.

- [ ] **Step 6: Commit**

```sh
git add desktop/src-tauri/src/commands/appbar_win.rs \
        desktop/src-tauri/src/commands/macos_window.rs \
        desktop/src-tauri/src/commands/appbar_stub.rs \
        desktop/src-tauri/src/commands/mod.rs
git commit -m "feat(desktop): scaffold AppBar and macOS NSWindow modules"
```

---

## Task 3: Add `reserveSpace` preference

**Files:**
- Modify: `desktop/src/preferences.ts:169-175`
- Modify: `desktop/src/preferences.ts:538-544`

- [ ] **Step 1: Extend the WindowPrefs interface**

In `desktop/src/preferences.ts`, change the `WindowPrefs` interface around line 169:

```ts
export interface WindowPrefs {
  pinned: boolean;
  defaultWidth: "full" | "narrow";
  narrowWidth: number;
  skipTaskbar: boolean;
  tickerPosition: TickerPosition;
  /**
   * When true, the ticker registers with the OS as a reserved screen
   * region (Windows: Shell AppBar; macOS: no-op, since macOS has no
   * public API for this — pinning already opts the window into
   * all-Spaces + fullscreen-aux behavior). Default false to preserve
   * the original overlay behavior for existing users.
   */
  reserveSpace: boolean;
}
```

- [ ] **Step 2: Extend the default**

At `desktop/src/preferences.ts:538`, change:

```ts
const DEFAULT_WINDOW: WindowPrefs = {
  pinned: true,
  defaultWidth: "full",
  narrowWidth: 800,
  skipTaskbar: true,
  tickerPosition: "top",
  reserveSpace: false,
};
```

- [ ] **Step 3: Verify the existing deep-merge picks up the new field for old users**

The deep-merge at `desktop/src/preferences.ts:1150` is `{ ...DEFAULT_WINDOW, ...source.window }`. A stored prefs blob without `reserveSpace` will inherit `false` from the default. No explicit migration code is needed.

Run typecheck:
```sh
cd desktop && npm run build
```
Expected: success.

- [ ] **Step 4: Commit**

```sh
git add desktop/src/preferences.ts
git commit -m "feat(desktop): add reserveSpace preference (default off)"
```

---

## Task 4: Subclass the ticker WndProc on Windows

**Files:**
- Modify: `desktop/src-tauri/src/commands/appbar_win.rs`
- Modify: `desktop/src-tauri/Cargo.toml`

This task adds the `WndProc` subclass that handles AppBar notification messages and guarantees `ABM_REMOVE` is called when the HWND is destroyed.

> **Background:** `windows-sys` exposes `SetWindowSubclass`, `RemoveWindowSubclass`, and `DefSubclassProc` from `Win32::UI::Shell`. They take a raw extern function pointer, not a Rust closure, so no procedural macros / extra crates are needed.

- [ ] **Step 1: Add the subclass proc and wire it into `register()`**

Append to `desktop/src-tauri/src/commands/appbar_win.rs`:

```rust
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::Shell::{
    DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass, ABN_FULLSCREENAPP, ABN_POSCHANGED,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WM_DESTROY, WS_EX_TOPMOST,
};

/// Arbitrary subclass ID — must be unique per HWND.
const SUBCLASS_ID: usize = 0xA9B_AppBar; // 'AppBar' mnemonic

unsafe extern "system" fn appbar_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid_subclass: usize,
    _dw_ref_data: usize,
) -> LRESULT {
    if msg == APPBAR_CALLBACK_MSG {
        match wparam as u32 {
            ABN_FULLSCREENAPP => {
                // lparam == 1 → fullscreen app entered
                // lparam == 0 → fullscreen app left
                let entering = lparam != 0;
                let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let new_style = if entering {
                    style & !(WS_EX_TOPMOST as isize)
                } else {
                    style | (WS_EX_TOPMOST as isize)
                };
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
            }
            ABN_POSCHANGED => {
                // Another AppBar moved. We could re-query our own
                // position here; for now we trust the next user-
                // initiated position_ticker call to fix things up.
            }
            _ => {}
        }
        return 0;
    }

    if msg == WM_DESTROY {
        // Last-chance unregister so we don't orphan the reservation.
        let mut data: APPBARDATA = std::mem::zeroed();
        data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
        data.hWnd = hwnd;
        SHAppBarMessage(ABM_REMOVE, &mut data);
        REGISTERED.store(false, Ordering::Relaxed);
        RemoveWindowSubclass(hwnd, Some(appbar_subclass_proc), SUBCLASS_ID);
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}
```

Note the magic number `0xA9B_AppBar` — Rust accepts underscores in integer literals, but `AppBar` isn't valid hex. Replace with a real constant:

```rust
const SUBCLASS_ID: usize = 0xA9B_0001;
```

- [ ] **Step 2: Install the subclass during `register()`**

In `register()`, after the `ABM_NEW` call succeeds and before the return, add:

```rust
    unsafe {
        SetWindowSubclass(hwnd, Some(appbar_subclass_proc), SUBCLASS_ID, 0);
    }
```

- [ ] **Step 3: Verify build**

```sh
cargo check --manifest-path desktop/src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

On non-Windows hosts, do at minimum:
```sh
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```
Expected: clean compile on the host platform (Windows code is gated and only meaningful when targeting Windows).

- [ ] **Step 4: Commit**

```sh
git add desktop/src-tauri/src/commands/appbar_win.rs
git commit -m "feat(desktop): subclass AppBar WndProc for fullscreen-app and destroy"
```

---

## Task 5: Wire AppBar into `position_ticker` and `pin_window`

**Files:**
- Modify: `desktop/src-tauri/src/commands/window.rs`

- [ ] **Step 1: Add `reserve_space: bool` parameter to `position_ticker`**

Change the signature in `desktop/src-tauri/src/commands/window.rs:13`:

```rust
#[tauri::command]
pub fn position_ticker(
    window: tauri::Window,
    position: String,
    height: Option<f64>,
    reserve_space: Option<bool>,
) -> Result<(), String> {
```

The `Option<bool>` keeps backward compatibility with callers that haven't been updated; treat `None` as `false`.

- [ ] **Step 2: Branch into the AppBar path on Windows when `reserve_space` is true**

Replace the `Compositor::Fallback` arm at `desktop/src-tauri/src/commands/window.rs:71-77` with a Windows-aware version:

```rust
        Compositor::Fallback => {
            #[cfg(target_os = "windows")]
            {
                if reserve_space.unwrap_or(false) {
                    use crate::commands::appbar_win;
                    // Ensure registered (idempotent)
                    appbar_win::register(&window)?;
                    // AppBar needs PHYSICAL pixels
                    let phys_x = (monitor_x * scale) as i32;
                    let phys_y = (new_y * scale) as i32;
                    let phys_w = (screen_width * scale) as i32;
                    let phys_h = (win_height * scale) as i32;
                    return appbar_win::set_position(
                        &window, &position, phys_x, phys_y, phys_w, phys_h,
                    );
                }
                // reserve_space=false on Windows: ensure we are NOT
                // registered so a previous opt-in is undone.
                use crate::commands::appbar_win;
                let _ = appbar_win::unregister(&window);
            }

            // Default GTK/AppKit path (also Windows non-reserve mode)
            let _ = window.set_size(tauri::LogicalSize::new(screen_width, win_height));
            window
                .set_position(tauri::LogicalPosition::new(monitor_x, new_y))
                .map_err(|e| format!("set_position failed: {e}"))
        }
```

- [ ] **Step 3: Apply macOS floating behavior in `pin_window`**

Replace `pin_window` at `desktop/src-tauri/src/commands/window.rs:91-101`:

```rust
#[tauri::command]
pub fn pin_window(window: tauri::Window, pinned: bool) -> Result<(), String> {
    let result = match compositor::detect() {
        Compositor::Hyprland => compositor::hyprland::pin(&window, pinned),
        Compositor::Sway => compositor::sway::pin(&window, pinned),
        Compositor::Kwin(qdbus) => compositor::kwin::pin(&window, pinned, qdbus),
        Compositor::Fallback => window
            .set_always_on_top(pinned)
            .map_err(|e| format!("set_always_on_top failed: {e}")),
    };

    // macOS: also flip the NSWindow collection behavior so the
    // ticker shows up across all Spaces and alongside fullscreen
    // apps. Independent of compositor (macOS is always Fallback).
    #[cfg(target_os = "macos")]
    {
        use crate::commands::macos_window;
        if pinned {
            let _ = macos_window::apply_floating_behavior(&window);
        } else {
            let _ = macos_window::clear_floating_behavior(&window);
        }
    }

    result
}
```

- [ ] **Step 4: Register `position_ticker`'s new signature in the invoke handler**

No change needed — the handler in `lib.rs:80-94` references the function by name, not by signature. Tauri picks up the new parameter automatically.

- [ ] **Step 5: Build**

```sh
cargo build --manifest-path desktop/src-tauri/Cargo.toml
```
Expected: success.

- [ ] **Step 6: Commit**

```sh
git add desktop/src-tauri/src/commands/window.rs
git commit -m "feat(desktop): wire AppBar and macOS NSWindow into window commands"
```

---

## Task 6: Unregister AppBar on app exit

**Files:**
- Modify: `desktop/src-tauri/src/lib.rs`

The AppBar API requires `ABM_REMOVE` before the process exits, or the work area stays shrunk. The `WM_DESTROY` subclass handler from Task 4 covers normal window destruction, but it doesn't fire if the app exits without destroying the window first (rare but possible with `app.exit()`).

- [ ] **Step 1: Add an exit-event hook**

In `desktop/src-tauri/src/lib.rs`, find the `app.run(...)` call near line 151. Add an `Exit` event branch:

```rust
    app.run(|app_handle, event| {
        // ── AppBar cleanup on Windows ────────────────────────────
        // We MUST call ABM_REMOVE before the process exits or the
        // shrunk work area persists until explorer restart.
        #[cfg(target_os = "windows")]
        {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                if let Some(ticker) = app_handle.get_webview_window("ticker") {
                    use crate::commands::appbar_win;
                    let _ = appbar_win::unregister(&ticker.as_ref().window());
                }
            }
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
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            let _ = &app_handle;
            let _ = &event;
        }
    });
```

Note: the existing `#[cfg(not(any(target_os = "macos", target_os = "ios")))]` block ends with `let _ = &event;`. We move the `event` reference into the Windows block above so we don't get an unused-variable warning on Windows. Re-verify the final structure before saving.

- [ ] **Step 2: Verify build**

```sh
cargo build --manifest-path desktop/src-tauri/Cargo.toml
```
Expected: success on host platform. Cross-build for Windows happens in CI.

- [ ] **Step 3: Commit**

```sh
git add desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): unregister AppBar on app exit (Windows)"
```

---

## Task 7: Frontend — pass `reserveSpace` to Rust commands

**Files:**
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: Update both `position_ticker` invocations in App.tsx**

`desktop/src/App.tsx` calls `invoke("position_ticker", ...)` in three places (around lines 273-275 for prefs sync, 309 for initial setup, 327 for resize). Each call needs `reserveSpace` added.

For the prefs-sync handler around line 269:

```ts
      // Side effects: ticker position
      if (next.window.tickerPosition !== prev.window.tickerPosition
          || next.window.reserveSpace !== prev.window.reserveSpace) {
        setTickerPosition(next.window.tickerPosition);
        savePref("tickerPosition", next.window.tickerPosition);
        const rowCount = next.appearance.tickerLayout.rows.length;
        const h = Math.round(TICKER_HEIGHTS[next.ticker.tickerMode] * rowCount * (next.appearance.uiScale / 100));
        invoke("position_ticker", {
          position: next.window.tickerPosition,
          height: h,
          reserveSpace: next.window.reserveSpace,
        }).catch(() => {});
      }
```

For the initial-setup `useEffect` around line 305:

```ts
    if (tickerH > 0) {
      invoke("position_ticker", {
        position: tickerPosition,
        height: tickerH,
        reserveSpace: prefs.window.reserveSpace,
      })
        .then(() => getCurrentWindow().show())
        .catch(() => {});
    }
```

For the resize-on-change `useEffect` around line 325, add `prefs.window.reserveSpace` to the deps array and pass it in the invoke:

```ts
  useEffect(() => {
    const rowCount = prefs.appearance.tickerLayout.rows.length;
    const tickerH = prefs.ticker.showTicker
      ? Math.round(TICKER_HEIGHTS[prefs.ticker.tickerMode] * rowCount * (prefs.appearance.uiScale / 100))
      : 0;
    if (tickerH > 0) {
      invoke("position_ticker", {
        position: tickerPosition,
        height: tickerH,
        reserveSpace: prefs.window.reserveSpace,
      }).catch(() => {});
    }
  }, [
    prefs.ticker.tickerMode,
    prefs.appearance.tickerLayout.rows.length,
    prefs.appearance.uiScale,
    prefs.ticker.showTicker,
    prefs.window.reserveSpace,
    tickerPosition,
  ]);
```

- [ ] **Step 2: Typecheck**

```sh
cd desktop && npm run build
```
Expected: success.

- [ ] **Step 3: Commit**

```sh
git add desktop/src/App.tsx
git commit -m "feat(desktop): pass reserveSpace to position_ticker invocations"
```

---

## Task 8: Settings UI for the toggle

**Files:**
- Modify: locate the existing window/ticker settings tab and add a toggle there

- [ ] **Step 1: Find the settings tab that owns `window.tickerPosition`**

```sh
rg "window\.tickerPosition" desktop/src/components --files-with-matches
```

Expected: one or two files in `desktop/src/components/settings/`. Open the one that renders a toggle/select for `tickerPosition`. This is the right place for the new `reserveSpace` toggle, since they're semantically grouped.

- [ ] **Step 2: Add the toggle UI**

Use the same `Switch` / `Toggle` / `Checkbox` component already used for `pinned` and `skipTaskbar` in that file. Match the existing layout pattern — don't introduce a new component. The label and help text:

```tsx
<SettingRow
  label="Reserve screen space"
  help={
    <>
      Tells the OS to treat the ticker like the taskbar.
      Maximized windows will no longer overlap the ticker.
      Windows only — macOS has no API for this. <br />
      <strong>Off by default.</strong> Toggle on to reclaim your maximized windows.
    </>
  }
>
  <Toggle
    checked={prefs.window.reserveSpace}
    onChange={(value) =>
      updatePrefs({ window: { ...prefs.window, reserveSpace: value } })
    }
  />
</SettingRow>
```

(Adapt component names + prop shapes to match whatever the existing settings rows use. Read the surrounding rows first.)

- [ ] **Step 3: Gate visibility to non-Linux (optional, recommended)**

The toggle is meaningless on Linux until we implement the Wayland reserve-space path. Hide the row on Linux:

```tsx
{!isLinux && (
  <SettingRow label="Reserve screen space" ...>
    ...
  </SettingRow>
)}
```

Detect the platform via `@tauri-apps/plugin-os` (already a dependency check in `package.json`) or via a `useEffect` that calls `platform()` from `@tauri-apps/plugin-os`.

- [ ] **Step 4: Typecheck and dev-test**

```sh
cd desktop && npm run build
```
Then run:
```sh
cd desktop && npm run tauri:dev
```
Toggle the new setting. Expected: ticker re-positions, and on Windows, maximized windows now stop at the ticker's bottom edge instead of going underneath.

- [ ] **Step 5: Commit**

```sh
git add desktop/src/components/settings/
git commit -m "feat(desktop): add 'Reserve screen space' settings toggle"
```

---

## Task 9: Manual QA checklist

This is not code — it's a manual verification pass before shipping. Run on each platform.

**Windows:**

- [ ] Toggle "Reserve screen space" ON → maximize a browser window → verify the maximized window's bottom edge stops at the top of the ticker (assuming ticker is at top).
- [ ] Move the ticker from top to bottom → verify maximized windows re-snap to the new reserved area without a manual maximize/restore cycle.
- [ ] Open a fullscreen app (e.g., F11 in browser, or a fullscreen game) → verify the ticker hides itself (the `WS_EX_TOPMOST` clear we do on `ABN_FULLSCREENAPP`).
- [ ] Leave fullscreen → verify the ticker reappears on top.
- [ ] Toggle "Reserve screen space" OFF → verify the work area returns to normal (drag any maximized window — its full-screen extent should now include the ticker's old space).
- [ ] Hide the ticker (right-click → Hide Ticker) → verify the work area is released (no leftover dead zone).
- [ ] Quit the app via tray "Quit" → reopen any window manager / explorer → verify the work area is fully restored. **This is the critical leak test.** If it fails, the `Exit` event hook in Task 6 didn't fire correctly.
- [ ] Multi-monitor: drag the ticker to a different monitor and toggle reserve-space → verify reservation moves with the ticker. (Acceptable failure mode: reservation only applies on the monitor the ticker was on at register time. If broken, file a follow-up; not a blocker.)
- [ ] DPI scaling: set Windows display scaling to 150% → toggle reserve-space → verify the AppBar rect lands on the correct pixel boundary (no gap or overlap with maximized windows).

**macOS:**

- [ ] Toggle "Pin on Top" ON → switch Spaces (Ctrl+→ / Ctrl+←) → verify the ticker follows you to every Space.
- [ ] Enter Mission Control → verify the ticker is stationary (doesn't slide along with other windows).
- [ ] Open an app in fullscreen (green button) → switch to the fullscreen Space → verify the ticker is visible alongside the fullscreen app.
- [ ] Toggle "Pin on Top" OFF → verify the ticker reverts to a normal window (no longer on all Spaces, no longer above fullscreen apps).
- [ ] The settings row for "Reserve screen space" should explain it's Windows-only or be hidden on macOS (depending on Task 8 step 3).

**Linux (smoke test — no behavioral change expected):**

- [ ] Toggle "Reserve screen space" on each compositor (Hyprland / Sway / KWin / GNOME) → verify nothing breaks. The `appbar_stub.rs` no-op should make this invisible.
- [ ] Existing Wayland behaviors (pin, position) should be unchanged.

- [ ] **Final commit (if any docs need updating)**

```sh
git add docs/
git commit -m "docs(desktop): note Windows AppBar reserve-space mode"
```

---

## Risks and Followups

1. **AppBar leak on crash.** If the desktop app crashes hard (segfault, force-killed via Task Manager), neither `WM_DESTROY` nor our `Exit` hook fires, and the work area stays shrunk until logout or explorer restart. There's no robust solution — the Windows taskbar itself has this problem. Mitigation: on next launch, before re-registering, send `ABM_REMOVE` once unconditionally to clear any orphan. Add this as a small follow-up to Task 2's `register()`.
2. **Multi-monitor.** Initial release pins to whichever monitor the ticker was on at register time. Moving the ticker to another monitor while reserve-space is on does *not* migrate the reservation. Documented in QA; followup work tracked separately.
3. **Wayland reserve-space.** Hyprland has `layer-shell` (`anchor top`), Sway has `swaybar`-style protocol, KWin has the `wl_shell` plasma protocol. All three need separate implementations. Defer to a Phase 2 plan.
4. **macOS App Store rejection risk.** The collection-behavior + status-window-level approach uses only public AppKit API. Should pass MAS review. The `FullScreenAuxiliary` flag in particular has been public since 10.7.
5. **`AppKit::NSStatusWindowLevel` over the menu bar.** Some users may find this aggressive (the ticker can cover the menu bar on macOS during edge cases). If reports come in, drop the level to `NSFloatingWindowLevel` (level 3) — still above normal windows, but below the menu bar.
