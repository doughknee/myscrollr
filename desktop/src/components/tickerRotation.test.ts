/**
 * The lap counter's arithmetic: a slot advances exactly once per
 * visible->hidden transition, never while on screen, and never on a
 * tick where nothing changed.
 */
import { describe, it, expect } from "vitest";
import { advanceCycles } from "./tickerRotation";

const S = (...xs: string[]) => new Set(xs);

describe("advanceCycles", () => {
  it("advances a slot that was visible and no longer is", () => {
    expect(advanceCycles({}, S("a"), S())).toEqual({ a: 1 });
  });

  it("does not advance a slot while it stays visible", () => {
    const c = { a: 3 };
    expect(advanceCycles(c, S("a"), S("a"))).toBe(c);
  });

  it("does not advance a slot on the tick it becomes visible", () => {
    // Entering is not a lap; leaving is.
    const c = { a: 3 };
    expect(advanceCycles(c, S(), S("a"))).toBe(c);
  });

  it("returns the same object when nothing changed, so state does not churn", () => {
    const c = { a: 1, b: 2 };
    expect(advanceCycles(c, S("a", "b"), S("a", "b"))).toBe(c);
    expect(advanceCycles(c, S(), S())).toBe(c);
  });

  it("advances only the slots that left, independently", () => {
    expect(advanceCycles({ a: 1, b: 1 }, S("a", "b"), S("b"))).toEqual({ a: 2, b: 1 });
  });

  it("counts a full lap as exactly one", () => {
    let c: Readonly<Record<string, number>> = {};
    // visible, visible, gone, gone, visible again, gone
    const frames = [S("a"), S("a"), S(), S(), S("a"), S()];
    for (let i = 1; i < frames.length; i++) c = advanceCycles(c, frames[i - 1], frames[i]);
    expect(c).toEqual({ a: 2 });
  });
});
