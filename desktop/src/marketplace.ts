// desktop/src/marketplace.ts
//
// The flat WIDGET catalog. Everything the user adds is a "widget":
//  - DATA widgets are named, pre-filtered views over a backend data source
//    (a coarse channel). "Stocks"/"Crypto" are the finance source split by
//    asset class; "NFL"/"NBA"/… are the sports source split by league;
//    "News" is rss; "Yahoo Fantasy" is fantasy; "Predictions" is kalshi.
//    Their ids match api/core/widgets.go (finance_stocks, sports_nfl, …).
//  - UTILITY widgets are local-only (clock, timer, weather, …).
//
// A data widget derives its icon/hex/info/FeedTab from its coarse source
// manifest (so there's one place that owns the rendering), and carries an
// `addConfig` that is POSTed to the API on add so the backend subscribes to
// the right league/asset-class/feeds.

import type { ComponentType } from "react";
import type { SourceInfo, ChannelManifest, WidgetManifest } from "./types";
import type { SubscriptionTier } from "./auth";
import { getChannel } from "./channels/registry";
import { getAllWidgets, getWidget, WIDGET_ORDER } from "./widgets/registry";

type IconProps = { size?: number; className?: string };

// ── Categories ──────────────────────────────────────────────────
// Group the flat catalog. "utility" is the local-only bucket.
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

// ── Catalog item ────────────────────────────────────────────────

export interface CatalogItem {
  /** Widget id — matches the backend widget/channel_type (sports_nfl, …). */
  id: string;
  name: string;
  description: string;
  icon: ComponentType<IconProps>;
  hex: string;
  /** Brand logo URL (real mark). Cards show this, falling back to `icon`. */
  logoUrl?: string;
  category: WidgetCategory;
  /** "data" → a backend-connected widget (created via the channels API);
   *  "utility" → a local-only widget (stored in preferences). */
  kind: "data" | "utility";
  /** For data widgets: the coarse source channel that owns the FeedTab +
   *  data (finance | sports | rss | fantasy | predictions). */
  source?: string;
  /** For data widgets: config POSTed to the API on add so the backend
   *  subscribes correctly (league / asset class / feeds). */
  addConfig?: Record<string, unknown>;
  info: SourceInfo;
  requiredTier: SubscriptionTier;
}

// ── Data widget definitions ─────────────────────────────────────

interface DataWidgetDef {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  source: string;
  /** Distinct brand accent (hex). Overrides the coarse source's color so
   *  widgets in the same category don't all look the same. */
  color: string;
  addConfig?: Record<string, unknown>;
  requiredTier?: SubscriptionTier;
}

// League name strings in addConfig.leagues must match what the sports service
// emits (config.leagues → cdc:sports:{LEAGUE}); confirm against the live sports
// catalog when the sports service is wired. News widgets are single curated
// feeds from channels/rss/service/configs/feeds.json — each is rss filtered to
// its one feed URL; "rss_custom" is the bring-your-own-feed widget.
const DATA_WIDGETS: DataWidgetDef[] = [
  // Finance — split by asset class.
  { id: "finance_stocks", name: "Stocks", description: "Live stock & ETF prices for the symbols you pick.", category: "finance", source: "finance", color: "#16a34a", addConfig: { symbols: [], asset_class: "stock" } },
  { id: "finance_crypto", name: "Crypto", description: "Live crypto prices for the coins you pick.", category: "finance", source: "finance", color: "#f7931a", addConfig: { symbols: [], asset_class: "crypto" } },
  // Sports — one widget per league.
  { id: "sports_nfl", name: "NFL", description: "Live NFL scores and game states.", category: "sports", source: "sports", color: "#013369", addConfig: { leagues: ["NFL"] } },
  { id: "sports_nba", name: "NBA", description: "Live NBA scores and game states.", category: "sports", source: "sports", color: "#c9082a", addConfig: { leagues: ["NBA"] } },
  { id: "sports_nhl", name: "NHL", description: "Live NHL scores and game states.", category: "sports", source: "sports", color: "#111827", addConfig: { leagues: ["NHL"] } },
  { id: "sports_mlb", name: "MLB", description: "Live MLB scores and game states.", category: "sports", source: "sports", color: "#002d72", addConfig: { leagues: ["MLB"] } },
  { id: "sports_f1", name: "F1", description: "Formula 1 race weekends and results.", category: "sports", source: "sports", color: "#e10600", addConfig: { leagues: ["Formula 1"] } },
  { id: "sports_worldcup", name: "World Cup", description: "FIFA World Cup fixtures and scores.", category: "sports", source: "sports", color: "#2e7d46", addConfig: { leagues: ["World Cup"] } },
  // News — 10 curated feeds, each its own widget.
  { id: "news_bbc", name: "BBC News", description: "World, UK and breaking news from the BBC.", category: "news", source: "rss", color: "#b80000", addConfig: { feeds: [{ name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" }] } },
  { id: "news_npr", name: "NPR", description: "US and world news, analysis and reporting from NPR.", category: "news", source: "rss", color: "#4667de", addConfig: { feeds: [{ name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" }] } },
  { id: "news_guardian", name: "The Guardian", description: "Independent world news, opinion and reporting.", category: "news", source: "rss", color: "#052962", addConfig: { feeds: [{ name: "The Guardian", url: "https://www.theguardian.com/world/rss" }] } },
  { id: "news_aljazeera", name: "Al Jazeera", description: "Breaking news from the Middle East and around the world.", category: "news", source: "rss", color: "#e8a33d", addConfig: { feeds: [{ name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" }] } },
  { id: "news_propublica", name: "ProPublica", description: "Investigative journalism in the public interest.", category: "news", source: "rss", color: "#c8102e", addConfig: { feeds: [{ name: "ProPublica", url: "https://feeds.propublica.org/propublica/main" }] } },
  { id: "news_bloomberg", name: "Bloomberg", description: "Global markets, finance and business news.", category: "news", source: "rss", color: "#1a1a2e", addConfig: { feeds: [{ name: "Bloomberg Markets", url: "https://feeds.bloomberg.com/markets/news.rss" }] } },
  { id: "news_cnbc", name: "CNBC", description: "Markets, business and finance headlines.", category: "news", source: "rss", color: "#005594", addConfig: { feeds: [{ name: "CNBC Top News", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" }] } },
  { id: "news_nasa", name: "NASA", description: "Space, science and mission news from NASA.", category: "news", source: "rss", color: "#0b3d91", addConfig: { feeds: [{ name: "NASA Breaking News", url: "https://www.nasa.gov/news-release/feed/" }] } },
  { id: "news_hackernews", name: "Hacker News", description: "Top stories from the Hacker News front page.", category: "news", source: "rss", color: "#ff6600", addConfig: { feeds: [{ name: "Hacker News", url: "https://hnrss.org/frontpage" }] } },
  { id: "news_theverge", name: "The Verge", description: "Technology, science, art and culture.", category: "news", source: "rss", color: "#5200ff", addConfig: { feeds: [{ name: "The Verge", url: "https://www.theverge.com/rss/index.xml" }] } },
  // Custom RSS — bring your own feeds.
  { id: "rss_custom", name: "Custom RSS", description: "Follow any RSS or Atom feed by pasting its URL.", category: "news", source: "rss", color: "#ee802f", addConfig: { feeds: [] } },
  // Fantasy, Predictions.
  { id: "fantasy_yahoo", name: "Yahoo Fantasy", description: "Your Yahoo Fantasy leagues, matchups, and standings.", category: "fantasy", source: "fantasy", color: "#6001d2", requiredTier: "uplink" },
  { id: "predictions", name: "Predictions", description: "Live prediction-market odds from Kalshi.", category: "predictions", source: "predictions", color: "#1fc9a0" },
];

// ── Resolution helpers (widget id → coarse source manifest) ─────

/** The coarse source channel id for a data-widget id, or undefined for a
 *  utility widget / unknown id. E.g. "sports_nfl" → "sports". */
export function sourceForWidget(id: string): string | undefined {
  return DATA_WIDGETS.find((w) => w.id === id)?.source;
}

/** The definition (incl. addConfig + source) for a data-widget id. */
export function dataWidgetDef(id: string): DataWidgetDef | undefined {
  return DATA_WIDGETS.find((w) => w.id === id);
}

/** The manifest that owns rendering for a widget id: the coarse channel
 *  manifest for a data widget, or the utility widget's own manifest. */
export function manifestForWidget(
  id: string,
): ChannelManifest | WidgetManifest | undefined {
  const src = sourceForWidget(id);
  if (src) return getChannel(src);
  // Fall back to a coarse channel id (legacy rows in transition) then a
  // utility widget id.
  return getChannel(id) ?? getWidget(id);
}

/** The catalog item (display: name/icon/hex/category) for a widget id. */
export function catalogItemById(id: string): CatalogItem | undefined {
  return getCatalogItems().find((it) => it.id === id);
}

/** A manifest for RENDERING a data widget on Home / Source pages: the coarse
 *  source's FeedTab + icon + info, but the widget's own id + name (so an MLB
 *  widget shows "MLB", not "Sports"). Falls back to a legacy coarse channel or
 *  a utility manifest. */
export function widgetManifest(
  id: string,
): ChannelManifest | WidgetManifest | undefined {
  const def = dataWidgetDef(id);
  if (!def) return getChannel(id) ?? getWidget(id);
  const source = getChannel(def.source);
  if (!source) return undefined;
  return { ...source, id: def.id, name: def.name, tabLabel: def.name, hex: def.color };
}

// ── Builder ─────────────────────────────────────────────────────

// Brand domains for widget logos. Only widgets that represent a single brand
// get one (news sources, sports leagues, Yahoo, Kalshi); the rest fall back to
// their colored icon. Displaying a service's own mark to represent an
// integration with it is standard nominative use.
const WIDGET_LOGO_DOMAINS: Record<string, string> = {
  sports_nfl: "nfl.com",
  sports_nba: "nba.com",
  sports_nhl: "nhl.com",
  sports_mlb: "mlb.com",
  sports_f1: "formula1.com",
  sports_worldcup: "fifa.com",
  news_bbc: "bbc.com",
  news_npr: "npr.org",
  news_guardian: "theguardian.com",
  news_aljazeera: "aljazeera.com",
  news_propublica: "propublica.org",
  news_bloomberg: "bloomberg.com",
  news_cnbc: "cnbc.com",
  news_nasa: "nasa.gov",
  news_hackernews: "news.ycombinator.com",
  news_theverge: "theverge.com",
  fantasy_yahoo: "yahoo.com",
  predictions: "kalshi.com",
};

/** Brand logo URL for a widget id (or undefined). icon.horse returns the
 *  highest-resolution icon a site offers (apple-touch-icon, etc.) — much
 *  crisper than a raw favicon, no API key. Cards fall back to the colored
 *  icon on load error. */
export function widgetLogoUrl(id: string): string | undefined {
  const domain = WIDGET_LOGO_DOMAINS[id];
  return domain ? `https://icon.horse/icon/${domain}` : undefined;
}

function buildDataItem(def: DataWidgetDef): CatalogItem | null {
  const src = getChannel(def.source);
  if (!src) return null; // source channel not registered — skip
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    // Distinct per-widget brand color; the icon still comes from the coarse
    // source for now (per-widget hero art differentiates further next).
    icon: src.icon,
    hex: def.color,
    logoUrl: widgetLogoUrl(def.id),
    category: def.category,
    kind: "data",
    source: def.source,
    addConfig: def.addConfig,
    info: src.info,
    requiredTier: def.requiredTier ?? "free",
  };
}

export function getCatalogItems(): CatalogItem[] {
  const data = DATA_WIDGETS.map(buildDataItem).filter(
    (x): x is CatalogItem => x !== null,
  );

  const utilities: CatalogItem[] = getAllWidgets().map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    icon: w.icon,
    hex: w.hex,
    category: "utility" as const,
    kind: "utility" as const,
    info: w.info,
    requiredTier: "free" as const,
  }));

  return [...data, ...utilities];
}

/** Canonical order for sorting: data widgets in definition order, then the
 *  utility widgets in their registry order. */
export const CANONICAL_ORDER = [
  ...DATA_WIDGETS.map((w) => w.id),
  ...WIDGET_ORDER,
];
