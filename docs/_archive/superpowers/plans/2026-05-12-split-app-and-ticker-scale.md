# Split App and Ticker Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple UI scaling so the App window uses presets in `/settings` and the Ticker window uses a slider in `/ticker`, controlled independently.

**Architecture:** Add `appearance.tickerScale` alongside the existing `appearance.uiScale`. App window keeps reading `uiScale`. Ticker window reads `tickerScale` for both webview zoom and height math. Settings shows presets. Ticker route shows a slider.

**Tech Stack:** React 19, Tailwind v4, existing settings controls, existing `useTheme` hook, existing Tauri webview zoom integration.

---

## File Structure

- Modify `desktop/src/preferences.ts`: add `tickerScale` to `AppearancePrefs` and default it from saved `uiScale` during migration.
- Modify `desktop/src/App.tsx`: ticker window uses `appearance.tickerScale` for `useTheme` zoom and for ticker-height math.
- Modify `desktop/src/components/settings/GeneralSettings.tsx`: replace slider with `SegmentedRow` presets bound to `uiScale`.
- Modify `desktop/src/components/settings/TickerSettings.tsx`: prepend a single dense `Ticker scale` slider row bound to `tickerScale`.

## Tasks

### Task 1: Add tickerScale to preferences with migration

- [ ] Add `tickerScale: number` to `AppearancePrefs`.
- [ ] Set `tickerScale: 100` in `DEFAULT_APPEARANCE`.
- [ ] In `loadPrefs`, when the saved `appearance.tickerScale` is missing/invalid, default it to the saved `appearance.uiScale` (or 100 if that is also missing).

### Task 2: App and ticker windows use independent scales

- [ ] In `desktop/src/App.tsx` (ticker window) replace every `prefs.appearance.uiScale` / `prefsRef.current.appearance.uiScale` used for the ticker `useTheme` and ticker-height calculations with `prefs.appearance.tickerScale` / `prefsRef.current.appearance.tickerScale`.
- [ ] Leave `desktop/src/routes/__root.tsx` (app window `useTheme`) untouched — it continues to use `uiScale`.

### Task 3: Settings page shows app scale presets

- [ ] In `desktop/src/components/settings/GeneralSettings.tsx`, replace the slider row with a `SegmentedRow` for `Display size` bound to `appearance.uiScale`.
- [ ] Reintroduce a local `APP_SCALE_PRESETS` constant with values `85`, `100`, `115`, `130` and label strings `85%`, `100%`, `115%`, `130%`.
- [ ] Remove the now-unused slider component and its helpers.

### Task 4: Ticker route shows ticker scale slider

- [ ] In `desktop/src/components/settings/TickerSettings.tsx`, render a single dense settings row at the top with a slim slider bound to `prefs.appearance.tickerScale` (min `75`, max `150`, step `5`).
- [ ] Persist updates via `onPrefsChange({ ...prefs, appearance: { ...prefs.appearance, tickerScale: next } })`.

### Task 5: Verify

- [ ] Run `npm run build` in `desktop/`.
- [ ] Leave the running `tauri:dev` process alone so the UI hot-reloads.
