/**
 * Ticker.
 *
 * Every conditional here mirrors what ScrollrTicker actually reads, so
 * the page never offers a control that does nothing:
 *   - Direction is meaningless in Rotate (pages swap, they don't travel).
 *   - Time per page only exists for the two timed modes (:335, :363).
 *   - Hover speed is only consulted in continuous scroll; Page and
 *     Rotate halt outright on hover instead (:316, :372), so the toggle's
 *     description changes rather than the toggle disappearing.
 *
 * Screen edge writes `window.tickerPosition`; App.tsx's pref subscriber
 * owns the reposition side effect, so this only has to set the pref.
 */
import { useCallback } from "react";
import { resetCategory } from "../../../preferences";
import type {
  AppPreferences,
  ChipColorMode,
  MixMode,
  ScrollMode,
  TickerDirection,
  TickerGap,
  TickerPosition,
  TickerPrefs,
} from "../../../preferences";
import { useUndoableAction } from "../../../hooks/useUndoableAction";
import {
  RowList,
  SegmentedRow,
  SettingsGroup,
  SliderRow,
  ToggleRow,
} from "../SettingsControls";
import { Row } from "./Row";

const SCROLL_MODE_OPTIONS: { value: ScrollMode; label: string }[] = [
  { value: "continuous", label: "Continuous" },
  { value: "step", label: "Page" },
  { value: "flip", label: "Rotate" },
];

const DIRECTION_OPTIONS: { value: TickerDirection; label: string }[] = [
  { value: "left", label: "← Left" },
  { value: "right", label: "Right →" },
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

interface TickerPageProps {
  prefs: AppPreferences;
  onPrefsChange: (prefs: AppPreferences) => void;
}

export default function TickerPage({ prefs, onPrefsChange }: TickerPageProps) {
  const { ticker } = prefs;

  const hoverSpeedApplies =
    ticker.scrollMode === "continuous" && ticker.pauseOnHover;
  const stepPauseApplies =
    ticker.scrollMode === "step" || ticker.scrollMode === "flip";

  const setTicker = useCallback(
    <K extends keyof TickerPrefs>(key: K, value: TickerPrefs[K]) => {
      onPrefsChange({ ...prefs, ticker: { ...ticker, [key]: value } });
    },
    [prefs, ticker, onPrefsChange],
  );

  return (
    <>
      <SettingsGroup label="Behavior">
        <RowList>
          <Row id="scrollMode">
            <SegmentedRow
              label="Scroll mode"
              description="How chips advance: continuous scroll, page through, or rotate."
              value={ticker.scrollMode}
              options={SCROLL_MODE_OPTIONS}
              onChange={(v) => setTicker("scrollMode", v)}
            />
          </Row>
          {ticker.scrollMode !== "flip" && (
            <Row id="direction">
              <SegmentedRow
                label="Direction"
                description="Which way the ticker moves."
                value={ticker.tickerDirection}
                options={DIRECTION_OPTIONS}
                onChange={(v) => setTicker("tickerDirection", v)}
              />
            </Row>
          )}
          <Row id="itemOrder">
            <SegmentedRow
              label="Item order"
              description="Group items by source or weave them together."
              value={ticker.mixMode}
              options={MIX_OPTIONS}
              onChange={(v) => setTicker("mixMode", v)}
            />
          </Row>
        </RowList>
      </SettingsGroup>

      <SettingsGroup label="Motion">
        <RowList>
          <Row id="speed">
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
          </Row>
          {stepPauseApplies && (
            <Row id="stepPause">
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
            </Row>
          )}
          <Row id="pauseOnHover">
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
          </Row>
          {hoverSpeedApplies && (
            <Row id="hoverSpeed">
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
            </Row>
          )}
        </RowList>
      </SettingsGroup>

      <SettingsGroup label="Display">
        <RowList>
          <Row id="screenEdge">
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
          </Row>
          <Row id="detailLevel">
            <SegmentedRow
              label="Detail level"
              description="Single line vs. detail row under each chip."
              value={ticker.tickerMode}
              options={DETAIL_LEVEL_OPTIONS}
              onChange={(v) => setTicker("tickerMode", v)}
            />
          </Row>
          <Row id="spacing">
            <SegmentedRow
              label="Spacing"
              description="Gap between chips."
              value={ticker.tickerGap}
              options={SPACING_OPTIONS}
              onChange={(v) => setTicker("tickerGap", v as TickerGap)}
            />
          </Row>
          <Row id="chipColors">
            <SegmentedRow
              label="Chip colors"
              description="Source colors, accent theme, or subtle grayscale."
              value={ticker.chipColors}
              options={CHIP_COLOR_OPTIONS}
              onChange={(v) => setTicker("chipColors", v)}
            />
          </Row>
          <Row id="tickerScale">
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
          </Row>
        </RowList>
      </SettingsGroup>
    </>
  );
}

/**
 * Reset handler for the page header button. Exposed separately so the
 * surface can render the button in the title row while the undo toast
 * still snapshots through the same `useUndoableAction` contract.
 */
export function useTickerReset() {
  const undoable = useUndoableAction();
  return useCallback(
    () =>
      undoable(
        {
          label: "Reset ticker style",
          description: "Restored all ticker style defaults.",
        },
        (current) => resetCategory(current, "ticker"),
      ),
    [undoable],
  );
}
