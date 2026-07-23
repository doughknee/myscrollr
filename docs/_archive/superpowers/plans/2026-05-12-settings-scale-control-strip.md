# Settings Scale Control Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken live UI-scale slider with a polished stepper-and-preset control that avoids webview zoom drag issues.

**Architecture:** Keep the existing `uiScale` numeric preference and `setApp("uiScale", value)` update path. Implement a local `ScaleControlRow` in `GeneralSettings.tsx` so shared settings controls are not affected.

**Tech Stack:** React 19, Tailwind v4 utility classes, existing Tooltip-backed labels via section styling.

---

## File Structure

- Modify `desktop/src/components/settings/GeneralSettings.tsx`: remove `SliderRow` usage/import and add local `ScaleControlRow` helper.

## Tasks

### Task 1: Replace slider with scale control strip

- [ ] Remove `SliderRow` import.
- [ ] Replace `Display size` slider JSX with `ScaleControlRow`.
- [ ] Add `ScaleControlRow` local component with minus/plus controls, current value, range hint, and preset chips.
- [ ] Preserve `uiScale` min `75`, max `150`, step `5`, and existing preference update path.

### Task 2: Verify

- [ ] Run `npm run build` in `desktop/`.
- [ ] Leave the running `tauri:dev` process alone so the UI hot-reloads.
