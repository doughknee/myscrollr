import { memo } from "react";
import { accentStyle, mix } from "./parts";

/** Narrowest column an Also cell takes (pagePlan's default; a dated status line). */
export const ALSO_MIN_COL = 300;

interface AlsoCellProps {
  /** The widget's code, as its status chip names it: "EPL", "NBA", "PBS". */
  code: string;
  /** Why it has nothing on, from the source's status(): "next match Sat, Oct 10, 4:30 PM". */
  text: string;
  /** This widget's colour (`accentFor`), since an Also page mixes widgets. */
  accent: string;
  onClick?: () => void;
}

/**
 * One quiet widget on the shared "Also" page (canvas: SCROLLR-268 "Main",
 * page 8). Widgets with nothing to show share one page at the end of the lap
 * instead of each spending a page saying so; each says why and, when known,
 * when, exactly as its status chip does (CHIP_SPEC §8.7).
 *
 * The code tag is fixed for the widget's life and the text sits after it
 * in a truncating track, so a message changing never moves the tag.
 */
const AlsoCell = memo(function AlsoCell({ code, text, accent, onClick }: AlsoCellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={code}
      className="flex h-full w-full min-w-0 items-center gap-3 px-4 text-left font-mono"
      style={accentStyle(accent)}
    >
      <span
        data-part="code"
        className="shrink-0 rounded-[3px] px-1.5 py-[3px] text-[11px] font-bold leading-4 tracking-[0.08em]"
        style={{ background: mix(18), color: "var(--accent)" }}
      >
        {code}
      </span>
      <span data-part="text" className="min-w-0 truncate text-[12.5px] font-medium leading-none text-fg-2">
        {text}
      </span>
    </button>
  );
});

export default AlsoCell;
