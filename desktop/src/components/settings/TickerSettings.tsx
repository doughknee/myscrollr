/**
 * Ticker settings — presentation controls for the ticker strip.
 *
 * The standalone ticker window's on/off toggle lives in the TopBar so
 * it isn't duplicated here. Settings sections mirror the Settings page
 * (dense card grid, tooltip-labeled rows).
 */
import { useCallback } from "react";
import { resetCategory } from "../../preferences";
import {
  Section,
  SegmentedRow,
  SliderRow,
  ToggleRow,
  ResetButton,
} from "./SettingsControls";
import { getTier } from "../../auth";
import { useUndoableAction } from "../../hooks/useUndoableAction";
import type {
  AppPreferences,
  TickerPrefs,
  TickerGap,
  MixMode,
  ChipColorMode,
  TickerDirection,
  ScrollMode,
} from "../../preferences";

// ── Props ───────────────────────────────────────────────────────

interface TickerSettingsProps {
  prefs: AppPreferences;
  onPrefsChange: (prefs: AppPreferences) => void;
}

// ── Options ─────────────────────────────────────────────────────

const SCROLL_MODE_OPTIONS: { value: ScrollMode; label: string }[] = [
  { value: "continuous", label: "Continuous" },
  { value: "step", label: "Page" },
  { value: "flip", label: "Rotate" },
];

const DIRECTION_OPTIONS: { value: TickerDirection; label: string }[] = [
  { value: "left", label: "\u2190 Left" },
  { value: "right", label: "Right \u2192" },
];

const MIX_OPTIONS: { value: MixMode; label: string }[] = [
  { value: "grouped", label: "By source" },
  { value: "weave", label: "Mixed" },
];

const DETAIL_LEVEL_OPTIONS: { value: "compact" | "comfort"; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfort", label: "Detailed" },
];

const SPACING_OPTIONS: { value: TickerGap; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "spacious", label: "Wide" },
];

const CHIP_COLOR_OPTIONS: { value: ChipColorMode; label: string }[] = [
  { value: "widget", label: "Widget" },
  { value: "accent", label: "Theme" },
  { value: "muted", label: "Subtle" },
];

// ── Component ───────────────────────────────────────────────────

export default function TickerSettings({ prefs, onPrefsChange }: TickerSettingsProps) {
  const { ticker } = prefs;
  const tier = getTier();


  // Undoable destructive-action wrapper. Every "the user might regret
  // this" mutation in this file routes through `undoable` instead of
  // `onPrefsChange` directly so a 5-second toast with Undo appears.
  // See `hooks/useUndoableAction.ts` for the contract.
  const undoable = useUndoableAction();

  const setTicker = useCallback(<K extends keyof TickerPrefs>(key: K, value: TickerPrefs[K]) => {
    onPrefsChange({ ...prefs, ticker: { ...ticker, [key]: value } });
  }, [prefs, ticker, onPrefsChange]);

  // Resetting all ticker prefs is destructive (overwrites speed,
  // colors, mode, etc.) but trivially reversible — we snapshot the
  // current category and toast Undo.
  const handleReset = useCallback(() => {
    undoable(
      { label: "Reset ticker style", description: "Restored all ticker style defaults." },
      (current) => resetCategory(current, "ticker"),
    );
  }, [undoable]);


  return (
    <div>
      {/* ── Settings cards ────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-2 items-start">
        <div className="space-y-4 min-w-0">
        {/* ── Behavior ───────────────────────────────────────── */}
        <Section title="Behavior" variant="card">
          <ToggleRow
            label="Pause on hover"
            description="Slow the ticker while you hover so chips are easier to read."
            checked={ticker.pauseOnHover}
            onChange={(v) => setTicker("pauseOnHover", v)}
          />
          <SegmentedRow
            label="Scroll mode"
            description="How chips advance: continuous scroll, page through, or rotate."
            value={ticker.scrollMode}
            options={SCROLL_MODE_OPTIONS}
            onChange={(v) => setTicker("scrollMode", v)}
          />
          {ticker.scrollMode !== "flip" && (
            <SegmentedRow
              label="Direction"
              description="Which way the ticker moves."
              value={ticker.tickerDirection}
              options={DIRECTION_OPTIONS}
              onChange={(v) => setTicker("tickerDirection", v)}
            />
          )}
          <SegmentedRow
            label="Item order"
            description="Group items by source or weave them together."
            value={ticker.mixMode}
            options={MIX_OPTIONS}
            onChange={(v) => setTicker("mixMode", v)}
          />
        </Section>

        {/* ── Display ────────────────────────────────────────── */}
        <Section title="Display" variant="card">
          <SegmentedRow
            label="Detail level"
            description="Single line vs. detail row under each chip."
            value={ticker.tickerMode}
            options={DETAIL_LEVEL_OPTIONS}
            onChange={(v) => setTicker("tickerMode", v)}
          />
          <SegmentedRow
            label="Spacing"
            description="Gap between chips."
            value={ticker.tickerGap}
            options={SPACING_OPTIONS}
            onChange={(v) => setTicker("tickerGap", v as TickerGap)}
          />
          <SegmentedRow
            label="Chip colors"
            description="Source colors, accent theme, or subtle grayscale."
            value={ticker.chipColors}
            options={CHIP_COLOR_OPTIONS}
            onChange={(v) => setTicker("chipColors", v)}
          />
          <SliderRow
            label="Scale"
            description="Resize the ticker window. Independent from the main app scale."
            value={prefs.appearance.tickerScale}
            min={75}
            max={150}
            step={5}
            displayValue={`${prefs.appearance.tickerScale}%`}
            onChange={(v) =>
              onPrefsChange({
                ...prefs,
                appearance: { ...prefs.appearance, tickerScale: v },
              })
            }
          />
        </Section>
        </div>

        <div className="space-y-4 min-w-0">
        {/* ── Motion ─────────────────────────────────────────── */}
        <Section title="Motion" variant="card">
          <SliderRow
            label="Speed"
            description="How fast the ticker scrolls."
            value={ticker.tickerSpeed}
            min={5}
            max={150}
            step={1}
            displayValue={`${ticker.tickerSpeed}`}
            onChange={(v) => setTicker("tickerSpeed", v)}
          />
        </Section>

        </div>
      </div>

      {/* ── Reset ──────────────────────────────────────────── */}
      <div className="flex items-center justify-end pt-3">
        <ResetButton label="Reset ticker settings" onClick={handleReset} />
      </div>
    </div>
  );
}
