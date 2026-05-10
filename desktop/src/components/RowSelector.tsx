/**
 * RowSelector — radio-segmented control for ticker visibility.
 *
 * Replaces the duplicated Eye/EyeOff buttons (feed page) and tray-menu
 * CheckMenuItem flips with a single mental model:
 *
 *     "Where should this source appear?  Off / Row 1 / Row 2 / Row 3"
 *
 * The component is dumb — it renders a row picker and bubbles the
 * selection up. Callers (feed.tsx, App.tsx tray) wire the
 * `setChannelTickerRow` / `setWidgetTickerRow` helpers from
 * preferences.ts, plus `channelsApi.update` for channels' server-side
 * `ticker_enabled` flag.
 *
 * Visual: small inline segmented control in the same row as a channel
 * /widget header. When `maxRows === 1` (Free tier) labels collapse to
 * `[Off] [On]` since there's only one row to choose from.
 *
 * +Add row affordance: when `canAddRow` and `onAddRow` are provided,
 * a trailing dashed `[+ Add]` button is rendered after the row buttons.
 * Clicking it asks the parent to create a new row and assign the
 * current source to it (a single-click flow that previously required
 * leaving Home, opening Settings → Ticker, clicking "Add row", going
 * back to Home, and reassigning the source — five steps for one
 * intent). The button hides automatically once the layout is at the
 * tier cap.
 *
 * Disabled state: when the channel is disabled at the catalog level,
 * the entire control fades and shows a hint to enable it from Catalog.
 */
import clsx from "clsx";
import { Plus } from "lucide-react";
import Tooltip from "./Tooltip";

interface RowSelectorProps {
  /** Currently selected row (0..maxRows-1) or null for off. */
  value: number | null;
  /** Total number of rows the user can choose from (1, 2, or 3 based on tier). */
  maxRows: number;
  /** Disabled state (e.g. when channel.enabled === false). */
  disabled?: boolean;
  /** Hint text shown beneath the control when disabled. */
  disabledHint?: string;
  /** Called when the user picks a row or "Off". */
  onChange: (next: number | null) => void;
  /** Optional aria-label for the radiogroup (defaults to "Ticker row"). */
  ariaLabel?: string;
  /** Optional className appended to the radiogroup container. */
  className?: string;
  /**
   * When provided alongside `canAddRow`, render a trailing dashed
   * `[+ Add]` button after the row buttons. The handler should both
   * create a new row in the layout AND assign this source to it (use
   * `useTickerLayout().addRow(sourceId)` for the canonical flow).
   */
  onAddRow?: () => void;
  /**
   * Whether the layout has room for another row (i.e. the user's tier
   * allows at least one more). When false, the +Add button hides
   * (rather than showing as disabled — there's no useful click path
   * from a tier cap).
   */
  canAddRow?: boolean;
}

interface RowButton {
  key: string;
  label: string;
  row: number | null;
}

export default function RowSelector({
  value,
  maxRows,
  disabled = false,
  disabledHint,
  onChange,
  ariaLabel = "Ticker row",
  className,
  onAddRow,
  canAddRow = false,
}: RowSelectorProps) {
  // Build the button list. With a single row available we use [Off]/[On]
  // because "Row 1" sounds wrong when there's nothing else.
  const rowsAvailable = Math.max(1, maxRows);
  const buttons: RowButton[] = [{ key: "off", label: "Off", row: null }];
  if (rowsAvailable === 1) {
    buttons.push({ key: "row-0", label: "On", row: 0 });
  } else {
    for (let i = 0; i < rowsAvailable; i++) {
      buttons.push({ key: `row-${i}`, label: `Row ${i + 1}`, row: i });
    }
  }

  // Only surface the +Add affordance when both the parent says it's
  // possible AND a handler exists. We don't render a disabled button at
  // the tier cap — the layout summary on Home explains the cap with
  // the upgrade copy, so a dead button here is just noise.
  const showAdd = !disabled && canAddRow && typeof onAddRow === "function";

  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        className={clsx(
          "inline-flex items-center gap-0.5 p-0.5 rounded-md border border-edge/30 bg-base-200/60",
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        {buttons.map(({ key, label, row }) => {
          const active = value === row;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled) onChange(row);
              }}
              disabled={disabled}
              className={clsx(
                "px-2 py-0.5 rounded text-[11px] font-medium transition-all duration-150 active:scale-90",
                active
                  ? "bg-accent/15 text-accent"
                  : "text-fg-3 hover:text-fg-2 hover:bg-base-300",
              )}
            >
              {label}
            </button>
          );
        })}
        {showAdd && (
          <Tooltip
            content="Create a new ticker row and put this source on it"
            side="top"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddRow?.();
              }}
              aria-label="Add a new row and assign this source to it"
              className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-medium border border-dashed border-edge/60 text-fg-4 hover:text-accent hover:border-accent/60 transition-all duration-150 active:scale-90 ml-0.5"
            >
              <Plus size={10} />
              Add
            </button>
          </Tooltip>
        )}
      </div>
      {disabled && disabledHint && (
        <p className="text-[11px] text-fg-4">{disabledHint}</p>
      )}
    </div>
  );
}
