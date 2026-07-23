# Batch A — Quick Fixes Design

**Date:** 2026-04-28
**Status:** Approved (decisions locked, awaiting spec sign-off before plan)
**Scope:** Three independent, low-risk desktop fixes that ship as one PR
**Sequence:** First in a three-batch plan (A → B → C). B = unified `/users/me/overview` API + client refactor. C = settings IA redesign + website support page.

---

## Why these three are batched

Items 1, 3, 6 from the user's six-item list share three traits:

1. **Atomic** — each lives in 1–7 files, no API changes, no migrations.
2. **Independent** — none touches the others' files. Three disjoint diffs in one PR.
3. **Visible** — each fixes a user-facing complaint (false update banner, pin/unpin friction, dead-end ticker clicks).

Batches B and C have larger blast radius and depend on data shape decisions that this batch leaves untouched. Shipping A first removes three sources of UX confusion before we redesign the IA in C.

---

## Item 1 — Updater false-positive on Windows

### Symptom

Running "Check for updates" on Windows always reports an update available, even when the user is on the latest published version. macOS and Linux do not show this behavior in practice.

### Root cause

Two cooperating mechanisms are in play and one of them only seeds itself when the user already used the in-app updater:

- **Rust comparator** — `desktop/src-tauri/src/lib.rs:36` registers `default_version_comparator(|current, remote| remote.version >= current)`. The `>=` is intentional — it allows a "patched rebuild" pattern where we re-issue an existing version (e.g., `1.0.3`) with a fix without bumping the version number. Same version, newer asset, updater picks it up.
- **JS guard** — `desktop/src/components/settings/GeneralSettings.tsx:124–163` reads `KEY_LAST_UPDATE_DATE` from the Tauri store and, when versions match, compares the stored date to the remote `update.date` (the manifest's `pub_date`). If they match, the update is suppressed.

The bug is that `KEY_LAST_UPDATE_DATE` is only ever **written** in one path — the post-`downloadAndInstall` reconcile loop at `GeneralSettings.tsx:107–115`. That path requires the user to have actually run an in-app update.

Windows users overwhelmingly install via the MSI manual download from GitHub Releases. They never trigger the in-app updater, so `KEY_LAST_UPDATE_DATE` is never seeded. Every subsequent in-app check sees an empty store, the JS guard short-circuits (line 140: `storedDate &&` is falsy), and the UI happily shows `step: "available"` with `isPatch: true`.

macOS and Linux users typically install once via DMG/AppImage/deb and then ride the in-app updater for subsequent versions, which seeds the key. Same code path, different real-world install habits.

### Fix

Seed `KEY_LAST_UPDATE_DATE` on the first in-app check that returns "you are on this version". Specifically, in `GeneralSettings.tsx`'s check handler, when `update.version === appVersion`:

- If `KEY_LAST_UPDATE_DATE` is null → write `update.date` to the store and set `step: "up-to-date"`. This bootstraps the guard for fresh installs and existing-but-empty stores.
- If `update.date === storedDate` → set `step: "up-to-date"`.
- If `update.date !== storedDate` → genuine patched rebuild, set `step: "available"` with `isPatch: true`.

The Rust comparator stays untouched. The "patched rebuild" feature is preserved.

### Trade-off

If a Windows user manually installs an older MSI than the latest GitHub release, the seed step records the LATER `pub_date` as "the one I'm on" and they never see the patch they're actually missing. This requires the user to deliberately download an older asset, which is rare. Acceptable.

### Files

- `desktop/src/components/settings/GeneralSettings.tsx` — only file touched. Modify the body of the `handleCheck` callback at the version-match branch (~line 124–163).

---

## Item 3 — Remove pin-to-sidebar feature

### Symptom

The catalog page exposes a Pin/Unpin button on each enabled channel/widget card. The "pin" controls whether the channel/widget appears in the left sidebar nav. Users find the extra step confusing — they expect adding a channel to make it sidebar-visible, which is what `handleAdd` already auto-does on first install. The Pin/Unpin button only matters if the user wants to keep a source enabled but hide its sidebar entry, which nobody does in practice.

### Approach

Remove the feature entirely. Sidebar visibility becomes a derived state of `Channel.enabled === true` (for channels) and presence in `prefs.widgets.enabledWidgets` (for widgets). Sort order pulls from the existing `[...CHANNEL_ORDER, ...WIDGET_ORDER]` constant in `catalog.tsx:37`.

`Channel.visible` is **not** part of the sidebar rule. Visibility is a feed-level filter (hide a channel from today's feed without removing it). The sidebar is navigation. Mixing them would lock a user out of navigating to a channel's config page when they have it temporarily hidden, which is the wrong UX.

### Distinguishing the two pin concepts

The codebase has **two unrelated "pin" features** that share Lucide icons. Only the first is being removed:

| Concept | Field | Where | Status |
|---|---|---|---|
| **Sidebar pin** | `prefs.pinnedSources: string[]` | `catalog.tsx`, `Sidebar.tsx`, `__root.tsx` | **REMOVE** |
| **Ticker-edge pin** | `prefs.widgets.pinnedWidgets: Record<string, {side, row?}>` | `useWidgetPin`, `TickerPinSection`, `ConsolidatedChip` | **KEEP** (unrelated) |

Tooltips disambiguate: sidebar pin says "Pin to sidebar"; ticker-edge pin says "Pin widget". The implementation correctly keeps these separate; this spec only touches the first.

### Migration

`pinnedSources` is dropped from `AppPreferences`. `loadPrefs` simply stops reading the field. Old persisted JSON retains a stale `pinnedSources` key that is never read again — harmless dead data.

The user-visible side effect: a user who had `finance` enabled-but-unpinned will see `finance` newly appear in their sidebar after upgrading. This is the intended new behavior. There is no way to preserve "I want my sidebar empty" because that affordance is being removed by design.

### Files (delete)

| File | Lines | What |
|---|---|---|
| `desktop/src/preferences.ts` | 382, 555, 901, 966 | Field decl, default, loadPrefs read, reset |
| `desktop/src/components/marketplace/CatalogCard.tsx` | 3, 31, 39–40, 50, 57, 166–184 | `Pin/PinOff` imports, props, button block |
| `desktop/src/routes/catalog.tsx` | 88–95, 99–105, 115–124, 130, 134–135, 144, 198, 205 | Pinned writes in handleAdd/handleRemove, handleTogglePin, props |
| `desktop/src/components/onboarding/OnboardingWizard.tsx` | 259–271 | `pinnedIds` calc and `pinnedSources` write |
| `desktop/src/hooks/useChannelActions.ts` | 73–79 | Cleanup block on channel delete |
| `desktop/src/hooks/useWidgetActions.ts` | 44–46, 54 | Cleanup block on widget toggle off |

### Files (rewire)

| File | Lines | What |
|---|---|---|
| `desktop/src/routes/__root.tsx` | 376–391, 548 | Replace `resolvedPinnedSources` memo with one reading `dashboard.channels` (filtered to `enabled === true`) + `prefs.widgets.enabledWidgets`, sorted via canonical order. |
| `desktop/src/components/Sidebar.tsx` | 73–79, 94, 121, 194–207 | Rename `pinnedSources` prop to `sources` (semantic clarity, not strictly required). Internal interface `PinnedSource` renamed to `SidebarSource`. |

### Sort key

The catalog already defines a canonical sort order. Extract `CANONICAL_ORDER = [...CHANNEL_ORDER, ...WIDGET_ORDER]` from `catalog.tsx:37` into a shared module (e.g., `desktop/src/lib/catalogOrder.ts`) so the sidebar memo and the catalog grid share the constant. This ensures the sidebar order and the catalog order stay in sync.

### Verify

- Catalog: Add → channel/widget appears in sidebar. Remove → it disappears. No Pin button anywhere.
- Onboarding: complete the wizard, sidebar populates with the picks.
- Settings: ticker-edge pin still works. Tray "Pin on Top" (always-on-top window) still works (uses `window.pinned`, different field).
- Persistence: a user upgrading from v1.0.3 with `pinnedSources` written sees old data ignored, sidebar populates from enabled state.

---

## Item 6 — Ticker chip click opens external URL

### Symptom

Clicking any chip in the ticker opens the desktop app's main window via `invoke("show_app_window")`. Users expect the click to navigate to the external destination — the article URL for an RSS chip, the symbol's vendor page for a finance chip, the league/player URL for a fantasy chip.

### Approach

Pass an optional `url` parameter through the chip's `onClick` callback chain. When present, the click handler calls `open(url)` from `@tauri-apps/plugin-shell` (already installed). When absent, fall back to the current "open app" behavior so widget chips (clock, weather, sysmon, uptime, github) keep their existing interaction.

### URL sources

| Chip | Source | Construction |
|---|---|---|
| **TradeChip** | `Trade.link` | Already populated by Rust ingestion service (`channels/finance/service/src/lib.rs:159`). No backend change. |
| **GameChip** | `Game.link` | Already populated by Rust ingestion service (`channels/sports/api/models.go:11`). No backend change. |
| **RssChip** | `RssItem.link` | Already populated from the feed's `<link>` element. No backend change. |
| **FantasyStatChip** | constructed | `https://{prefix}.fantasysports.yahoo.com/{game_code}/{league_id}` where `league_id = league_key.split('.l.')[1]` and `prefix` maps `nfl→football, nba→basketball, nhl→hockey, mlb→baseball`. |
| **FollowedPlayerChip** | constructed | `https://sports.yahoo.com/{game_code}/players/{player_id}/` where `player_id = player_key.split('.p.')[1]`. `game_code` comes from the parent `LeagueResponse` already passed in via the `leagues` prop. |
| **ConsolidatedChip** (widgets) | none | Returns `undefined` — handler falls back to "open app". |

Backend additions (surfacing Yahoo's native `data.url` and per-player `url`) are deferred. Client-side construction is deterministic and good enough for Batch A.

### New file

`desktop/src/utils/chipUrl.ts` — central helper module:

```ts
export function chipUrl(channelType: string, data: ...): string | undefined
function buildYahooLeagueUrl(leagueKey: string, gameCode: string): string
function buildYahooPlayerUrl(playerKey: string, gameCode: string): string
const SPORT_PREFIX: Record<string, string>
```

### Modified files

| File | What |
|---|---|
| `desktop/src/components/ScrollrTicker.tsx` | Extend `onChipClick` signature to `(channelType, itemId, url?: string) => void`. Wire `chipUrl(...)` into each chip's onClick payload. |
| `desktop/src/App.tsx` | Update `handleChipClick(channelType, itemId, url?)`. If `url`, call `open(url)`. Else fall back to `savePref("activeItem", channelType)` + `invoke("show_app_window")`. |

### Chip components touched

- `desktop/src/components/chips/TradeChip.tsx` — pass `trade.link`
- `desktop/src/components/chips/GameChip.tsx` — pass `game.link`
- `desktop/src/components/chips/RssChip.tsx` — pass `item.link`
- `desktop/src/components/chips/FantasyStatChip.tsx` — pass constructed league URL
- `desktop/src/components/chips/FollowedPlayerChip.tsx` — pass constructed player URL
- `desktop/src/components/chips/ConsolidatedChip.tsx` — pass `undefined` (widgets keep open-app behavior)

### Error handling

`open()` rejects on the rare cases the OS shell can't handle the URL. Wrap in `.catch(err => console.error(...))` so a malformed URL never blocks subsequent clicks. Do not surface a user-facing error toast for this — it's a click handler, the user can just click again.

### Verify

- Click each chip type, confirm it opens the right URL in the default browser.
- Click a widget chip, confirm the app window opens (current behavior).
- Click a chip with an empty `link` field (e.g., RSS feed that returned no `<link>`) — falls back to `RssItem.feed_url` (consider this; if undesired, falls back to opening the app instead). Defer that fallback to implementation; the simpler "no link → open app" behavior is acceptable for Batch A.

---

## Cross-cutting concerns

### Testing

Manual smoke test only. No new unit tests. The behavioral changes are all in click handlers and a memo rewire — already covered indirectly by the existing 154-test Vitest suite (which exercises preferences shape, view selectors, and chip URL construction would be a natural follow-up if drift is observed).

The Item 3 deletion makes existing tests in `preferences.test.ts` more strict (the field is gone, so any reference would fail to compile). No tests today reference `pinnedSources`, so no test changes required.

### Bundle size

Item 6 adds one small utility file (~50 lines) and pulls `@tauri-apps/plugin-shell`'s `open` into the App.tsx bundle (already used in 5 other places, so no new chunk).

Item 3's deletions reduce overall bundle slightly. Item 1 is a behavior change in an already-bundled file.

### Versioning

Per the user's standing rule: not bumping desktop version for non-substantive changes. Batch A ships against v1.0.3 as a fresh asset replacement on the existing GitHub release.

### PR shape

Single PR titled `fix(desktop): updater seed + remove pin-to-sidebar + ticker chip external URLs`. Three logical commits, one per item, so each is reviewable in isolation:

1. `fix(updater): seed KEY_LAST_UPDATE_DATE on first version-match check`
2. `refactor(sidebar): remove pin-to-sidebar; sidebar now driven by enabled state`
3. `feat(ticker): chip click opens external URL via shell.open`

Squash-merge as one feature batch. Branch name: `feature/batch-a-quick-fixes`.

---

## Out of scope (deferred to Batch B / C)

- Surfacing Yahoo's native `data.url` and per-player `url` through the Go layer (defer to Batch B if and when client-side construction proves insufficient).
- Settings IA redesign (Batch C).
- Account page parity / unified `/users/me/overview` endpoint (Batch B).
- Website `/support` route and contact form (Batch C).
- The "if RSS link is empty, fall back to feed_url" edge case — deferred unless observed in practice.

---

## Decisions locked

| Decision | Choice |
|---|---|
| Updater fix approach | Seed `KEY_LAST_UPDATE_DATE` on first check |
| Sidebar visibility rule | `Channel.enabled === true` (ignore `visible` flag) |
| Fantasy chip URL source | Client-side construction from existing keys |
| Widget chip click behavior | Keep current "open app" fallback |

---

## Acceptance criteria

- `npm run check` clean (Prettier + ESLint, marketing site only — desktop has no lint config)
- `npm run build` clean (`vite build && tsc --noEmit` for desktop)
- `cargo check --manifest-path src-tauri/Cargo.toml` clean
- `npm run test` green (existing 154-test Vitest suite)
- Manual smoke test on macOS dev build covering: catalog Add/Remove flow, sidebar render after onboarding, ticker click for each chip type, "Check for updates" returns "up-to-date" when on latest

Windows MSI verification of Item 1 happens after merge by either you or me — the seed-on-first-check fix is statically obvious but the actual Windows install path needs an MSI test build to confirm in situ.
