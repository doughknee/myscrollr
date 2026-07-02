/**
 * releases tests — pure parsing/formatting helpers only. No network:
 * fetchReleases() is intentionally NOT exercised here (it's a thin
 * wrapper over plugin-http fetch + the cache, both environment-bound).
 * The plugin-http import crashes outside a Tauri webview, so it's
 * stubbed before the module under test loads — same pattern as
 * store.test.ts.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import {
  parseVersionFromTag,
  extractHeadline,
  compareVersions,
  mapRelease,
  formatReleaseDate,
  relativeTime,
  renderReleaseMarkdown,
  RELEASES_PAGE_URL,
} from "./releases";

// ── parseVersionFromTag ─────────────────────────────────────────

describe("parseVersionFromTag", () => {
  it("strips the desktop-v prefix", () => {
    expect(parseVersionFromTag("desktop-v1.0.20")).toBe("1.0.20");
  });

  it("keeps prerelease suffixes intact", () => {
    expect(parseVersionFromTag("desktop-v1.1.0-beta.2")).toBe("1.1.0-beta.2");
  });

  it("rejects tags from other release trains", () => {
    expect(parseVersionFromTag("web-v2.3.0")).toBeNull();
    expect(parseVersionFromTag("api-v0.9.1")).toBeNull();
    expect(parseVersionFromTag("v1.0.20")).toBeNull();
    expect(parseVersionFromTag("")).toBeNull();
  });

  it("rejects a bare prefix with no version", () => {
    expect(parseVersionFromTag("desktop-v")).toBeNull();
  });
});

// ── extractHeadline ─────────────────────────────────────────────

describe("extractHeadline", () => {
  it("takes the text after the em dash in the name", () => {
    expect(
      extractHeadline("Scrollr Desktop v1.0.20 — FIFA World Cup 2026", ""),
    ).toBe("FIFA World Cup 2026");
  });

  it("uses the LAST em dash when there are several", () => {
    expect(
      extractHeadline("Scrollr — Desktop v1.0.20 — Kalshi Predictions", ""),
    ).toBe("Kalshi Predictions");
  });

  it("falls back to the first ## heading in the body", () => {
    const body = "Intro paragraph\n\n## Highlights\n\n- stuff\n\n## Fixes";
    expect(extractHeadline("Scrollr Desktop v1.0.20", body)).toBe("Highlights");
  });

  it("does not treat ### (or deeper) headings as headlines", () => {
    const body = "### Only a sub-heading here\n\n- stuff";
    expect(extractHeadline("Scrollr Desktop v1.0.20", body)).toBe("");
  });

  it("returns empty string when there is no dash and no heading", () => {
    expect(extractHeadline("Scrollr Desktop v1.0.20", "plain notes")).toBe("");
  });

  it("falls through to the body when the em dash has nothing after it", () => {
    expect(extractHeadline("v1.0.20 —", "## Big News")).toBe("Big News");
  });
});

// ── compareVersions ─────────────────────────────────────────────

describe("compareVersions", () => {
  it("compares numeric segments, not lexically", () => {
    // Lexical compare would say "1.0.3" > "1.0.20".
    expect(compareVersions("1.0.20", "1.0.3")).toBeGreaterThan(0);
    expect(compareVersions("1.0.3", "1.0.20")).toBeLessThan(0);
  });

  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.20", "1.0.20")).toBe(0);
  });

  it("treats missing segments as 0", () => {
    expect(compareVersions("1.1", "1.1.0")).toBe(0);
    expect(compareVersions("1.1.1", "1.1")).toBeGreaterThan(0);
  });

  it("major/minor outrank patch", () => {
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.9.20")).toBeGreaterThan(0);
  });

  it("sorts a list into semver order", () => {
    const versions = ["1.0.3", "1.0.20", "0.9.9", "1.0.4"];
    versions.sort(compareVersions);
    expect(versions).toEqual(["0.9.9", "1.0.3", "1.0.4", "1.0.20"]);
  });
});

// ── mapRelease ──────────────────────────────────────────────────

describe("mapRelease", () => {
  const raw = {
    tag_name: "desktop-v1.0.20",
    name: "Scrollr Desktop v1.0.20 — FIFA World Cup 2026",
    body: "## Highlights\n\n- World Cup mode",
    published_at: "2026-06-12T15:30:00Z",
    html_url:
      "https://github.com/brandon-relentnet/myscrollr/releases/tag/desktop-v1.0.20",
    prerelease: false,
    draft: false,
  };

  it("maps a desktop release into a ReleaseEntry", () => {
    expect(mapRelease(raw)).toEqual({
      tag: "desktop-v1.0.20",
      version: "1.0.20",
      name: "Scrollr Desktop v1.0.20 — FIFA World Cup 2026",
      headline: "FIFA World Cup 2026",
      date: "2026-06-12T15:30:00Z",
      body: "## Highlights\n\n- World Cup mode",
      url: "https://github.com/brandon-relentnet/myscrollr/releases/tag/desktop-v1.0.20",
      prerelease: false,
    });
  });

  it("skips non-desktop tags", () => {
    expect(mapRelease({ ...raw, tag_name: "web-v3.1.0" })).toBeNull();
  });

  it("skips drafts", () => {
    expect(mapRelease({ ...raw, draft: true })).toBeNull();
  });

  it("falls back to the tag when the name is empty", () => {
    const entry = mapRelease({ ...raw, name: null });
    expect(entry?.name).toBe("desktop-v1.0.20");
    // Headline then comes from the body's ## heading.
    expect(entry?.headline).toBe("Highlights");
  });

  it("falls back to created_at when published_at is missing", () => {
    const entry = mapRelease({
      ...raw,
      published_at: null,
      created_at: "2026-06-10T00:00:00Z",
    });
    expect(entry?.date).toBe("2026-06-10T00:00:00Z");
  });

  it("marks prereleases and defaults missing url to the releases page", () => {
    const entry = mapRelease({ ...raw, prerelease: true, html_url: undefined });
    expect(entry?.prerelease).toBe(true);
    expect(entry?.url).toBe(RELEASES_PAGE_URL);
  });
});

// ── formatReleaseDate ───────────────────────────────────────────

describe("formatReleaseDate", () => {
  it("formats as a human calendar date (UTC)", () => {
    expect(formatReleaseDate("2026-06-12T15:30:00Z")).toBe("Jun 12, 2026");
  });

  it("returns empty string for garbage input", () => {
    expect(formatReleaseDate("not-a-date")).toBe("");
    expect(formatReleaseDate("")).toBe("");
  });
});

// ── relativeTime ────────────────────────────────────────────────

describe("relativeTime", () => {
  const NOW = new Date("2026-07-02T12:00:00Z").getTime();

  it.each([
    ["2026-07-02T09:00:00Z", "today"],
    ["2026-07-01T09:00:00Z", "yesterday"],
    ["2026-06-27T12:00:00Z", "5 days ago"],
    ["2026-06-24T12:00:00Z", "1 week ago"],
    ["2026-06-11T12:00:00Z", "3 weeks ago"],
    ["2026-05-15T12:00:00Z", "1 month ago"],
    ["2026-01-02T12:00:00Z", "6 months ago"],
    ["2025-06-01T12:00:00Z", "1 year ago"],
    ["2023-06-01T12:00:00Z", "3 years ago"],
  ])("%s → %s", (iso, expected) => {
    expect(relativeTime(iso, NOW)).toBe(expected);
  });

  it("clamps future dates to today", () => {
    expect(relativeTime("2026-07-03T12:00:00Z", NOW)).toBe("today");
  });

  it("returns empty string for garbage input", () => {
    expect(relativeTime("not-a-date", NOW)).toBe("");
  });
});

// ── renderReleaseMarkdown ───────────────────────────────────────

describe("renderReleaseMarkdown", () => {
  it("renders GitHub-flavored markdown", () => {
    const html = renderReleaseMarkdown(
      "## Highlights\n\n- **Bold** win\n- `inline code`",
    );
    expect(html).toContain("<h2>Highlights</h2>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<code>inline code</code>");
    expect(html).toContain("<li>");
  });

  it("strips <script> blocks defensively", () => {
    const html = renderReleaseMarkdown(
      'Hello\n\n<script>alert("xss")</script>\n\nWorld',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
    expect(html).toContain("Hello");
    expect(html).toContain("World");
  });

  it("wraps tables for horizontal scrolling", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const html = renderReleaseMarkdown(md);
    expect(html).toContain('<div class="md-table-wrap"><table>');
    expect(html).toContain("</table></div>");
  });

  it("does not add breaks:true line breaks inside paragraphs", () => {
    // breaks:false — single newlines within a paragraph don't become <br>.
    const html = renderReleaseMarkdown("line one\nline two");
    expect(html).not.toContain("<br");
  });

  it("handles empty input", () => {
    expect(renderReleaseMarkdown("")).toBe("");
  });
});
