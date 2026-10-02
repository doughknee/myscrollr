/** The GitHub page's thing cell (SCROLLR-312, canvas F1): a kicker line, then the title. */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import gh from "../../../dev/__fixtures__/github.board.json";
import { thingsFor } from "../../../widgets/github/types";
import type { GitHubBoard } from "../../../widgets/github/types";
import ThingCell from "./ThingCell";

const NOW = Date.parse(gh._captured_at);
const things = thingsFor(gh as unknown as GitHubBoard, gh.config as never, NOW);
const part = (c: HTMLElement, p: string) => c.querySelector<HTMLElement>(`[data-part=${p}]`)!;

describe("ThingCell", () => {
  it("line 1: the kicker in its tone, where, and the checks right-aligned; line 2: the title", () => {
    const { container: c } = render(<ThingCell thing={things.find((t) => t.tag === "CHANGES ASKED")!} dark />);
    expect([part(c, "tag"), part(c, "where"), part(c, "right"), part(c, "title")].map((e) => e.textContent)).toEqual([
      "CHANGES ASKED",
      "myscrollr #479 · yours",
      "✗ 1 of 5",
      "Connect GitHub: core brokers the Scrollr Desktop app",
    ]);
    expect(part(c, "tag").style.color).toContain("--color-down");
    expect(part(c, "right").style.color).toContain("--color-down");
    expect(part(c, "title").classList.contains("text-fg")).toBe(true);
    expect(c.querySelector("[data-chip]")!.getAttribute("data-item")).toBe("https://github.com/sample/myscrollr/pull/479");
  });

  it("a review reads in the widget's ink; what shipped is quieter: green kicker, a faint wash, the title in fg-2", () => {
    const { container: r } = render(<ThingCell thing={things.find((t) => t.tag === "REVIEW")!} dark />);
    expect(part(r, "tag").style.color).toBe("var(--accent-ink)");
    const { container: m } = render(<ThingCell thing={things.find((t) => t.shipped)!} dark />);
    expect(part(m, "tag").style.color).toContain("--color-up");
    expect(m.querySelector("[data-chip]")!.classList.contains("bg-fg/[0.03]")).toBe(true);
    expect(part(m, "title").classList.contains("text-fg-2")).toBe(true);
  });
});
