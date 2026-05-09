/**
 * Ticker settings — presentation controls for the ticker strip.
 *
 * Features a live preview that responds to every setting change in
 * real-time, visual card selectors for layout and style options,
 * and a collapsible advanced section.
 *
 * Extracted from routes/ticker.tsx for use inside the tabbed Settings page.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Ticker } from "motion-plus/react";
import { motion, AnimatePresence, useMotionValue, animate } from "motion/react";
import { clsx } from "clsx";
import { ChevronDown, Plus, Trash2, Lock, Info } from "lucide-react";
import { resetCategory, removeTickerRow } from "../../preferences";
import { ResetButton } from "./SettingsControls";
import { getTier } from "../../auth";
import { getAllChannels } from "../../channels/registry";
import { getAllWidgets } from "../../widgets/registry";
import { useTickerLayout } from "../../hooks/useTickerLayout";
import { useUndoableAction } from "../../hooks/useUndoableAction";
import type {
  AppPreferences,
  TickerPrefs,
  TickerGap,
  MixMode,
  ChipColorMode,
  TickerDirection,
  ScrollMode,
  TickerRowConfig,
} from "../../preferences";

// ── Props ───────────────────────────────────────────────────────

interface TickerSettingsProps {
  prefs: AppPreferences;
  onPrefsChange: (prefs: AppPreferences) => void;
}

// ── Sample chip data for the live preview ───────────────────────

interface SampleChip {
  label: string;
  value: string;
  detail?: string;
  color: string;
  textColor: string;
  borderColor: string;
}

const SAMPLE_CHIPS: SampleChip[] = [
  // Finance (4)
  { label: "FINANCE", value: "Symbol \u00B7 Price", detail: "Exchange \u00B7 Change %", color: "bg-primary/[0.06]", textColor: "text-primary", borderColor: "ring-primary/25" },
  { label: "FINANCE", value: "Ticker \u00B7 Change", detail: "Sector \u00B7 Market Cap", color: "bg-primary/[0.06]", textColor: "text-primary", borderColor: "ring-primary/25" },
  { label: "FINANCE", value: "Index \u00B7 Value", detail: "Day High \u00B7 Day Low", color: "bg-primary/[0.06]", textColor: "text-primary", borderColor: "ring-primary/25" },
  { label: "FINANCE", value: "Crypto \u00B7 Price", detail: "24h Vol \u00B7 Change %", color: "bg-primary/[0.06]", textColor: "text-primary", borderColor: "ring-primary/25" },
  // Sports (4)
  { label: "SPORTS", value: "Team vs Team", detail: "League \u00B7 Game Time", color: "bg-secondary/[0.06]", textColor: "text-secondary", borderColor: "ring-secondary/25" },
  { label: "SPORTS", value: "Score \u00B7 Status", detail: "Quarter \u00B7 Time Left", color: "bg-secondary/[0.06]", textColor: "text-secondary", borderColor: "ring-secondary/25" },
  { label: "SPORTS", value: "Team \u00B7 Record", detail: "Conference \u00B7 Rank", color: "bg-secondary/[0.06]", textColor: "text-secondary", borderColor: "ring-secondary/25" },
  { label: "SPORTS", value: "Final \u00B7 Score", detail: "Highlights \u00B7 Recap", color: "bg-secondary/[0.06]", textColor: "text-secondary", borderColor: "ring-secondary/25" },
  // RSS (4)
  { label: "RSS", value: "Article Headline", detail: "Source \u00B7 Time Ago", color: "bg-info/[0.06]", textColor: "text-info", borderColor: "ring-info/25" },
  { label: "RSS", value: "News Title", detail: "Feed Name \u00B7 Published", color: "bg-info/[0.06]", textColor: "text-info", borderColor: "ring-info/25" },
  { label: "RSS", value: "Blog Post Title", detail: "Author \u00B7 Read Time", color: "bg-info/[0.06]", textColor: "text-info", borderColor: "ring-info/25" },
  { label: "RSS", value: "Breaking News", detail: "Category \u00B7 Just Now", color: "bg-info/[0.06]", textColor: "text-info", borderColor: "ring-info/25" },
  // Fantasy (4)
  { label: "FANTASY", value: "Player \u00B7 Points", detail: "Position \u00B7 Team", color: "bg-accent-purple/[0.06]", textColor: "text-accent-purple", borderColor: "ring-accent-purple/25" },
  { label: "FANTASY", value: "Matchup \u00B7 Score", detail: "Week \u00B7 Standing", color: "bg-accent-purple/[0.06]", textColor: "text-accent-purple", borderColor: "ring-accent-purple/25" },
  { label: "FANTASY", value: "Roster \u00B7 Projected", detail: "Bench \u00B7 Waiver", color: "bg-accent-purple/[0.06]", textColor: "text-accent-purple", borderColor: "ring-accent-purple/25" },
  { label: "FANTASY", value: "Trade \u00B7 Offer", detail: "Deadline \u00B7 Status", color: "bg-accent-purple/[0.06]", textColor: "text-accent-purple", borderColor: "ring-accent-purple/25" },
  // Weather (1)
  { label: "WEATHER", value: "Location \u00B7 Temp", detail: "Condition \u00B7 Feels Like", color: "bg-widget-weather/[0.06]", textColor: "text-widget-weather", borderColor: "ring-widget-weather/25" },
  // Sysmon (1)
  { label: "SYSMON", value: "CPU \u00B7 Usage %", detail: "Frequency \u00B7 Temp", color: "bg-widget-sysmon/[0.06]", textColor: "text-widget-sysmon", borderColor: "ring-widget-sysmon/25" },
  // GitHub (1)
  { label: "GITHUB", value: "Repo \u00B7 CI Status", detail: "Workflow \u00B7 Time Ago", color: "bg-widget-github/[0.06]", textColor: "text-widget-github", borderColor: "ring-widget-github/25" },
  // Uptime (1)
  { label: "UPTIME", value: "Monitor \u00B7 Uptime %", detail: "Status \u00B7 Last Checked", color: "bg-widget-uptime/[0.06]", textColor: "text-widget-uptime", borderColor: "ring-widget-uptime/25" },
];

const MUTED_OVERRIDE = {
  color: "bg-fg/[0.03]",
  textColor: "text-fg-2",
  borderColor: "ring-fg/10",
};

const ACCENT_OVERRIDE = {
  color: "bg-primary/[0.06]",
  textColor: "text-primary",
  borderColor: "ring-primary/25",
};

// ── Chip ordering for preview ───────────────────────────────────

/** Group chips by their label (source), then round-robin interleave. */
function weaveChips(chips: SampleChip[]): SampleChip[] {
  const groups: Record<string, SampleChip[]> = {};
  for (const chip of chips) {
    (groups[chip.label] ??= []).push(chip);
  }
  const buckets = Object.values(groups);
  if (buckets.length === 0) return [];
  const result: SampleChip[] = [];
  const maxLen = Math.max(...buckets.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) result.push(bucket[i]);
    }
  }
  return result;
}

function orderChips(chips: SampleChip[], mode: MixMode): SampleChip[] {
  return mode === "weave" ? weaveChips(chips) : chips;
}

// ── Advanced options ────────────────────────────────────────────

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

// ── Component ───────────────────────────────────────────────────

export default function TickerSettings({ prefs, onPrefsChange }: TickerSettingsProps) {
  const { ticker } = prefs;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const tier = getTier();

  // Single source of truth for layout state, shared with the Home page
  // RowSelectors and the tray submenus. `rowCount`, `tierMaxRows`,
  // `canAddRow`, etc. all flow from this hook so this surface and Home
  // can never drift on what's possible vs what currently exists.
  const tickerLayout = useTickerLayout(prefs, onPrefsChange, tier);
  const {
    rows,
    rowCount,
    tierMaxRows: maxRows,
    canAddRow,
    canCustomize,
    addRow: addRowFromHook,
    setSourceRow,
  } = tickerLayout;

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

  // ── Row mutations ─────────────────────────────────────────────
  // Thin wrappers around the hook so the JSX below stays readable.
  // Note: the toggle is now `setSourceRow(id, row | null)` — moving a
  // source into a row implicitly removes it from any other row, which
  // matches the Home-page RowSelector semantics. Pre-refactor the
  // Settings checkbox grid had its own custom multi-row toggle logic
  // that duplicated `setSourceTickerRow`; collapsing them removes a
  // class of "Settings says X, Home says Y" bugs.
  const addRow = useCallback(() => {
    addRowFromHook();
  }, [addRowFromHook]);

  const toggleRowSource = useCallback(
    (rowIndex: number, sourceId: string) => {
      const row = rows[rowIndex];
      const isInTarget = row.sources.includes(sourceId);
      // Toggling ON in row N moves the source there (and out of any
      // other row). Toggling OFF removes it entirely (Off everywhere).
      // This mirrors Home's [Off][Row 1]…[Row N] semantics exactly.
      setSourceRow(sourceId, isInTarget ? null : rowIndex);
    },
    [rows, setSourceRow],
  );

  const deleteRow = useCallback(
    (index: number) => {
      // Build the toast description from the row's actual contents so
      // the user knows what they just lost. Empty rows ("shows all
      // sources") get a generic label instead of the noisy "Removed:
      // (nothing)" string.
      const row = rows[index];
      const sources = row?.sources ?? [];
      const sourceLabel = sources.length === 0
        ? undefined
        : sources.length <= 3
          ? `Removed: ${sources.join(", ")}.`
          : `Removed: ${sources.slice(0, 3).join(", ")} +${sources.length - 3} more.`;
      undoable(
        { label: `Removed Row ${index + 1}`, description: sourceLabel },
        (current) => removeTickerRow(current, index),
      );
    },
    [rows, undoable],
  );

  // ── Available sources (channels + enabled widgets) ────────────
  const availableSources = useMemo(() => {
    const channels = getAllChannels().map((ch) => ({
      id: ch.id,
      label: ch.tabLabel,
      hex: ch.hex,
    }));
    const widgets = getAllWidgets()
      .filter((w) => prefs.widgets.enabledWidgets.includes(w.id))
      .map((w) => ({
        id: w.id,
        label: w.tabLabel,
        hex: w.hex,
      }));
    return [...channels, ...widgets];
  }, [prefs.widgets.enabledWidgets]);

  // Compute preview params — reflect all settings
  const gapPx = ticker.tickerGap === "tight" ? 8 : ticker.tickerGap === "spacious" ? 20 : 12;
  const comfort = ticker.tickerMode === "comfort";

  return (
    <div>
      {/* ── Header with on/off toggle ─────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[12px] font-mono text-fg-3">Enable ticker</span>
        <button
          onClick={() => setTicker("showTicker", !ticker.showTicker)}
          className={clsx(
            "relative w-9 h-5 rounded-full transition-colors",
            ticker.showTicker ? "bg-accent" : "bg-base-350",
          )}
          aria-label={ticker.showTicker ? "Disable ticker" : "Enable ticker"}
        >
          <div
            className={clsx(
              "absolute top-[3px] left-[3px] h-3.5 w-3.5 rounded-full transition-transform duration-200",
              ticker.showTicker
                ? "translate-x-[16px] bg-surface"
                : "translate-x-0 bg-fg-3",
            )}
          />
        </button>
      </div>

      {/* ── Live Preview ──────────────────────────────────────── */}
      {/* Animation strategy:
           - Outer wrapper uses `layout` (not `layout="size"`) and a
             gentle spring so the preview grows/shrinks smoothly when
             rows are added/removed instead of snapping or compounding
             with inner chip layouts.
           - Each row is keyed by its stable index ONLY (no `rows.length`
             baked in) so adding a row doesn't remount the existing
             rows mid-scroll. AnimatePresence handles enter/exit for
             rows that are actually appearing/disappearing.
           - PreviewRow itself owns the scroll-mode swap internally
             via a crossfade, so changing scrollMode/direction/mixMode
             never tears down the row container. */}
      <div className="pb-5">
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.7 }}
          className={clsx(
            "rounded-xl border border-edge/50 bg-base-150 overflow-hidden relative py-1",
            !ticker.showTicker && "opacity-30 pointer-events-none",
          )}
        >
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent z-10 pointer-events-none" />
          <AnimatePresence initial={false}>
            {rows.map((row, rowIdx) => {
              // Filter the sample chips to match the row's configured sources.
              // Empty sources = show everything (matches runtime behaviour).
              // Label-to-source matching is case-insensitive because the chip
              // label ("FINANCE") differs from the source id ("finance").
              const rowEffectiveMixMode = row.mixMode ?? ticker.mixMode;
              const orderedChips = orderChips(SAMPLE_CHIPS, rowEffectiveMixMode);
              const rowChips = row.sources.length === 0
                ? orderedChips
                : orderedChips.filter((c) =>
                    row.sources.some((s) => s.toLowerCase() === c.label.toLowerCase()),
                  );
              return (
                <motion.div
                  key={`row-${rowIdx}`}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 340,
                    damping: 32,
                    mass: 0.7,
                    opacity: { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] },
                  }}
                  className={clsx(
                    "flex items-center relative overflow-hidden",
                    rowIdx > 0 && "border-t border-edge/30",
                  )}
                >
                  {rowChips.length > 0 ? (
                    <PreviewRow
                      chips={rowChips}
                      comfort={comfort}
                      colorMode={ticker.chipColors}
                      scrollMode={row.scrollMode ?? ticker.scrollMode}
                      speed={row.speed ?? ticker.tickerSpeed}
                      direction={row.direction ?? ticker.tickerDirection}
                      stepPause={ticker.stepPause}
                      pauseOnHover={ticker.pauseOnHover}
                      hoverSpeed={ticker.hoverSpeed}
                      gap={gapPx}
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full py-3 text-[11px] font-mono text-fg-4">
                      Row {rowIdx + 1} has no sources selected
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* ── Settings ──────────────────────────────────────────── */}
      <motion.div layout="position" transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }} className="space-y-6">

        {/* ── Rows (multi-deck builder) ─────────────────────── */}
        <SettingGroup label={`Rows (${rowCount}/${maxRows})`}>
          {/* Shared-state banner — the row count and per-source
              assignments here are the SAME values driving the Home
              page's RowSelectors and the system tray's submenus. We
              call this out explicitly because pre-refactor users
              thought they were two independent surfaces and got
              confused when changes "leaked" between them. */}
          <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg border border-edge/30 bg-base-200/40">
            <Info size={12} className="text-fg-4 mt-0.5 shrink-0" />
            <p className="text-[11px] text-fg-3 leading-relaxed">
              These rows are shared with the{" "}
              <span className="text-fg-2 font-medium">Home page</span> and the
              system tray. Add or remove rows here to control the layout
              everywhere; assign individual sources from Home for quick
              changes.
            </p>
          </div>

          <div className="space-y-2">
            {rows.map((row, rowIdx) => (
              <RowCard
                key={rowIdx}
                rowIndex={rowIdx}
                row={row}
                sources={availableSources}
                canRemove={rowCount > 1}
                canCustomize={canCustomize}
                onToggleSource={(id) => toggleRowSource(rowIdx, id)}
                onRemove={() => deleteRow(rowIdx)}
              />
            ))}
            <button
              type="button"
              onClick={addRow}
              disabled={!canAddRow}
              className={clsx(
                "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed text-[11px] font-mono uppercase tracking-wider transition-colors",
                !canAddRow
                  ? "border-edge/30 text-fg-4/40 cursor-not-allowed"
                  : "border-edge/60 text-fg-3 hover:text-accent hover:border-accent/60 cursor-pointer",
              )}
            >
              <Plus size={12} />
              {!canAddRow ? "Tier cap reached" : "Add row"}
            </button>
            {!canAddRow && maxRows < 3 && (
              <p className="text-[10px] font-mono text-fg-4/70 text-center pt-1">
                {maxRows === 1
                  ? "Upgrade to Uplink for a second ticker row."
                  : "Upgrade to Uplink Pro for up to 3 ticker rows."}
              </p>
            )}
          </div>
        </SettingGroup>

        {/* ── Detail level ──────────────────────────────────── */}
        <SettingGroup label="Detail level">
          <div className="flex gap-2">
            <VisualCard
              selected={ticker.tickerMode === "compact"}
              onClick={() => setTicker("tickerMode", "compact")}
              label="Compact"
            >
              <div className="flex items-center gap-1.5 w-full">
                <span className={clsx("text-[9px] font-mono font-semibold uppercase tracking-wider", ticker.tickerMode === "compact" ? "text-accent/60" : "text-fg-4/40")}>AAPL</span>
                <span className={clsx("text-[10px] font-mono", ticker.tickerMode === "compact" ? "text-accent" : "text-fg-4/60")}>{"\u25B2"} 2.4%</span>
              </div>
            </VisualCard>
            <VisualCard
              selected={ticker.tickerMode === "comfort"}
              onClick={() => setTicker("tickerMode", "comfort")}
              label="Detailed"
            >
              <div className="flex flex-col gap-0.5 w-full">
                <div className="flex items-center gap-1.5">
                  <span className={clsx("text-[9px] font-mono font-semibold uppercase tracking-wider", ticker.tickerMode === "comfort" ? "text-accent/60" : "text-fg-4/40")}>AAPL</span>
                  <span className={clsx("text-[10px] font-mono", ticker.tickerMode === "comfort" ? "text-accent" : "text-fg-4/60")}>{"\u25B2"} 2.4%</span>
                </div>
                <span className={clsx("text-[8px] font-mono", ticker.tickerMode === "comfort" ? "text-accent/40" : "text-fg-4/20")}>Tech {"\u00B7"} $182.50</span>
              </div>
            </VisualCard>
          </div>
        </SettingGroup>

        {/* ── Speed ─────────────────────────────────────────── */}
        <SettingGroup label="Speed">
          <SpeedSlider
            value={ticker.tickerSpeed}
            onChange={(v) => setTicker("tickerSpeed", v)}
          />
        </SettingGroup>

        {/* ── Style ─────────────────────────────────────────── */}
        <SettingGroup label="Style">
          {/* Spacing */}
          <div className="flex gap-2">
            {(["tight", "normal", "spacious"] as const).map((gap) => {
              const gapLabel = gap === "tight" ? "Tight" : gap === "normal" ? "Normal" : "Wide";
              const gapSize = gap === "tight" ? "gap-0.5" : gap === "normal" ? "gap-1.5" : "gap-3";
              return (
                <VisualCard
                  key={gap}
                  selected={ticker.tickerGap === gap}
                  onClick={() => setTicker("tickerGap", gap as TickerGap)}
                  label={gapLabel}
                >
                  <div className={clsx("flex items-center w-full", gapSize)}>
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={clsx(
                          "h-3 rounded-[2px] flex-1",
                          ticker.tickerGap === gap ? "bg-accent/40" : "bg-fg-4/15",
                        )}
                      />
                    ))}
                  </div>
                </VisualCard>
              );
            })}
          </div>

          {/* Colors */}
          <div className="flex gap-2 mt-2">
            <VisualCard
              selected={ticker.chipColors === "channel"}
              onClick={() => setTicker("chipColors", "channel")}
              label="Colorful"
            >
              <div className="flex items-center gap-1 w-full">
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                <div className="w-2.5 h-2.5 rounded-full bg-secondary" />
                <div className="w-2.5 h-2.5 rounded-full bg-info" />
                <div className="w-2.5 h-2.5 rounded-full bg-accent-purple" />
                <div className="w-2.5 h-2.5 rounded-full bg-widget-uptime" />
              </div>
            </VisualCard>
            <VisualCard
              selected={ticker.chipColors === "accent"}
              onClick={() => setTicker("chipColors", "accent")}
              label="Theme"
            >
              <div className="flex items-center gap-1 w-full">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="w-2.5 h-2.5 rounded-full bg-primary" />
                ))}
              </div>
            </VisualCard>
            <VisualCard
              selected={ticker.chipColors === "muted"}
              onClick={() => setTicker("chipColors", "muted")}
              label="Subtle"
            >
              <div className="flex items-center gap-1 w-full">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="w-2.5 h-2.5 rounded-full bg-fg-3/30" />
                ))}
              </div>
            </VisualCard>
          </div>
        </SettingGroup>

        {/* ── Advanced ──────────────────────────────────────── */}
        <div className="border-t border-edge/30 pt-4">
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-2 text-[11px] font-mono font-semibold uppercase tracking-wider text-fg-4 hover:text-fg-3 transition-colors w-full"
          >
            <ChevronDown
              size={12}
              className={clsx("transition-transform duration-200", advancedOpen && "rotate-180")}
            />
            Advanced
          </button>

          {advancedOpen && (
            <div className="mt-3 space-y-3 pl-1">
              {/* Scroll mode */}
              <AdvancedRow label="Scroll mode">
                <SegmentedPicker
                  value={ticker.scrollMode}
                  options={SCROLL_MODE_OPTIONS}
                  onChange={(v) => setTicker("scrollMode", v)}
                />
              </AdvancedRow>

              {/* Direction */}
              {ticker.scrollMode !== "flip" && (
                <AdvancedRow label="Direction">
                  <SegmentedPicker
                    value={ticker.tickerDirection}
                    options={DIRECTION_OPTIONS}
                    onChange={(v) => setTicker("tickerDirection", v)}
                  />
                </AdvancedRow>
              )}

              {/* Item order */}
              <AdvancedRow label="Item order">
                <SegmentedPicker
                  value={ticker.mixMode}
                  options={MIX_OPTIONS}
                  onChange={(v) => setTicker("mixMode", v)}
                />
              </AdvancedRow>
            </div>
          )}
        </div>

        {/* ── Reset ─────────────────────────────────────────── */}
        <div className="flex items-center justify-end pt-2">
          <ResetButton label="Reset to defaults" onClick={handleReset} />
        </div>
      </motion.div>
    </div>
  );
}

// ── Preview chip ────────────────────────────────────────────────

function PreviewChip({ chip, comfort, colorMode }: { chip: SampleChip; comfort: boolean; colorMode: ChipColorMode }) {
  const c = colorMode === "muted" ? MUTED_OVERRIDE
    : colorMode === "accent" ? ACCENT_OVERRIDE
    : chip;

  // Use a gentle spring for the chip's own size changes (mostly
  // triggered by the compact↔comfort detail row appearing). Springs
  // feel less mechanical than linear cubic-beziers when the chip
  // grows vertically while the parent ticker is also animating.
  return (
    <motion.span
      layout
      transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.6 }}
      className={clsx(
        "ticker-chip inline-flex px-3 rounded-sm ring-1 ring-inset font-mono whitespace-nowrap",
        c.color, c.borderColor,
        comfort
          ? "flex-col items-start justify-center py-1.5 gap-0"
          : "items-center gap-1.5 py-1.5 text-[13px]",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className={clsx("font-semibold text-[11px] uppercase tracking-wider", c.textColor + "/60")}>{chip.label}</span>
        {chip.value && <span className={c.textColor}>{chip.value}</span>}
      </span>
      <AnimatePresence initial={false}>
        {comfort && chip.detail && (
          <motion.span
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{
              height: { type: "spring", stiffness: 380, damping: 34, mass: 0.6 },
              opacity: { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] },
            }}
            className={clsx("text-[10px] overflow-hidden", c.textColor + "/40")}
          >
            {chip.detail}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.span>
  );
}

// ── Preview row — mirrors the real ScrollrTicker's mode handling ─
//
// Why this is structured as it is (the previous version was glitchy):
//
//   1. A single outer container holds ALL three render modes
//      (continuous, step, flip) and crossfades between them. Pre-fix
//      the parent component swapped between PreviewRow children via
//      AnimatePresence with a key built from (scrollMode + direction +
//      mixMode) — every change to any of those tore down the entire
//      row, lost the motion-plus Ticker's internal scroll position,
//      and forced a full DOM remeasure. Now the swap happens inside,
//      so the container width / refs stay stable.
//
//   2. `chipItems` is memoized. The motion-plus Ticker is sensitive to
//      identity churn on its `items` prop — building a new array per
//      render caused brief stutters as it re-cloned children.
//
//   3. `visibleCount` (flip mode) uses a ResizeObserver, not a
//      stale `containerRef.current?.clientWidth` read at render time.
//      The previous version always read 600 on the first render and
//      the real width on the second, which meant the flip page count
//      jumped after the first interval tick.
//
//   4. `offset` (step) and `flipPage` (flip) are NOT reset when chip
//      length changes. Previously, toggling a source mid-scroll would
//      teleport the ticker back to position 0; now scroll continues
//      seamlessly and just wraps over the new chip set on the next tick.

function PreviewRow({
  chips,
  comfort,
  colorMode,
  scrollMode,
  speed,
  direction,
  stepPause,
  pauseOnHover,
  hoverSpeed,
  gap,
}: {
  chips: SampleChip[];
  comfort: boolean;
  colorMode: ChipColorMode;
  scrollMode: ScrollMode;
  speed: number;
  direction: TickerDirection;
  stepPause: number;
  pauseOnHover: boolean;
  hoverSpeed: number;
  gap: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoize the chip elements so the motion-plus Ticker doesn't see a
  // fresh array on every parent re-render (every keystroke on the
  // speed slider, every hover on a settings card, etc.). Identity
  // stability matters because Ticker clones items into its scroll
  // track; new identities = new clones = a 1-frame jitter.
  const chipItems = useMemo(
    () =>
      chips.map((chip, i) => (
        <PreviewChip
          key={`${chip.label}-${chip.value}-${i}`}
          chip={chip}
          comfort={comfort}
          colorMode={colorMode}
        />
      )),
    [chips, comfort, colorMode],
  );

  // ── Step mode: Ticker with offset-driven animation (matches real ticker) ──
  const offset = useMotionValue(0);

  useEffect(() => {
    if (scrollMode !== "step" || chips.length === 0) return;
    // Don't reset offset — preserve scroll continuity if the user
    // toggled a source mid-loop. The wrap math handles new chip sets
    // gracefully.
    let cancelled = false;
    const transitionDuration = Math.max(0.15, 1.2 - (speed - 5) * 0.0072);

    async function stepLoop() {
      await sleep(600);
      while (!cancelled) {
        // Measure first chip width for step size
        const container = containerRef.current;
        const firstItem = container?.querySelector(".ticker-chip") as HTMLElement | null;
        const stepSize = firstItem ? firstItem.offsetWidth + gap : 160;

        const sign = direction === "left" ? 1 : -1;
        const current = offset.get();

        await animate(offset, current + sign * stepSize, {
          duration: transitionDuration,
          ease: [0.25, 0.1, 0.25, 1],
        });

        if (cancelled) break;
        await sleep(stepPause * 1000);
      }
    }

    stepLoop();
    return () => { cancelled = true; };
    // Intentionally NOT depending on chips.length — see the comment
    // above about scroll continuity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollMode, speed, direction, stepPause, gap, offset]);

  // ── Flip mode: AnimatePresence vertical slide (matches real ticker) ──
  const [flipPage, setFlipPage] = useState(0);

  // Track container width via ResizeObserver so visibleCount stays
  // accurate without remounting on every render. 600 is a reasonable
  // first-paint fallback that matches typical settings-panel widths.
  const [containerWidth, setContainerWidth] = useState(600);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth || 600);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleCount = useMemo(() => {
    const avgChipWidth = comfort ? 180 : 120;
    return Math.max(1, Math.floor(containerWidth / (avgChipWidth + gap)));
  }, [comfort, gap, containerWidth]);

  useEffect(() => {
    if (scrollMode !== "flip" || chips.length === 0) return;
    // Don't reset flipPage on chip-length change — wrap math handles it.
    const timer = setInterval(() => setFlipPage((p) => p + 1), stepPause * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollMode, stepPause]);

  const flipShift = chips.length > 0 ? (flipPage * visibleCount) % chips.length : 0;
  const flipChips = useMemo(
    () => [...chips.slice(flipShift), ...chips.slice(0, flipShift)],
    [chips, flipShift],
  );
  const transitionDuration = Math.max(0.15, 1.2 - (speed - 5) * 0.0072);

  // ── Render: single container, crossfade between mode subtrees ────
  // Keeping all three modes inside one outer <div ref={containerRef}>
  // means scroll-mode changes only swap the *inner* mode content. The
  // ResizeObserver, the Ticker's internal track, and step/flip state
  // all persist across mode-swap UI feedback.

  const isStep = scrollMode === "step";
  const velocity = direction === "left" ? speed : -speed;

  return (
    <div ref={containerRef} className="ticker-container w-full py-2 overflow-hidden relative">
      <AnimatePresence mode="popLayout" initial={false}>
        {scrollMode === "flip" ? (
          <motion.div
            key="mode-flip"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={flipPage}
                initial={{ y: "100%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "-100%", opacity: 0 }}
                transition={{ duration: transitionDuration, ease: [0.25, 0.1, 0.25, 1] }}
                className="flex items-center h-full px-2"
                style={{ gap }}
              >
                {flipChips.map((chip, i) => (
                  <PreviewChip
                    key={`${chip.label}-${chip.value}-${i}`}
                    chip={chip}
                    comfort={comfort}
                    colorMode={colorMode}
                  />
                ))}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="mode-scroll"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full"
          >
            <Ticker
              items={chipItems}
              velocity={isStep ? 0 : velocity}
              offset={isStep ? offset : undefined}
              hoverFactor={isStep ? 1 : (pauseOnHover ? hoverSpeed : 1)}
              gap={gap}
              fade={40}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Promise-based sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Setting group ───────────────────────────────────────────────

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-fg-4 mb-3">
        {label}
      </h3>
      {children}
    </div>
  );
}

// ── Visual card selector ────────────────────────────────────────

function VisualCard({
  selected,
  onClick,
  label,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex-1 flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all cursor-pointer",
        selected
          ? "border-accent/60 bg-accent/5"
          : "border-edge/40 bg-surface-2/30 hover:border-edge/60 hover:bg-surface-2/50",
      )}
    >
      <div className="w-full px-1">{children}</div>
      <span className={clsx(
        "text-[10px] font-mono uppercase tracking-wider",
        selected ? "text-accent" : "text-fg-4",
      )}>
        {label}
      </span>
    </button>
  );
}

// ── Speed slider ────────────────────────────────────────────────

function SpeedSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = ((value - 5) / (150 - 5)) * 100;

  return (
    <div className="space-y-2">
      <div className="relative h-8 flex items-center">
        {/* Track */}
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-base-300" />
        {/* Filled */}
        <div
          className="absolute left-0 h-1.5 rounded-full bg-accent/50"
          style={{ width: `${pct}%` }}
        />
        {/* Input */}
        <input
          type="range"
          aria-label="Ticker speed"
          min={5}
          max={150}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
        {/* Thumb */}
        <div
          className="absolute w-4 h-4 rounded-full bg-fg-2 border-2 border-surface shadow-md pointer-events-none"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-fg-4 uppercase tracking-wider px-0.5">
        <span>Slow</span>
        <span>Fast</span>
      </div>
    </div>
  );
}

// ── Advanced row ────────────────────────────────────────────────

function AdvancedRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] font-mono text-fg-3">{label}</span>
      {children}
    </div>
  );
}

// ── Segmented picker (compact, for advanced section) ────────────

function SegmentedPicker<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-base-200 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            "px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer leading-none",
            value === opt.value
              ? "bg-base-300 text-fg shadow-sm"
              : "text-fg-3 hover:text-fg-2",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Row card (multi-deck builder) ───────────────────────────────

interface RowSource {
  id: string;
  label: string;
  hex: string;
}

interface RowCardProps {
  rowIndex: number;
  row: TickerRowConfig;
  sources: RowSource[];
  canRemove: boolean;
  canCustomize: boolean;
  onToggleSource: (id: string) => void;
  onRemove: () => void;
}

function RowCard({
  rowIndex,
  row,
  sources,
  canRemove,
  canCustomize,
  onToggleSource,
  onRemove,
}: RowCardProps) {
  const showingAll = row.sources.length === 0;

  return (
    <div className="rounded-xl border border-edge/40 bg-surface-2/30 p-3">
      {/* Row header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-fg-3">
          Row {rowIndex + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-fg-4 hover:text-accent-red transition-colors cursor-pointer p-1 rounded"
            aria-label={`Remove row ${rowIndex + 1}`}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Sources grid */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-fg-4 mb-1.5">
          Sources {showingAll && <span className="text-fg-4/60">(all visible)</span>}
        </div>
        {sources.length === 0 ? (
          <div className="text-[11px] font-mono text-fg-4/70 py-2">
            No channels or widgets enabled. Enable some in the main settings first.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {sources.map((src) => {
              const selected = row.sources.includes(src.id);
              return (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => onToggleSource(src.id)}
                  className={clsx(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono transition-all cursor-pointer",
                    selected
                      ? "border-accent/60 bg-accent/10 text-fg"
                      : "border-edge/40 bg-transparent text-fg-3 hover:border-edge/60 hover:text-fg-2",
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: src.hex }}
                  />
                  <span className="truncate">{src.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Customize (Ultimate) upsell teaser — only shown to tiers that
          DON'T already have customization unlocked. Showing "Coming
          soon" to Ultimate / super_user users implies a feature gap
          where there isn't one (the Phase 2 UI hasn't shipped yet,
          but tease pre-launch confused testers). Free / Uplink / Pro
          continue to see the locked Ultimate upsell here. */}
      {!canCustomize && (
        <div className="mt-3 pt-3 border-t border-edge/30">
          <div className="flex items-center justify-between text-[11px] font-mono text-fg-4/60">
            <span className="flex items-center gap-1.5">
              <Lock size={11} />
              Customize scroll
            </span>
            <span className="text-[10px] uppercase tracking-wider">
              Ultimate
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
