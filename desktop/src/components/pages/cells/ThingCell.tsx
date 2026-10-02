import { memo } from "react";
import clsx from "clsx";
import { toneColor } from "./RepoCell";
import type { GitHubThing } from "../../../widgets/github/types";

interface ThingCellProps {
  thing: GitHubThing;
  dark: boolean;
  onClick?: () => void;
}

/**
 * One thing on the GitHub page's spare columns (SCROLLR-312, canvas F1): a
 * PR that needs you, a failing run, an issue, or what just shipped. Two
 * lines, like the repo cell beside it. Line 1: the kicker (what kind, in
 * caps), where it is (`myscrollr #479 · yours`) and, right-aligned, the
 * PR's checks or an age. Line 2: its title. Shipped cells draw quieter (a
 * faint wash, the title in fg-2), like a final on a sports page. The column
 * is the repo cell's (`REPO_MIN_COL`); click opens the item.
 */
const ThingCell = memo(function ThingCell({ thing, dark, onClick }: ThingCellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={thing.url}
      data-thing={thing.shipped ? "shipped" : ""}
      className={clsx(
        "relative flex h-full w-full min-w-0 flex-col justify-center gap-[5px] pl-[18px] pr-4 text-left",
        thing.shipped && "bg-fg/[0.03]",
      )}
    >
      <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] leading-[15px]">
        <span data-part="tag" data-tone={thing.tone} className="max-w-[60%] shrink-0 truncate font-semibold tracking-[0.06em]" style={{ color: toneColor(thing.tone, dark) }}>
          {thing.tag}
        </span>
        <span data-part="where" className="min-w-0 truncate font-semibold tracking-[0.06em] text-fg-3">
          {thing.where}
        </span>
        <span data-part="right" data-tone={thing.rightTone} className="ml-auto shrink-0 text-[12px]" style={{ color: toneColor(thing.rightTone, dark) }}>
          {thing.right}
        </span>
      </span>
      <span data-part="title" className={clsx("truncate font-sans text-[14px] font-semibold leading-[18px]", thing.shipped ? "text-fg-2" : "text-fg")}>
        {thing.title}
      </span>
    </button>
  );
});

export default ThingCell;
