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
  /** Render the logo on a light tile (transparent/dark marks like UFC). */
  logoLight?: boolean;
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
  /** Terse card subtitle (1–2 lines). */
  description: string;
  category: WidgetCategory;
  source: string;
  /** Distinct brand accent (hex). Overrides the coarse source's color so
   *  widgets in the same category don't all look the same. */
  color: string;
  addConfig?: Record<string, unknown>;
  requiredTier?: SubscriptionTier;
  /** Per-widget "more info" copy for the info page. Falls back to the coarse
   *  source manifest's about/usage when omitted, so every widget reads as its
   *  own thing (NFL ≠ MLB ≠ BBC) instead of sharing one generic blurb. */
  about?: string;
  usage?: string[];
  /** Render the logo on a light tile. For transparent/dark marks (e.g. the
   *  black UFC wordmark) that would vanish when placed flush on a dark card. */
  logoLight?: boolean;
}

// Shared usage recipes — most widgets in a family follow the same three
// steps, so we name them once and reuse. Per-widget `usage` overrides these.
const USAGE_TEAM_SPORT = [
  "Live scores and game state update automatically.",
  "Set a favorite team from the top bar to keep it front and center.",
  "Pin it on game days so scores stay on screen.",
];
const USAGE_NEWS = [
  "Headlines refresh automatically as new stories publish.",
  "Open any headline from the feed to read the full story.",
  "Pin it to keep the latest news in view.",
];

// League name strings in addConfig.leagues must match what the sports service
// emits (config.leagues → cdc:sports:{LEAGUE}); confirm against the live sports
// catalog when the sports service is wired. News widgets are single curated
// feeds from channels/rss/service/configs/feeds.json — each is rss filtered to
// its one feed URL; "rss_custom" is the bring-your-own-feed widget.
const DATA_WIDGETS: DataWidgetDef[] = [
  // Finance — split by asset class.
  {
    id: "finance_stocks", name: "Stocks", category: "finance", source: "finance", color: "#16a34a",
    description: "Live stock & ETF prices for the symbols you pick.",
    addConfig: { symbols: [], asset_class: "stock" },
    about: "Real-time stock and ETF prices for the tickers you follow. Your watchlist streams live as the market moves — no brokerage app open, no tab to babysit.",
    usage: [
      "Type a ticker in the top bar's search to add or remove it.",
      "Quotes stream in real time during market hours.",
      "Pin it to keep your watchlist always visible.",
    ],
  },
  {
    id: "finance_crypto", name: "Crypto", category: "finance", source: "finance", color: "#f7931a",
    description: "Live crypto prices for the coins you pick.",
    addConfig: { symbols: [], asset_class: "crypto" },
    about: "Live crypto prices for the coins you track, streamed around the clock. From BTC and ETH to the long tail, your picks update the moment the market does.",
    usage: [
      "Type a coin in the top bar's search to add or remove it.",
      "Prices stream 24/7 — crypto never closes.",
      "Pin it so every big move catches your eye.",
    ],
  },
  // Sports — one widget per league. `leagues` strings MUST match
  // channels/sports/service/configs/leagues.json exactly.
  {
    id: "sports_nfl", name: "NFL", category: "sports", source: "sports", color: "#013369",
    description: "Live NFL scores and game states.",
    addConfig: { leagues: ["NFL"] }, usage: USAGE_TEAM_SPORT,
    about: "Live NFL scores, quarters, and game clock for every matchup on the slate. Follow the whole week or zero in on your team.",
  },
  {
    id: "sports_nba", name: "NBA", category: "sports", source: "sports", color: "#c9082a",
    description: "Live NBA scores and game states.",
    addConfig: { leagues: ["NBA"] }, usage: USAGE_TEAM_SPORT,
    about: "Live NBA scores and game state across the association — every quarter, every buzzer-beater, as it happens.",
  },
  {
    id: "sports_nhl", name: "NHL", category: "sports", source: "sports", color: "#111827",
    description: "Live NHL scores and game states.",
    addConfig: { leagues: ["NHL"] }, usage: USAGE_TEAM_SPORT,
    about: "Live NHL scores and period-by-period game state for every game on the ice.",
  },
  {
    id: "sports_mlb", name: "MLB", category: "sports", source: "sports", color: "#002d72",
    description: "Live MLB scores and game states.",
    addConfig: { leagues: ["MLB"] }, usage: USAGE_TEAM_SPORT,
    about: "Live MLB scores, innings, and game state across the league, all season long.",
  },
  {
    id: "sports_f1", name: "F1", category: "sports", source: "sports", color: "#e10600",
    description: "Formula 1 race weekends and results.",
    addConfig: { leagues: ["Formula 1"] },
    about: "Formula 1 race weekends — practice, qualifying, and the Grand Prix result the moment the checkered flag drops.",
    usage: [
      "Practice, qualifying, and race results update through the weekend.",
      "See the podium the second the race ends.",
      "Pin it during a Grand Prix to follow every session.",
    ],
  },
  {
    id: "sports_worldcup", name: "World Cup", category: "sports", source: "sports", color: "#2e7d46",
    description: "FIFA World Cup fixtures and scores.",
    addConfig: { leagues: ["FIFA World Cup"] },
    about: "Every FIFA World Cup fixture and live score, through the group stage and into the knockouts.",
    usage: [
      "Live scores through the group stage and knockout rounds.",
      "Every fixture on the calendar, updated automatically.",
      "Pin it during the tournament so you never miss a goal.",
    ],
  },
  {
    id: "sports_ncaaf", name: "NCAA Football", category: "sports", source: "sports", color: "#0b427a",
    description: "Live college football scores across the FBS.",
    addConfig: { leagues: ["NCAA Football"] }, usage: USAGE_TEAM_SPORT,
    about: "Live college football scores across the FBS — Saturday slates, rivalry week, and bowl season.",
  },
  {
    id: "sports_ncaab", name: "NCAA Basketball", category: "sports", source: "sports", color: "#d2691e",
    description: "Live college basketball scores and the road to March.",
    addConfig: { leagues: ["NCAA Basketball"] }, usage: USAGE_TEAM_SPORT,
    about: "Live college basketball scores through conference play and all the way into March Madness.",
  },
  {
    id: "sports_premierleague", name: "Premier League", category: "sports", source: "sports", color: "#37003c",
    description: "Live scores from England's Premier League.",
    addConfig: { leagues: ["Premier League"] }, usage: USAGE_TEAM_SPORT,
    about: "Live scores from England's Premier League — all 20 clubs, every matchweek.",
  },
  {
    id: "sports_laliga", name: "La Liga", category: "sports", source: "sports", color: "#e2001a",
    description: "Live scores from Spain's La Liga.",
    addConfig: { leagues: ["La Liga"] }, usage: USAGE_TEAM_SPORT,
    about: "Live scores from Spain's La Liga, from the title race to the relegation scrap.",
  },
  {
    id: "sports_mls", name: "MLS", category: "sports", source: "sports", color: "#001838",
    description: "Live Major League Soccer scores.",
    addConfig: { leagues: ["MLS"] }, usage: USAGE_TEAM_SPORT,
    about: "Live Major League Soccer scores across the Eastern and Western conferences.",
  },
  {
    id: "sports_championsleague", name: "Champions League", category: "sports", source: "sports", color: "#0e1e5b",
    description: "Live UEFA Champions League scores.",
    addConfig: { leagues: ["Champions League"] }, usage: USAGE_TEAM_SPORT,
    about: "Live UEFA Champions League scores through the league phase and into the knockout rounds.",
  },
  {
    id: "sports_ufc", name: "UFC", category: "sports", source: "sports", color: "#d20a0a", logoLight: true,
    description: "UFC fight cards and results.",
    addConfig: { leagues: ["UFC"] },
    about: "UFC fight cards and results — main card and prelims, bout by bout on event nights.",
    usage: [
      "Fight results update bout by bout on event nights.",
      "Follow the main card and prelims in one place.",
      "Pin it during an event to catch every finish.",
    ],
  },
  {
    id: "sports_afl", name: "AFL", category: "sports", source: "sports", color: "#003da5",
    description: "Live Australian Football League scores.",
    addConfig: { leagues: ["AFL"] }, usage: USAGE_TEAM_SPORT,
    about: "Live Australian Football League scores across the home-and-away season and finals.",
  },
  // News — 10 curated feeds, each its own widget.
  {
    id: "news_bbc", name: "BBC News", category: "news", source: "rss", color: "#b80000",
    description: "World, UK and breaking news from the BBC.",
    addConfig: { feeds: [{ name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" }] }, usage: USAGE_NEWS,
    about: "Headlines from the BBC — world, UK, and breaking news from one of the most-read newsrooms on the planet.",
  },
  {
    id: "news_npr", name: "NPR", category: "news", source: "rss", color: "#4667de",
    description: "US and world news, analysis and reporting from NPR.",
    addConfig: { feeds: [{ name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" }] }, usage: USAGE_NEWS,
    about: "News, analysis, and reporting from NPR, spanning US and world coverage.",
  },
  {
    id: "news_guardian", name: "The Guardian", category: "news", source: "rss", color: "#052962",
    description: "Independent world news, opinion and reporting.",
    addConfig: { feeds: [{ name: "The Guardian", url: "https://www.theguardian.com/world/rss" }] }, usage: USAGE_NEWS,
    about: "Independent world news, opinion, and reporting from The Guardian.",
  },
  {
    id: "news_aljazeera", name: "Al Jazeera", category: "news", source: "rss", color: "#e8a33d",
    description: "Breaking news from the Middle East and around the world.",
    addConfig: { feeds: [{ name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" }] }, usage: USAGE_NEWS,
    about: "Breaking news from Al Jazeera, with deep coverage of the Middle East and the Global South.",
  },
  {
    id: "news_propublica", name: "ProPublica", category: "news", source: "rss", color: "#c8102e",
    description: "Investigative journalism in the public interest.",
    addConfig: { feeds: [{ name: "ProPublica", url: "https://feeds.propublica.org/propublica/main" }] }, usage: USAGE_NEWS,
    about: "Investigative journalism in the public interest from the nonprofit newsroom ProPublica.",
  },
  {
    id: "news_bloomberg", name: "Bloomberg", category: "news", source: "rss", color: "#1a1a2e",
    description: "Global markets, finance and business news.",
    addConfig: { feeds: [{ name: "Bloomberg Markets", url: "https://feeds.bloomberg.com/markets/news.rss" }] }, usage: USAGE_NEWS,
    about: "Markets, finance, and business news from Bloomberg.",
  },
  {
    id: "news_cnbc", name: "CNBC", category: "news", source: "rss", color: "#005594",
    description: "Markets, business and finance headlines.",
    addConfig: { feeds: [{ name: "CNBC Top News", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" }] }, usage: USAGE_NEWS,
    about: "Markets, business, and finance headlines from CNBC.",
  },
  {
    id: "news_nasa", name: "NASA", category: "news", source: "rss", color: "#0b3d91",
    description: "Space, science and mission news from NASA.",
    addConfig: { feeds: [{ name: "NASA Breaking News", url: "https://www.nasa.gov/news-release/feed/" }] }, usage: USAGE_NEWS,
    about: "Space, science, and mission news straight from NASA.",
  },
  {
    id: "news_hackernews", name: "Hacker News", category: "news", source: "rss", color: "#ff6600",
    description: "Top stories from the Hacker News front page.",
    addConfig: { feeds: [{ name: "Hacker News", url: "https://hnrss.org/frontpage" }] }, usage: USAGE_NEWS,
    about: "Top stories from the Hacker News front page — tech, startups, and programming.",
  },
  {
    id: "news_theverge", name: "The Verge", category: "news", source: "rss", color: "#5200ff",
    description: "Technology, science, art and culture.",
    addConfig: { feeds: [{ name: "The Verge", url: "https://www.theverge.com/rss/index.xml" }] }, usage: USAGE_NEWS,
    about: "Technology, science, art, and culture from The Verge.",
  },
  // Custom RSS — bring your own feeds.
  {
    id: "rss_custom", name: "Custom RSS", category: "news", source: "rss", color: "#ee802f",
    description: "Follow any RSS or Atom feed by pasting its URL.",
    addConfig: { feeds: [] },
    about: "Bring your own feeds. Paste any RSS or Atom URL and Scrollr streams its latest items alongside everything else.",
    usage: [
      "Paste any RSS or Atom feed URL in the Feeds view.",
      "Add as many feeds as you like — they merge into one stream.",
      "Perfect for niche blogs, newsletters, or subreddits with a feed.",
    ],
  },
  // Fantasy, Predictions.
  {
    // Tier gate RETIRED v1.1.2 — Yahoo Fantasy is a normal widget on every
    // plan (the slot is the only lever). No requiredTier = "free".
    id: "fantasy_yahoo", name: "Yahoo Fantasy", category: "fantasy", source: "fantasy", color: "#6001d2",
    description: "Your Yahoo Fantasy leagues, matchups, and standings.",
    about: "Your Yahoo Fantasy leagues in the ticker — live scoring, matchups, and standings without ever opening the app.",
    usage: [
      "Connect your Yahoo account from the top bar.",
      "Leagues, matchups, and standings sync automatically.",
      "Live scoring updates while your players are on the field.",
    ],
  },
  {
    id: "predictions", name: "Kalshi", category: "predictions", source: "predictions", color: "#1fc9a0",
    description: "Live odds from the Kalshi prediction market.",
    about: "Live odds from Kalshi, the regulated US prediction market — a real-time read on elections, economic prints, and the events in the news.",
    usage: [
      "Live market odds update as money moves.",
      "Follow the events and questions you care about.",
      "Display-only — Scrollr shows the market, it never places a trade.",
    ],
  },
];

// ── Resolution helpers (widget id → coarse source manifest) ─────

/** Legacy widget ids produced by the server-side migration (000014) that
 *  have no catalog entry of their own. "news" is the renamed coarse rss
 *  row every pre-split RSS user carries — it must keep resolving to the
 *  rss source or their feeds silently vanish from the ticker, Home, and
 *  the source page while still occupying a slot. */
const LEGACY_WIDGET_SOURCES: Record<string, { source: string; name: string }> =
  {
    news: { source: "rss", name: "News" },
  };

/** The coarse source channel id for a data-widget id, or undefined for a
 *  utility widget / unknown id. E.g. "sports_nfl" → "sports". */
export function sourceForWidget(id: string): string | undefined {
  return (
    DATA_WIDGETS.find((w) => w.id === id)?.source ??
    LEGACY_WIDGET_SOURCES[id]?.source
  );
}

/** The definition (incl. addConfig + source) for a data-widget id. */
export function dataWidgetDef(id: string): DataWidgetDef | undefined {
  return DATA_WIDGETS.find((w) => w.id === id);
}

/** The fixed asset class ("stock" | "crypto") for a finance widget, or
 *  undefined. Lets the finance feed + Configure scope to that one class so
 *  Stocks and Crypto stop sharing a mixed list. */
export function assetClassForWidget(id: string): string | undefined {
  const ac = dataWidgetDef(id)?.addConfig?.asset_class;
  return typeof ac === "string" ? ac : undefined;
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
  if (!def) {
    const legacy = LEGACY_WIDGET_SOURCES[id];
    if (legacy) {
      const source = getChannel(legacy.source);
      if (!source) return undefined;
      return { ...source, id, name: legacy.name, tabLabel: legacy.name };
    }
    return getChannel(id) ?? getWidget(id);
  }
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
  sports_ncaaf: "ncaa.com",
  sports_ncaab: "ncaa.com",
  sports_premierleague: "premierleague.com",
  sports_laliga: "laliga.com",
  sports_mls: "mlssoccer.com",
  sports_championsleague: "uefa.com",
  sports_ufc: "ufc.com",
  sports_afl: "afl.com.au",
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
  // Utilities that ARE real products get their real marks too.
  github: "github.com",
  uptime: "uptime.kuma.pet",
};

// icon.horse silently returns a *blank* (200 + transparent) image for a few
// domains (kalshi.com, ufc.com) — the <img> "loads" successfully, so the
// card's onError fallback never fires and the tile just shows empty. Pin those
// to an explicit URL that actually resolves. DuckDuckGo's icon CDN returns the
// real, opaque brand mark (verified: Kalshi's green "K", the UFC wordmark),
// never a transparent blank, and is CORS/CSP-friendly.
const WIDGET_LOGO_OVERRIDES: Record<string, string> = {
  predictions: "https://icons.duckduckgo.com/ip3/kalshi.com.ico",
  sports_ufc: "https://icons.duckduckgo.com/ip3/ufc.com.ico",
};

/** Brand logo URL for a widget id (or undefined). Prefers an explicit override
 *  for domains icon.horse can't resolve; otherwise icon.horse returns the
 *  highest-resolution icon a site offers (apple-touch-icon, etc.) — much
 *  crisper than a raw favicon, no API key. Cards fall back to the colored
 *  icon on load error. */
export function widgetLogoUrl(id: string): string | undefined {
  const override = WIDGET_LOGO_OVERRIDES[id];
  if (override) return override;
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
    logoLight: def.logoLight,
    category: def.category,
    kind: "data",
    source: def.source,
    addConfig: def.addConfig,
    // Per-widget about/usage where written, falling back to the coarse source
    // manifest so every widget reads as its own thing on the info page.
    info: {
      about: def.about ?? src.info.about,
      usage: def.usage ?? src.info.usage,
    },
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
    logoUrl: widgetLogoUrl(w.id),
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
