/**
 * News/RSS widget preview harness — dev-only, browser-only entry.
 *
 * Mirrors datawidgets/finance/preview/ (see that harness + the predictions
 * one for the pattern rationale): the REAL RssFeedTab with STATEFUL
 * prefs and a seeded, disabled query cache. Feed ADD/REMOVE mutations
 * are not exercised (no authenticated API in a browser) — the Feeds
 * view is asserted render-only.
 */
// FIRST: evaluate the widget registry before ../FeedTab (module-cycle
// guard — see the finance harness for the full explanation).
import "../../registry";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../style.css";
import { ShellContext, type ShellState } from "../../../shell-context";
import { dashboardQueryOptions, rssCatalogOptions } from "../../../api/queries";
import { migrateRssDisplay, type AppPreferences } from "../../../preferences";
import { rssDataWidget } from "../FeedTab";
import type { WidgetId, TrackedFeed } from "../../../api/client";
import type { FeedTabProps, RssItem } from "../../../types";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") ?? "scrollr-light";
const widgetId = params.get("widget") ?? "rss_custom";

// ── Deterministic fixture ────────────────────────────────────────

const FEEDS: { name: string; url: string; category: string; custom?: boolean }[] = [
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", category: "World" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "Tech" },
  { name: "Ars Technica", url: "https://arstechnica.com/feed/", category: "Tech" },
  { name: "ESPN", url: "https://www.espn.com/espn/rss/news", category: "Sports" },
  { name: "Hacker News", url: "https://news.ycombinator.com/rss", category: "Tech" },
  { name: "My Blog", url: "https://example.com/feed.xml", category: "Custom", custom: true },
];

const catalog: TrackedFeed[] = FEEDS.filter((f) => !f.custom).map((f, i) => ({
  url: f.url,
  name: f.name,
  category: f.category,
  is_default: true,
  consecutive_failures: 0,
  last_success_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
}));

const catalogAll: TrackedFeed[] = [
  ...catalog,
  {
    url: "https://example.com/feed.xml",
    name: "My Blog",
    category: "Custom",
    is_default: false,
    consecutive_failures: 2,
    last_error: "HTTP 503",
    last_success_at: new Date(Date.now() - 96 * 3_600_000).toISOString(),
  },
];

// ~14 articles per feed, ages staggered hours apart so Newest/Oldest
// and the per-source cap all have something to bite on. Relative to
// now so the article-age window never silently empties the harness.
const rssItems: RssItem[] = FEEDS.flatMap((feed, fi) =>
  Array.from({ length: 14 }, (_, ai) => {
    const stamp = new Date(
      Date.now() - (ai * 5 + fi) * 3_600_000,
    ).toISOString();
    return {
      id: fi * 100 + ai,
      feed_url: feed.url,
      guid: `${feed.name}-${ai}`,
      title: `${feed.name} headline ${ai + 1}: the ${feed.category.toLowerCase()} story`,
      link: "https://example.com/article",
      description: `Deterministic harness copy for ${feed.name} article ${ai + 1} — long enough to render a two-line description block in comfort mode.`,
      source_name: feed.name,
      published_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    };
  }),
);

function main(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const widgetRow = (type: string, feeds: typeof FEEDS) => ({
    id: 1,
    widget_type: type,
    enabled: true,
    ticker_enabled: true,
    created_at: "2026-07-17T00:00:00Z",
    updated_at: "2026-07-17T00:00:00Z",
    config: {
      feeds: feeds.map((f) => ({ name: f.name, url: f.url, is_custom: f.custom })),
    },
  });
  queryClient.setQueryData(dashboardQueryOptions().queryKey, {
    data: { rss: rssItems },
    widgets: [
      widgetRow("rss_custom", FEEDS),
      widgetRow("news_bbc", FEEDS.slice(0, 1)),
    ],
  });
  queryClient.setQueryData(rssCatalogOptions().queryKey, catalog);
  queryClient.setQueryData(
    rssCatalogOptions({ includeFailing: true }).queryKey,
    catalogAll,
  );

  const initialPrefs = {
    widgetDisplay: {
      rss: {
        ...migrateRssDisplay(undefined),
        // Legacy-style per-source cap so the "Show all" footer has
        // something to reveal (the modern default is 0 = show all).
        articlesPerSource: 5,
      },
    },
  } as unknown as AppPreferences;

  const noop = (): void => {};
  const shellBase = {
    authenticated: false,
    tier: "free",
    subscriptionInfo: null,
    onLogin: noop,
    onLogout: noop,
    autostartEnabled: false,
    onAutostartChange: noop,
    appVersion: "preview",
    allDataWidgetManifests: [],
    allWidgets: [],
  };

  const feedContext = {
    __hasConfig: true,
    __dashboardLoaded: true,
    __refreshing: false,
  } as FeedTabProps["feedContext"];

  const FeedTab = rssDataWidget.FeedTab;

  function Harness() {
    const [prefs, setPrefs] = useState<AppPreferences>(initialPrefs);
    const shell = {
      ...shellBase,
      prefs,
      onPrefsChange: setPrefs,
    } as unknown as ShellState;
    return (
      <QueryClientProvider client={queryClient}>
        <ShellContext.Provider value={shell}>
          <div
            id="app-shell"
            data-theme={theme}
            className="h-screen overflow-y-auto scrollbar-thin bg-surface text-fg font-sans"
          >
            <FeedTab
              mode="comfort"
              feedContext={feedContext}
              widgetId={widgetId}
            />
          </div>
        </ShellContext.Provider>
      </QueryClientProvider>
    );
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}

main();
