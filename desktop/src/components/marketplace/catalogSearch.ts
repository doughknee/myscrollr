/**
 * Catalog search + shelving — the pure half of the Hub → Directory page.
 *
 * Everything here is a function of the catalog and a string, so the route
 * can stay a thin state machine over the URL. The rules come from the
 * design's Behavior / Growth cards (design_handoff_catalog/README.md).
 */
import { CATEGORY_LABELS } from "../../marketplace";
import type { CatalogItem, WidgetCategory } from "../../marketplace";

// ── Kinds ───────────────────────────────────────────────────────

export type CatalogKind = "all" | WidgetCategory;
export type CatalogSort = "az" | "popular" | "new";

/** Hub tile / rail order. Server-defined in spirit; the labels map is the
 *  client's ceiling on kinds it can name, so the order lives beside it. */
export const CATEGORY_ORDER: WidgetCategory[] = [
  "sports",
  "finance",
  "news",
  "fantasy",
  "predictions",
  "utility",
];

/** `?kind=` from the URL: a known category, else "all". */
export function kindFromSearch(kind: string | undefined): CatalogKind {
  return kind && kind in CATEGORY_LABELS ? (kind as WidgetCategory) : "all";
}

type Searchable = Pick<
  CatalogItem,
  "name" | "description" | "category" | "group" | "keywords"
>;

/** Everything a query is matched against, lower-cased. */
export function haystack(item: Searchable): string {
  return [
    item.name,
    item.description,
    item.group ?? "",
    CATEGORY_LABELS[item.category],
    ...(item.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

/** Normalise what was typed: trim, collapse whitespace, lower-case. */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

export function matchesQuery(item: Searchable, q: string): boolean {
  const needle = normalizeQuery(q);
  return needle === "" || haystack(item).includes(needle);
}

// ── Groups ──────────────────────────────────────────────────────

/** A kind with fewer widgets than this shows no group headers. */
export const GROUP_HEADER_MIN = 8;
/** Past this many rows the group pills become jump anchors. */
export const PILL_ANCHOR_MIN = 24;

export interface Shelf<T> {
  /** Group label; "" for ungrouped items. */
  key: string;
  items: T[];
}

/**
 * Split a kind's widgets into its groups, in first-appearance order — the
 * server's canonical order decides which group leads, so a new group is a
 * server-only change like everything else in the catalog.
 */
export function groupByShelf<T extends { group?: string }>(items: T[]): Shelf<T>[] {
  const out: Shelf<T>[] = [];
  for (const item of items) {
    const key = item.group ?? "";
    let shelf = out.find((s) => s.key === key);
    if (!shelf) out.push((shelf = { key, items: [] }));
    shelf.items.push(item);
  }
  return out;
}

/** Group headers earn their place only once a kind is big enough to need
 *  them and actually has more than one group. */
export function showGroupHeaders(total: number, groups: number): boolean {
  return total >= GROUP_HEADER_MIN && groups > 1;
}

// ── Miss → closest group ────────────────────────────────────────

/**
 * What people type when the catalog has nothing: a league name, a paper,
 * a coin. Each hint maps a fragment of the query to the group we do have
 * that is nearest to it. Order matters — first hit wins.
 */
const CLOSEST_GROUP_HINTS: [fragment: string, group: string][] = [
  ["liga", "Soccer"],
  ["serie", "Soccer"],
  ["eredivisie", "Soccer"],
  ["league", "Soccer"],
  ["fc", "Soccer"],
  ["cup", "Soccer"],
  ["ball", "Basketball"],
  ["hockey", "Hockey"],
  ["race", "Motorsport"],
  ["gp", "Motorsport"],
  ["fight", "Combat"],
  ["tennis", "Golf & Tennis"],
  ["golf", "Golf & Tennis"],
  ["cricket", "Rugby"],
  ["rugby", "Rugby"],
  ["news", "World"],
  ["times", "World"],
  ["post", "World"],
  ["journal", "Business"],
  ["tech", "Tech & Science"],
  ["coin", "Markets"],
  ["stock", "Markets"],
  ["etf", "Markets"],
  ["ci", "Dev"],
  ["deploy", "Dev"],
  ["twitch", "Gaming"],
  ["game", "Gaming"],
];

/** The group a missed query is closest to, or undefined when no hint fits. */
export function closestGroup(q: string): string | undefined {
  const needle = normalizeQuery(q);
  return CLOSEST_GROUP_HINTS.find(([fragment]) => needle.includes(fragment))?.[1];
}

/** Title-case the query for the miss card: "eredivisie" → "Eredivisie". */
export function missName(q: string): string {
  return q.trim().replace(/\b\w/g, (m) => m.toUpperCase());
}

// ── New ─────────────────────────────────────────────────────────

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Joined the catalog within the last 30 days. */
export function isNew(addedAt: string | undefined, now: Date = new Date()): boolean {
  if (!addedAt) return false;
  const t = Date.parse(addedAt);
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= NEW_WINDOW_MS;
}

/** Newest first; undated items sort last, ties keep catalog order. */
export function byNewest<T extends { addedAt?: string }>(items: T[]): T[] {
  const stamp = (i: T) => (i.addedAt ? Date.parse(i.addedAt) || 0 : 0);
  return [...items].sort((a, b) => stamp(b) - stamp(a));
}

export function byName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}
