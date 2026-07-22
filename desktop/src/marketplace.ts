// desktop/src/marketplace.ts
//
// The widget catalog, as the client sees it.
//
// The catalog itself is SERVER-OWNED (VISION §4.2): core-api serves it at
// GET /catalog and this module is a thin view over that response. The client
// contributes exactly one thing the server cannot — renderers — which it
// attaches by `source`. Adding a widget that reuses an existing renderer
// (another league, another feed) is a server-only change; no desktop release.
//
// Two things make a synchronous API possible over an async source:
//
//  1. `catalog.snapshot.json` is a build-time snapshot of GET /catalog,
//     generated from the server, never hand-edited. It is what the ticker
//     renders from offline and on first run before any fetch completes
//     (VISION §4.2, constraint 1). A Go test pins it to the live catalog so
//     it cannot rot.
//  2. `refreshCatalog()` fetches the live catalog and swaps it in. Callers
//     keep their synchronous reads; they just see fresher data afterwards.

import type { ComponentType } from "react";
import type {
  SourceInfo,
  DataWidgetManifest,
  WidgetManifest,
  CatalogWidget,
  CatalogPayload,
} from "./types";
import type { SubscriptionTier } from "./auth";
import { getDataWidget } from "./datawidgets/registry";
import { getAllWidgets, getWidget, WIDGET_ORDER } from "./widgets/registry";
import snapshot from "./catalog.snapshot.json";

type IconProps = { size?: number; className?: string };

// ── Categories ──────────────────────────────────────────────────
// A cosmetic filter tag on a widget, independent of its source (§4.1).
// The server sends the tag; these are the display labels for it.
export type WidgetCategory =
  | "sports"
  | "finance"
  | "news"
  | "fantasy"
  | "predictions"
  | "utility";

export const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  sports: "Sports",
  finance: "Finance",
  news: "News",
  fantasy: "Fantasy",
  predictions: "Predictions",
  utility: "Utilities",
};

// ── The server's catalog entry ──────────────────────────────────

export type { CatalogWidget, CatalogPayload };

// ── Catalog state ───────────────────────────────────────────────

let payload: CatalogPayload = snapshot as CatalogPayload;

// Listeners for `useSyncExternalStore`, so a refresh that changes the catalog
// re-renders the Library and the ticker instead of sitting in module state
// until something else happens to re-render.
const listeners = new Set<() => void>();

/** Subscribe to catalog swaps. Returns an unsubscribe function. */
export function subscribeCatalog(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The catalog version currently in use — the bundled snapshot's until a
 *  refresh lands. Doubles as the `useSyncExternalStore` snapshot: it is a
 *  stable string that changes exactly when the catalog does. */
export function catalogVersion(): string {
  return payload.version;
}

/** Every widget the server knows about, in its canonical order. */
export function catalogWidgets(): CatalogWidget[] {
  return payload.widgets;
}

/**
 * Replace the in-memory catalog with a freshly fetched one.
 *
 * Staleness policy: the bundled snapshot is only ever a starting point, so
 * this runs once at app start and the result is kept for the session. The
 * server sets a 5-minute Cache-Control and an ETag, so a repeat fetch inside
 * that window is free and one outside it is a cheap 304.
 *
 * Fails soft: an offline or erroring server leaves the snapshot in place,
 * which is the entire point of bundling it.
 */
export type CatalogRefresh = "updated" | "unchanged" | "failed";

export async function refreshCatalog(
  fetchCatalog: () => Promise<CatalogPayload>,
): Promise<CatalogRefresh> {
  // Three outcomes, not two. "unchanged" and "failed" both used to return
  // false, which meant a caller could not tell "the server agrees with the
  // snapshot" from "there is no server" — and so could not decide whether
  // retrying was worth anything.
  let next: CatalogPayload;
  try {
    next = await fetchCatalog();
  } catch {
    return "failed";
  }
  if (!next?.widgets?.length) return "failed";
  if (next.version === payload.version) return "unchanged";
  payload = next;
  listeners.forEach((fn) => fn());
  return "updated";
}

function byId(id: string): CatalogWidget | undefined {
  return payload.widgets.find((w) => w.id === id);
}

// ── Catalog item (server data + client renderer) ─────────────────

export interface CatalogItem {
  /** Widget id — matches the backend widget_type (sports_nfl, …). */
  id: string;
  name: string;
  description: string;
  icon: ComponentType<IconProps>;
  hex: string;
  /** Brand logo URL (real mark). Cards show this, falling back to `icon`. */
  logoUrl?: string;
  /** Render the logo on a light tile (transparent/dark marks like UFC). */
  logoLight?: boolean;
  category: WidgetCategory;
  /**
   * The source that owns the renderer + data
   * (finance | sports | rss | fantasy | predictions), or undefined for a
   * local-only utility widget.
   *
   * Its presence IS the data/utility distinction — a data widget is created
   * via the widgets API and fed by CDC, a utility lives in preferences. A
   * separate `kind` field used to carry the same fact; two fields encoding
   * one thing can only drift, so ask `isUtilityWidget()` instead.
   */
  source?: string;
  /** For data widgets: config POSTed to the API on add so the backend
   *  subscribes correctly (league / asset class / feeds). */
  addConfig?: Record<string, unknown>;
  info: SourceInfo;
  requiredTier: SubscriptionTier;
}

/** The source widget id for a data-widget id, or undefined for a utility /
 *  unknown id. E.g. "sports_nfl" → "sports". */
export function sourceForWidget(id: string): string | undefined {
  return byId(id)?.source;
}

/**
 * FOUR QUESTIONS THAT LOOK ALIKE. An audit once counted 23 "competing
 * derivations" of this predicate across the client and proposed collapsing
 * them onto this function. Nineteen of the twenty-one that were analysed
 * turned out to be asking something else, and rewriting them would have
 * introduced bugs. Before you consolidate one, work out which it needs:
 *
 *   (a) is this widget a utility?      -> this function. Kind, from the catalog.
 *   (b) has the user ADDED it?         -> prefs.widgets.enabledWidgets. What the
 *                                         slot cap counts and what nav lists.
 *   (c) does this build have code for it?
 *                                      -> widgets/registry.ts, or a narrower
 *                                         local roster (ScrollrTicker's
 *                                         WIDGET_TYPES is the key set of
 *                                         WidgetTickerData; chipColors' map must
 *                                         stay literal for Tailwind to scan it).
 *   (d) is it on the ticker right now? -> prefs.widgets.widgetsOnTicker.
 *
 * (b), (c) and (d) are not weaker forms of (a) — a utility can be catalogued
 * but not added, added but unrenderable, or renderable but off the ticker. The
 * one genuine bug this analysis found was a site that needed (b) and asked (c):
 * the tray listed every widget this build ships rather than the ones the user
 * added, which put chips on the ticker that no slot cap could see.
 *
 * True for a local-only widget (clock, weather, …): one with no server row and
 * no CDC feed.
 *
 * Answered from the catalog first — that is the authority, and asking the
 * renderer registry instead is what made every utility vanish in v1.1.11.
 * But the catalog is server-owned and refreshes at runtime, so it can legally
 * not know about a widget this build registers locally; `canonicalOrder()`
 * appends exactly those. Requiring a catalog hit meant such a widget fell
 * through to the data-widget path, where it renders an "add this widget"
 * empty state instead of itself.
 *
 * So: catalog if it knows the id, local registry if it does not. An id
 * neither knows is not a utility.
 */
export function isUtilityWidget(id: string): boolean {
  const w = byId(id);
  if (w) return !w.source;
  return getWidget(id) !== undefined;
}

/** The fixed asset class ("stock" | "crypto") for a finance widget, or
 *  undefined. Lets the finance feed + Configure scope to that one class so
 *  Stocks and Crypto stop sharing a mixed list. */
export function assetClassForWidget(id: string): string | undefined {
  const ac = byId(id)?.default_config?.asset_class;
  return typeof ac === "string" ? ac : undefined;
}

/** The default config POSTed on add for a widget id. */
export function addConfigForWidget(
  id: string,
): Record<string, unknown> | undefined {
  return byId(id)?.default_config;
}

/** The catalog item (display: name/icon/hex/category) for a widget id. */
export function catalogItemById(id: string): CatalogItem | undefined {
  const w = byId(id);
  return (w && buildItem(w)) ?? undefined;
}

/** Brand logo URL for a widget id (or undefined). Server-owned: the catalog
 *  carries the resolved URL, including the hand-pinned ones for domains the
 *  icon service returns a blank image for. */
export function widgetLogoUrl(id: string): string | undefined {
  return byId(id)?.logo_url;
}

/** A manifest for RENDERING a widget on Home / Source pages: the source's
 *  renderer (FeedTab + icon), carrying the widget's own id/name/color so an
 *  MLB widget shows "MLB", not "Sports". This is the `source → renderer`
 *  registry (§4.1) — the only widget knowledge left on the client. */
export function widgetManifest(
  id: string,
): DataWidgetManifest | WidgetManifest | undefined {
  const w = byId(id);
  if (!w) {
    // Not in the catalog: fall back to a directly-registered renderer, which
    // is how a client newer than the catalog still renders something.
    return getDataWidget(id) ?? getWidget(id);
  }
  if (!w.source) return getWidget(w.id);
  const renderer = getDataWidget(w.source);
  if (!renderer) return undefined; // renderer this client lacks — skip
  return {
    ...renderer,
    id: w.id,
    name: w.name,
    tabLabel: w.name,
    hex: w.color,
  };
}

// ── Builder ─────────────────────────────────────────────────────

function buildItem(w: CatalogWidget): CatalogItem | null {
  // Utilities own their renderer directly; data widgets borrow their
  // source's. Either way the client supplies only the icon + FeedTab.
  const renderer = !w.source ? getWidget(w.id) : getDataWidget(w.source);
  if (!renderer) return null; // renderer not registered in this client — skip

  return {
    id: w.id,
    name: w.name,
    description: w.description,
    icon: renderer.icon,
    hex: w.color,
    logoUrl: w.logo_url,
    logoLight: w.logo_light,
    // The wire keeps these as plain strings so the server can add a category
    // or tier without a client release. Narrow here, defaulting anything this
    // client doesn't recognise rather than rendering an unlabelled group.
    category: isKnownCategory(w.category) ? w.category : "utility",
    source: w.source,
    addConfig: w.default_config,
    info: {
      about: w.about ?? renderer.info.about,
      usage: w.usage ?? renderer.info.usage,
    },
    requiredTier: w.required_tier as SubscriptionTier,
  };
}

function isKnownCategory(c: string): c is WidgetCategory {
  return c in CATEGORY_LABELS;
}

export function getCatalogItems(): CatalogItem[] {
  return payload.widgets
    .map(buildItem)
    .filter((x): x is CatalogItem => x !== null);
}

/**
 * Canonical order for sorting: the server's order, with any locally
 * registered utility the catalog doesn't know about appended.
 *
 * A function, not a module-load const. It used to be built once from the
 * bundled `snapshot`, so `refreshCatalog()` could swap `payload` and this
 * would still describe the shipped snapshot forever. A widget added
 * server-side therefore sorted as unknown (`indexOf` → -1, so it sorted
 * first) and vanished from the sidebar entirely, because __root.tsx builds
 * the nav by iterating this list and silently drops ids it does not contain.
 * That is most of why "add a widget server-side, no client release" did not
 * actually work.
 */
export function canonicalOrder(): string[] {
  return [
    ...payload.widgets.map((w) => w.id),
    ...WIDGET_ORDER.filter((id) => !payload.widgets.some((w) => w.id === id)),
  ];
}

/** Pick a readable text color (near-black or white) for a solid brand-colored
 *  surface, from the color's perceived luminance — so a light brand (gold,
 *  teal) gets dark text and a dark brand (navy, red) gets white. Shared by the
 *  catalog card and the widget info page so brand buttons match everywhere. */
export function readableTextOn(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#111827" : "#ffffff";
}

// `getAllWidgets` stays exported through here for callers that want the
// local utility renderers without going through the catalog.
export { getAllWidgets };
