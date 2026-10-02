/** The GitHub page's cell (SCROLLR-312, canvas board B3). */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { GitHubBoardRepo } from "../../../api/client";
import gh from "../../../dev/__fixtures__/github.board.json";
import { repoChip } from "../../../widgets/github/types";
import RepoCell, { REPO_MIN_COL } from "./RepoCell";

const NOW = Date.parse(gh._captured_at);
const chip = (i: number) => repoChip((gh.repos as unknown as GitHubBoardRepo[])[i], gh.config[i] as never, false, NOW);
const part = (c: HTMLElement, p: string) => c.querySelector<HTMLElement>(`[data-part=${p}]`);
const pills = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-part=pill]")].map((p) => `${p.dataset.kind}:${p.textContent}`);

describe("RepoCell", () => {
  it("the dot, the name, the age; the pills worst first", () => {
    const { container } = render(<RepoCell chip={chip(0)} width={600} dark />);
    expect(part(container, "title")!.textContent).toBe("myscrollr");
    expect(part(container, "age")!.textContent).toBe("1h");
    expect(container.querySelector("[data-chip]")!.getAttribute("data-worst")).toBe("accent");
    expect(container.querySelector("[data-chip]")!.getAttribute("data-item")).toBe("sample/myscrollr");
    expect(pills(container)).toEqual(["you:2 PRs for you", "ok:✓ test", "ok:✓ deploy", "quiet:1 new issue"]);
  });

  it("a narrow column clips with +N, keeping the worst", () => {
    const { container } = render(<RepoCell chip={chip(0)} width={REPO_MIN_COL} dark={false} />);
    const got = pills(container);
    expect(got[0]).toBe("you:2 PRs for you");
    expect(got.at(-1)).toMatch(/^more:\+\d$/);
    expect(got.length).toBeLessThan(5);
  });

  it("a red repo: a red dot and the failing pill first, red text on its wash", () => {
    const { container } = render(<RepoCell chip={chip(1)} width={600} dark />);
    expect(container.querySelector("[data-chip]")!.getAttribute("data-worst")).toBe("red");
    const first = container.querySelector<HTMLElement>("[data-part=pill]")!;
    expect(first.textContent).toBe("✗ deploy · 12m");
    expect(first.style.color).toContain("--color-down");
  });

  it("nothing watched, or GitHub would not say: a quiet line, never an empty cell", () => {
    const empty = repoChip({ repo: "o/r", available: true, workflows: [] }, undefined, false, NOW);
    expect(render(<RepoCell chip={empty} width={400} dark />).container.textContent).toContain("Nothing to watch");
    const gone = repoChip({ repo: "o/gone", available: false, workflows: [] }, undefined, false, NOW);
    expect(render(<RepoCell chip={gone} width={400} dark />).container.textContent).toContain("Not available");
  });
});
