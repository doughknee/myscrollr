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
import { useUndoableAction } from "../../hooks/useUndoableAction";
import type {
  AppPreferences,
  TickerPrefs,
  TickerGap,
  MixMode,
  ChipColorMode,
  TickerDirection,
  ScrollMode,
  TickerPosition,
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

const POSITION_OPTIONS: { value: TickerPosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
];

// ── Component ───────────────────────────────────────────────────

export default function TickerSettings({ prefs, onPrefsChange }: TickerSettingsProps) {
  const { ticker } = prefs;

  // Hover only slows a continuously scrolling ticker. Page and Rotate
  // advance on a timer, so hovering there halts the next step outright
  // and `hoverSpeed` is never consulted (ScrollrTicker.tsx:316, :372).
  const hoverSpeedApplies =
    ticker.scrollMode === "continuous" && ticker.pauseOnHover;
  // Conversely, the dwell time between advances only exists for the two
  // timed modes.
  const stepPauseApplies =
    ticker.scrollMode === "step" || ticker.scrollMode === "flip";

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
          {stepPauseApplies && (
            <SliderRow
              label="Time per page"
              description="How long each page stays put before the ticker advances."
              value={ticker.stepPause}
              min={1}
              max={10}
              step={1}
              displayValue={`${ticker.stepPause}s`}
              onChange={(v) => setTicker("stepPause", v)}
            />
          )}
          <ToggleRow
            label="Slow down on hover"
            description={
              ticker.scrollMode === "continuous"
                ? "Ease off while you hover so chips are easier to read."
                : "Hold the current page while you hover so it doesn't advance out from under you."
            }
            checked={ticker.pauseOnHover}
            onChange={(v) => setTicker("pauseOnHover", v)}
          />
          {hoverSpeedApplies && (
            <SliderRow
              label="Hover speed"
              description="How far it slows while hovered. At 0% the ticker stops completely."
              value={Math.round(ticker.hoverSpeed * 100)}
              min={0}
              max={100}
              step={5}
              displayValue={
                ticker.hoverSpeed === 0
                  ? "Stop"
                  : `${Math.round(ticker.hoverSpeed * 100)}%`
              }
              onChange={(v) => setTicker("hoverSpeed", v / 100)}
            />
          )}
        </Section>
        </div>

        <div className="space-y-4 min-w-0">
        {/* ── Display ────────────────────────────────────────── */}
        <Section title="Display" variant="card">
          {/* Screen edge lived only on the ticker's own hover toolbar and
              right-click menu, which is exactly the discoverability
              problem TickerToolbar's persistent hint icon exists to work
              around. It's a placement choice; it belongs here too. The
              side effects (reposition + persist) are already handled by
              the window.tickerPosition branch in App.tsx's pref-change
              subscriber, so writing the pref is enough. */}
          <SegmentedRow
            label="Screen edge"
            description="Which edge of the screen the ticker sits on."
            value={prefs.window.tickerPosition}
            options={POSITION_OPTIONS}
            onChange={(v) =>
              onPrefsChange({
                ...prefs,
                window: { ...prefs.window, tickerPosition: v },
              })
            }
          />
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
      </div>

      {/* ── Reset ──────────────────────────────────────────── */}
      <div className="flex items-center justify-end pt-3">
        <ResetButton label="Reset ticker settings" onClick={handleReset} />
      </div>
    </div>
  );
}
