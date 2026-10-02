/**
 * GitHub on the edge (SCROLLR-312, canvas B3): one or two repos share ONE
 * fixed-width slot that rotates on the page turn; three or more are a page
 * and leave the edge. Plus the Continuous chip, the same pills.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { GitHubBoardRepo } from "../../api/client";
import type { GitHubChipData, WidgetTickerData } from "../../types";
import gh from "../../dev/__fixtures__/github.board.json";
import { repoChip } from "../../widgets/github/types";
import { githubChip } from "../../hooks/useWidgetTickerData";
import { GITHUB_DEFAULTS } from "../../widgets/github/config";
import { GitHubCappedChip } from "../chips/CappedChip";
import EdgeZone, { buildEdge } from "./EdgeZone";

const NOW = Date.parse(gh._captured_at);
const repos = gh.repos as unknown as GitHubBoardRepo[];
const chips = (n: number, quiet = false): GitHubChipData[] => repos.slice(0, n).map((r, i) => repoChip(r, gh.config[i] as never, quiet, NOW));

const edgeOf = (github: GitHubChipData[]) =>
  buildEdge({ clock: [], timer: [], weather: [], sysmon: [], uptime: [], github } as WidgetTickerData, [], null, ["github"]);

describe("the GitHub edge slot", () => {
  it("0 repos: nothing; 1 or 2: one slot; 3 or more: none (the page has them)", () => {
    expect(edgeOf([]).utilities).toEqual([]);
    expect(edgeOf(chips(1)).utilities).toHaveLength(1);
    expect(edgeOf(chips(2)).utilities.map((u) => u.items.length)).toEqual([2]);
    expect(edgeOf(chips(3)).utilities).toEqual([]);
    expect(edgeOf(chips(4)).utilities).toEqual([]);
  });

  it("label GITHUB · REPO, the dot and the most urgent pill, the next pill beneath, the most urgent link", () => {
    const [a, b] = edgeOf(chips(2)).utilities[0].items;
    expect(a).toMatchObject({ label: "GITHUB · myscrollr", mark: "you", value: "2 PRs for you", tone: "ink", detail: "✓ test", url: "https://github.com/sample/myscrollr/pulls" });
    expect(b).toMatchObject({ label: "GITHUB · scrollr-api", mark: "down", value: "✗ deploy · 12m", tone: "down", detail: "✓ test" });
  });

  it("a running workflow rings; quiet hours grey the slot to the age", () => {
    const infra = repoChip(repos[3], gh.config[3] as never, false, NOW);
    expect(edgeOf([infra]).utilities[0].items[0]).toMatchObject({ mark: "run", value: "◌ apply · 3m" });
    expect(edgeOf(chips(1, true)).utilities[0].items[0]).toMatchObject({ mark: "idle", value: "1h", dim: true });
  });

  it("rotates on the turn, one fixed width whichever repo is up, with a corner dot per repo", () => {
    const edge = edgeOf(chips(2));
    const at = (tick: number) => render(<EdgeZone edge={edge} tick={tick} reduced dark />).container;
    const one = at(0);
    const btn = one.querySelector("[data-widget=github] button")!;
    expect(btn.classList.contains("w-[176px]")).toBe(true);
    expect(one.querySelector("[data-item]")!.getAttribute("data-item")).toBe("github-sample/myscrollr");
    expect(one.querySelectorAll("[data-part=dots] > span")).toHaveLength(2);
    expect(one.querySelector("[data-part=dots] [data-on]")).toBe(one.querySelectorAll("[data-part=dots] > span")[0]);
    const two = at(1);
    expect(two.querySelector("[data-item]")!.getAttribute("data-item")).toBe("github-sample/scrollr-api");
    expect(two.querySelector("[data-widget=github] button")!.classList.contains("w-[176px]")).toBe(true);
    expect(two.querySelector("[data-part=dots] [data-on]")).toBe(two.querySelectorAll("[data-part=dots] > span")[1]);
    // One repo: no rotation, no dots.
    const solo = render(<EdgeZone edge={edgeOf(chips(1))} tick={5} reduced dark />).container;
    expect(solo.querySelector("[data-part=dots]")).toBeNull();
  });
});

describe("the flash (308's rule)", () => {
  it("the first sight never flashes; the worst state changing does; the flash off says nothing", () => {
    const green: GitHubBoardRepo = { repo: "o/flash", available: true, workflows: [{ name: "ci", state: "passing", at: "2026-10-02T11:00:00Z" }] };
    const red: GitHubBoardRepo = { ...green, workflows: [{ name: "ci", state: "failing", at: "2026-10-02T11:30:00Z" }] };
    const cfg = { ...GITHUB_DEFAULTS, repos: [{ repo: "o/flash", prs: "mine" as const, issues: "off" as const }] };
    expect(githubChip(green, cfg, false, NOW).flash).toBe(0);
    expect(githubChip(green, cfg, false, NOW).flash).toBe(0);
    expect(githubChip(red, cfg, false, NOW)).toMatchObject({ flash: 1, flashTone: "down" });
    expect(githubChip(red, { ...cfg, flash: false }, false, NOW).flash).toBeUndefined();
  });
});

describe("GitHubCappedChip (Continuous)", () => {
  it("the worst state on the cap, the most urgent pill, the rest beneath, the age", () => {
    const { container } = render(<GitHubCappedChip item={chips(2)[1]} />);
    expect(container.textContent).toContain("scrollr-api");
    expect(container.textContent).toContain("✗ deploy · 12m");
    expect(container.textContent).toContain("✓ test · 3 open PRs");
    expect(container.textContent).toContain("12m");
  });
});
