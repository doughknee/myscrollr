# Settings Shortcuts Scale Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the Settings Appearance and Keyboard Shortcuts UX without changing preference semantics or adding global shortcut behavior.

**Architecture:** Keep the existing `uiScale` numeric preference and existing keydown handlers. Replace the segmented display-size control with the existing slider row and make the shortcuts section explicitly in-app only.

**Tech Stack:** React 19, Tailwind v4 utility classes, existing `SliderRow`, existing settings card layout.

---

## File Structure

- Modify `desktop/src/components/settings/GeneralSettings.tsx`: use `SliderRow` for display size, rename/polish shortcuts section, and update `ShortcutsList` presentation.
- No preference, routing, Tauri, or shortcut handler files change.

## Tasks

### Task 1: Convert Display size to a slider

- [ ] Import `SliderRow` from `SettingsControls`.
- [ ] Replace the `SegmentedRow` for `Display size` with `SliderRow` using `min={75}`, `max={150}`, `step={5}`, `displayValue={`${appearance.uiScale}%`}`, and the existing `setApp("uiScale", value)` path.
- [ ] Remove the now-unused `SCALE_PRESETS` constant.

### Task 2: Polish in-app shortcuts

- [ ] Rename the section to `In-app shortcuts`.
- [ ] Add a compact note explaining shortcuts work while Scrollr is focused.
- [ ] Render shortcut rows with cleaner spacing and a small `Focused` scope badge.
- [ ] Preserve the existing shortcut list and labels.

### Task 3: Verify

- [ ] Run `npm run build` in `desktop/`.
- [ ] Leave the running `tauri:dev` process alone so the UI hot-reloads.
