import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  tip: vi.fn(),
}));

vi.mock("./store", () => ({
  readStoreShared: async (k: string) => m.disk.get(k),
  setStorePersisted: async (k: string, v: unknown) => {
    m.disk.set(k, v);
  },
}));
vi.mock("./tips", () => ({
  TIP_IDS: { PAGES_INTRO: "pages-intro" },
  showTipOnce: m.tip,
}));

import { applyPagesIntro, PAGES_INTRO_KEY } from "./pagesIntro";
import { loadPrefs } from "../preferences";
import type { AppPreferences } from "../preferences";

const withMode = (scrollMode: "pages" | "continuous"): AppPreferences => ({
  ...loadPrefs(),
  ticker: { ...loadPrefs().ticker, scrollMode },
});
const run = (prefs: AppPreferences) => applyPagesIntro(prefs, vi.fn(), vi.fn());

beforeEach(() => {
  m.disk.clear();
  m.tip.mockReset();
});

describe("applyPagesIntro", () => {
  it("continuous, no marker: marker written, flipped to pages, notice once", async () => {
    expect(await run(withMode("continuous"))).toBe(true);
    expect(m.disk.get(PAGES_INTRO_KEY)).toBe(true);
    expect(m.tip).toHaveBeenCalledTimes(1);
    const [id, next, , opts] = m.tip.mock.calls[0];
    expect(id).toBe("pages-intro");
    expect(next.ticker.scrollMode).toBe("pages");
    expect(opts.actionLabel).toBe("Open Ticker settings");
  });

  it("continuous, marker present: unchanged, no notice", async () => {
    m.disk.set(PAGES_INTRO_KEY, true);
    expect(await run(withMode("continuous"))).toBe(false);
    expect(m.tip).not.toHaveBeenCalled();
  });

  it("fresh install (already pages): marker only, no notice", async () => {
    expect(await run(withMode("pages"))).toBe(false);
    expect(m.disk.get(PAGES_INTRO_KEY)).toBe(true);
    expect(m.tip).not.toHaveBeenCalled();
  });

  it("switching back to Continuous after the flip: never flipped again", async () => {
    await run(withMode("continuous")); // the release's first run
    m.tip.mockClear();
    expect(await run(withMode("continuous"))).toBe(false); // every later launch
    expect(await run(withMode("continuous"))).toBe(false);
    expect(m.tip).not.toHaveBeenCalled();
  });
});
