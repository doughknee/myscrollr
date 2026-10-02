/** The GitHub page's cell (SCROLLR-309, canvas board 2). */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { GitHubPagePR } from "../../../widgets/github/types";
import PRCell, { checksText, tagOf } from "./PRCell";

const NOW = Date.parse("2026-10-02T12:00:00Z");

const pr = (over: Partial<GitHubPagePR> = {}): GitHubPagePR => ({
  number: 478,
  title: "The band: edge bar, name and page pills replace the pager",
  html_url: "https://github.com/sample/myscrollr/pull/478",
  author: "sample-dev",
  is_mine: false,
  review_requested: true,
  review_state: "none",
  draft: false,
  head_branch: "band",
  head_sha: "a478",
  updated_at: "2026-10-02T10:00:00Z",
  checks: { total: 5, passed: 5, failed: 0, running: 0 },
  checks_state: "passing",
  repo: "myscrollr",
  why: 0,
  ...over,
});

const part = (c: HTMLElement, p: string) => c.querySelector<HTMLElement>(`[data-part=${p}]`);

describe("PRCell", () => {
  it("the title, then repo #number · author · age, the tag and the checks", () => {
    const { container } = render(<PRCell pr={pr()} dark now={NOW} />);
    expect(part(container, "title")!.textContent).toBe("The band: edge bar, name and page pills replace the pager");
    expect(part(container, "meta")!.textContent).toBe("myscrollr #478 · sample-dev · 2h");
    expect(part(container, "tag")!.textContent).toBe("Review requested");
    expect(part(container, "checks")!.textContent).toBe("✓ 5/5");
    expect(container.querySelector("[data-chip]")!.getAttribute("data-item")).toBe("myscrollr#478");
  });

  it("yours says yours; the three tags and the three checks", () => {
    const { container } = render(<PRCell pr={pr({ is_mine: true, review_requested: false, review_state: "changes_requested", checks_state: "failing", checks: { total: 5, passed: 4, failed: 1, running: 0 } })} dark={false} now={NOW} />);
    expect(part(container, "meta")!.textContent).toBe("myscrollr #478 · yours · 2h");
    expect(part(container, "tag")!.textContent).toBe("Changes requested");
    expect(part(container, "checks")!.textContent).toBe("✗ 1 failing");
    expect(tagOf(pr({ review_requested: false, review_state: "approved" }))).toBe("approved");
    expect(tagOf(pr({ review_requested: false }))).toBeNull();
    expect(checksText(pr({ checks_state: "running", checks: { total: 5, passed: 3, failed: 0, running: 2 } }))).toEqual({ text: "◌ 2 running", tone: "run" });
    expect(checksText(pr({ checks_state: "unknown" }))).toBeNull();
  });

  it("nothing moves while the page is up: the tag stays, the checks keep their mount-time width", () => {
    const running = pr({ checks_state: "running", checks: { total: 5, passed: 3, failed: 0, running: 2 } });
    const { container, rerender } = render(<PRCell pr={running} dark now={NOW} />);
    expect(part(container, "checks")!.style.minWidth).toBe("11ch");
    rerender(<PRCell pr={{ ...running, review_requested: false, review_state: "approved", checks_state: "passing", checks: { total: 5, passed: 5, failed: 0, running: 0 } }} dark now={NOW} />);
    expect(part(container, "checks")!.textContent).toBe("✓ 5/5");
    expect(part(container, "checks")!.style.minWidth).toBe("11ch");
    expect(part(container, "tag")!.textContent).toBe("Review requested");
  });
});
