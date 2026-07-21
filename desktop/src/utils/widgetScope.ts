import type { Game, Trade, RssItem } from "../types";

/**
 * Scope a coarse-source dashboard payload down to a single widget's slice.
 *
 * `dashboard.data` is keyed by coarse source (finance / sports / rss / …), but
 * each widget (sports_nfl, finance_stocks, news_bbc) shows only its own data —
 * its leagues / symbols / feed URLs, read from the widget's user_widgets
 * `config`. Shared by the ticker (ScrollrTicker) and the Home feed so both
 * surfaces scope identically. A nullish config (a legacy coarse widget row)
 * returns the payload unscoped. Sources without a per-widget dimension
 * (fantasy, predictions — single widgets) fall through and return everything.
 */
export function scopeSourceData(
  source: string,
  data: unknown[],
  config: Record<string, unknown> | undefined,
): unknown[] {
  if (!config) return data;
  switch (source) {
    case "sports": {
      const leagues = new Set(
        Array.isArray(config.leagues) ? (config.leagues as string[]) : [],
      );
      return (data as Game[]).filter((g) => leagues.has(g.league));
    }
    case "finance": {
      const symbols = new Set(
        Array.isArray(config.symbols) ? (config.symbols as string[]) : [],
      );
      return (data as Trade[]).filter((t) => symbols.has(t.symbol));
    }
    case "rss": {
      const urls = new Set(
        (Array.isArray(config.feeds)
          ? (config.feeds as Array<{ url?: string }>)
          : []
        )
          .map((f) => f.url)
          .filter((u): u is string => !!u),
      );
      return (data as RssItem[]).filter((i) => urls.has(i.feed_url));
    }
    default:
      return data;
  }
}
