/**
 * Predictions market search — pure matching logic (no React).
 *
 * CLIENT-SIDE ONLY by design: the dashboard payload already carries the full
 * curated market universe (~240 rows), and Kalshi trade-api/v2 exposes no
 * text-search parameter (verified against docs.kalshi.com 2026-07-15 — GET
 * /markets and GET /events accept only structured ticker/status/timestamp
 * filters). See ui-review/NOTES.md for the full decision log.
 *
 * Matching model, per whitespace-separated query token (AND across tokens,
 * any field satisfies a token):
 *   1. exact substring (case-insensitive) — covers prefix/infix,
 *   2. typo tolerance per word: bounded Damerau-Levenshtein (OSA) against
 *      each word, and against the word's prefix for longer words, with the
 *      edit budget scaled by token length (<4 exact, 4–7 → 1 edit, ≥8 → 2).
 * Fields: event title, outcome labels (+subtitle), category.
 * Results keep the browse ordering — search filters in place, it never
 * re-ranks. Highlight ranges index into the ORIGINAL strings.
 */
import type { Prediction } from "../../types";
import type { PredictionEvent } from "./view";

/** Half-open [start, end) index range into the original string. */
export type MatchRange = [start: number, end: number];

export interface EventSearchHit {
  /** Ranges within `event.title`. */
  titleRanges: MatchRange[];
  /** Ranges within the category label. */
  categoryRanges: MatchRange[];
  /** market.id → ranges within `outcomeLabel(market)`. */
  outcomeRanges: Record<string, MatchRange[]>;
}

/**
 * The label an outcome row renders — binary legs read "Yes", multi-outcome
 * legs use their own title ("Atlanta", "France"). SINGLE SOURCE for both
 * the card row and the matcher, so highlight offsets can never drift.
 */
export function outcomeLabel(m: Prediction): string {
  return m.title && m.title.toLowerCase() !== "yes" ? m.title : "Yes";
}

/** Edit budget by token length — short tokens must match exactly. */
function maxEdits(len: number): number {
  if (len < 4) return 0;
  if (len <= 7) return 1;
  return 2;
}

/**
 * Bounded Damerau-Levenshtein (optimal string alignment: substitution,
 * insertion, deletion, adjacent transposition each cost 1). Returns
 * `cap + 1` as soon as the distance provably exceeds `cap`. Inputs are
 * single words (short); the O(len²) DP is fine at this scale.
 */
export function editDistance(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;

  // Three rolling rows (previous-previous needed for transposition).
  let prevPrev: number[] = [];
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  let curr: number[] = new Array<number>(lb + 1);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        v = Math.min(v, prevPrev[j - 2] + 1); // transposition
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    [prevPrev, prev, curr] = [prev, curr, prevPrev];
  }
  const d = prev[lb];
  return d > cap ? cap + 1 : d;
}

/** Merge overlapping/touching ranges, sorted by start. */
export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return [...ranges].sort((x, y) => x[0] - y[0]);
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const out: MatchRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const next = sorted[i];
    if (next[0] <= last[1]) {
      last[1] = Math.max(last[1], next[1]);
    } else {
      out.push([next[0], next[1]]);
    }
  }
  return out;
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

/**
 * Match one lowercase query token against a text. Returns highlight ranges
 * (indices into `text`) or null. Substring first, then per-word typo match.
 */
export function matchToken(token: string, text: string): MatchRange[] | null {
  if (!token || !text) return null;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(token);
  if (idx >= 0) return [[idx, idx + token.length]];

  const cap = maxEdits(token.length);
  if (cap === 0) return null;

  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(lower))) {
    const word = m[0];
    if (editDistance(token, word, cap) <= cap) {
      return [[m.index, m.index + word.length]];
    }
    // Typo'd prefix of a longer word ("electon" → "elections").
    if (
      word.length > token.length &&
      editDistance(token, word.slice(0, token.length), cap) <= cap
    ) {
      return [[m.index, m.index + token.length]];
    }
  }
  return null;
}

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Match a query against one event. Every token must match at least one
 * field (title / category / any outcome label or subtitle); ranges are
 * collected for every field a token hit, so all occurrences highlight.
 */
export function matchEvent(
  tokens: string[],
  event: PredictionEvent,
  category: string | undefined,
): EventSearchHit | null {
  const titleRanges: MatchRange[] = [];
  const categoryRanges: MatchRange[] = [];
  const outcomeRanges: Record<string, MatchRange[]> = {};

  for (const token of tokens) {
    let matched = false;
    const t = matchToken(token, event.title);
    if (t) {
      titleRanges.push(...t);
      matched = true;
    }
    if (category) {
      const c = matchToken(token, category);
      if (c) {
        categoryRanges.push(...c);
        matched = true;
      }
    }
    for (const outcome of event.outcomes) {
      const r = matchToken(token, outcomeLabel(outcome));
      if (r) {
        (outcomeRanges[outcome.id] ??= []).push(...r);
        matched = true;
      } else if (outcome.subtitle && matchToken(token, outcome.subtitle)) {
        // Subtitle isn't rendered on the card — counts as a match, no ranges.
        matched = true;
      }
    }
    if (!matched) return null;
  }

  for (const id of Object.keys(outcomeRanges)) {
    outcomeRanges[id] = mergeRanges(outcomeRanges[id]);
  }
  return {
    titleRanges: mergeRanges(titleRanges),
    categoryRanges: mergeRanges(categoryRanges),
    outcomeRanges,
  };
}

/**
 * Filter an event list by a free-text query. Returns eventTicker → hit for
 * matching events, or null when the query has no tokens (no search active).
 */
export function searchEvents(
  query: string,
  events: PredictionEvent[],
  categoryOf: (event: PredictionEvent) => string | undefined,
): Map<string, EventSearchHit> | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  const hits = new Map<string, EventSearchHit>();
  for (const event of events) {
    const hit = matchEvent(tokens, event, categoryOf(event));
    if (hit) hits.set(event.eventTicker, hit);
  }
  return hits;
}
