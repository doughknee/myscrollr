# Current Session Handoff

## Repo State
- Branch: `main`
- Worktree: clean
- Last commit: `8622750 refactor(desktop): IA overhaul + chrome polish (v1.0.10) (#153)`
- Version: **1.0.10** (`desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`)

## Active Task
None. PR #153 merged. Branch `refactor/desktop-ia` deleted.

## What Just Shipped (v1.0.10)

A comprehensive desktop IA refactor across ~30 commits squashed into one merge commit. The whole app now uses one navigation idiom, one chassis, one motion vocabulary.

### Foundation primitives (live and ready to consume)
- **`<TopBar>`** (`desktop/src/components/TopBar.tsx`) — full-width chrome row. Owns brand mark, Spotify-style ←/→ buttons (powered by `useNavHistory`), page identity breadcrumb (read from `usePageIdentity`), ambient ticker/pin/connection toggles. Always mounted in `__root.tsx` for authenticated users.
- **`<PageLayout>`** (`desktop/src/components/layout/PageLayout.tsx`) — universal page chassis. Props: `title`, `subtitle`, `parentLabel`, `onParentClick`, `onTitleClick`, `menuItems`, `menuLabel`, `entityAction` (legacy), `tabs` (legacy — prefer menuItems), `width: "narrow" | "wide"`, `fillHeight`, `noContentPadding`, `footer`. Internally publishes identity to PageContext; the TopBar reads it.
- **`<OverflowMenu>`** (`desktop/src/components/OverflowMenu.tsx`) — floating-ui-based accessible dropdown. Accepts `items: OverflowMenuItem[]`, optional `trigger` element (custom-trigger uses cloneElement pattern). Built-in keyboard nav, typeahead, focus-lock, theme-correct portal (`#app-shell`).
- **`<DisplayItemsGrid>`** (`desktop/src/components/settings/DisplayItemsGrid.tsx`) — shared Feed/Ticker visibility grid with column-headers-as-bulk-toggles. Used by Sports/RSS/Fantasy Display tabs.
- **`PageContext` / `useRegisterPageIdentity` / `usePageIdentity`** (`desktop/src/components/layout/page-context.tsx`).
- **`useNavHistory`** (`desktop/src/hooks/useNavHistory.ts`) — wraps `useCanGoBack` + reads `__TSR_index` from `router.history.location.state` for `canForward`. Subscribes directly to `router.history.subscribe` so it updates on every PUSH/BACK/FORWARD/GO.

### Per-channel managers (foundation for Display previews if extended)
- **`SymbolManager`** (`desktop/src/channels/finance/SymbolManager.tsx`) — Finance configure. Unified scrollable list, click rows to add/remove.
- **`LeagueManager`** (`desktop/src/channels/sports/LeagueManager.tsx`) — Sports configure. Same shape + favorite-team picker per tracked league.
- **`FeedManager`** (`desktop/src/channels/rss/FeedManager.tsx`) — RSS configure. Same shape + custom-feed inline form (animated AnimatePresence height collapse).
- **`FinanceDisplayPanel`** (`desktop/src/channels/finance/DisplayPanel.tsx`) — showcase Display panel with live `FeedPreview` + `TickerPreview` side by side. Updates in real time as toggles change. **Template for the next Pending item.**

### Animation vocabulary (apply consistently in any new code)
- `active:scale-[0.97]` for nav items / large surfaces
- `active:scale-95` for standard buttons
- `active:scale-90` for small icon buttons (≤28px)
- `type:"spring", stiffness: 380-500, damping: 22-32` for icon swaps
- `layoutId` for elements that move between positions (active underlines, accent bars)
- `0.18-0.25s ease-[0.22,0.61,0.36,1]` for content fades
- 40-50ms stagger delays for entrance reveals
- CSS easing tokens in `style.css`: `--ease-snap`, `--ease-pop`, `--ease-out-soft`

### Lessons learned (do NOT re-learn next session)
1. **Tauri bundler gates notarize on env-var *presence*, not value.** Don't try to toggle by passing `''`. (Caused run #25605423069 fail.)
2. **floating-ui's `getReferenceProps()` injects `aria-expanded`** which `cloneElement` merges into the trigger. Read it for chevron flip animations — no extra state needed.
3. **floating-ui's `useListNavigation` overrides sibling onClick** — pass click handlers INTO `getItemProps({ onClick })` so they merge instead of getting overwritten.
4. **`FloatingPortal` mounts at `<body>` by default** — outside the `#app-shell[data-theme=...]` selector. Pass `root={portalRoot}` (resolved via useEffect) so menus inherit the active theme.
5. **TanStack memory history's current index is `__TSR_index` on `history.location.state`** — not `history.state?.index`. Subscribe to `router.history.subscribe` directly for live forward-state recompute (router's `onResolved` is too late).
6. **Tailwind grid-cols class must be string-literal**, not template-literal. JIT can't see runtime classes. Share the same literal between header rows and body rows so column tracks align.
7. **`PageLayout` content cross-fade keys on `title+subtitle+activeKey`** — set `subtitle` to the active section/filter label so Settings/Catalog tab swaps animate.
8. **The persisted `Venue` enum stays unchanged** (`off | feed | ticker | both`) — convert at UI boundary via `enumToBools` / `boolsToEnum` from `preferences.ts`.
9. **`useNow()` takes no args** (singleton interval). Don't pass a polling interval.
10. **Sonner CSS must ship in the entry bundle** (`app-main.tsx`), not the route chunk, or toasts paint unstyled until the chunk loads.
11. **Pre-paint theme**: inline script in `app.html` reads `scrollr:theme-mirror` from localStorage + `prefers-color-scheme`. `useTheme` writes the mirror on every change. Don't try to read Tauri store synchronously.

### Plan deviations carried forward (do NOT undo)
- Finance is the reference Display panel with live preview. Sports/RSS/Fantasy Display tabs use the shared `DisplayItemsGrid` only — they'll get previews per the next Pending item.
- Source page Feed view uses `noContentPadding={true}` (flush rendering); Configure/Display keep the padded narrow column.
- Home uses `noContentPadding` + its own `space-y-5` wrapper.
- Settings + Catalog use breadcrumb dropdowns (`menuItems` on PageLayout) — NOT in-page tab bands.
- Channel removal still uses `ConfirmDialog`; widgets use `useUndoableAction` toast. Asymmetric on purpose (channel deletion is server-side).
- `Channel.ticker_enabled` is still dual-tracked client+server. Deferred derivation to a follow-up — don't cut over without reasoning about other clients.
- Sidebar has no Home or Catalog nav items (TopBar brand mark + `+ Add source` button cover those).

### Spec
`docs/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md` — the full IA refactor design doc. 289 lines. Includes mental model (Library/Source/Ticker), unified page chassis, canonical-home-per-verb table, file-level impact, implementation phases.

## Risks / Open Questions
- The Finance `DisplayPanel` live preview pattern is bespoke. Sports/RSS/Fantasy need analogous preview components — Sports needs a sample `GameItem`, RSS needs a sample feed row, Fantasy needs a sample matchup card. Each will be ~150 lines following the `FeedPreview`/`TickerPreview` shape.
- Bundle size warning persists (`style-*.js` ~580kb). Pre-existing, not introduced by this PR. Code-splitting follow-up if needed.

## Next Best Action

Start the next pending item: apply the Finance live-preview pattern to **Sports** Display first (Fantasy is the most complex; Sports is the smallest scope, good shakedown).

```
You're picking up the Scrollr desktop IA refactor on `main`. The big v1.0.10 ship landed (PR #153, commit 8622750) — full IA + chrome polish across ~30 commits. Read `docs/superpowers/handoffs/current.md` first for the complete operational state, including foundation primitives (TopBar, PageLayout, OverflowMenu, DisplayItemsGrid, PageContext, useNavHistory), animation vocabulary, and lessons learned that you must NOT re-learn (e.g. Tailwind grid-cols can't be runtime-assembled; floating-ui `getItemProps` merge contract; persisted `Venue` enum boundary helpers).

**Repo**: `/Users/doni/code/myscrollr` — desktop app at `desktop/`. Branch `main`, clean. Version 1.0.10.

**Spec for full context**: `docs/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md`.

**Next task**: Apply the Finance live-preview pattern to the **Sports** Display tab (`desktop/src/routes/channel.$type.$tab.tsx` → `SportsDisplay` function). Currently uses the shared `DisplayItemsGrid` only; needs a side-by-side live preview surface like Finance has.

**Reference implementation**: `desktop/src/channels/finance/DisplayPanel.tsx` — the showcase. It has `FeedPreview` and `TickerPreview` components inline that render an actual sample card with the user's current toggle state, updating in real time. Mirror this shape:
1. Create `desktop/src/channels/sports/DisplayPanel.tsx`.
2. Build `SportsFeedPreview` (sample of a `GameItem`-shaped card) and `SportsTickerPreview` (sample chip — see `desktop/src/components/chips/GameChip.tsx`).
3. Pull the user's first tracked league + a sample game from the dashboard if available; fall back to a hardcoded sample.
4. Surface the existing Display toggles (`showLogos`, `showTimer`, `showUpcoming`, `showFinal` Venue enums) using the same `DisplayItemsGrid` you have now.
5. Wire `<SportsDisplay />` in `channel.$type.$tab.tsx` to render the new panel.

**After Sports**: do RSS (sample feed row from `desktop/src/channels/rss/FeedTab.tsx`), then Fantasy (`MatchupHero` is the natural sample — but Fantasy has 14 venue toggles in 4 groups, more complex).

**Workflow**: implement, typecheck (`cd desktop && npx tsc --noEmit`), build (`npm run build`), commit each channel separately. After all three are done, bump to 1.0.11 in `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`, then create PR via `gh pr create` and squash-merge.

**Foundations available** (don't recreate):
- `<DisplayItemsGrid>` — column-headers-as-bulk-toggles grid widget
- `Section`, `ToggleRow`, `SegmentedRow`, `ResetButton` from `desktop/src/components/settings/SettingsControls`
- `enumToBools` / `boolsToEnum` from `desktop/src/preferences.ts`
- `useShell` for prefs access

**Plan deviations carried forward — do NOT undo**:
- Source page Feed view uses `noContentPadding=true`; Configure/Display keep the padded narrow column. The Display panel renders inside `width="narrow"` PageLayout, so layout your component to fit there.
- Animation vocabulary is established — use `active:scale-95` press feedback and motion-studio springs that already exist in style.css (`--ease-snap`, `--ease-pop`).
- Persisted `Venue` enum is unchanged. Use `enumToBools(value)` to read .feed and .ticker booleans.

**No blocking issues. Begin with Sports Display panel.**
```
