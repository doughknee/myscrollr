import { describe, it, expect } from "vitest";

/**
 * Regression guard for a bug class TypeScript structurally cannot catch.
 *
 * The optimistic-update hooks write back into the dashboard cache with
 * `return { ...old, <key>: rows }`. When the wire field was renamed
 * `channels` → `widgets`, four of these kept writing `channels`. Nothing
 * failed: excess-property checking does not apply through a spread, and an
 * `as DashboardResponse` cast silenced the rest. The effect would have been
 * silent — adding a widget or changing its config simply would not update
 * the UI until the next refetch.
 *
 * So this asserts on the source text, read through Vite's `?raw` glob (no
 * node types needed). Crude, but it catches exactly what the compiler is
 * blind to, and it costs nothing.
 */
const sources = import.meta.glob<string>(
  ["./useAddWidget.ts", "./useSportsConfig.ts", "./useDataWidgetConfig.ts", "./useDashboardCDC.ts"],
  { query: "?raw", import: "default", eager: true },
);

describe("optimistic dashboard writes", () => {
  it("covers every hook that writes the dashboard cache", () => {
    expect(Object.keys(sources)).toHaveLength(4);
  });

  for (const [path, src] of Object.entries(sources)) {
    it(`${path} writes the dashboard's widgets key, not a stale one`, () => {
      // `channels` as an object-literal KEY is writing a field
      // DashboardResponse no longer has. Reading one is fine — ShellDataState
      // legitimately has its own `channels`, so these hooks destructure and
      // call `.find()` on it; neither of those puts a colon after the name.
      const stale = src.match(/\bchannels\s*:/g);
      expect(
        stale,
        `${path} assigns a "channels" key; DashboardResponse uses "widgets"`,
      ).toBeNull();

      // And each hook must actually write widgets, so this cannot pass on a
      // file that stopped updating the cache altogether.
      expect(
        /\bwidgets\b/.test(src),
        `${path} never mentions widgets — did the cache write get dropped?`,
      ).toBe(true);
    });
  }
});
