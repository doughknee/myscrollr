/** The GitHub page's cell (SCROLLR-312, canvas board C4 · D): two lines, two answers. */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { GitHubBoardRepo } from "../../../api/client";
import gh from "../../../dev/__fixtures__/github.board.json";
import { repoChip } from "../../../widgets/github/types";
import RepoCell from "./RepoCell";

const NOW = Date.parse(gh._captured_at);
const repos = gh.repos as unknown as GitHubBoardRepo[];
const chip = (i: number) => repoChip(repos[i], gh.config[i] as never, false, NOW);
const part = (c: HTMLElement, p: string) => c.querySelector<HTMLElement>(`[data-part=${p}]`)?.textContent ?? null;
const lines = (i: number) => {
  const { container: c } = render(<RepoCell chip={chip(i)} dark />);
  return [part(c, "title"), part(c, "status"), part(c, "tag"), part(c, "what"), part(c, "who"), part(c, "empty")];
};

describe("RepoCell", () => {
  it("green, with a review for you: line 2 names the PR and who asked", () => {
    expect(lines(0)).toEqual(["myscrollr", "all green · 1h", "Review", "The band: edge bar, name and page pills replace the pager", "sample-dev +1", null]);
    // The dot answers line 1: green, though a review waits.
    const { container } = render(<RepoCell chip={chip(0)} dark />);
    expect(container.querySelector<HTMLElement>("[data-part=dot]")!.style.background).toContain("--color-up");
  });

  it("red: line 1 says which run and when, line 2 the commit that broke it and that it was you", () => {
    expect(lines(1)).toEqual(["scrollr-api", "deploy failed · 12m", "Broke on", "fix: hold the budget until GitHub resets it", "you", null]);
    const { container } = render(<RepoCell chip={chip(1)} dark />);
    expect(container.querySelector("[data-chip]")!.getAttribute("data-worst")).toBe("red");
    expect(container.querySelector<HTMLElement>("[data-part=status]")!.style.color).toContain("--color-down");
  });

  it("red from another CI (no commit to name), nothing else: says nothing needs you", () => {
    expect(lines(2)).toEqual(["scrollr-web", "vercel failed · 3m", null, null, null, "Nothing else needs you"]);
  });

  it("running, with new issues: the newest issue by name, +N for the rest", () => {
    expect(lines(3)).toEqual(["infra", "apply running · 3m", "Issue", "Sample: rotate the registry token", "+1", null]);
  });

  it("nothing watched, GitHub would not say, or quiet hours: a quiet line, never an empty cell", () => {
    const empty = repoChip({ repo: "o/r", available: true, workflows: [] }, undefined, false, NOW);
    expect(render(<RepoCell chip={empty} dark />).container.textContent).toContain("Nothing needs you");
    const gone = repoChip({ repo: "o/gone", available: false, workflows: [] }, undefined, false, NOW);
    expect(render(<RepoCell chip={gone} dark />).container.textContent).toContain("Not available");
    const quiet = repoChip(repos[1], gh.config[1] as never, true, NOW);
    expect(render(<RepoCell chip={quiet} dark />).container.textContent).toContain("Quiet hours");
  });
});
