# Design: Scrollr Desktop IA Refactor

**Status:** approved, in implementation
**Date:** 2026-05-09
**Author:** brainstorming session

## Background

A fresh-install user identified four issues with the desktop app:

1. The onboarding wizard feels weak and redundant
2. The transition from onboarding to home is jarring
3. Toast notifications appear unstyled until the first Undo click
4. Default theme is "dark" regardless of system preference

Investigation surfaced a deeper structural problem: every verb in the app has 2+ canonical surfaces, four parallel filter layers control what shows where, and no two routes share visual chrome. The original four issues are symptoms of an information architecture that has accreted features without a unifying model.

This refactor establishes one model, one chassis, and one home per verb.

## Goals

- Each user verb (add, remove, configure, view, manage ticker, change settings) has exactly one canonical home.
- Every route renders through one shared layout chassis.
- The number of overlapping filter layers drops from four to two.
- The 4 originally-reported issues are fixed as a side effect of structural cleanup.
- No regressions to existing functionality (ticker rows, source data, billing, auth).

## Non-goals

- New features (per-symbol ticker assignment, snooze ticker, customizable shortcuts) — flagged for follow-up.
- Backend changes other than collapsing `Channel.ticker_enabled` to a derived field (deferred if other clients depend on it).
- Changes to the auth flow, AuthGate, or Logto integration.
- Changes to the channels (finance/sports/rss/fantasy) ingestion services.

## Mental model: Library / Source / Ticker

Three nouns. Every verb maps to exactly one.

- **Library** = the Catalog. Discover and **add** sources. Never remove from here.
- **Source** = a per-channel or per-widget detail page. **Use, configure, remove** here.
- **Ticker** = the radar. **Manage rows and style** in Settings → Ticker. Toggle on/off and pin via control strip.

| Verb | Canonical home | Other surfaces (invocations) |
|---|---|---|
| Add a source | Catalog | Sidebar `+ Add source` button (navigates to Catalog) |
| Remove a source | Source page header (Trash + Undo toast) | none |
| Configure a source | Source page → Configure tab | none |
| Set source display | Source page → Configure → Display section | none |
| View source data | Source page → Feed tab | Home preview drills in |
| Pick what previews on Home | Home → section Pencil edit mode | none |
| Manage ticker rows | Settings → Ticker → Rows section | Tray right-click (quick add/assign) |
| Manage ticker style | Settings → Ticker → Style section | none |
| Toggle ticker on/off | Control strip | Tray, ticker hover toolbar, `Ctrl+T` |
| Pin window on top | Control strip | Tray, ticker hover toolbar |
| Sign in / out, billing | Settings → Account | Banners deeplink here |
| Help & support | Sidebar → Support | Tray "Report a Bug" deeplinks |

## Filter layers: from four to two

**Today:**
1. `Channel.enabled` — added / not
2. `Channel.ticker_enabled` — server flag for ticker membership
3. `tickerLayout.rows[].sources` — client-side row assignment
4. Home `selectedKeys` per section — preview filter

**After:**
1. **Added** (`Channel.enabled` for channels; `prefs.widgets.enabledWidgets` for widgets)
2. **Ticker row membership** (`tickerLayout.rows[].sources`)

`Channel.ticker_enabled` becomes a **derived** field on the client computed from row membership. The dual-state drift documented in `__root.tsx:558` becomes structurally impossible. If other clients write this field independently, full server-side derivation is deferred to a follow-up.

Home `selectedKeys` is **kept** — it's a Home-specific preview filter, not a "what's tracked" filter. Lives entirely client-side, doesn't affect ticker.

## Page chassis: `PageLayout`

Every route renders through one component:

```
┌────────────────────────────────────────────────────┐
│ OS title bar / custom chrome                       │
├────────────────────────────────────────────────────┤
│ Control strip                                      │  always present
│ [● Ticker] [📌 Pin]    🟢 Connected               │
├────────────────────────────────────────────────────┤
│ Sidebar │ Page header                              │  always present
│         │   Title • subtitle    [entity action]    │
│         ├─────────────────────────────────────────┤
│         │ Tab bar                                   │  optional
│         │   Tab 1 • Tab 2 • Tab 3                  │
│         ├─────────────────────────────────────────┤
│         │ Section stack                             │  always present
│         │   ┌─ Section ──────────[section action]┐ │
│         │   │ ...                                 │ │
│         │   └─────────────────────────────────────┘ │
│         │   ┌─ Section ──────────────────────────┐ │
│         │   │ ...                                 │ │
│         │   └─────────────────────────────────────┘ │
│         ├─────────────────────────────────────────┤
│         │ Footer                                    │  optional
│         │   destructive / peripheral actions        │
└─────────┴─────────────────────────────────────────────┘
```

**Slots:**
- `breadcrumb` — back chevron + parent path (Source pages only)
- `title` / `subtitle` — page identity
- `entityAction` — destructive action tied to the page entity (Trash on Source pages); empty on others
- `tabs` — sub-navigation bar (Source pages, Settings); absent when not used
- `children` — vertical stack of `<Section>` components
- `footer` — destructive/peripheral page actions

**Section component:**
- Title (left) + optional badge + spacer + optional `sectionAction` button (right)
- Content slot below
- Visual weight per page: bordered card on Settings/Configure, borderless divider on Home, grid on Catalog

**Empty state component (`<EmptySection>`):**
- Icon + 1-line message + optional CTA button
- Used inside any section when its content is empty

## Surface specs

### Control strip (new component, below title bar)

`desktop/src/components/ControlStrip.tsx`

- Left: `[● Ticker on / Ticker off]` button — toggles `prefs.tickerEnabled`. Visual state shows current.
- Left: `[📌 Pin]` toggle — toggles `prefs.alwaysOnTop`.
- Right: connection indicator with friendly states:
  - 🟢 Connected
  - 🟡 Reconnecting…
  - 🔴 Offline (with Retry on click)
- SSE/Polling distinction moves to a debug surface (Behavior tab footer or About).

### Sidebar (`Sidebar.tsx` updated)

- Top: `[+ Add source]` primary button → navigates to `/catalog`
- Nav: Home, Catalog, divider, per-source items with ticker-status dot, divider, Settings, Support
- Bottom: collapse toggle only (connection indicator moved to control strip)

### Home (`/feed`)

Header: "Home" / "Your live feed at a glance"
Tabs: none
Sections (when `hasAnySources`):
- **Ticker preview** — read-only summary of ticker rows + `[Manage ticker]` button → Settings → Ticker
- **Per source** — one section per added source, section action is Pencil ↔ Check (preview-key picker), drill-arrow on title click

Sections (when `!hasAnySources`):
- **Hero** — single centered section: "Welcome to Scrollr / Your radar is empty / [Browse the Catalog →]"

### Catalog (`/catalog`)

Header: "Catalog" / "Add channels and widgets to your feed"
Tabs: All • Channels • Widgets (filter)
Sections:
- **Card grid** — one card per channel/widget
  - 1-line description
  - Small visual sample (mini sparkline / league logos / RSS source logos / widget preview) — description-only fallback acceptable if visuals need iteration
  - Action button: `Add` (not added), `Open` (added, visually de-emphasized), `Upgrade` (locked)
  - **No Remove button** — moved to Source page
- Visual hierarchy: not-added > added > locked

### Source page (`/channel/:type/:tab` and `/widget/:id/:tab`)

Both channels and widgets use the same 2-tab structure.

Header: breadcrumb (`← Home / Finance`) + title + subtitle + Trash entity action
Tabs: **Feed** • **Configure**

Tab content:
- **Feed** — channel/widget's own data view (existing components: MyWatchlist, ScoresTab, etc.)
- **Configure** — sections:
  - **What to track** — symbol/league/feed picker (channels) or main config (widgets)
  - **Display** — render preferences (channels: %change/logos/etc; widgets: existing display options pulled out of today's Configure)
  - **Ticker behavior** (footer text only) — "This source is on Row 1 — manage in Settings → Ticker"

Trash button uses **5-second Undo toast** for both channels and widgets (extending today's widget pattern). No confirm dialog.

### Settings (`/settings?tab=...`)

Header: "Settings" / no subtitle
Tabs: **Appearance** • **Ticker** • **Behavior** • **Account**

**Appearance:**
- Color mode (Light / Dark / System)
- Display size, font weight, contrast

**Ticker:**
- **Rows** section (primary, first) — multi-deck row builder
- **Style** section — speed, density, colors, scroll mode, direction, item order
- (Master ticker on/off toggle removed — now in control strip)

**Behavior:**
- Launch on system startup
- Default ticker visibility on launch
- Ticker default position (top / bottom)
- **Keyboard shortcuts** (read-only panel: `Ctrl+T`, `Ctrl+,`, `Ctrl+Shift+T`, `Esc`)

**Account:**
- Profile (display name, email, username)
- Security (password reset)
- Subscription (status, billing, plan actions)
- Your Plan (tier limits, upgrade)
- Your Data (export)
- Footer: About (version), Updates (state machine), Reset all settings (destructive)

### Support (`/support`)

Header: "Support" / "Find help, file bugs, or contact us"
Tabs: none
Sections: Search + Category cards OR (when in a category) breadcrumb + section content
No chrome changes from existing functionality, just rendered through `PageLayout`.

## First-run experience

- Wizard removed entirely (delete `OnboardingWizard.tsx`, `WizardShell.tsx`, all `Step*.tsx`, `curated-picks.ts`).
- AuthGate stays.
- `prefs.showSetupOnLogin` removed; Settings toggle removed.
- After auth, user lands on `/feed` with `!hasAnySources` → renders hero section.
- `prefs.tickerEnabled` defaults to `true` for new accounts so ticker self-demonstrates after first add.

## Bug fixes (rolled in)

1. **Toast CSS** — Move `import "sonner/dist/styles.css"` from `routes/__root.tsx:25` to `src/app-main.tsx` so it ships in the entry bundle, not a code-split route chunk.
2. **Toaster theme** — Replace hardcoded `theme="dark"` at `__root.tsx:889,922` with theme that follows `prefs.appearance.theme` resolved value.
3. **Theme default** — Change `preferences.ts:412` from `theme: "dark"` to `theme: "system"`.
4. **Pre-paint flash** — Add inline script in `desktop/app.html` that reads saved pref + `prefers-color-scheme`, sets `data-theme` on `<html>` and `#app-shell` before React mounts. Replaces hardcoded `data-theme="dark"` at `__root.tsx:722`.
5. **Stale redirects** — Fix `router.ts:21` redirects to `/ticker` and `/account` (routes that don't exist) — point them to `/settings?tab=ticker` and `/settings?tab=account`.

## Migration / compatibility

- Existing users keep their preferences. Unknown keys (`showSetupOnLogin`) are safely ignored by the prefs loader.
- Existing users with `theme: "dark"` keep dark mode — only the **default for new installs** changes.
- `Channel.ticker_enabled` field stays on the wire for backward compat with the API; the desktop derives it from row membership client-side.
- Tray right-click menu, hover toolbar, system shortcuts unchanged.

## Out of scope (tracked for follow-up)

- Per-symbol ticker assignment (today: per-source granularity only)
- Snooze ticker for N minutes
- Customizable keyboard shortcuts (panel is read-only this pass)
- "Copy debug info" button
- Notifications preferences (placeholder section only)
- Catalog mini-sample components for each channel type — included in scope but cards may ship with description-only first if the visual previews need iteration

## File-level impact

**New files:**
- `desktop/src/components/PageLayout.tsx` — universal page chassis
- `desktop/src/components/Section.tsx` — section card wrapper
- `desktop/src/components/EmptySection.tsx` — unified empty state
- `desktop/src/components/ControlStrip.tsx` — new control strip
- `desktop/src/components/feed/WelcomeHero.tsx` — empty home hero (or inline)

**Significantly modified:**
- `desktop/src/routes/__root.tsx` — remove onboarding gate, add control strip, simplify shell
- `desktop/src/routes/feed.tsx` — render through PageLayout, remove RowSelector chips, add hero
- `desktop/src/routes/catalog.tsx` — visual hierarchy, descriptions, no Remove button
- `desktop/src/routes/channel.$type.$tab.tsx` — collapse to 2 tabs, fold Display into Configure
- `desktop/src/routes/widget.$id.$tab.tsx` — fold Display section into Configure tab (matching channels)
- `desktop/src/routes/settings.tsx` — 4 tabs (Appearance/Ticker/Behavior/Account), restructured contents
- `desktop/src/components/Sidebar.tsx` — add `+ Add source` button, status dots
- `desktop/src/components/SourcePageLayout.tsx` — generalize / merge into PageLayout
- `desktop/src/preferences.ts` — `theme: "system"` default, drop `showSetupOnLogin`, ensure `tickerEnabled` defaults true
- `desktop/src/router.ts` — fix stale redirects
- `desktop/src/app-main.tsx` — add sonner CSS import
- `desktop/app.html` — add pre-paint theme script

**Deleted:**
- `desktop/src/components/onboarding/OnboardingWizard.tsx`
- `desktop/src/components/onboarding/WizardShell.tsx`
- `desktop/src/components/onboarding/Step*.tsx` (5 files)
- `desktop/src/components/onboarding/curated-picks.ts`
- `desktop/src/components/onboarding/AuthGate.tsx` — **kept** (separate concern)

## Implementation phases

1. **Foundations** — `PageLayout`, `Section`, `EmptySection` components. No route changes yet.
2. **Bug fixes** — toast CSS, theme default + pre-paint, stale redirects, Toaster theme prop. Independently shippable.
3. **Wizard removal + empty home hero** — delete wizard, add hero section, default `tickerEnabled: true`.
4. **Source pages** — collapse to 2 tabs, Display section in Configure, unified Trash + Undo.
5. **Sidebar + control strip** — `+ Add source`, status dots, control strip with simplified connection indicator.
6. **Home redesign** — render through PageLayout, remove RowSelector chips, ticker preview becomes read-only.
7. **Settings restructure** — 4 tabs, About/Updates/Reset move to Account footer, shortcuts panel.
8. **Catalog improvements** — visual hierarchy, descriptions.
9. **Filter layer cleanup** — derive `ticker_enabled` from row membership (client-side).

Each phase commits independently.
