/**
 * Ticker — the bar, in the order a person thinks about it:
 * is it on → where → what it looks like → how it moves → how it behaves
 * (docs/SETTINGS_AUDIT.md §1, §3; REL-204).
 *
 * Every number on this page is a preset, never a slider. The prefs stay
 * numbers (`tickerSpeed`, `stepPause`, `tickerScale`) so the bar reads
 * them unchanged; `loadPrefs` snaps anything off the list.
 *
 * Time per page only exists in Page mode, so it only renders there.
 * Hide-when-fullscreen only does anything on Windows, so it only
 * renders there.
 *
 * Screen edge writes `window.tickerPosition`; App.tsx's pref subscriber
 * owns the reposition side effect, so this only has to set the pref.
 */
import { useCallback } from "react";
import {
  resetTickerPage,
  SCALE_PRESETS,
  STEP_PAUSES,
  TICKER_SPEEDS,
} from "../../../preferences";
import type {
  AppPreferences,
  ChipColorMode,
  HoverBehavior,
  MixMode,
  ScrollMode,
  TickerPosition,
  TickerPrefs,
  WindowPrefs,
} from "../../../preferences";
import { useUndoableAction } from "../../../hooks/useUndoableAction";
import { IS_WINDOWS } from "../../WindowControls";
import { IdentifyButton, MonitorsRows } from "../MonitorMap";
import {
  RowList,
  SegmentedRow,
  SettingsGroup,
  ToggleRow,
} from "../SettingsControls";
import { Row } from "./Row";

const POSITION_OPTIONS: { value: TickerPosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
];

const DETAIL_LEVEL_OPTIONS: { value: "compact" | "comfort"; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfort", label: "Detailed" },
];

const SIZE_OPTIONS = SCALE_PRESETS.map((v) => ({
  value: String(v),
  label: `${v}%`,
}));

const CHIP_COLOR_OPTIONS: { value: ChipColorMode; label: string }[] = [
  { value: "widget", label: "Widget" },
  { value: "accent", label: "Theme" },
  { value: "muted", label: "Subtle" },
];

const SCROLL_MODE_OPTIONS: { value: ScrollMode; label: string }[] = [
  { value: "continuous", label: "Continuous" },
  { value: "step", label: "Page" },
];

const SPEED_OPTIONS = [
  { value: String(TICKER_SPEEDS.slow), label: "Slow" },
  { value: String(TICKER_SPEEDS.normal), label: "Normal" },
  { value: String(TICKER_SPEEDS.fast), label: "Fast" },
];

const HOVER_OPTIONS: { value: HoverBehavior; label: string }[] = [
  { value: "keep", label: "Keep moving" },
  { value: "slow", label: "Slow down" },
  { value: "pause", label: "Pause" },
];

const STEP_PAUSE_OPTIONS = STEP_PAUSES.map((v) => ({
  value: String(v),
  label: `${v} s`,
}));

const MIX_OPTIONS: { value: MixMode; label: string }[] = [
  { value: "grouped", label: "By source" },
  { value: "weave", label: "Mixed" },
];

interface TickerPageProps {
  prefs: AppPreferences;
  onPrefsChange: (prefs: AppPreferences) => void;
}

export default function TickerPage({ prefs, onPrefsChange }: TickerPageProps) {
  const { ticker, window: window_ } = prefs;
  const paged = ticker.scrollMode === "step";

  const setTicker = useCallback(
    <K extends keyof TickerPrefs>(key: K, value: TickerPrefs[K]) =>
      onPrefsChange({ ...prefs, ticker: { ...ticker, [key]: value } }),
    [prefs, ticker, onPrefsChange],
  );
  const setWindow = useCallback(
    <K extends keyof WindowPrefs>(key: K, value: WindowPrefs[K]) =>
      onPrefsChange({ ...prefs, window: { ...window_, [key]: value } }),
    [prefs, window_, onPrefsChange],
  );

  return (
    <>
      <SettingsGroup label="On">
        <RowList>
          <Row id="showTicker">
            <ToggleRow
              label="Show the ticker"
              description="The bar on your screen. Ctrl+T, the tray and the ticker's right-click menu do the same."
              checked={ticker.showTicker}
              onChange={(v) => setTicker("showTicker", v)}
            />
          </Row>
        </RowList>
      </SettingsGroup>

      <SettingsGroup label="Where" action={<IdentifyButton />}>
        <MonitorsRows
          chosen={window_.tickerMonitors}
          onChange={(v) => setWindow("tickerMonitors", v)}
        />
        <RowList>
          <Row id="screenEdge">
            <SegmentedRow
              label="Screen edge"
              description="Which edge of the screen the ticker sits on."
              value={window_.tickerPosition}
              options={POSITION_OPTIONS}
              onChange={(v) => setWindow("tickerPosition", v)}
            />
          </Row>
        </RowList>
      </SettingsGroup>

      <SettingsGroup label="Look">
        <RowList>
          <Row id="detailLevel">
            <SegmentedRow
              label="Detail level"
              description="One line per chip, or a detail row under each."
              value={ticker.tickerMode}
              options={DETAIL_LEVEL_OPTIONS}
              onChange={(v) => setTicker("tickerMode", v)}
            />
          </Row>
          <Row id="tickerScale">
            <SegmentedRow
              label="Size"
              description="Resize the bar. The app window has its own size."
              value={String(prefs.appearance.tickerScale)}
              options={SIZE_OPTIONS}
              onChange={(v) =>
                onPrefsChange({
                  ...prefs,
                  appearance: { ...prefs.appearance, tickerScale: Number(v) },
                })
              }
            />
          </Row>
          <Row id="chipColors">
            <SegmentedRow
              label="Chip colors"
              description="Each widget's own color, the theme accent, or subtle grays."
              value={ticker.chipColors}
              options={CHIP_COLOR_OPTIONS}
              onChange={(v) => setTicker("chipColors", v)}
            />
          </Row>
        </RowList>
      </SettingsGroup>

      <SettingsGroup label="Motion">
        <RowList>
          <Row id="scrollMode">
            <SegmentedRow
              label="Scroll mode"
              description="Scroll without stopping, or show a page at a time."
              value={ticker.scrollMode}
              options={SCROLL_MODE_OPTIONS}
              onChange={(v) => setTicker("scrollMode", v)}
            />
          </Row>
          <Row id="speed">
            <SegmentedRow
              label="Speed"
              description={
                paged
                  ? "How quickly each page slides in."
                  : "How fast the chips travel."
              }
              value={String(ticker.tickerSpeed)}
              options={SPEED_OPTIONS}
              onChange={(v) => setTicker("tickerSpeed", Number(v))}
            />
          </Row>
          <Row id="onHover">
            <SegmentedRow
              label="On hover"
              description={
                paged
                  ? "Whether the page holds still while your mouse is over it."
                  : "What the bar does while your mouse is over it."
              }
              value={ticker.onHover}
              options={HOVER_OPTIONS}
              onChange={(v) => setTicker("onHover", v)}
            />
          </Row>
          {paged && (
            <Row id="stepPause">
              <SegmentedRow
                label="Time per page"
                description="How long each page stays before the next one."
                value={String(ticker.stepPause)}
                options={STEP_PAUSE_OPTIONS}
                onChange={(v) => setTicker("stepPause", Number(v))}
              />
            </Row>
          )}
        </RowList>
      </SettingsGroup>

      <SettingsGroup label="Behaviour">
        <RowList>
          <Row id="alwaysOnTop">
            <ToggleRow
              label="Stay above other windows"
              description="Keep the ticker visible over whatever else is open."
              checked={window_.pinned}
              onChange={(v) => setWindow("pinned", v)}
            />
          </Row>
          {IS_WINDOWS && (
            <Row id="hideFullscreen">
              <ToggleRow
                label="Hide when an app goes fullscreen"
                description="Get out of the way of games, videos and presentations."
                checked={window_.hideOnFullscreen}
                onChange={(v) => setWindow("hideOnFullscreen", v)}
              />
            </Row>
          )}
          <Row id="itemOrder">
            <SegmentedRow
              label="Item order"
              description="Keep each widget's items together, or mix them."
              value={ticker.mixMode}
              options={MIX_OPTIONS}
              onChange={(v) => setTicker("mixMode", v)}
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
 * Button, toast and undo share the one name.
 */
export const RESET_TICKER_LABEL = "Reset ticker settings";

export function useTickerReset() {
  const undoable = useUndoableAction();
  return useCallback(
    () =>
      undoable(
        {
          label: RESET_TICKER_LABEL,
          description: "Every setting on the Ticker page is back to its default.",
        },
        resetTickerPage,
      ),
    [undoable],
  );
}
