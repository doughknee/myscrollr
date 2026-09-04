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
    // Cap is 32: enough to hold the server's ~30-point intraday series and
    // still leave room for live ticks to extend it.
    for (let i = 1; i <= 40; i++) pushPrice("NVDA", i);
    const series = pushPrice("NVDA", 41);
    expect(series).toHaveLength(32);
    expect(series[series.length - 1]).toBe(41);
    expect(series[0]).toBe(10);
  });

  // ── server-seeded series ────────────────────────────────────────
  // Without a seed the buffer starts empty on every launch and the chip
  // holds a blank 44-56px gap until a second distinct price arrives — the
  // report that prompted this ("so much blank space, the graph isn't
  // loading"). Two points was not enough either: a pair can only draw a
  // straight line. The server now supplies a real intraday series.

  it("seeds from the server series, then extends it with live ticks", () => {
    const seed = [10, 11, 10.5, 12];
    expect(pushPrice("NVDA", 12.5, seed)).toEqual([10, 11, 10.5, 12, 12.5]);
    expect(pushPrice("NVDA", 13)).toEqual([10, 11, 10.5, 12, 12.5, 13]);
  });

  it("seeds only once — a later render must not re-prefix the series", () => {
    const seed = [10, 11];
    pushPrice("NVDA", 12, seed);
    pushPrice("NVDA", 13, seed);
    expect(pushPrice("NVDA", 14, seed)).toEqual([10, 11, 12, 13, 14]);
  });

  it("drops the pre-seed tick instead of leaving a cliff off the end", () => {
    // A chip records one price before its series lands. Prepending the series
    // in FRONT of that tick strands a stale price after a full session of
    // real ones and draws a vertical cliff — symbols whose recorded tick sat
    // 6-8% from where their series ended showed exactly that.
    pushPrice("NVDA", 304.78); // stale
    const series = [320, 322, 321, 325.53];
    expect(pushPrice("NVDA", 325.6, series)).toEqual([
      320, 322, 321, 325.53, 325.6,
    ]);
  });

  it("still seeds a symbol that was rendered before its series arrived", () => {
    // THE BUG. A chip renders as soon as the dashboard lands, so a symbol
    // whose series has not been fetched yet records one price first. An
    // "empty series only" rule locked those out permanently — three of four
    // symbols on screen stayed blank until the app restarted.
    pushPrice("NVDA", 12);
    // The 12 is dropped: the series is the better record of that period, and
    // the current price follows it immediately.
    expect(pushPrice("NVDA", 12.5, [10, 11])).toEqual([10, 11, 12.5]);
  });

  it("seeds even after several ticks have accumulated", () => {
    // THE OUTAGE BUG. Any count-based gate ("empty only", "at most one
    // tick") locks a symbol out the moment it records one tick more than the
    // gate allows. While the backend was down the prices kept changing, the
    // buffers filled past the limit, and every chip stayed blank even after
    // the series came back. The two are records of the same period and the
    // server's is the better one, so it replaces rather than merges.
    pushPrice("NVDA", 100);
    pushPrice("NVDA", 101);
    pushPrice("NVDA", 102);
    expect(pushPrice("NVDA", 103, [50, 60])).toEqual([50, 60, 103]);
  });

  it("latches, so live ticks after the seed are never discarded", () => {
    const series = [50, 60];
    pushPrice("NVDA", 61, series);
    pushPrice("NVDA", 62, series);
    expect(pushPrice("NVDA", 63, series)).toEqual([50, 60, 61, 62, 63]);
  });

  it("drops non-positive seed points rather than drawing through the floor", () => {
    // The ingester uses <= 0 to mean "no bar for this slot".
    expect(pushPrice("NVDA", 12, [10, 0, 11, -5])).toEqual([10, 11, 12]);
  });

  it("ignores an absent or empty seed", () => {
    expect(pushPrice("NVDA", 12)).toEqual([12]);
    __resetPriceHistory();
    expect(pushPrice("NVDA", 12, [])).toEqual([12]);
    __resetPriceHistory();
    expect(pushPrice("NVDA", 12, null)).toEqual([12]);
  });

  it("trims an oversized seed so live ticks still fit", () => {
    // A seed longer than the buffer must not fill it completely, or the
    // very next tick would push the oldest seed point out and the line
    // would crawl instead of extending.
    const seed = Array.from({ length: 50 }, (_, i) => i + 1);
    const series = pushPrice("NVDA", 999, seed);
    expect(series).toHaveLength(32);
    expect(series[series.length - 1]).toBe(999);
    expect(series[series.length - 2]).toBe(50);
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
