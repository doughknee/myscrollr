/**
 * Releases data layer — GitHub Releases → ReleaseEntry.
 *
 * Shared data contract with myscrollr.com: both surfaces consume the
 * GitHub Releases of this repo (the canonical constant used by
 * myscrollr.com/scripts/fetch-latest-version.mjs). Desktop releases are
 * tagged `desktop-v<semver>`; tags with any other prefix (web, api…)
 * are skipped.
 *
 * Network: uses @tauri-apps/plugin-http fetch (same pattern as the
 * GitHub widget in src/widgets/github/types.ts) so the call bypasses
 * webview CORS. Unauthenticated is fine — the repo is public and the
 * page fetches at most once per session thanks to the sessionStorage
 * cache below.
 *
 * All parsing helpers are pure and unit-tested in releases.test.ts.
 */
import { fetch } from "@tauri-apps/plugin-http";
import DOMPurify from "dompurify";
import { Marked } from "marked";

// ── Types ───────────────────────────────────────────────────────

export interface ReleaseEntry {
  /** Raw git tag, e.g. "desktop-v1.0.20". */
  tag: string;
  /** Bare semver, e.g. "1.0.20" (tag with the "desktop-v" prefix stripped). */
  version: string;
  /** Release name, e.g. "Scrollr Desktop v1.0.20 — FIFA World Cup 2026". */
  name: string;
  /** The exciting part: text after the last "—" in name, else the first
   *  `## heading` in the body, else "". */
  headline: string;
  /** published_at ISO timestamp. */
  date: string;
  /** Markdown release notes. */
  body: string;
  /** html_url — the release page on GitHub. */
  url: string;
  prerelease: boolean;
}

/** Shape of the GitHub API release object (only the fields we read). */
export interface RawGitHubRelease {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
}

// ── Constants ───────────────────────────────────────────────────

// Canonical endpoint shared with myscrollr.com/scripts/fetch-latest-version.mjs.
// The repo was renamed to doughknee/myscrollr; GitHub redirects and fetch
// follows redirects by default, so the old owner keeps working.
export const RELEASES_API_URL =
  "https://api.github.com/repos/brandon-relentnet/myscrollr/releases?per_page=50";

/** Human-facing releases page — used by empty/error states. */
export const RELEASES_PAGE_URL =
  "https://github.com/brandon-relentnet/myscrollr/releases";

export const RELEASES_CACHE_KEY = "scrollr-releases-cache";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const FETCH_TIMEOUT_MS = 10_000;

const DESKTOP_TAG_PREFIX = /^desktop-v/;

// ── Pure helpers ────────────────────────────────────────────────

/**
 * "desktop-v1.0.20" → "1.0.20". Returns null for tags that don't
 * belong to the desktop release train (web-v*, api-v*, bare v*…).
 */
export function parseVersionFromTag(tag: string): string | null {
  if (!DESKTOP_TAG_PREFIX.test(tag)) return null;
  const version = tag.replace(DESKTOP_TAG_PREFIX, "");
  return version.length > 0 ? version : null;
}

/**
 * Pull the human "headline" out of a release. Priority:
 *   1. Text after the LAST em dash "—" in the release name.
 *   2. The first `## heading` in the markdown body (### and deeper
 *      don't count).
 *   3. "".
 */
export function extractHeadline(name: string, body: string): string {
  const n = name ?? "";
  const dashIdx = n.lastIndexOf("—");
  if (dashIdx !== -1) {
    const after = n.slice(dashIdx + 1).trim();
    if (after) return after;
  }
  const heading = /^##(?!#)[ \t]*(.+?)[ \t]*$/m.exec(body ?? "");
  if (heading) return heading[1].trim();
  return "";
}

/**
 * Numeric segment-wise semver compare (NOT lexical): "1.0.20" > "1.0.3".
 * Missing segments count as 0, so "1.1" === "1.1.0". Non-numeric
 * segments (e.g. a "beta" suffix segment) compare as 0.
 * Returns <0 / 0 / >0 like a standard comparator.
 */
export function compareVersions(a: string, b: string): number {
  const as = a.split(".");
  const bs = b.split(".");
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const av = parseInt(as[i] ?? "0", 10) || 0;
    const bv = parseInt(bs[i] ?? "0", 10) || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Map one raw GitHub release to a ReleaseEntry, or null when the
 * release isn't part of the desktop train (or is a draft).
 */
export function mapRelease(raw: RawGitHubRelease): ReleaseEntry | null {
  const tag = raw?.tag_name ?? "";
  const version = parseVersionFromTag(tag);
  if (!version) return null;
  if (raw.draft === true) return null;

  const name = raw.name?.trim() ? raw.name : tag;
  const body = raw.body ?? "";
  return {
    tag,
    version,
    name,
    headline: extractHeadline(name, body),
    date: raw.published_at ?? raw.created_at ?? "",
    body,
    url: raw.html_url ?? RELEASES_PAGE_URL,
    prerelease: raw.prerelease === true,
  };
}

/**
 * "2026-06-12T15:30:00Z" → "Jun 12, 2026". Rendered in UTC so the
 * label is deterministic (release dates are calendar facts, not
 * local-time events). "" for unparseable input.
 */
export function formatReleaseDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Coarse relative age: "today", "yesterday", "5 days ago",
 * "3 weeks ago", "2 months ago", "last year". `now` is injectable
 * for tests. "" for unparseable input.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const days = Math.floor(Math.max(0, now - t) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (days < 7) return rtf.format(-days, "day");
  if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}

// ── Markdown rendering ──────────────────────────────────────────

// Instance-scoped so our options never leak into other marked users.
const releaseMarked = new Marked({ gfm: true, breaks: false });

/**
 * Markdown → HTML for release notes. GitHub-flavored, synchronous.
 * The content is first-party (we author our own release notes) but
 * <script> blocks are stripped defensively anyway. Tables get wrapped
 * in `.md-table-wrap` so wide tables scroll horizontally instead of
 * blowing out the page (styled in style.css under .release-notes-md).
 */
export function renderReleaseMarkdown(md: string): string {
  const raw = releaseMarked.parse(md ?? "", { async: false });
  // Real sanitizer (ship-review follow-up) — the regex only stripped
  // <script> blocks; DOMPurify also kills on* handlers + javascript: URLs.
  const html = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  return html
    .replace(/<table>/gi, '<div class="md-table-wrap"><table>')
    .replace(/<\/table>/gi, "</table></div>");
}

// ── Session cache ───────────────────────────────────────────────

interface ReleasesCache {
  fetchedAt: number;
  entries: ReleaseEntry[];
}

function readCache(now: number): ReleaseEntry[] | null {
  try {
    const raw = sessionStorage.getItem(RELEASES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReleasesCache;
    if (typeof parsed?.fetchedAt !== "number") return null;
    if (!Array.isArray(parsed.entries)) return null;
    if (now - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.entries;
  } catch {
    return null;
  }
}

function writeCache(entries: ReleaseEntry[], now: number): void {
  try {
    sessionStorage.setItem(
      RELEASES_CACHE_KEY,
      JSON.stringify({ fetchedAt: now, entries } satisfies ReleasesCache),
    );
  } catch {
    // Quota/serialization failures just mean we refetch next time.
  }
}

// ── Fetch ───────────────────────────────────────────────────────

/**
 * Fetch desktop releases from GitHub. Successful responses are cached
 * in sessionStorage for 30 minutes so reopening the page doesn't
 * refetch. Returns [] on any failure (network, timeout, non-2xx,
 * unexpected payload) — callers render the friendly empty state.
 */
export async function fetchReleases(): Promise<ReleaseEntry[]> {
  const now = Date.now();
  const cached = readCache(now);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) return [];
    const entries = raw
      .map((r) => mapRelease(r as RawGitHubRelease))
      .filter((e): e is ReleaseEntry => e !== null);
    writeCache(entries, now);
    return entries;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
