import { memo } from "react";
import { accentFor, accentStyle, inkFor, mix } from "./parts";

/** Narrowest column an Also cell takes (a dated status line), for pagePlan's `columnsFor`. */
export const ALSO_MIN_COL = 300;

interface AlsoCellProps {
  /** The widget's code, as its status chip names it: "EPL", "NBA", "PBS". */
  code: string;
  /** Why it has nothing on, from the source's status(): "next match Sat, Oct 10, 4:30 PM". */
  text: string;
  /** This widget's catalog colour, since an Also page mixes widgets. */
  hex: string | undefined;
  dark: boolean;
  onClick?: () => void;
}

/**
 * One quiet widget on the shared "Also" page (canvas: SCROLLR-268 "Main",
 * page 8). Widgets with nothing to show share one page at the end of the lap
 * instead of each spending a page saying so; each says why and, when known,
 * when, exactly as its status chip does (CHIP_SPEC §8.7).
 *
 * The code tag is fixed for the widget's life and the text sits after it
 * in a truncating track, so a message changing never moves the tag. The tag
 * is a small label: the ink on the label's own tint (16% dark, 12% light),
 * the pair `inkFor` is proven readable on (SCROLLR-287).
 */
const AlsoCell = memo(function AlsoCell({ code, text, hex, dark, onClick }: AlsoCellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={code}
      className="flex h-full w-full min-w-0 items-center gap-3 px-4 text-left font-mono"
      style={accentStyle(accentFor(hex, dark), inkFor(hex, dark))}
    >
      <span
        data-part="code"
        className="shrink-0 rounded-[3px] px-1.5 py-[3px] text-[12px] font-bold leading-4 tracking-[0.08em]"
        style={{ background: mix(dark ? 16 : 12), color: "var(--accent-ink)" }}
      >
        {code}
      </span>
      <span data-part="text" className="min-w-0 truncate text-[13px] font-medium leading-none text-fg-2">
        {text}
      </span>
    </button>
  );
});

export default AlsoCell;
