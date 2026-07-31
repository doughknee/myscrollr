/**
 * The search index is hand-maintained, so the thing most likely to go
 * wrong is drift: a row gets added, renamed, or moved and the index
 * silently stops matching it. These tests pin the parts that can be
 * checked mechanically — including reading the page sources to confirm
 * every indexed rowId still corresponds to a real `data-row` target.
 */
import { describe, expect, it } from "vitest";
import {
  SETTINGS_SEARCH_INDEX,
  searchSettings,
} from "./searchIndex";
import { SETTINGS_PAGES, isSettingsPage } from "./pages";

// Page sources as raw strings, via Vite rather than node:fs. This file
// lives under src/, where tsconfig exposes only vite/client + vitest
// globals — reaching for node builtins here type-checks fine under
// vitest (Vite resolves them at runtime) but fails `tsc --noEmit`, which
// is the second half of `npm run build` and therefore the release build.
const PAGE_SOURCES = import.meta.glob("./pages/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every `<Row id="…">` and `data-row="…"` across the settings surface. */
function renderedRowIds(): Set<string> {
  const ids = new Set<string>();
  for (const src of Object.values(PAGE_SOURCES)) {
    for (const m of src.matchAll(/<Row\s+id="([^"]+)"/g)) ids.add(m[1]);
    for (const m of src.matchAll(/data-row="([^"]+)"/g)) ids.add(m[1]);
  }
  return ids;
}

describe("settings search index", () => {
  it("only references real pages", () => {
    for (const entry of SETTINGS_SEARCH_INDEX) {
      expect(isSettingsPage(entry.page), `${entry.rowId} → ${entry.page}`).toBe(
        true,
      );
    }
  });

  it("has no duplicate rowIds", () => {
    const seen = SETTINGS_SEARCH_INDEX.map((e) => `${e.page}:${e.rowId}`);
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

  it("covers every page that has jumpable rows", () => {
    const indexed = new Set(SETTINGS_SEARCH_INDEX.map((e) => e.page));
    for (const page of SETTINGS_PAGES) {
      expect(indexed.has(page), `no search entries for "${page}"`).toBe(true);
    }
  });
});

describe("searchSettings", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });

  it("matches on label", () => {
    const hits = searchSettings("hover speed");
    expect(hits.map((h) => h.rowId)).toContain("hoverSpeed");
  });

  it("matches on description", () => {
    const hits = searchSettings("brighten muted text");
    expect(hits.map((h) => h.rowId)).toEqual(["highContrast"]);
  });

  /** Keywords are the whole point — they catch words not in the copy. */
  it("matches on keywords that appear nowhere in the visible text", () => {
    expect(searchSettings("gdpr").map((h) => h.rowId)).toEqual(["export"]);
    expect(searchSettings("a11y").map((h) => h.rowId)).toEqual(["highContrast"]);
    expect(searchSettings("hotkey").map((h) => h.rowId)).toEqual(["shortcuts"]);
  });

  it("is case-insensitive", () => {
    expect(searchSettings("CATPPUCCIN").map((h) => h.rowId)).toEqual(["theme"]);
  });

  /** The behaviour the design reference shows: "speed" → 2 ticker rows. */
  it("reproduces the reference query", () => {
    const hits = searchSettings("speed");
    expect(hits.map((h) => h.label)).toEqual(["Speed", "Hover speed"]);
    expect(hits.every((h) => h.page === "ticker")).toBe(true);
  });

  /**
   * "windows" must still find the fullscreen toggle. The caveat moved
   * out of the description and into a badge chip, so only the keyword
   * list keeps it findable.
   */
  it("still finds the Windows-only toggle by platform name", () => {
    expect(searchSettings("windows").map((h) => h.rowId)).toContain(
      "hideFullscreen",
    );
  });
});
