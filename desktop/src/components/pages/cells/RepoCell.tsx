import { memo } from "react";
import clsx from "clsx";
import { OnceFlash } from "../../chips/ChipFlash";
import { semantic } from "./parts";
import type { CSSProperties } from "react";
import type { GitHubChipData } from "../../../types";
import type { ThingTone } from "../../../widgets/github/types";

/** Narrowest column a repo takes (its name, a status and a readable line 2), for pagePlan's `columnsFor`. The thing cells share it. */
export const REPO_MIN_COL = 300;

/** A line's colour: red, green and the accent ink carry meaning; dim and faint step back. Shared with ThingCell. */
export function toneColor(tone: ThingTone, dark: boolean): string {
  switch (tone) {
    case "red":
      return semantic("down", dark);
    case "up":
      return semantic("up", dark);
    case "accent":
      return "var(--accent-ink)";
    case "dim":
      return "var(--color-fg-2)";
    default:
      return "var(--color-fg-3)";
  }
}

interface RepoCellProps {
  chip: GitHubChipData;
  dark: boolean;
  onClick?: () => void;
}

/**
 * One tracked repo on the GitHub page (SCROLLR-312, canvas board C4 · D):
 * two lines, two answers. Line 1: a dot in the repo's worst state, its name,
 * and is it broken (`deploy failed · 12m`, `apply running · 3m`, `all green
 * · 1h`). Line 2: what needs you, by name (`Review` · the PR's title · who;
 * `Broke on` · the commit · you). Click: the most urgent thing's link.
 *
 * Nothing moves while the page is up (§P.8): both lines truncate in a
 * frozen column, so a refresh changes text in place.
 */
const RepoCell = memo(function RepoCell({ chip, dark, onClick }: RepoCellProps) {
  const { status, need } = chip;
  // The dot answers line 1 (is it broken), not the repo's worst: a review waiting on a green repo stays green.
  const dot: CSSProperties = {
    background: !status
      ? "var(--color-fg-3)"
      : status.tone === "red"
        ? "var(--color-down)"
        : status.tone === "accent"
          ? "var(--accent)"
          : "var(--color-up)",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={chip.repo}
      data-worst={chip.worst}
      className="relative flex h-full w-full min-w-0 flex-col justify-center gap-[5px] pl-[18px] pr-4 text-left"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span data-part="dot" className="size-2 shrink-0 rounded-full" style={dot} />
        <span data-part="title" className="shrink-0 font-sans text-[15px] font-bold leading-[19px] text-fg">
          {chip.label}
        </span>
        <span
          data-part="status"
          data-tone={status?.tone ?? "faint"}
          className={clsx("ml-auto min-w-0 truncate font-mono text-[12px] leading-none", status?.tone === "red" && "font-semibold")}
          style={{ color: toneColor(status?.tone ?? "faint", dark) }}
        >
          {status?.text ?? chip.age}
        </span>
      </span>
      <span data-part="need" className="flex min-w-0 items-center gap-2 font-sans text-[13px] leading-[17px]">
        {need ? (
          <>
            <span
              data-part="tag"
              data-tone={need.tone}
              className={clsx("shrink-0", need.tone !== "faint" && "font-semibold")}
              style={{ color: toneColor(need.tone, dark) }}
            >
              {need.tag}
            </span>
            <span data-part="what" className={clsx("min-w-0 flex-1 truncate", need.tone === "faint" || need.tone === "dim" ? "text-fg-2" : "text-fg")}>
              {need.text}
            </span>
            {need.who && (
              <span data-part="who" className="shrink-0 font-mono text-[11px] text-fg-3">
                {need.who}
              </span>
            )}
          </>
        ) : (
          <span data-part="empty" className="text-fg-3">
            {chip.quiet ? "Quiet hours" : !chip.available ? "Not available" : status?.tone === "red" ? "Nothing else needs you" : "Nothing needs you"}
          </span>
        )}
      </span>
      {chip.flash !== undefined && <OnceFlash id={chip.id} token={chip.flash} tone={chip.flashTone} />}
    </button>
  );
});

export default RepoCell;
