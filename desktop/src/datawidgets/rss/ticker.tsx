import type { RssItem } from "../../types";
import { shouldShowOnTicker } from "../../preferences";
import RssChip from "../../components/chips/RssChip";
import { chipUrlForRss } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows } from "../ticker";
import { selectRssForTicker, getRssDisplayPrefs } from "./view";

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
    return selectRssForTicker(rows, merged).map((item) => ({
      key: `rss-${item.id}`,
      node: (
        <RssChip
          item={item}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          showSource={shouldShowOnTicker(prefs.showSource)}
          showTimestamps={shouldShowOnTicker(prefs.showTimestamps)}
          onClick={() => ctx.onChipClick?.("rss", item.id, chipUrlForRss(item))}
        />
      ),
    }));
  },
};
