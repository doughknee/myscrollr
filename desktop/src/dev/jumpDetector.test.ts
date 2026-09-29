import { afterEach, describe, expect, it, vi } from "vitest";
import { changedPaths, detect, startJumpDetector, summarizeArgs, summarizeDashboard, type Snap } from "./jumpDetector";

const bounds = { left: 0, right: 1000 };
const chip = (key: string, x: number, w = 100): Snap => ({ key, x, w });
const scroll = (s: Snap[], dx: number) => s.map((c) => ({ ...c, x: c.x + dx }));

describe("detect", () => {
  const prev = [chip("a", 100), chip("b", 300), chip("c", 500)];

  it("ignores a pure scroll", () => {
    expect(detect(prev, scroll(prev, -6), bounds)).toEqual([]);
  });

  it("ignores a whole-bar step (median absorbs it)", () => {
    expect(detect(prev, scroll(prev, -270), bounds)).toEqual([]);
  });

  it("flags a chip that moves > 2 px relative to the median, not one at 2 px", () => {
    const cur = scroll(prev, -6);
    cur[1] = { ...cur[1], x: cur[1].x + 3 };
    const f = detect(prev, cur, bounds);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ key: "b", jumpPx: 3, swapped: null });
    cur[1] = { ...prev[1], x: prev[1].x - 6 + 2 };
    expect(detect(prev, cur, bounds)).toEqual([]);
  });

  it("flags a width change > 0.5 px and reports before/after", () => {
    const cur = scroll(prev, -6);
    cur[0] = { ...cur[0], w: 100.6 };
    const f = detect(prev, cur, bounds);
    expect(f).toEqual([{ key: "a", jumpPx: 0, widthBefore: 100, widthAfter: 100.6, swapped: null }]);
    cur[0] = { ...cur[0], w: 100.5 };
    expect(detect(prev, cur, bounds)).toEqual([]);
  });

  it("flags a chip that vanishes or appears fully on screen, not one at the edge", () => {
    expect(detect(prev, prev.slice(0, 2), bounds)).toEqual([
      { key: "c", jumpPx: 0, widthBefore: 100, widthAfter: 0, swapped: "disappeared" },
    ]);
    expect(detect(prev.slice(0, 2), prev, bounds)[0]).toMatchObject({ key: "c", swapped: "appeared" });
    const edge = [...prev, chip("d", 960)];
    expect(detect(prev, edge, bounds)).toEqual([]); // entering at the right edge
  });

  it("pairs loop clones (same key) by nearest position", () => {
    const p = [chip("a", 50), chip("a", 650)];
    expect(detect(p, scroll(p, -6), bounds)).toEqual([]);
  });
});

describe("summaries", () => {
  it("drops secret-looking args and collapses objects", () => {
    expect(summarizeArgs({ token: "x", height: 228, position: "top", monitors: [1, 2], cfg: {} })).toBe(
      "height=228 position=top monitors=[2 items] cfg=[object]",
    );
  });
  it("counts items per source", () => {
    expect(summarizeDashboard({ data: { finance: [1, 2], rss: [], x: 5 }, widgets: [1] })).toBe("finance=2 rss=0 widgets=1");
  });
});

describe("changedPaths", () => {
  it("names the leaf that changed", () => {
    expect(changedPaths({ ticker: { tickerMode: "detailed", x: 1 } }, { ticker: { tickerMode: "compact", x: 1 } })).toEqual([
      'ticker.tickerMode: "detailed" -> "compact"',
    ]);
    expect(changedPaths({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe("gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does nothing outside dev (no timers, no hooks)", () => {
    vi.stubEnv("DEV", false);
    const set = vi.spyOn(globalThis, "setInterval");
    const stop = startJumpDetector("ticker");
    expect(set).not.toHaveBeenCalled();
    stop();
    set.mockRestore();
  });
});
