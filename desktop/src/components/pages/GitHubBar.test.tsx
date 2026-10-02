/**
 * GitHub on the bar outside its page (SCROLLR-312): never on the edge (the
 * page has it from one repo up, canvas F1), the flash, and the Continuous
 * chip, which still draws the pills.
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
import { buildEdge } from "./EdgeZone";

const NOW = Date.parse(gh._captured_at);
const repos = gh.repos as unknown as GitHubBoardRepo[];
const chips = (n: number, quiet = false): GitHubChipData[] => repos.slice(0, n).map((r, i) => repoChip(r, gh.config[i] as never, quiet, NOW));

describe("GitHub is never on the edge", () => {
  it("whatever the number of repos, quiet or not: the edge is for clocks, weather, timers and pins", () => {
    for (const github of [chips(1), chips(2), chips(4), chips(2, true)]) {
      const edge = buildEdge({ clock: [], timer: [], weather: [], sysmon: [], uptime: [], github, githubThings: [] } as WidgetTickerData, [], null, ["github"]);
      expect(edge.utilities).toEqual([]);
    }
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
