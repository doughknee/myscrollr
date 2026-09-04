import type { RssItem } from "../../types";
import RssChip from "../../components/chips/RssChip";
import { chipUrlForRss } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows } from "../ticker";
import { selectRssForTicker, getRssDisplayPrefs } from "./view";
import { catalogItemById } from "../../marketplace";

/**
 * News/RSS ticker chips.
 *
 * Global Display prefs are merged with THIS widget's config.display override
 * (v1.1.3: the per-widget time window must gate ticker chips exactly like
 * the feed).
 */
export const rssTickerSource: TickerSource = {
  chips(raw: unknown, ctx: TickerContext): TickerChip[] {
    const prefs = ctx.widgetDisplay?.rss;
    if (!prefs) return [];

    const merged = getRssDisplayPrefs(prefs, ctx.dashboard, ctx.tab);
    const rows = scopedRows<RssItem>(raw, ctx);
    // The widget's catalog brand colour, as the sports chips take theirs.
    const accent = catalogItemById(ctx.tab)?.hex;
    // Items per feed in the last day, from everything the widget holds --
    // not just what survives the ticker horizon, since the point is to say
    // how much the horizon is hiding.
    const dayAgo = Date.now() - 86_400_000;
    const perFeed = new Map<string, number>();
    for (const r of rows) {
      const t = new Date(r.published_at ?? r.created_at).getTime();
      if (Number.isFinite(t) && t >= dayAgo) perFeed.set(r.feed_url, (perFeed.get(r.feed_url) ?? 0) + 1);
    }
    return selectRssForTicker(rows, merged).map((item) => ({
      key: `rss-${item.id}`,
      node: (
        <RssChip
          item={item}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          accent={accent}
          feedCountToday={perFeed.get(item.feed_url)}
          onClick={() => ctx.onChipClick?.("rss", item.id, chipUrlForRss(item))}
        />
      ),
    }));
  },
};
