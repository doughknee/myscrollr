# Settings Routing Layout Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flatten Settings into a single Appearance-oriented page while moving Ticker and Account to top-level sidebar routes.

**Architecture:** Keep existing settings state and business logic intact. Split route ownership so `/settings` renders `GeneralSettings`, `/ticker` renders `TickerSettings`, and `/account` renders `AccountSettings`; update navigation callsites and sidebar active-state parsing accordingly. Refactor only the presentation layer for the remaining Settings page: compact responsive cards and tooltip-based descriptions.

**Tech Stack:** React 19, TanStack Router file routes, Tailwind v4 utility classes, existing `Tooltip`, existing settings controls, Tauri updater/autostart bindings.

---

## File Structure

- Create `desktop/src/routes/ticker.tsx`: top-level route wrapping existing `TickerSettings` with `PageLayout`.
- Create `desktop/src/routes/account.tsx`: top-level route wrapping existing `AccountSettings` with `PageLayout` and existing reset-all handler.
- Modify `desktop/src/routes/settings.tsx`: remove tab search validation and render only `GeneralSettings` inside a flat page.
- Modify `desktop/src/components/settings/GeneralSettings.tsx`: replace loose vertical section list with a responsive two-column card grid.
- Modify `desktop/src/components/settings/SettingsControls.tsx`: make sections visually contained cards and move row descriptions into existing tooltip behavior with dashed hover labels.
- Modify `desktop/src/components/Sidebar.tsx`: add top-level Ticker and Account nav items.
- Modify `desktop/src/routes/__root.tsx`: parse `/ticker` and `/account`, pass new sidebar active states and handlers, update old `/settings?tab=*` navigations.
- Modify `desktop/src/routes/feed.tsx`: send “customize ticker” to `/ticker`.
- Modify `desktop/src/App.tsx`: send ticker context-menu navigation to `/ticker`.
- Modify `desktop/src/router.ts`: update legacy route redirects.
- Do not edit `desktop/src/routeTree.gen.ts`; it is generated.

## Tasks

### Task 1: Split Ticker and Account into top-level routes

- [ ] Create `desktop/src/routes/ticker.tsx` with a `/ticker` file route that imports `TickerSettings`, reads `prefs` and `onPrefsChange` from `useShell`, and renders `PageLayout title="Ticker" width="wide"`.
- [ ] Create `desktop/src/routes/account.tsx` with a `/account` file route that imports `AccountSettings`, reads auth/subscription handlers from `useShell`, defines the same `resetAll` handler currently in `settings.tsx`, and renders `PageLayout title="Account" width="narrow"`.
- [ ] Rewrite `desktop/src/routes/settings.tsx` to remove tab validation and render only `GeneralSettings` with the existing appearance/window/startup/autostart/update props.

### Task 2: Update shell routing and sidebar navigation

- [ ] Modify `desktop/src/routes/__root.tsx` route parsing to return active state for `/ticker` and `/account`.
- [ ] Add `handleNavigateToTicker` and `handleNavigateToAccount` callbacks that navigate to `/ticker` and `/account`.
- [ ] Replace settings-tab navigation callsites in `__root.tsx`: settings shortcuts and footer use `/settings`; billing banner account actions use `/account`.
- [ ] Modify `desktop/src/components/Sidebar.tsx` props and rendering to include top-level Ticker and Account nav items alongside Settings and Support.
- [ ] Update `desktop/src/routes/feed.tsx` and `desktop/src/App.tsx` ticker customization links to `/ticker`.
- [ ] Update `desktop/src/router.ts` redirects so removed settings paths point to `/settings`, `/ticker`, or `/account`.

### Task 3: Compact the flat Settings page layout

- [ ] Modify `desktop/src/components/settings/GeneralSettings.tsx` JSX only: render a responsive grid with left column containing Appearance and right column containing Window, Startup, Keyboard shortcuts, Updates, and About.
- [ ] Keep every existing setting row and handler exactly as-is, including reset, updater, app version, autostart, and window callbacks.
- [ ] Move the “Reset general settings” action to a compact footer inside the flat settings content.

### Task 4: Replace inline setting descriptions with tooltips

- [ ] Modify `desktop/src/components/settings/SettingsControls.tsx` to import the existing `Tooltip` component.
- [ ] Add a small internal `SettingLabel` helper that wraps labels with `Tooltip` when a description exists and applies a subtle dashed underline.
- [ ] Update `ToggleRow`, `SegmentedRow`, `SelectRow`, `VenueRow`, `SliderRow`, and `ActionRow` so descriptions are no longer rendered inline.
- [ ] Preserve accessible labels for controls and keep click/change behavior unchanged.

### Task 5: Verify

- [ ] Run `npm run build` in `desktop/`.
- [ ] If TanStack Router regenerates `routeTree.gen.ts`, leave the generated output intact.
- [ ] Inspect changed files for accidental logic changes in preferences, Tauri command calls, updater state machine, auth, and ticker layout behavior.
