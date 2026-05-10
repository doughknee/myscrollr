/**
 * TickerLayoutSummary — compact "what does my ticker look like right
 * now" strip rendered at the top of the Home page.
 *
 * Why it exists:
 *   The Home page lets users assign individual sources to ticker rows
 *   (`Off / Row 1 / Row 2 …`), but pre-refactor it had no way to show
 *   the *shape* of the layout itself — how many rows exist, what's on
 *   each, and how to grow/shrink the structure. Users had to leave Home
 *   for Settings → Ticker just to see "do I currently have 1 row or 2?"
 *
 *   This strip surfaces the layout summary inline, with affordances to
 *   add a row (when under the tier cap) or jump straight into the full
 *   editor for power-user changes (per-row scroll overrides, mix mode).
 *
 *   Contract: read-only diagnostics + two CTA buttons. All actual
 *   mutations route through the same `useTickerLayout` hook the
 *   row-pickers use, so this component cannot get out of sync with the
 *   per-source pickers below it.
 */
import { Plus, Settings as SettingsIcon } from "lucide-react";
import clsx from "clsx";
import Tooltip from "./Tooltip";
import type { TickerRowConfig } from "../preferences";
import type { ChannelManifest, WidgetManifest } from "../types";

interface TickerLayoutSummaryProps {
  /** Live layout rows (use the value returned by `useTickerLayout`). */
  rows: TickerRowConfig[];
  /** Total rows allowed by the user's tier (1, 2, or 3). */
  tierMaxRows: number;
  /** Whether the layout has room for another row. */
  canAddRow: boolean;
  /** Append an empty row. No-op when `canAddRow` is false. */
  onAddRow: () => void;
  /** Open the full Settings → Ticker editor. */
  onOpenSettings: () => void;
  /** Channel manifests, used to color the per-row source bars. */
  channelManifests: ChannelManifest[];
  /** Widget manifests, used to color the per-row source bars. */
  widgetManifests: WidgetManifest[];
}

export default function TickerLayoutSummary({
  rows,
  tierMaxRows,
  canAddRow,
  onAddRow,
  onOpenSettings,
  channelManifests,
  widgetManifests,
}: TickerLayoutSummaryProps) {
  const rowCount = rows.length;
  const atTierCap = !canAddRow && tierMaxRows < 3;

  // Build a quick id-to-hex lookup so we can color the per-source bars
  // without forcing the parent to do the join. Falls back to a neutral
  // grey for unknown ids (shouldn't happen in practice).
  const sourceColor = (id: string): string => {
    const ch = channelManifests.find((c) => c.id === id);
    if (ch) return ch.hex;
    const w = widgetManifests.find((mf) => mf.id === id);
    if (w) return w.hex;
    return "#6b7280"; // neutral gray-500 fallback
  };

  return (
    <section
      aria-label="Ticker layout summary"
      className="rounded-xl border border-edge/30 bg-base-150/50 px-4 py-3"
    >
      {/* Header row: count badge + CTAs */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-ui-section font-mono font-semibold text-fg-3 uppercase tracking-wider">
          Ticker layout
        </span>
        <span className="text-ui-meta font-mono text-fg-3">
          {rowCount === 1 ? "1 row" : `${rowCount} rows`}
          <span className="text-fg-3"> / {tierMaxRows} max</span>
        </span>

        <div className="flex-1" />

        {canAddRow && (
          <Tooltip content="Add an empty row to your ticker" side="top">
            <button
              type="button"
              onClick={onAddRow}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-edge/60 text-ui-meta font-medium text-fg-3 hover:text-accent hover:border-accent/60 transition-colors"
              aria-label="Add a new ticker row"
            >
              <Plus size={11} />
              Add row
            </button>
          </Tooltip>
        )}

        <Tooltip content="Open the full ticker editor in Settings" side="top">
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-ui-meta font-medium text-fg-3 hover:text-accent transition-colors"
            aria-label="Open the full ticker layout editor in Settings"
          >
            <SettingsIcon size={11} />
            Manage
          </button>
        </Tooltip>
      </div>

      {/* Per-row visualization — each row renders as a tiny strip of
          colored bars (one per source). Empty rows show a "shows
          everything" hint instead of an empty strip. */}
      <ul className="space-y-1.5" role="list">
        {rows.map((row, idx) => (
          <li
            key={idx}
            className="flex items-center gap-2 text-ui-meta font-mono text-fg-3"
          >
            <span className="w-12 shrink-0 text-fg-3">
              {rowCount === 1 ? "Row" : `Row ${idx + 1}`}
            </span>
            {row.sources.length === 0 ? (
              <span className="italic text-fg-3">
                shows all enabled sources
              </span>
            ) : (
              <div className="flex items-center gap-1 flex-wrap">
                {row.sources.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-ui-chip font-medium"
                    style={{
                      backgroundColor: `${sourceColor(id)}1a`,
                      color: sourceColor(id),
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: sourceColor(id) }}
                    />
                    {id}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Tier-cap hint — only when user can't grow further AND their
          cap is below the absolute max. If they're on Pro/Ultimate at 3
          rows, no hint (they've already maxed out). */}
      {atTierCap && (
        <p className={clsx("mt-2 text-ui-chip font-mono text-fg-3")}>
          {tierMaxRows === 1
            ? "Upgrade to Uplink for a second ticker row."
            : "Upgrade to Uplink Pro for a third ticker row."}
        </p>
      )}
    </section>
  );
}
