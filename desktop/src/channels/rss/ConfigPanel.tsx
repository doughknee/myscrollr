import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import FeedManager from "./FeedManager";
import { ToggleRow } from "../../components/settings/SettingsControls";
import { rssCatalogOptions } from "../../api/queries";
import { useChannelConfig } from "../../hooks/useChannelConfig";
import { useShell } from "../../shell-context";
import { getLimit } from "../../tierLimits";
import type { RssDisplayPrefs } from "../../preferences";
import type { Channel, RssChannelConfig } from "../../api/client";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface RssConfigPanelProps {
  channel: Channel;
  subscriptionTier: SubscriptionTier;
  hex: string;
}

// ── Dispatch ─────────────────────────────────────────────────────

export default function RssConfigPanel({
  channel,
  subscriptionTier,
}: RssConfigPanelProps) {
  // A curated single-feed news widget (news_bbc, …) has an intrinsic feed — no
  // feed manager, just display. rss_custom (bring-your-own) and any legacy
  // coarse rss/news channel keep the full feed manager.
  if (channel.channel_type.startsWith("news_")) {
    return <NewsWidgetConfig channel={channel} />;
  }
  return <RssFeedConfig channel={channel} subscriptionTier={subscriptionTier} />;
}

// ── Curated news widget — fixed feed + display toggles ───────────

function NewsWidgetConfig({ channel }: { channel: Channel }) {
  const { prefs } = useShell();
  const globalRss = prefs.channelDisplay.rss;
  const override =
    (channel.config as { display?: Partial<RssDisplayPrefs> })?.display ?? {};
  const { updateItems } = useChannelConfig<Partial<RssDisplayPrefs>>(
    channel.channel_type,
    "display",
  );

  const feedName =
    (channel.config as RssChannelConfig)?.feeds?.[0]?.name ?? channel.channel_type;
  const effDescription = override.showDescription ?? globalRss.showDescription;
  const effTimestamps = override.showTimestamps ?? globalRss.showTimestamps;

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-7 pt-1">
      <section className="flex flex-col gap-2">
        <h3 className="px-3 text-sm font-semibold text-fg">Feed</h3>
        <div className="px-3 py-2.5 rounded-lg border border-edge/40 bg-base-150/30 text-ui-body text-fg-2">
          Tracking <span className="font-medium text-fg">{feedName}</span> — a
          curated feed, so there's nothing to pick.
        </div>
      </section>

      <section className="flex flex-col gap-0.5">
        <h3 className="px-3 text-sm font-semibold text-fg">Display</h3>
        <ToggleRow
          label="Article descriptions"
          description="Show a short summary under each headline"
          checked={effDescription !== "off"}
          onChange={(c) =>
            updateItems({ ...override, showDescription: c ? "both" : "off" })
          }
        />
        <ToggleRow
          label="Timestamps"
          description="Show how long ago each article was published"
          checked={effTimestamps !== "off"}
          onChange={(c) =>
            updateItems({ ...override, showTimestamps: c ? "both" : "off" })
          }
        />
      </section>
    </div>
  );
}

// ── rss_custom + legacy coarse — full feed manager ──────────────

function RssFeedConfig({
  channel,
  subscriptionTier,
}: {
  channel: Channel;
  subscriptionTier: SubscriptionTier;
}) {
  const { error, setError, saving, updateItems } = useChannelConfig<
    Array<{ name: string; url: string; is_custom?: boolean }>
  >(channel.channel_type, "feeds");

  const rssConfig = channel.config as RssChannelConfig;
  const feeds = Array.isArray(rssConfig?.feeds) ? rssConfig.feeds : [];
  const feedUrlSet = useMemo(() => new Set(feeds.map((f) => f.url)), [feeds]);

  const maxFeeds = getLimit(subscriptionTier, "feeds");
  const maxCustomFeeds = getLimit(subscriptionTier, "customFeeds");
  const customFeedCount = useMemo(
    () => feeds.filter((f) => f.is_custom).length,
    [feeds],
  );

  // Two catalogs: "clean" (curated, healthy feeds for browsing) and
  // "all" (includes failing feeds + the user's customs, used for
  // health badges on rows the user has already subscribed to).
  const {
    data: catalog = [],
    isLoading: catalogLoading,
    isError: catalogError,
  } = useQuery(rssCatalogOptions());

  const { data: catalogAll = [] } = useQuery(
    rssCatalogOptions({ includeFailing: true }),
  );

  const addCatalogFeed = useCallback(
    (url: string) => {
      if (feeds.length >= maxFeeds) return;
      const allFeeds = [...catalog, ...catalogAll];
      const feed = allFeeds.find((f) => f.url === url);
      if (!feed || feedUrlSet.has(url)) return;
      updateItems([...feeds, { name: feed.name, url: feed.url }]);
    },
    [catalog, catalogAll, feeds, feedUrlSet, updateItems, maxFeeds],
  );

  const removeFeed = useCallback(
    (url: string) => {
      updateItems(feeds.filter((f) => f.url !== url));
    },
    [feeds, updateItems],
  );

  const addCustomFeed = useCallback(
    (name: string, url: string) => {
      if (feeds.length >= maxFeeds) return;
      if (customFeedCount >= maxCustomFeeds) return;
      if (feedUrlSet.has(url)) {
        toast.error("This feed is already added");
        return;
      }
      updateItems([...feeds, { name, url, is_custom: true }]);
    },
    [feeds, feedUrlSet, updateItems, maxFeeds, maxCustomFeeds, customFeedCount],
  );

  return (
    <div className="w-full max-w-2xl mx-auto h-full flex flex-col min-h-0 gap-3 pt-1">
      {error && (
        <div className="shrink-0 px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-[11px] text-error flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="text-error/60 hover:text-error cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <FeedManager
          feeds={feeds}
          catalog={catalog}
          catalogAll={catalogAll}
          onAddCatalog={addCatalogFeed}
          onAddCustom={addCustomFeed}
          onRemove={removeFeed}
          loading={catalogLoading}
          error={catalogError}
          maxFeeds={maxFeeds}
          maxCustomFeeds={maxCustomFeeds}
          customCount={customFeedCount}
          subscriptionTier={subscriptionTier}
          saving={saving}
        />
      </div>
    </div>
  );
}
