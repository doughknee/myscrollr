/**
 * ChipCell — one labelled segment inside a multi-value utility chip.
 *
 * Clock zones and weather locations are lists of small facts, not one
 * fact with detail. The old chip strung them together with pipe
 * characters, which made three cities read as one run-on string. A cell
 * gives each its own bounded lane, so the eye can land on "TYO" without
 * parsing everything to its left.
 *
 * Cells are separated by a hairline rather than a glyph — a border is
 * quieter than a pipe and doesn't compete with the data for attention.
 */
import { clsx } from "clsx";

interface ChipCellProps {
  label: string;
  /** Dimmed treatment — a zone in its night hours, a paused timer. */
  dim?: boolean;
  /** Hairline separator on the left. Omit for the first cell. */
  divided?: boolean;
  labelClass?: string;
  comfort?: boolean;
  children: React.ReactNode;
  /** Second line, comfort only — e.g. "Fri · UTC-4". */
  meta?: React.ReactNode;
}

export function ChipCell({
  label,
  dim,
  divided,
  labelClass,
  comfort,
  children,
  meta,
}: ChipCellProps) {
  return (
    <span
      className={clsx(
        "flex min-w-0 flex-col justify-center",
        comfort ? "gap-0.5 px-2.5" : "px-2",
        divided && "border-l border-edge/40",
        // Night and paused states dim the whole cell rather than
        // recolouring the value: the value still has to be readable,
        // it just shouldn't be the thing you notice first.
        dim && "opacity-55",
      )}
    >
      <span
        className={clsx(
          "flex items-baseline gap-1.5",
          comfort ? "text-ui-body" : "text-ui-chip",
        )}
      >
        <span
          className={clsx(
            "shrink-0 font-mono text-[10px] font-bold uppercase tracking-wider",
            labelClass,
          )}
        >
          {label}
        </span>
        {children}
      </span>
      {comfort && meta && (
        <span className="font-mono text-ui-chip text-fg-4">{meta}</span>
      )}
    </span>
  );
}
