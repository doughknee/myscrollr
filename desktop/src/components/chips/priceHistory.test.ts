import { describe, expect, it, beforeEach } from "vitest";
import { pushPrice, __resetPriceHistory } from "./priceHistory";

describe("priceHistory", () => {
  beforeEach(() => {
    __resetPriceHistory();
  });

  it("accumulates a series across ticks", () => {
    pushPrice("NVDA", 100);
    pushPrice("NVDA", 101);
    expect(pushPrice("NVDA", 102)).toEqual([100, 101, 102]);
  });

  it("keeps symbols apart", () => {
    pushPrice("NVDA", 100);
    pushPrice("TSLA", 200);
    expect(pushPrice("NVDA", 101)).toEqual([100, 101]);
    expect(pushPrice("TSLA", 201)).toEqual([200, 201]);
  });

  it("collapses repeats — a flat market must not flush the buffer", () => {
    pushPrice("NVDA", 100);
    for (let i = 0; i < 20; i++) pushPrice("NVDA", 100);
    pushPrice("NVDA", 105);
    // The 100 survived twenty identical ticks, so the move is still visible.
    expect(pushPrice("NVDA", 106)).toEqual([100, 105, 106]);
  });

  it("caps the series so old ticks fall off the front", () => {
    for (let i = 1; i <= 12; i++) pushPrice("NVDA", i);
    const series = pushPrice("NVDA", 13);
    expect(series).toHaveLength(8);
    expect(series[series.length - 1]).toBe(13);
    expect(series[0]).toBe(6);
  });

  it("coerces string prices, since the API types them either way", () => {
    pushPrice("NVDA", "100.5");
    expect(pushPrice("NVDA", 101)).toEqual([100.5, 101]);
  });

  it("ignores junk rather than poisoning the series with NaN", () => {
    pushPrice("NVDA", 100);
    expect(pushPrice("NVDA", "not-a-price")).toEqual([]);
    expect(pushPrice("NVDA", 101)).toEqual([100, 101]);
  });

  it("evicts the least recently touched symbol past the cap", () => {
    for (let i = 0; i < 200; i++) pushPrice(`SYM${i}`, 1);
    // Touch the oldest so it is no longer the eviction candidate.
    pushPrice("SYM0", 2);
    pushPrice("NEW", 1);

    // SYM0 survived because it was touched; SYM1 was next-oldest and went.
    expect(pushPrice("SYM0", 3)).toEqual([1, 2, 3]);
    expect(pushPrice("SYM1", 9)).toEqual([9]);
  });
});
