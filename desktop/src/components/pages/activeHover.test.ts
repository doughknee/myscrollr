import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOVER_IDLE_MS, createActiveHover } from "./activeHover";

describe("active hover (SCROLLR-291)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds on enter, releases after 5 s of stillness, grabs again on a move", () => {
    const seen: boolean[] = [];
    const h = createActiveHover((a) => seen.push(a));
    h.move();
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(HOVER_IDLE_MS - 1);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true, false]);
    h.move();
    expect(seen).toEqual([true, false, true]);
  });

  it("a moving pointer keeps the hold, and reports one transition, not one per move", () => {
    const seen: boolean[] = [];
    const h = createActiveHover((a) => seen.push(a));
    for (let i = 0; i < 30; i++) {
      h.move();
      vi.advanceTimersByTime(1000);
    }
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(HOVER_IDLE_MS);
    expect(seen).toEqual([true, false]);
  });

  it("leaving releases at once and cancels the idle timer", () => {
    const seen: boolean[] = [];
    const h = createActiveHover((a) => seen.push(a));
    h.move();
    h.leave();
    expect(seen).toEqual([true, false]);
    vi.advanceTimersByTime(HOVER_IDLE_MS * 2);
    expect(seen).toEqual([true, false]);
    h.leave();
    expect(seen).toEqual([true, false]);
  });
});
