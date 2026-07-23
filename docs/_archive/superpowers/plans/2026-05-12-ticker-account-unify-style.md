# Ticker + Account Style Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match Ticker and Account pages to the Settings page style: dense cards, tooltip-labeled rows, segmented controls, no marketing copy blocks, no decorative visual cards.

**Architecture:** Keep all existing behavior (preview, row builder, subscription portal, auth, billing). Replace bespoke `SettingGroup`/`VisualCard`/`AdvancedRow`/`SegmentedPicker` containers with `Section variant="card"` and the dense row primitives already used in Settings. Promote the existing Speed/Scale sliders into clean `SliderRow`s.

**Tech Stack:** React 19, Tailwind v4, existing `SettingsControls` primitives, existing `Tooltip`, existing preview components.

---

## File Structure

- Modify `desktop/src/components/settings/SettingsControls.tsx`: confirm the `card` variant works with `SliderRow` and that all rows allow tooltip-only descriptions (already in place).
- Modify `desktop/src/components/settings/TickerSettings.tsx`: restructure layout into card sections with dense rows, drop `SettingGroup`/`VisualCard`/`AdvancedRow`/`SegmentedPicker` UI in favor of `Section`/`SegmentedRow`/`ToggleRow`/`SliderRow`. Keep `PreviewRow`, `RowCard`, and the row mutation logic intact.
- Modify `desktop/src/components/settings/AccountSettings.tsx`: convert every section to `Section variant="card"`. Replace inline copy paragraphs and the big red Reset block with `DisplayRow`, `ActionRow`, and a single destructive `ActionRow` styled with `bg-error/10 text-error`. Tier limits table moves inside its own card.

## Tasks

### Task 1: Unify Ticker page

- [ ] Replace `SettingGroup` headers with `Section title="..." variant="card"` containers.
- [ ] Promote the “Enable ticker” toggle into a `Behavior` card with `ToggleRow`s and `SegmentedRow`s for `Scroll mode`, `Direction`, `Item order` (Direction hidden when `scrollMode === "flip"`).
- [ ] Add a `Display` card with `SegmentedRow` for `Detail level`, `SegmentedRow` for `Spacing`, `SegmentedRow` for `Chip colors`, and a `SliderRow` for `Scale` bound to `appearance.tickerScale`.
- [ ] Add a `Motion` card with `SliderRow` for `Speed`.
- [ ] Move the preview block to a `Live preview` card at the top with the same `Section` framing.
- [ ] Keep `Rows` as its own card containing the existing `RowCard` builder. Remove the old "shared with Home" info banner inside the card; surface that note via a tooltip on the section title instead.
- [ ] Delete `SettingGroup`, `VisualCard`, `AdvancedRow`, `SegmentedPicker`, `SpeedSlider`, and the local `ScaleSlider` once unused.

### Task 2: Unify Account page

- [ ] Wrap every existing `<Section>` with `variant="card"`.
- [ ] Account card: keep `DisplayRow` for "Signed in as" and "Plan", convert sign-out into an `ActionRow` with `actionClass="bg-error/10 text-error hover:bg-error/20"`.
- [ ] Security card: convert the password reset block into a single `ActionRow` whose `action` text reflects `idle`/`sending`/`sent` states; replace inline subtitle with a tooltip on the label.
- [ ] Subscription card: keep the same logic but drop the freeform paragraphs in favor of `DisplayRow`s (`Status`, `Plan`, `Renews`, `Trial`, etc.) plus a footer `ActionRow` for `Manage Subscription` / `Update Payment` / `See Plans`. Title remains `Subscription` regardless of trial state; trial state is reflected by the Status row badge.
- [ ] Plan card: keep `TierLimitsTable` inside a `Section variant="card" title="Plan limits"`, render the upgrade button as a single `ActionRow` (`Upgrade to Uplink` / `Upgrade plan`).
- [ ] Data card: keep `AccountExportButton` inside a `Section variant="card" title="Data"`.
- [ ] Danger zone: replace the big red panel with a `Section variant="card" title="Danger zone"` and a single destructive `ActionRow` (`Reset all settings`) styled with `actionClass="bg-error/10 text-error hover:bg-error/20"`.
- [ ] Leave the `ConfirmDialog` wiring untouched.

### Task 3: Verify

- [ ] Run `npm run build` in `desktop/`.
- [ ] Leave the running `tauri:dev` process alone for hot reload.
