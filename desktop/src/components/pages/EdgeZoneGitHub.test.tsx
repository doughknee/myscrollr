/**
 * The GitHub edge slot's four connected states (SCROLLR-308, canvas board 1)
 * and its one flash per change.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { GitHubChipData, WidgetTickerData } from "../../types";
import type { GitHubPRRow } from "../../api/client";
import { GitHubCappedChip } from "../chips/CappedChip";
import EdgeZone, { GH_RESERVE, buildEdge } from "./EdgeZone";

const pr = (n: number, over: Partial<GitHubPRRow> = {}): GitHubPRRow => ({
  number: n,
  title: `Fix the thing #${n}`,
  html_url: "",
  author: "bob",
  is_mine: false,
  review_requested: true,
  review_state: "none",
  draft: false,
  head_branch: "b",
  head_sha: "s",
  updated_at: "",
  checks: { total: 0, passed: 0, failed: 0, running: 0 },
  checks_state: "none",
  ...over,
});

const chip = (id: string, over: Partial<GitHubChipData>): GitHubChipData => ({
  id,
  label: id,
  status: "success",
  workflowName: "CI",
  defaultCi: { state: "passing", workflow: "CI", commit_message: "feat: ship it\n\nbody" },
  flash: 0,
  ...over,
});

const STATES: GitHubChipData[] = [
  chip("myscrollr", { state: "passing", age: "2h" }),
  chip("scrollr-api", { state: "broken", age: "12m", defaultCi: { state: "failing", workflow: "deploy", commit_message: "fix: the deploy" } }),
  chip("scrollr-web", { state: "running", age: "3m", mineRunning: 2, mineBranch: "feat-x" }),
  chip("infra", { state: "needs", needs: 12, prs: [pr(1), pr(2)] }),
];

const edgeOf = (github: GitHubChipData[]) =>
  buildEdge({ clock: [], timer: [], weather: [], sysmon: [], uptime: [], github } as WidgetTickerData, [], null, ["github"]);

describe("GitHub edge slot: four states", () => {
  const items = edgeOf(STATES).utilities[0].items;

  it("passing: a green dot and the age, never the word", () => {
    expect(items[0]).toMatchObject({ mark: "up", value: "2h", dim: true, detail: "feat: ship it" });
    expect(JSON.stringify(items[0]).toLowerCase()).not.toContain("passing");
  });

  it("broken: a red dot, the workflow and its age, the commit beneath", () => {
    expect(items[1]).toMatchObject({ mark: "down", value: "deploy · 12m", tone: "down", detail: "fix: the deploy" });
  });

  it("running on yours: the ring, `yours · 3m`, the branch (+ the others) beneath", () => {
    expect(items[2]).toMatchObject({ mark: "run", value: "yours · 3m", tone: "ink", detail: "feat-x +1" });
  });

  it("needs you: the count pill and `for you`, the first PR beneath", () => {
    expect(items[3]).toMatchObject({ mark: "count", count: 12, value: "for you", tone: "ink", detail: "Fix the thing #1" });
  });

  it("a long workflow is cut to fit the reservation", () => {
    const long = edgeOf([chip("r", { state: "broken", age: "12m", defaultCi: { state: "failing", workflow: "Desktop Release" } })]);
    expect(long.utilities[0].items[0].value).toBe("Desktop… · 12m");
    expect(long.utilities[0].items[0].value.length).toBeLessThanOrEqual(GH_RESERVE.length);
  });

  it("every state reserves the same widest form, so a state change never moves the slot", () => {
    expect(new Set(items.map((i) => i.reserve))).toEqual(new Set([GH_RESERVE]));
    const { container } = render(<EdgeZone edge={edgeOf(STATES)} tick={3} reduced dark />);
    const sizers = [...container.querySelectorAll('[aria-hidden="true"]')].filter((s) => s.textContent?.includes(GH_RESERVE));
    expect(sizers).toHaveLength(4);
    // Each sizer holds a dot's room, never the item's own mark.
    for (const s of sizers) expect(s.querySelector("[data-mark]")).toBeNull();
    // tick 3 shows the needs-you item: a two-digit count in the pill.
    expect(container.querySelector('[data-mark="count"]')!.textContent).toBe("12");
  });

  it("not connected: the latest-run form, as before", () => {
    const old = edgeOf([{ id: "o", label: "o", status: "failure", workflowName: "CI", elapsed: "4m" }]).utilities[0].items[0];
    expect(old).toMatchObject({ value: "✗ 4m", tone: "down" });
    expect(old.mark).toBeUndefined();
  });
});

describe("GitHub flash", () => {
  const one = (flash: number) => edgeOf([chip("flash-repo", { state: "passing", age: "1m", flash })]);
  const flashes = (c: HTMLElement) => c.querySelectorAll(".chip-flash").length;

  it("fires once per new token; a poll that changed nothing, or a remount, never fires", () => {
    const { container, rerender, unmount } = render(<EdgeZone edge={one(0)} tick={0} reduced dark />);
    expect(flashes(container)).toBe(0);
    rerender(<EdgeZone edge={one(0)} tick={0} reduced dark />); // a poll, nothing changed
    expect(flashes(container)).toBe(0);
    rerender(<EdgeZone edge={one(1)} tick={0} reduced dark />); // passing → failing
    expect(flashes(container)).toBe(1);
    const el = container.querySelector(".chip-flash");
    rerender(<EdgeZone edge={one(1)} tick={0} reduced dark />);
    expect(container.querySelector(".chip-flash")).toBe(el); // same element: the animation does not replay
    unmount();
    const again = render(<EdgeZone edge={one(1)} tick={0} reduced dark />); // rolls back in
    expect(flashes(again.container)).toBe(0);
  });
});

describe("GitHubCappedChip (Continuous)", () => {
  it("needs you: the count on the cap and `for you`; others put the age in the fixed cell", () => {
    const needs = render(<GitHubCappedChip item={STATES[3]} />);
    expect(needs.container.textContent).toContain("12");
    expect(needs.container.textContent).toContain("for you");
    const broken = render(<GitHubCappedChip item={STATES[1]} />);
    expect(broken.container.textContent).toContain("deploy");
    expect(broken.container.textContent).toContain("12m");
    expect(broken.container.textContent?.toLowerCase()).not.toContain("passing");
  });
});
