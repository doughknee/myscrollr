import { memo } from "react";
import type { CSSProperties } from "react";
import type { GitHubChipData } from "../../../types";
import type { GitHubPill, PillKind } from "../../../widgets/github/types";
import { fitPills } from "../../../widgets/github/types";
import { OnceFlash } from "../../chips/ChipFlash";
import { mix, semantic } from "./parts";

/** Narrowest column a repo takes (its name and two or three pills), for pagePlan's `columnsFor`. */
export const REPO_MIN_COL = 300;

/** The cell's side padding (18 left, 16 right): what the pills row loses of the column. */
const PAD_X = 34;

/** A pill's colours: red and green on their own wash, the accent pair for you and running, grey counts. */
export function pillStyle(kind: PillKind | "more", dark: boolean): CSSProperties {
  switch (kind) {
    case "red":
      return { background: "color-mix(in srgb, var(--color-down) 12%, transparent)", color: semantic("down", dark) };
    case "ok":
      return { background: "color-mix(in srgb, var(--color-up) 12%, transparent)", color: semantic("up", dark) };
    case "you":
      return { background: mix(dark ? 16 : 12), color: "var(--accent-ink)" };
    case "run":
      return { background: mix(dark ? 10 : 8), color: "var(--accent-ink)" };
    default:
      return { background: "color-mix(in srgb, var(--color-fg-3) 14%, transparent)", color: "var(--color-fg-2)" };
  }
}

function Pill({ kind, text, dark }: { kind: PillKind | "more"; text: string; dark: boolean }) {
  return (
    <span
      data-part="pill"
      data-kind={kind}
      className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-[5px] px-[7px] font-mono text-[12px] font-semibold leading-none"
      style={pillStyle(kind, dark)}
    >
      {text}
    </span>
  );
}

interface RepoCellProps {
  chip: GitHubChipData;
  /** The column's width: how many pills fit before `+N`. */
  width: number;
  dark: boolean;
  onClick?: () => void;
}

/**
 * One tracked repo on the GitHub page (SCROLLR-312, canvas board B3): a dot
 * in the repo's worst state, its name, the age of its newest event
 * right-aligned; under them its pills, worst first, as many as the column
 * holds and then `+N`. Click: the most urgent pill's link.
 *
 * Nothing moves while the page is up (§P.8): the column width is frozen, so
 * a refresh changes a pill's text or colour in place; a pill that appears
 * takes room only on the right.
 */
const RepoCell = memo(function RepoCell({ chip, width, dark, onClick }: RepoCellProps) {
  const { shown, more } = fitPills(chip.pills, Math.max(0, width - PAD_X));
  const dot: CSSProperties =
    chip.worst === "red"
      ? { background: "var(--color-down)" }
      : chip.worst === "accent"
        ? { background: "var(--accent)" }
        : chip.worst === "ok"
          ? { background: "var(--color-up)" }
          : { background: "var(--color-fg-3)" };
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={chip.repo}
      data-worst={chip.worst}
      className="relative flex h-full w-full min-w-0 flex-col justify-center gap-[7px] pl-[18px] pr-4 text-left"
    >
      <span className="flex min-w-0 items-center gap-[7px]">
        <span data-part="dot" className="size-2 shrink-0 rounded-full" style={dot} />
        <span data-part="title" className="min-w-0 truncate font-sans text-[15px] font-semibold leading-[19px] text-fg">
          {chip.label}
        </span>
        <span data-part="age" className="ml-auto shrink-0 font-mono text-[12px] leading-none text-fg-3">
          {chip.age}
        </span>
      </span>
      <span data-part="pills" className="flex min-w-0 gap-1.5 overflow-hidden">
        {shown.map((p: GitHubPill, i) => (
          <Pill key={`${i}:${p.text}`} kind={p.kind} text={p.text} dark={dark} />
        ))}
        {more > 0 && <Pill kind="more" text={`+${more}`} dark={dark} />}
        {chip.pills.length === 0 && (
          <span data-part="empty" className="font-mono text-[12px] leading-5 text-fg-3">
            {chip.available ? "Nothing to watch" : "Not available"}
          </span>
        )}
      </span>
      {chip.flash !== undefined && <OnceFlash id={chip.id} token={chip.flash} tone={chip.flashTone} />}
    </button>
  );
});

export default RepoCell;
