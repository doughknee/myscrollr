import { memo } from "react";
import { clsx } from "clsx";
import { getChipColors, chipShellClasses } from "./chipColors";

interface StatusChipProps {
  /** League code or feed tab, as the widget's real chips name it. */
  tab: string;
  /** "next match Sat 10 Oct, 12:30", "off-season", "no headlines yet". */
  text: string;
  /** The widest text this widget's status can show; sets the width. */
  reserve: string;
  onClick?: () => void;
}

/**
 * The one chip an enabled widget puts on the rail when it has nothing
 * else to show (SCROLLR-264, CHIP_SPEC §8.7).
 *
 * Two cells: the tab and one line of status. Always the subtle palette,
 * whatever the colour mode, so it reads as the bar talking about a widget
 * rather than as that widget's data. It has no changing value and no
 * detail: the second 20px row stays empty, because
 * nothing in it would not restate the top row (§6).
 *
 * The width is set by a hidden sizer holding `reserve`, the widest message
 * this widget's status can ever show, so the chip is one width from first
 * render whether it says "off-season" or names a date.
 */
const StatusChip = memo(function StatusChip({ tab, text, reserve, onClick }: StatusChipProps) {
  const c = getChipColors("subtle", "status");
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${tab} · ${text}`}
      data-testid="status-chip"
      className={clsx(
        chipShellClasses(c, "whitespace-nowrap"),
        "grid max-w-[640px] grid-cols-[max-content_minmax(0,max-content)] grid-rows-[30px_20px]",
      )}
    >
      <span
        className={clsx(
          "col-start-1 row-span-full flex items-center border-r px-[9px] font-mono text-[10px] font-bold tracking-[0.08em]",
          c.divider,
          c.tabBg,
          c.text,
        )}
      >
        {tab}
      </span>
      <span
        aria-hidden
        className="invisible col-start-2 row-start-1 h-0 overflow-hidden whitespace-nowrap px-2.5 font-mono text-[12px] font-medium"
      >
        {reserve}
      </span>
      <span className="col-start-2 row-start-1 flex min-w-0 items-center px-2.5">
        <span data-testid="status-text" className={clsx("min-w-0 truncate text-left font-mono text-[12px] font-medium leading-none", c.textDim)}>
          {text}
        </span>
      </span>
    </button>
  );
});

export default StatusChip;
