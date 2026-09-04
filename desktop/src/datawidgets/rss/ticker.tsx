import type { RssItem } from "../../types";
import RssChip from "../../components/chips/RssChip";
import { chipUrlForRss } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows } from "../ticker";
import { selectRssForTicker, arrangeRssSlots } from "./view";
import { catalogItemById } from "../../marketplace";

/**
 * News/RSS ticker chips.
 *
 * Independent of the widget page. The feed's sort, filters, "Show N" and
 * time window are about reading a list; the rail applies its own horizon
 * and rotates whatever is eligible through a fixed number of slots. The
 * user configures nothing here, and a wire that posts thirty articles in
 * an hour is still three chips.
 */
export const rssTickerSource: TickerSource = {
  chips(raw: unknown, ctx: TickerContext): TickerChip[] {
    const rows = scopedRows<RssItem>(raw, ctx);
    // The widget's catalog brand colour, as the sports chips take theirs.
    const accent = catalogItemById(ctx.tab)?.hex;
    // Items per feed in the last day, from everything the widget holds --
    // not just what is eligible, since the point is to say how much the
    // rail is holding back.
    const dayAgo = Date.now() - 86_400_000;
    const perFeed = new Map<string, number>();
    for (const r of rows) {
      const t = new Date(r.published_at ?? r.created_at).getTime();
      if (Number.isFinite(t) && t >= dayAgo) perFeed.set(r.feed_url, (perFeed.get(r.feed_url) ?? 0) + 1);
    }
    const slots = arrangeRssSlots(selectRssForTicker(rows), ctx.cycles ?? {}, `rss-${ctx.tab}`);
    return slots.map(({ key, item, rotateSlot, reserveTitle }) => ({
      key,
      rotateSlot,
      node: (
        <RssChip
          item={item}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          accent={accent}
          reserveTitle={reserveTitle}
          feedCountToday={perFeed.get(item.feed_url)}
          onClick={() => ctx.onChipClick?.("rss", item.id, chipUrlForRss(item))}
        />
      ),
    }));
  },
};
