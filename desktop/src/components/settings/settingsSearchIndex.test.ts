/**
 * The search index is generated from rows.ts, and the pages render
 * their copy from the same file — so the thing left to guard is that
 * the two sets of row ids agree. These tests read the page sources and
 * fail in both directions: a rendered `<Row id>` / `data-row` with no
 * entry (unsearchable), and an entry with no rendered target (a jump
 * that silently no-ops).
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_SEARCH_INDEX, searchSettings } from "./searchIndex";
import { SETTINGS_PAGES, isSettingsPage, resolveSettingsPage } from "./pages";

// Page sources as raw strings, via Vite rather than node:fs. This file
// lives under src/, where tsconfig exposes only vite/client + vitest
// globals — reaching for node builtins here type-checks fine under
// vitest (Vite resolves them at runtime) but fails `tsc --noEmit`, which
// is the second half of `npm run build` and therefore the release build.
// Groups shared between pages (MonitorMap.tsx) sit one level up.
const PAGE_SOURCES = import.meta.glob(["./pages/*.tsx", "./*.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every `<Row id="…">` and `data-row="…"` token across the settings surface. */
function renderedRowIds(): Set<string> {
  const ids = new Set<string>();
  for (const src of Object.values(PAGE_SOURCES)) {
    for (const m of src.matchAll(/<Row\s+id="([^"]+)"/g)) ids.add(m[1]);
    // One element can carry several ids (`data-row="signedIn plan"`).
    for (const m of src.matchAll(/data-row="([^"]+)"/g)) {
      for (const id of m[1].split(/\s+/)) ids.add(id);
    }
  }
  return ids;
}

const indexedIds = () => new Set(SETTINGS_SEARCH_INDEX.map((e) => e.rowId));

describe("settings search index", () => {
  it("only references real pages", () => {
    for (const entry of SETTINGS_SEARCH_INDEX) {
      expect(isSettingsPage(entry.page), `${entry.rowId} → ${entry.page}`).toBe(
        true,
      );
    }
  });

  it("has no duplicate rowIds", () => {
    const seen = SETTINGS_SEARCH_INDEX.map((e) => e.rowId);
    expect(new Set(seen).size).toBe(seen.length);
  });

  /** The jump-flash silently no-ops when a rowId has no matching target. */
  it("every indexed row exists on a page", () => {
    const rendered = renderedRowIds();
    const missing = SETTINGS_SEARCH_INDEX.filter(
      (e) => !rendered.has(e.rowId),
    ).map((e) => `${e.page}:${e.rowId}`);
    expect(missing).toEqual([]);
  });

  /** The other direction: a row on a page that search cannot reach. */
  it("every rendered row is indexed", () => {
    const indexed = indexedIds();
    const unsearchable = [...renderedRowIds()].filter((id) => !indexed.has(id));
    expect(unsearchable).toEqual([]);
  });

  /** Searching a row's own label — the words on the page — finds it. */
  it("every rendered row is found by its label", () => {
    for (const entry of SETTINGS_SEARCH_INDEX) {
      const hits = searchSettings(entry.label, entry.when !== "signedOut");
      expect(
        hits.map((h) => h.rowId),
        `"${entry.label}" → ${entry.rowId}`,
      ).toContain(entry.rowId);
    }
  });

  it("covers every page that has jumpable rows", () => {
    const indexed = new Set(SETTINGS_SEARCH_INDEX.map((e) => e.page));
    for (const page of SETTINGS_PAGES) {
      expect(indexed.has(page), `no search entries for "${page}"`).toBe(true);
    }
  });

  /** The row that used to be indexed as a sort control is not a row. */
  it("does not index the release-history sort control", () => {
    expect(indexedIds().has("releaseSort")).toBe(false);
  });
});

describe("searchSettings", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(searchSettings("", true)).toEqual([]);
    expect(searchSettings("   ", true)).toEqual([]);
  });

  it("matches on label", () => {
    const hits = searchSettings("on hover", true);
    expect(hits.map((h) => h.rowId)).toContain("onHover");
  });

  it("matches on description", () => {
    const hits = searchSettings("brighten muted text", true);
    expect(hits.map((h) => h.rowId)).toEqual(["highContrast"]);
  });

  /** Keywords are the whole point — they catch words not in the copy. */
  it("matches on keywords that appear nowhere in the visible text", () => {
    expect(searchSettings("gdpr", true).map((h) => h.rowId)).toEqual(["export"]);
    expect(searchSettings("a11y", true).map((h) => h.rowId)).toEqual([
      "highContrast",
    ]);
    expect(searchSettings("hotkey", true).map((h) => h.rowId)).toEqual([
      "shortcuts",
    ]);
  });

  it("is case-insensitive", () => {
    expect(searchSettings("CATPPUCCIN", true).map((h) => h.rowId)).toEqual([
      "theme",
    ]);
  });

  /** Hover speed folded into On hover (REL-204): "speed" → one ticker row. */
  it("reproduces the reference query", () => {
    const hits = searchSettings("speed", true);
    expect(hits.map((h) => h.label)).toEqual(["Speed"]);
    expect(hits.every((h) => h.page === "ticker")).toBe(true);
  });

  /** The Ticker page's rows, in page order, are all findable (REL-204). */
  it("indexes every Ticker page row in page order", () => {
    expect(
      SETTINGS_SEARCH_INDEX.filter((e) => e.page === "ticker").map((e) => e.rowId),
    ).toEqual([
      "showTicker",
      "tickerMonitors",
      "screenEdge",
      "detailLevel",
      "tickerScale",
      "chipColors",
      "scrollMode",
      "speed",
      "onHover",
      "stepPause",
      "alwaysOnTop",
      "hideFullscreen",
      "itemOrder",
    ]);
  });

  /**
   * "windows" must still find the fullscreen toggle. The caveat moved
   * out of the description and into a badge chip, so only the keyword
   * list keeps it findable.
   */
  it("still finds the Windows-only toggle by platform name", () => {
    expect(searchSettings("windows", true).map((h) => h.rowId)).toContain(
      "hideFullscreen",
    );
  });

  /** Account rows only exist in one sign-in state, and so do their results. */
  it("hides account rows that are not on the page in this sign-in state", () => {
    expect(searchSettings("signed in as", false)).toEqual([]);
    expect(searchSettings("email", false).map((h) => h.rowId)).toEqual([]);
    expect(searchSettings("sign in to scrollr", true)).toEqual([]);
    expect(searchSettings("sign in to scrollr", false).map((h) => h.rowId)).toEqual([
      "signIn",
    ]);
    expect(searchSettings("export", false)).toEqual([]);
    expect(searchSettings("export", true).map((h) => h.rowId)).toEqual(["export"]);
  });

  /** Updates: the page label and the search label are the same words. */
  it("finds the update check by the label the page shows", () => {
    expect(searchSettings("check for updates", true).map((h) => h.rowId)).toEqual([
      "checkNow",
    ]);
  });
});

describe("resolveSettingsPage", () => {
  it("maps the renamed page's old id forward and everything else to the default", () => {
    expect(resolveSettingsPage("startup")).toBe("startup");
    expect(resolveSettingsPage("window")).toBe("startup"); // REL-206 rename
    expect(resolveSettingsPage("nope")).toBe("appearance");
    expect(resolveSettingsPage(undefined)).toBe("appearance");
  });
});
