import { describe, it, expect } from "vitest";

/**
 * Guard for a bug class TypeScript structurally cannot catch.
 *
 * Anything that builds a `DashboardResponse` writes it as an object
 * literal — `{ ...old, widgets: rows }` in the optimistic hooks,
 * `{ data, widgets, preferences } as DashboardResponse` in the query.
 * When the wire field was renamed `channels` → `widgets`, several of these
 * kept writing `channels`, and nothing failed: excess-property checking
 * does not apply through a spread, and an `as DashboardResponse` cast
 * silences it outright. The effect is silent — the sidebar, the account
 * page and the ticker all read `dashboard.widgets`, get `undefined`, and
 * render empty while the widget pages keep working.
 *
 * That shipped. `queries.ts` fetched `data.widgets` and stored it under
 * `channels`, so `dashboard.widgets` was *always* undefined in v1.1.10.
 *
 * This scans every file that mentions DashboardResponse rather than a
 * hand-kept list of filenames — the first version of this guard enumerated
 * four hooks and missed queries.ts for exactly that reason.
 */
const sources = import.meta.glob<string>("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * There is no allow-list. `ShellDataState` used to carry its own unrelated
 * `channels` field, which forced two exemptions here; the vocabulary rename
 * made it `widgets` like everything else, so every `channels:` key in a file
 * that touches DashboardResponse is now unambiguously the bug.
 */
const builders = Object.entries(sources).filter(
  ([path, src]) => src.includes("DashboardResponse") && !path.endsWith(".test.ts"),
);

describe("dashboard payload keys", () => {
  it("finds the files that build a DashboardResponse", () => {
    // Sanity: if this drops to zero the glob broke and the guard is vacuous.
    expect(builders.length).toBeGreaterThan(3);
  });

  for (const [path, src] of builders) {
    it(`${path} uses the widgets key, not the retired channels one`, () => {
      const stale = src.match(/\bchannels\s*:/g);
      expect(
        stale,
        `${path} assigns a "channels" key. DashboardResponse and the ` +
          `overview payload both use "widgets" — a stale key here is invisible ` +
          `to tsc and silently empties the sidebar.`,
      ).toBeNull();
    });
  }
});
