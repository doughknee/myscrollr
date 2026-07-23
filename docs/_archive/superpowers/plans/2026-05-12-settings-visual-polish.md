# Settings Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the flattened Settings page feel polished by removing dashed label affordances, softening cards, and balancing the two-column layout.

**Architecture:** Keep the existing route split and settings logic intact. Make presentation-only edits in shared settings controls and the flat `GeneralSettings` layout.

**Tech Stack:** React 19, Tailwind v4 utility classes, existing settings controls, existing Tooltip component.

---

## File Structure

- Modify `desktop/src/components/settings/SettingsControls.tsx`: remove dashed underline styling, quiet card chrome, tighten row rhythm.
- Modify `desktop/src/components/settings/GeneralSettings.tsx`: rebalance section distribution so left column contains Appearance, Window, Startup and right column contains Keyboard shortcuts, Updates, About.

## Tasks

### Task 1: Quiet the card and label styling

- [ ] Remove dashed underline classes from `SettingLabel` while preserving tooltip content.
- [ ] Change card sections from heavy bordered header bands to quieter panels with subtle border/background and plain title spacing.
- [ ] Reduce row padding slightly so controls feel less bulky.

### Task 2: Rebalance the Settings grid

- [ ] Move Window and Startup into the left column below Appearance.
- [ ] Keep Keyboard shortcuts, Updates, and About in the right column.
- [ ] Preserve all labels, descriptions, values, and callbacks.

### Task 3: Verify

- [ ] Run `npm run build` in `desktop/`.
- [ ] Leave the running Tauri dev server alone; Vite should hot-reload the presentation changes.
