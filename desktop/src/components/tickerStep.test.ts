import { describe, it, expect } from "vitest";
import { stepItemIndex } from "./tickerStep";

describe("stepItemIndex", () => {
  it("walks the originals in order when scrolling left", () => {
    expect([0, 1, 2, 3, 4].map((s) => stepItemIndex(s, 3, "left"))).toEqual([0, 1, 2, 0, 1]);
  });

  it("walks them backwards from the end when scrolling right", () => {
    // Content moves right; the item arriving at the leading edge is the
    // previous one in the loop, starting from the last.
    expect([0, 1, 2, 3, 4].map((s) => stepItemIndex(s, 3, "right"))).toEqual([2, 1, 0, 2, 1]);
  });

  it("is safe on an empty or single-item rail", () => {
    expect(stepItemIndex(7, 0, "left")).toBe(0);
    expect(stepItemIndex(7, 1, "left")).toBe(0);
    expect(stepItemIndex(7, 1, "right")).toBe(0);
  });

  it("would have drifted under the old first-item rule", () => {
    // Three chips 100, 200, 300 wide. Old behaviour: every step is 100.
    // After three steps the rail has moved 300px but the chips occupy 600,
    // so the pause lands halfway through the second chip. New behaviour
    // sums to exactly one loop.
    const widths = [100, 200, 300];
    const stepped = [0, 1, 2].reduce((acc, s) => acc + widths[stepItemIndex(s, 3, "left")], 0);
    expect(stepped).toBe(600);
    expect(3 * widths[0]).not.toBe(600);
  });
});
