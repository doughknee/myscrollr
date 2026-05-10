/**
 * DisplayItemsGrid — the unified Feed/Ticker visibility grid used by
 * every channel's Display preferences page.
 *
 * Layout:
 *   ┌───────────────┬──────┬──────┐
 *   │ DISPLAY ITEMS │  👁  │  📺  │   ← clickable column headers =
 *   │               │ FEED │TICKER│     bulk toggles for that column
 *   ├───────────────┼──────┼──────┤
 *   │ Metric label  │  ✓   │  ✓   │
 *   │ Description   │      │      │
 *   ├───────────────┼──────┼──────┤
 *   │ ...                          │
 *   └─────────────────────────────┘
 *
 * The grid template (1fr | 56px | 56px) is shared between the header
 * row and every metric row so cells column-align with toggles. Section
 * groups (optional `title` per section) render as sub-headers spanning
 * the full row.
 *
 * Persisted shape unchanged: `Venue` enum (off|feed|ticker|both)
 * converted at the UI boundary via boolsToEnum / enumToBools.
 *
 * API:
 *   - `sections`: groups of metric rows
 *   - `onChange(changes)`: emits a `{rowKey: newVenue}` object with
 *     EVERY row that changed in a single update — column-header bulk
 *     toggles flip every row in one event, per-cell clicks emit a
 *     single-entry object. Callers MUST apply the entire object in
 *     one state-setter call so bulk toggles aren't clobbered by
 *     stale-state overwrites (the same constraint the legacy
 *     DisplayLocationGrid had).
 *   - `title`: optional section-bar label (defaults to "Display items").
 */
import { Eye, Tv, Check } from "lucide-react";
import clsx from "clsx";
import { motion } from "motion/react";
import {
  boolsToEnum,
  enumToBools,
  type Venue,
} from "../../preferences";

// ── Public types ────────────────────────────────────────────────

export interface DisplayItemsRow {
  key: string;
  label: string;
  description?: string;
  value: Venue;
}

export interface DisplayItemsSection {
  /** Optional sub-header label spanning all three columns. */
  title?: string;
  rows: DisplayItemsRow[];
}

interface DisplayItemsGridProps {
  /** Groups of metric rows. */
  sections: DisplayItemsSection[];
  /** Top-level title rendered in the first column of the header bar.
   *  Defaults to "Display items". */
  title?: string;
  /** Single onChange that emits ALL changed rows in one batch so
   *  callers can apply them via one setState call. */
  onChange: (changes: Record<string, Venue>) => void;
}

// Shared grid template — must match between header and rows so JIT
// generates one column track. NEVER assemble via template literal;
// Tailwind's scanner can't see runtime classes.
const GRID_COLS = "grid-cols-[1fr_56px_56px]";

// ── Component ───────────────────────────────────────────────────

export default function DisplayItemsGrid({
  sections,
  title = "Display items",
  onChange,
}: DisplayItemsGridProps) {
  const allRows = sections.flatMap((s) => s.rows);

  const allFeedOn =
    allRows.length > 0 && allRows.every((r) => enumToBools(r.value).feed);
  const allTickerOn =
    allRows.length > 0 && allRows.every((r) => enumToBools(r.value).ticker);

  function setColumn(column: "feed" | "ticker", on: boolean) {
    const changes: Record<string, Venue> = {};
    for (const row of allRows) {
      const bools = enumToBools(row.value);
      const next = boolsToEnum(
        column === "feed" ? on : bools.feed,
        column === "ticker" ? on : bools.ticker,
      );
      if (next !== row.value) changes[row.key] = next;
    }
    if (Object.keys(changes).length > 0) onChange(changes);
  }

  function toggleOne(rowKey: string, current: Venue, column: "feed" | "ticker") {
    const bools = enumToBools(current);
    const next = boolsToEnum(
      column === "feed" ? !bools.feed : bools.feed,
      column === "ticker" ? !bools.ticker : bools.ticker,
    );
    onChange({ [rowKey]: next });
  }

  return (
    <div className="rounded-lg border border-edge/40 overflow-hidden">
      <div
        role="grid"
        aria-label="Where each metric appears"
        className="select-none"
      >
        {/* Header bar — section title + bulk-toggle column heads. */}
        <div
          role="row"
          className={clsx(
            "grid items-center gap-x-2 px-3 py-1.5 bg-base-250/30 border-b border-edge/40",
            GRID_COLS,
          )}
        >
          <h3
            role="columnheader"
            className="text-ui-section font-mono font-semibold uppercase tracking-wider text-fg-3"
          >
            {title}
          </h3>
          <ColumnHeaderToggle
            icon={Eye}
            label="Feed"
            active={allFeedOn}
            onClick={() => setColumn("feed", !allFeedOn)}
          />
          <ColumnHeaderToggle
            icon={Tv}
            label="Ticker"
            active={allTickerOn}
            onClick={() => setColumn("ticker", !allTickerOn)}
          />
        </div>

        {/* Section sub-groups + rows. */}
        {sections.map((section, sIdx) => (
          <div key={section.title ?? `__sec_${sIdx}`}>
            {section.title && (
              <div
                role="row"
                className={clsx(
                  "grid items-center gap-x-2 px-3 pt-3 pb-1",
                  GRID_COLS,
                )}
              >
                <div
                  role="columnheader"
                  className="col-span-3 text-ui-section font-mono font-semibold uppercase tracking-wider text-fg-3"
                >
                  {section.title}
                </div>
              </div>
            )}
            {section.rows.map((row, rIdx) => {
              const bools = enumToBools(row.value);
              const isLast =
                sIdx === sections.length - 1 &&
                rIdx === section.rows.length - 1;
              return (
                <div
                  key={row.key}
                  role="row"
                  className={clsx(
                    "grid items-center gap-x-2 px-3 py-2.5 hover:bg-base-250/20 transition-colors",
                    !isLast && "border-b border-edge/30",
                    GRID_COLS,
                  )}
                >
                  <div
                    role="rowheader"
                    className="flex flex-col gap-0.5 min-w-0"
                  >
                    <span className="text-ui-body text-fg-2 leading-tight">
                      {row.label}
                    </span>
                    {row.description && (
                      <span className="text-ui-meta text-fg-3 leading-tight">
                        {row.description}
                      </span>
                    )}
                  </div>
                  <CellToggle
                    active={bools.feed}
                    onClick={() => toggleOne(row.key, row.value, "feed")}
                    ariaLabel={`${bools.feed ? "Hide" : "Show"} ${row.label} on Feed`}
                  />
                  <CellToggle
                    active={bools.ticker}
                    onClick={() => toggleOne(row.key, row.value, "ticker")}
                    ariaLabel={`${bools.ticker ? "Hide" : "Show"} ${row.label} on Ticker`}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Column header / cell toggle (internal) ──────────────────────

function ColumnHeaderToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={`${active ? "Hide all from" : "Show all on"} ${label}`}
      onClick={onClick}
      className={clsx(
        "flex flex-col items-center justify-center gap-0.5 py-1 rounded-md",
        "transition-all duration-150 active:scale-[0.93]",
        active
          ? "text-accent hover:bg-accent/5"
          : "text-fg-4 hover:text-fg-2 hover:bg-base-250/40",
      )}
    >
      <Icon size={12} />
      <span className="text-ui-chip font-mono font-semibold uppercase tracking-wider leading-none">
        {label}
      </span>
    </button>
  );
}

function CellToggle({
  active,
  ariaLabel,
  onClick,
}: {
  active: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <div role="gridcell" className="flex items-center justify-center">
      <button
        type="button"
        role="checkbox"
        aria-checked={active}
        aria-label={ariaLabel}
        onClick={onClick}
        className={clsx(
          "w-[22px] h-[22px] rounded-md flex items-center justify-center",
          "transition-all duration-150 active:scale-90",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
          active
            ? "bg-accent text-surface hover:bg-accent/90"
            : "bg-base-300 hover:bg-base-350 border border-edge/40 text-transparent",
        )}
      >
        <motion.span
          key={active ? "on" : "off"}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 24 }}
          className="flex items-center justify-center"
        >
          <Check size={12} strokeWidth={3} />
        </motion.span>
      </button>
    </div>
  );
}
