# Settings Stable Columns Dense Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore live UI scale preview by stabilizing the Settings grid so webview zoom changes never flip column count mid-drag, and re-skin the slider to match the dense row style of every other setting.

**Architecture:** Replace the responsive grid with a fixed 2-column grid that does not depend on a viewport breakpoint, then collapse the scale control back into a single dense settings row with an inline slider and live preview.

**Tech Stack:** React 19, Tailwind v4 utility classes, existing settings card layout.

---

## File Structure

- Modify `desktop/src/components/settings/GeneralSettings.tsx`: switch grid to fixed two columns and replace the deferred slider with a dense live-preview row.
- No changes to shared settings controls.

## Tasks

### Task 1: Stabilize Settings two-column grid

- [ ] Replace `lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]` with `grid-cols-2 min-w-0` so the layout is always two columns inside the Settings page width.
- [ ] Keep `gap-4 items-start` and inner `min-w-0` cells.

### Task 2: Replace scale control with dense slider row

- [ ] Remove the `DeferredScaleSliderRow` component and any leftover description/range hint UI.
- [ ] Render the display size row as a single dense flex row matching other settings: left label, right pill showing current value, and a slim inline slider taking the right-side column area.
- [ ] Make the slider call `onChange` on every input change for live preview.
- [ ] Preserve `uiScale` clamping at min `75`, max `150`, step `5`.

### Task 3: Verify

- [ ] Run `npm run build` in `desktop/`.
- [ ] Visually confirm dragging the slider stays attached and the page does not reflow between 1 and 2 columns while the zoom changes.
