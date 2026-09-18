import { describe, it, expect } from "vitest";
import type { DashboardResponse } from "../types";
import fixture from "./__fixtures__/dashboard.default.json";

/**
 * The default ticker-shim dashboard (SCROLLR-226) must stay a
 * DashboardResponse (`satisfies` is checked by `tsc` in `npm run build`)
 * and hold enough rows for the ticker to actually rotate: 4 sports slots
 * need more than 4 games in one league, 3 news slots need more than 3
 * items across 2 feeds, and finance needs more symbols than slots.
 */
/**
 * A JSON import widens every string literal to `string`, so the fixture
 * cannot `satisfies DashboardResponse` directly (`direction: "down"` is
 * `string`). Widen the target the same way: structure and required keys
 * are still checked by tsc; the literal unions are checked below at run
 * time.
 */
type Widen<T> = T extends string
  ? string
  : T extends (infer U)[]
    ? Widen<U>[]
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

const dash = (fixture satisfies Widen<DashboardResponse>) as unknown as DashboardResponse;

describe("dashboard.default.json", () => {
  it("names its provenance and capture time", () => {
    expect(fixture._note.length).toBeGreaterThan(40);
    expect(Number.isNaN(Date.parse(fixture._captured_at))).toBe(false);
  });

  it("uses the literal unions tsc cannot see through a JSON import", () => {
    for (const t of dash.data.finance ?? []) {
      expect(["up", "down", undefined], t.symbol).toContain(t.direction);
    }
    expect(["comfort", "compact"]).toContain(dash.preferences?.feed_mode);
  });

  it("carries enough rows for rotation", () => {
    const games = dash.data.sports ?? [];
    const byLeague = new Map<string, number>();
    for (const g of games) byLeague.set(g.league, (byLeague.get(g.league) ?? 0) + 1);
    expect(Math.max(...byLeague.values())).toBeGreaterThanOrEqual(6);

    const rss = dash.data.rss ?? [];
    expect(rss.length).toBeGreaterThanOrEqual(5);
    expect(new Set(rss.map((r) => r.feed_url)).size).toBeGreaterThanOrEqual(2);

    expect(dash.data.finance?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("puts every data widget on the ticker with a config the scoper can read", () => {
    const widgets = dash.widgets ?? [];
    expect(widgets.length).toBeGreaterThan(0);
    for (const w of widgets) {
      expect(w.enabled && w.ticker_enabled, w.widget_type).toBe(true);
      expect(Object.keys(w.config).length, w.widget_type).toBeGreaterThan(0);
    }
  });
});
