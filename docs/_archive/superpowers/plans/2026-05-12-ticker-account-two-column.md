# Ticker + Account Two-Column Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the Settings page's stable two-column card grid on the Ticker and Account routes.

**Architecture:** Reuse the exact wrapper Settings uses (`grid gap-4 grid-cols-2 items-start` with `min-w-0` cells). Place the Ticker live preview full-width above the grid. Keep all card sections, behavior, and props unchanged.

**Tech Stack:** React 19, Tailwind v4, existing `SettingsControls` primitives.

---

## File Structure

- Modify `desktop/src/components/settings/TickerSettings.tsx`: keep live preview full-width, wrap Behavior + Display in the left column and Motion + Rows in the right column, keep Reset action footer outside the grid.
- Modify `desktop/src/components/settings/AccountSettings.tsx`: replace the top-level `space-y-4` wrapper with the same `grid gap-4 grid-cols-2 items-start` wrapper. Left column holds Account, Profile, Security. Right column holds Subscription (when present), Plan limits, Data, Danger zone.
- No changes to routes, props, preferences, or shared `Section`/row primitives.

## Tasks

### Task 1: Ticker page two-column grid

- [ ] Keep the existing live preview block full-width directly under the page chrome.
- [ ] Replace the `motion.div ... space-y-4` settings stack with `<motion.div className="grid gap-4 grid-cols-2 items-start">` containing two `<div className="space-y-4 min-w-0">` columns.
- [ ] Left column: `Behavior`, `Display`.
- [ ] Right column: `Motion`, `Rows`.
- [ ] Reset action stays in a footer row beneath the grid (`flex items-center justify-end pt-1`).

### Task 2: Account page two-column grid

- [ ] Replace the outer `<div className="space-y-4">` with `<div className="grid gap-4 grid-cols-2 items-start">` containing two `<div className="space-y-4 min-w-0">` columns.
- [ ] Left column: `Account`, `Profile` (when authenticated), `Security` (when authenticated).
- [ ] Right column: `Subscription` (when present), `Plan limits` (when authenticated), `Data` (when authenticated), `Danger zone`.
- [ ] Keep `ConfirmDialog` mounts outside the grid.

### Task 3: Verify

- [ ] Run `npm run build` in `desktop/`.
- [ ] Leave the running `tauri:dev` process alone for hot reload.
