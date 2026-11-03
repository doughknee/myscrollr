| Source / lifecycle | Total network loss | Rate limiting | Server errors / malformed data | Auth expiry | Suspend / resume / topology |
|---|---|---|---|---|---|
| Core dashboard: finance, sports, RSS; shared SSE | DEGRADED (O1) | DEGRADED (O1) | DEGRADED (O1) | OK (O2; existing recovery path) | DEGRADED (O1, R1) |
| Public finance market used to top up Pages | DEGRADED (O3) | DEGRADED (O3) | DEGRADED (O3) | OK (O3; public) | DEGRADED (O3) |
| Weather / GitHub / uptime store-fed utilities | DEGRADED (O4) | DEGRADED (O4) | DEGRADED (O4) | OK (O2/O4; GitHub only) | DEGRADED (O4) |
| Clock, timer, native system metrics | OK (O5; local) | OK (O5; no HTTP) | DEGRADED (O5; IPC failures retain data) | OK (O5; local) | OK (O5; code inspection only) |
| Native monitor map, saved display mode, placement | OK (O6; local) | OK (O6; no HTTP) | DEGRADED (R2; native failure) | OK (O6; independent) | BROKEN (R1); DEGRADED (R2, O6) |

# Fill resilience review

Scope: PR #529 at inventory revision `75a74c4b` versus `origin/main`. Read-only implementation audit of Fill lifecycle and shared ticker behavior affected by Fill. No source changes, native UI manipulation, service starts, dependency installation, cargo, commits, or Linear writes. Severity: P0 review blocker, P1 fix before release, P2 backlog.

The matrix describes code paths, not successful injected network/native failure tests. `OK` means the inspected path has an applicable existing recovery mechanism or is independent of that failure mode; it is not a platform certification. O1–O6 are observations and boundaries, not extra issue requests for unrelated inherited networking behavior.

## R1 — P1: A docked follower entering Fill can leave the remaining docked leader held forever

**Locations:** `desktop/src/App.tsx:806`; `desktop/src/components/pages/PagedBar.tsx:580-584`, `:610-616`; `desktop/src/components/pages/activeHover.ts:44-45`, `:55`.

**Code proof / reproduction:**

1. Have two selected displays in Pages/Docked, with `ticker` the docked leader and `ticker-2` a follower.
2. Activate the pointer on the follower. It emits `pages:hover {label: "ticker-2", on: true}`; the leader adds that label to `remoteHover`.
3. While that hover is active, change that display to Fill through the settings/state path without a prior pointer-leave event. This can be exercised deterministically in a component harness; keyboard-driven main-window settings with the pointer remaining over the ticker is the interactive case to verify.
4. The new key in `App.tsx:806` unmounts the old docked `PagedBar`. `useActiveHover` disposes its timer, but `dispose()` never sends the matching `on: false`. The new Fill bar is independent and does not send docked hover transitions.
5. The surviving leader has no expiry or membership reconciliation for `remoteHover`, so `heldRef` remains true and its automatic page clock stops indefinitely. Local pointer movement on that leader does not remove the orphan label.

**Read-only executed proof:** Transpiled the actual `activeHover.ts` in memory using the repository's TypeScript dependency; ran `move(); dispose()` with fake timers. Result:

```json
{"eventsAfterFollowerUnmount":[true],"pendingReleaseTimers":0,"leaderRemoteHoverRemainsTrue":true}
```

The helper leak is confirmed. Full native two-window keyboard interaction was deliberately not performed. This matters to this PR because mode changes now remount a follower without closing its native window; the old close/hotplug case also lacked a remote-hover lease.

**Suggested fix:** Release an active hover during unmount before disposing its timer; also expire/prune remote holds belonging to closed, suspended, or no-longer-docked participants. Add a focused regression covering a held docked follower transitioning to independent Fill while its old leader remains mounted. Verify both remaining docked pages and Fill keep advancing after five idle seconds, matching CHIP_SPEC P.16.

## R2 — P2: Placement failure can hide its own recovery message and has no automatic retry

**Locations:** `desktop/src/hooks/useTickerDisplay.ts:45-61`, `:69-70`; `desktop/src/components/TickerSurface.tsx:54`, `:99-107`; `desktop/src-tauri/src/commands/window.rs:136-154`, `:158-168`; `desktop/src-tauri/tauri.conf.json:60-69` (ticker starts hidden).

**Code proof / reproduction:** Start with a newly created or previously suspended hidden ticker assigned to Fill. Let `ticker_display` resolve normally but make the first `position_ticker` call fail once (for example, a transient compositor placement error; mock this IPC failure in a hook test). `win.show()` is after that call, so it is skipped. The catch only sets the error state. That message is inside the ticker's own hidden webview, so the user cannot see its instruction to open Scrollr and reselect a display.

After the native failure clears, there is no scheduled retry. The hook only runs again for a relevant preference change or `ticker-reposition`; the native monitor poll only emits when the enumerated monitor description changes. A stable attached monitor therefore cannot recover by waiting. When failure precedes `ticker_display` success, the default docked branch also drops the error entirely.

**Suggested fix:** Surface per-display placement failure and a Retry action in the main settings window, and optionally retry transient placement failures with a bounded, coalesced backoff. Keep the existing suspended/no-primary-Fill behavior; do not show a failed fullscreen window on an arbitrary fallback monitor. A hook test should fail the first placement, recover the next, and confirm that the error is reachable and recovery does not require toggling an unrelated preference.

**Confidence / limitation:** The error-control flow is confirmed by inspection; no real compositor fault was induced. Impact depends on a native failure, so this is P2 rather than a claim that ordinary Windows placement currently fails.

## Inspected paths and boundaries

### O1 — Dashboard and SSE retain the existing delivery contract

`routes/__root.tsx:265-278` polls `dashboardQueryOptions()` and broadcasts the dashboard to the store. `App.tsx:97-118` keeps its query cache and applies main-window broadcasts; `useDashboardCDC` updates the same cache. `api/queries.ts:58-104` takes authenticated `/dashboard`, falling back to `/public/feed`. `api/client.ts:44-80` supplies a 15-second request-stage timeout and JSON/error handling; `query.ts:20` sets one query retry. Successful JSON is typed, not runtime schema-validated. Fill receives the same `dashboard` and widget data as Docked (`App.tsx:762-851`), with no new backend API.

The shared SSE hook lives outside the Fill/PagedBar keyed subtree. `lib/windowRole.ts:42-45` keeps the process owner as `ticker`, independent of docked page leadership. `commands/window.rs:276` retains at least that window when all dedicated displays disappear. `useSharedSSE.ts:60-74` gates start/stop by ownership; Fill changes do not create one stream per display.

Network failures can retain cached values without a Fill-wide stale/error indicator. Existing SSE retries use 1/2/4/8/16/30-second delays (`commands/sse.rs:176-178`), without jitter or Retry-After handling; this PR does not alter that behavior. The 10 MB stream buffer and repeated-overflow exit are existing safeguards. Unrelated transport/backend shortcomings are outside this review's issue scope.

### O2 — Authentication still recovers outside the presentation subtree

`api/client.ts:149-203` gets a valid token and retries a 401 once after refresh. `auth.ts:516-594` keeps per-window refresh single-flight, rechecks shared token state, persists rotated credentials before returning, and preserves auth on network failure. `useSharedSSE.ts:110-124` lets only the owner reopen after `auth-expired`. Fill unmounts/remounts Pages, not the auth/SSE hooks, so no new duplicate auth or stream owner was identified.

`App.tsx:280-326` follows auth-store changes; the existing signed-out/public and signed-in-empty branches still reach Fill. The main window remains the sign-in recovery surface. No live account-expiry test was run.

### O3 — Public market fill is the existing query, with more potential consumers

`PagedBar.tsx:450-461` calculates grid capacity before deciding whether a watchlist is short, then uses `financeMarketOptions` (`api/queries.ts:211-219`, `/finance/public`, 30-second refresh). A larger grid can legitimately need public top-up when a docked row would not. Query deduplication is per webview, because each window constructs its own QueryClient (`main.tsx:38`, `query.ts:3-5`); this is not a new SSE connection.

The first page waits while the market query is pending, and its failure releases that wait; missing quotes degrade to the existing pool. There is no added Fill-specific retry or error presentation. Offline/429/invalid JSON and wake behavior use the existing query path. This audit did not perform network fault injection or audit upstream quota policy.

### O4 — Existing store-fed utilities

Weather: main `weatherQueryOptions` → `fetchWeather` → Open-Meteo → saved city store → `useWidgetTickerData` → shared EdgeZone. `api/queries.ts:252-286` uses all-settled, preserves old city weather on failure, and polls every ten minutes. `widgets/weather/types.ts:141-182` parses provider fields. Fill adds no fetch.

GitHub: main `githubBoardQuery` → existing authenticated board/runs route → `saveBoard` → ticker store listener → shared cells. `widgets/github/types.ts:138-149` polls every minute with one retry; `routes/__root.tsx:479-486` owns the shell observer. Fill adds no shell observer.

Uptime: existing `widgets/uptime/FeedTab.tsx:68-75` fetches Kuma status; `widgets/uptime/types.ts:138-183` combines page and heartbeat endpoints; the ticker reads the saved monitor store through `useWidgetTickerData`. Its refresh coverage remains inherited from the widget's existing behavior. Fill does not turn this cache reader into a new remote poller.

These retain values or placeholders under failure and have no new Fill-specific stale/retry surface. Provider schema/timeout/rate-limit behavior was traced to these existing boundaries, not expanded into unrelated backend or utility fixes.

### O5 — Timers and local sensors

`useWidgetTickerData` computes clocks/timers from current wall time; its one-second intervals are cleared on cleanup. Native metrics keep the prior sample after IPC failure. Fill shares these hooks and does not multiply them beyond the pre-existing one-ticker-per-monitor topology.

`PagedBar.tsx:557-570` has one interval per mounted leader/independent display; it clears the interval before advancing. It subtracts elapsed time and takes one next turn after a delayed callback, rather than replaying every missed dwell. This is code evidence against a queued burst on wake, not a physical sleep/wake result. R1 is the exception for leaked remote holds.

### O6 — Monitor persistence, placement, and viewport changes

- `preferences.ts:931-939` sanitizes saved per-display preferences on load; `lib/tickerDisplay.ts:18-40` rejects unknown modes and clamps reading-size choices. Main passes selected monitors plus display preferences to native sync on launch and change (`routes/__root.tsx:577-586`).
- Native `choose_display_monitors` suspends if all explicitly selected screens are missing and any was filled (`commands/window.rs:232-251`). `sync_ticker_windows` serializes window creation/destruction and keeps the primary ticker object alive. This preserves shared data ownership while suspending display content.
- `useTickerDisplay.ts:29-62` serializes placement per webview, reads latest preferences when queued work starts, and catches errors so a rejected placement does not permanently reject subsequent queued operations. It does not coalesce events, cancel a current placement on a new preference, or bound an outstanding native IPC call. No unbounded queue was reproduced during this audit.
- `commands/window.rs:374-430` releases AppBar registration for Fill, uses physical target bounds on fallback platforms, and enters fullscreen; exiting Fill returns to existing docked placement. Same-monitor fullscreen resolution/DPI adaptation still relies on the OS because this branch skips explicit geometry updates when already fullscreen on the target.
- `TickerSurface.tsx:31-41` listens for viewport resize; `PagedBar.tsx:548-553` replans independent Fill geometry immediately. Reading size/layout changes do not mutate content selections or start a new network source.

## Required runtime evidence still missing

Physical disconnect/reconnect, changing monitor selection while placement is in flight, sleep/wake, same-monitor resolution and mixed-DPI changes, taskbar/AppBar restoration, restart with a missing dedicated display, and macOS/Wayland fullscreen behavior were not exercised. No native preferences or windows were changed. The customer mini-PC and renderer workaround remain release gates described by the inventory and CHIP_SPEC P.16; source inspection and the helper proof cannot satisfy them.

Result: **0 P0, 1 P1, 1 P2**. Only this report was created.
