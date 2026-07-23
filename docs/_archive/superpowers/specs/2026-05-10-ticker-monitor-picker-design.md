# Ticker Monitor Picker — Design

**Date:** 2026-05-10
**Status:** Spec — pending implementation plan
**Scope:** Single-monitor selection for the ticker window. Per-monitor configurability and one-ticker-per-monitor are explicit non-goals (backlog).

## Problem

Today the ticker window's monitor is decided by Tauri at app startup — typically the OS primary monitor or whichever one Tauri's underlying windowing toolkit defaults to. The user has no control. On a multi-monitor setup this means the ticker shows up on a screen the user might not be looking at and they can't move it.

The user has confirmed they want two things, but agreed to ship the smaller piece first:

1. **(this spec)** Pick which monitor the ticker shows on, persist across launches.
2. **(deferred to backlog)** Optionally have a ticker on each monitor simultaneously, mirroring identical content.

The bigger design (Approach A — dynamic windows reconciled by monitor fingerprint) is the right architecture for #2 but not worth the multi-day investment until there's demand. This spec covers a strict subset of that architecture; nothing here needs to be thrown away to extend it later.

## Out of Scope

- One-ticker-per-monitor (multiple windows simultaneously) — backlog
- Per-monitor independent ticker configuration (different rows / data per screen) — backlog
- Per-monitor positions for the main app window — backlog
- Hot-plug auto-reconciliation (monitor unplugged/replugged at runtime) — limited handling only; full handling lives in Approach A

## User-Facing Behavior

### Settings UI

A new row in `Settings → General` (the existing `GeneralSettings.tsx` component, beneath "Always on top" and "Position"):

```
Display monitor          [▼ Built-in Display (1920×1080) · Primary    ]
                          Reset to primary
```

The dropdown lists every monitor currently connected:

- Each row labeled `${name} · ${width}×${height}`
- The OS primary monitor gets a small `Primary` badge
- The currently-selected monitor (whether by user pick or by fallback) is highlighted

When the user changes the selection, the ticker moves to the new monitor immediately. The choice persists across launches via the existing prefs store.

A small `Reset to primary` link below the dropdown sets the pref back to `null` (= "follow primary"), useful for users who picked a monitor that no longer exists.

### Default and Migration Behavior

- Fresh install: `tickerMonitorId = null`. Ticker spawns on the OS primary, same as today.
- Existing v1.0.12 install upgrading to v1.0.13: `tickerMonitorId` field is missing from prefs, reads as `null`. Ticker stays on whatever monitor Tauri picked at install time (effectively the primary). **No surprise behavior change for existing users.**

### Saved Monitor Disappears

When a saved `tickerMonitorId` doesn't match any currently-connected monitor (e.g. the user unplugged it, or the OS renamed it after a major update), the fallback ladder runs:

1. Exact fingerprint match (name + position + size + scale)
2. Name-only match (handles small position/size shifts)
3. Position-only match (handles renamed displays)
4. Fall back to OS primary

The fallback happens silently — no notification, no prompt. Users will see their ticker on the primary and can repick from settings if they want. This mirrors the user's stated preference for "predictable, simple failure mode" over a more accurate but noisier prompt-the-user approach.

### Hot-Plug at Runtime (Known Limitation)

If the user unplugs the active monitor while the app is running, the ticker behaves however Tauri / the underlying compositor handles an orphaned window — typically jumps to the primary monitor on macOS and Windows; on Wayland it depends on the compositor. We do not poll for monitor changes in this version. The user can repick from settings if the result is wrong.

The full Approach A design (deferred backlog item) addresses this with a 5-second reconciliation poll.

## Architecture

### Data Model

```ts
// preferences.ts: WindowPrefs
interface WindowPrefs {
  // ...existing fields
  /**
   * Stable hash identifying the user's chosen monitor for the ticker.
   * `null` = follow the OS primary monitor (default).
   *
   * Hash is sha256-truncated-to-16-hex of `{name}|{x},{y}|{w}x{h}` —
   * computed in Rust, opaque to JS. Schema-stable across upgrades to
   * the future multi-monitor design (`tickerMonitorIds: string[]`).
   */
  tickerMonitorId: string | null;
}
```

Default: `tickerMonitorId: null`. Migration: missing field reads as `null` (existing prefs migrator is field-by-field tolerant).

### New Backend Commands

In `desktop/src-tauri/src/commands/window.rs`:

```rust
#[derive(Serialize)]
pub struct MonitorInfo {
    /// Stable fingerprint hash; opaque identifier the JS side persists.
    pub id: String,
    /// Human-readable name from the OS, or "" if unavailable.
    pub name: String,
    /// Logical position (top-left corner) in the OS's virtual screen space.
    pub x: i32,
    pub y: i32,
    /// Logical dimensions (already divided by scale_factor).
    pub width: u32,
    pub height: u32,
    /// HiDPI scale factor (1.0 on normal displays, 2.0 on retina, etc.).
    pub scale: f64,
    /// True iff this is the OS primary monitor.
    pub is_primary: bool,
}

#[tauri::command]
pub fn list_monitors(window: tauri::Window) -> Result<Vec<MonitorInfo>, String> { ... }

#[tauri::command]
pub fn move_ticker_to_monitor(
    window: tauri::Window,
    monitor_id: Option<String>,
) -> Result<(), String> { ... }
```

`list_monitors` enumerates `window.available_monitors()` plus `window.primary_monitor()` for the `is_primary` flag. Order: primary first, then the rest in OS-reported order. Computes the fingerprint per the rule above.

`move_ticker_to_monitor` takes the saved id (or `None` for "follow primary"), runs the fingerprint match ladder against `available_monitors()`, picks the chosen monitor, then:

1. Computes the target geometry (logical x/y/width derived from the monitor, height taken from the existing ticker outer_size).
2. On Wayland (Hyprland / Sway / KDE), delegates to the compositor adapter's `position()` function with the cross-monitor coords (those adapters already use absolute coordinates that span multi-display setups).
3. On macOS / Windows / X11 / GNOME: GTK fallback path — `set_size()` then `set_position()`, same as the existing `position_ticker` command.
4. Then re-runs the existing `position_ticker(top|bottom, height)` flow to snap to the chosen edge of the new monitor.

The implementation can call into `position_ticker` directly to share the edge-snapping logic — `position_ticker` already queries `current_monitor()` per call, so once we've moved the window to the new monitor, asking position_ticker to snap will Just Work.

### Backend Initialization Hook

In `desktop/src-tauri/src/lib.rs::setup`, after the existing ticker initial sizing (line ~111), call `move_ticker_to_monitor` with the saved pref. Loaded at startup from the JS-side store via a one-time IPC roundtrip; if the pref is missing/null, we leave the ticker on Tauri's default monitor (the existing behavior).

Concretely: rather than reading prefs from Rust (we don't have access to the LazyStore in Rust without plumbing), we let the JS side fire `move_ticker_to_monitor` from `App.tsx` once it has bootstrapped prefs. This is the pattern already used for `position_ticker` (see `App.tsx:325`) — same one-trip dance, no new infrastructure.

### Frontend Wiring

`desktop/src/api/queries.ts`: new query `monitorsQueryOptions()` calling `invoke("list_monitors")`. `staleTime: 5_000` and `refetchOnMount: "always"` (so each time the user opens the General Settings page the monitor list is freshly enumerated; cheap because the underlying enumeration is <1ms).

`desktop/src/App.tsx`: subscribe to `tickerMonitorId` changes alongside the existing `tickerPosition` subscription (around `App.tsx:290`). On change, invoke `move_ticker_to_monitor`. On initial mount, after prefs are loaded, fire one `move_ticker_to_monitor` call with the saved value.

`desktop/src/components/settings/GeneralSettings.tsx`: add the new row beneath the existing position controls. Use a `<select>` (matches the existing settings idiom — `SegmentedRow` is for short option lists, but monitor lists can be 1–6+ items, so a dropdown is the right fit). Below the dropdown, a small `Reset to primary` button that sets `tickerMonitorId = null`.

### Compositor Adapter Notes

The existing Wayland adapters (`hyprland.rs`, `sway.rs`, `kwin.rs`) already accept absolute screen coordinates spanning multiple outputs:

- **Hyprland** `hyprctl dispatch movewindowpixel exact <x> <y>` works across outputs.
- **Sway** `swaymsg move absolute position <x> <y>` works across outputs.
- **KDE/KWin** `frameGeometry` accepts absolute Qt screen coords spanning all screens.

**No adapter changes expected.** Risk: I'll verify each path during implementation by checking the upstream docs / running on a multi-monitor Wayland session if available. If any adapter needs explicit output selection (e.g. KDE's `clientArea` may need an output index), I'll add it.

## Testing

### Unit Tests (Rust)

- `compute_fingerprint`: identical input → identical output; varying any field → different output. Determinism check.
- `match_monitor_fallback_ladder`: given a saved id and a list of available monitors, returns:
  - the exact match if present
  - the name-only match if the exact-fingerprint match fails
  - the position-only match if name fails
  - the primary if all fail
- These all live in a new `monitors.rs` module under `commands/` so they're isolated and pure.

### E2E via MCP

(Performed during the implementation session, documented in the PR description rather than as automated tests.)

1. Open dev MCP session.
2. Invoke `list_monitors` from JS — confirm the return shape and at least one monitor.
3. Open settings, screenshot the new dropdown.
4. Pick a non-default monitor — screenshot ticker visibly on the new monitor.
5. Restart the app — confirm ticker spawns on the picked monitor.
6. (If multi-monitor available) Disconnect and reconnect — confirm ticker falls back to primary, then doesn't auto-restore (acknowledged limitation).

### No New JS Unit Tests

The frontend changes are all wiring (settings UI, pref subscription) — no new pure logic worth a Vitest suite. The existing `preferences.test.ts` will need an entry confirming the migration default for `tickerMonitorId` is `null`; one assertion in the existing test file.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Wayland compositor adapter doesn't honor cross-monitor coords | Verify each path during implementation; fall back to GTK if a specific adapter fails. Matrix: Hyprland ✓, Sway ✓, KDE/KWin ✓ (per upstream docs); X11/GNOME use GTK fallback (already cross-monitor capable). |
| Fingerprint collisions between identical monitors (two of the same external display) | Position is part of the fingerprint, so two same-model displays at different positions get different ids. The collision case — two identical displays mirroring each other at the same coords — is degenerate and we don't optimize for it. |
| User picks a monitor, then the OS renames or repositions it (e.g. macOS update) | Fallback ladder catches name-only and position-only matches. Total miss falls back to primary. |
| Existing v1.0.12 users see unexpected change after upgrade | Migration is "missing field = null = follow primary". Behavior is identical to today's. Verified by the migration default in `preferences.ts`. |
| `list_monitors` returns nothing on a brand-new boot before display server is ready | The settings UI only calls `list_monitors` when the user opens the General Settings page, by which time the display server is fully up. Startup move-to-monitor uses the saved id; if `available_monitors()` is empty for some reason, the fallback ladder hits primary which is also empty, and we leave the ticker where it is. Unlikely to actually happen but handled. |

## Open Questions

None for this scope. The Approach A multi-ticker design (deferred) has its own question set; documented in the backlog.

## Estimated Effort

~80–120 LOC of new code split across:
- `commands/window.rs`: +60 (two new commands)
- `commands/monitors.rs`: +40 (fingerprint + match ladder, with unit tests)
- `lib.rs`: 0 (no startup changes — JS handles the initial move via existing pattern)
- `App.tsx`: +15 (subscription + initial-fire)
- `GeneralSettings.tsx`: +30 (new row + dropdown + reset button)
- `preferences.ts`: +5 (new field, migration)
- `api/queries.ts`: +10 (monitor list query)
- `preferences.test.ts`: +5 (migration assertion)

Estimated: 1–2 hours of focused work + MCP-driven verification. Same shape as the smaller fixes shipped this session.

## Out-of-Scope Items Captured for Future Work

These are explicitly NOT in this spec but stay relevant for the eventual multi-ticker design:

- Dynamic window lifecycle (spawn/despawn ticker windows based on prefs)
- Reconciliation poll loop (5s interval to detect monitor hot-plug/unplug)
- Per-monitor configuration (different rows/data per ticker)
- Settings UI multi-select instead of single dropdown
- Schema migration `tickerMonitorId: string | null` → `tickerMonitorIds: string[]`

These will form a separate spec when there's demand.
