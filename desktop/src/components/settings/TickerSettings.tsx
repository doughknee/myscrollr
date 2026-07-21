/**
 * Ticker settings — presentation controls for the ticker strip.
 *
 * The standalone ticker window's on/off toggle lives in the TopBar so
 * it isn't duplicated here. Settings sections mirror the Settings page
 * (dense card grid, tooltip-labeled rows).
 */
import { useCallback, useMemo } from "react";
import { motion } from "motion/react";
import { clsx } from "clsx";
import { Plus, Trash2, Lock } from "lucide-react";
import { resetCategory, removeTickerRow, setTickerRowSourceMembership } from "../../preferences";
import {
  Section,
  SegmentedRow,
  SliderRow,
  ToggleRow,
  ResetButton,
} from "./SettingsControls";
import { getTier } from "../../auth";
import { getAllDataWidgets } from "../../datawidgets/registry";
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

  // Single source of truth for layout state, shared with the Home page
  // the tray submenus. `rowCount`, `tierMaxRows`,
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
  // Ticker settings edits row membership only. Removing a widget from a
  // row must not remove it from `widgetsOnTicker`; otherwise returning a
  // row to the empty "all sources" state would still hide that widget.
  const addRow = useCallback(() => {
    addRowFromHook();
  }, [addRowFromHook]);

  const toggleRowSource = useCallback(
    (rowIndex: number, sourceId: string) => {
      const row = rows[rowIndex];
      const isInTarget = row.sources.includes(sourceId);
      onPrefsChange(setTickerRowSourceMembership(
        prefs,
        sourceId,
        rowIndex,
        !isInTarget,
      ));
    },
    [prefs, rows, onPrefsChange],
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

  // ── Available sources (data widgets + enabled utility widgets) ──
  const availableSources = useMemo(() => {
    const dataWidgets = getAllDataWidgets().map((ch) => ({
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
    return [...dataWidgets, ...widgets];
  }, [prefs.widgets.enabledWidgets]);

  return (
    <div>
      {/* ── Settings cards ────────────────────────────────────── */}
      <motion.div
        layout="position"
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        className="grid gap-4 grid-cols-2 items-start"
      >
        <div className="space-y-4 min-w-0">
        {/* ── Behavior ───────────────────────────────────────── */}
        <Section index={0} title="Behavior" variant="card">
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
        <Section index={1} title="Display" variant="card">
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
        <Section index={2} title="Motion" variant="card">
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

        {/* ── Rows ───────────────────────────────────────────── */}
        <Section index={3} title={`Rows (${rowCount}/${maxRows})`} variant="card">
          <div className="px-3 pt-1 pb-2 space-y-2">
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
                "w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed text-ui-meta font-medium transition-colors",
                !canAddRow
                  ? "border-edge/30 text-fg-4 cursor-not-allowed"
                  : "border-edge/50 text-fg-3 hover:text-accent hover:border-accent/60 cursor-pointer",
              )}
            >
              <Plus size={12} />
              {!canAddRow ? "Tier cap reached" : "Add row"}
            </button>
            {!canAddRow && maxRows < 3 && (
              <p className="text-ui-chip text-fg-3 text-center pt-1">
                {maxRows === 1
                  ? "Upgrade to Uplink for a second ticker row."
                  : "Upgrade to Uplink Pro for up to 3 ticker rows."}
              </p>
            )}
          </div>
        </Section>
        </div>
      </motion.div>

      {/* ── Reset ──────────────────────────────────────────── */}
      <div className="flex items-center justify-end pt-3">
        <ResetButton label="Reset ticker settings" onClick={handleReset} />
      </div>
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
        <span className="text-ui-section font-mono">
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
        <div className="text-ui-section font-mono mb-1.5">
          Sources {showingAll && <span className="text-fg-3">(all visible)</span>}
        </div>
        {sources.length === 0 ? (
          <div className="text-ui-meta font-mono text-fg-3 py-2">
            No widgets added yet. Add some from the Catalog first.
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
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-ui-meta font-mono transition-all cursor-pointer",
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
          <div className="flex items-center justify-between text-ui-meta font-mono text-fg-3">
            <span className="flex items-center gap-1.5">
              <Lock size={11} />
              Customize scroll
            </span>
            <span className="text-ui-chip uppercase tracking-wider">
              Ultimate
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
