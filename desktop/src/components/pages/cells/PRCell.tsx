import { memo, useState } from "react";
import type { GitHubPRRow } from "../../../api/client";
import type { GitHubPagePR } from "../../../widgets/github/types";
import { shortAge } from "../../../widgets/github/types";
import { mix } from "./parts";

/** Narrowest column a pull request takes (the title, then the meta line with its tag and checks), for pagePlan's `columnsFor`. */
export const PR_MIN_COL = 300;

type Tag = "review" | "changes" | "approved";

const TAG_TEXT: Record<Tag, string> = {
  review: "Review requested",
  changes: "Changes requested",
  approved: "Approved",
};

/** The state tag: a review asked of you leads, then what the reviews say. */
export function tagOf(pr: GitHubPRRow): Tag | null {
  if (pr.review_requested) return "review";
  if (pr.review_state === "changes_requested") return "changes";
  if (pr.review_state === "approved") return "approved";
  return null;
}

/** `✓ 5/5`, `✗ 1 failing`, `◌ 2 running`; nothing when there are no checks (or core did not look). */
export function checksText(pr: GitHubPRRow): { text: string; tone: "up" | "down" | "run" } | null {
  const c = pr.checks;
  switch (pr.checks_state) {
    case "failing":
      return { text: `✗ ${c.failed} failing`, tone: "down" };
    case "running":
      return { text: `◌ ${c.running} running`, tone: "run" };
    case "passing":
      return { text: `✓ ${c.passed}/${c.total}`, tone: "up" };
    default:
      return null;
  }
}

/**
 * Red and green as text on their own 12% wash: the palette's tokens moved
 * 15% toward white (dark) or black (light), the band chip's rule, so they
 * clear 4.5:1 on every palette (`pages-themes.spec`; a 14% wash left gruvbox-dark at 4.47).
 */
function semantic(token: "down" | "up", dark: boolean): string {
  return `color-mix(in srgb, var(--color-${token}) 85%, ${dark ? "white" : "black"})`;
}

interface PRCellProps {
  pr: GitHubPagePR;
  dark: boolean;
  /** Clock for the age; tests pin it. */
  now?: number;
  onClick?: () => void;
}

/**
 * One pull request that needs you, in a page column (SCROLLR-309, canvas
 * board 2). The title on one line (15px semibold, ellipsis); under it the
 * meta line, `repo #number · author|yours · age` in 12px mono, with the
 * state tag and the checks right-aligned on it.
 *
 * Nothing moves while the page is up (§P.8): the tag is why the PR is on
 * this page, taken when the cell mounts (a page mounts at swipe-in), and the
 * checks hold the width of their mount-time text (running and failing are
 * the same length, passing is shorter), so a run finishing changes the
 * glyph and the number in place.
 */
const PRCell = memo(function PRCell({ pr, dark, now, onClick }: PRCellProps) {
  const [tag] = useState(() => tagOf(pr));
  const checks = checksText(pr);
  const [checksCh] = useState(() => checks?.text.length ?? 0);
  const tagStyle =
    tag === "review"
      ? { background: mix(dark ? 16 : 12), color: "var(--accent-ink)" }
      : tag === "changes"
        ? { background: "color-mix(in srgb, var(--color-down) 12%, transparent)", color: semantic("down", dark) }
        : { background: "color-mix(in srgb, var(--color-up) 12%, transparent)", color: semantic("up", dark) };
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={`${pr.repo}#${pr.number}`}
      className="flex h-full w-full min-w-0 flex-col justify-center gap-1.5 pl-[18px] pr-4 text-left"
    >
      <span data-part="title" className="block min-w-0 truncate font-sans text-[15px] font-semibold leading-[19px] text-fg">
        {pr.title}
      </span>
      <span className="flex min-w-0 items-center gap-2.5 whitespace-nowrap text-[12px] leading-[16px]">
        <span data-part="meta" className="min-w-0 truncate font-mono text-fg-3">
          {pr.repo} #{pr.number} · {pr.is_mine ? "yours" : pr.author} · {shortAge(pr.updated_at, now)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          {tag && (
            <span data-part="tag" data-tag={tag} className="rounded-[4px] px-[7px] py-0.5 font-sans font-semibold" style={tagStyle}>
              {TAG_TEXT[tag]}
            </span>
          )}
          <span
            data-part="checks"
            className={checks?.tone === "up" ? "text-right font-mono font-semibold text-up" : checks?.tone === "down" ? "text-right font-mono font-semibold text-down" : "text-right font-mono font-semibold"}
            style={{ minWidth: `${checksCh}ch`, color: checks?.tone === "run" ? "var(--accent-ink)" : undefined }}
          >
            {checks?.text}
          </span>
        </span>
      </span>
    </button>
  );
});

export default PRCell;
