import type { Channel } from "../api/client";
import type { SubscriptionTier } from "../auth";
import { sourceForWidget } from "../marketplace";
import FinanceConfigPanel from "./finance/ConfigPanel";
import SportsConfigPanel from "./sports/ConfigPanel";
import RssConfigPanel from "./rss/ConfigPanel";
import FantasyConfigPanel from "./fantasy/ConfigPanel";
import PredictionsConfigPanel from "./predictions/ConfigPanel";

// ── Props ────────────────────────────────────────────────────────

interface ChannelConfigPanelProps {
  channelType: string;
  channel: Channel;
  subscriptionTier: SubscriptionTier;
  /** SSE delivery mode active */
  connected: boolean;
  /** Channel accent hex color */
  hex: string;
}

// ── Component ────────────────────────────────────────────────────

export default function ChannelConfigPanel({
  channelType,
  channel,
  subscriptionTier,
  connected,
  hex,
}: ChannelConfigPanelProps) {
  // Resolve widget ids (sports_nfl, finance_stocks, news, …) to their coarse
  // source so each maps to the right per-source config panel.
  switch (sourceForWidget(channelType) ?? channelType) {
    case "finance":
      return (
        <FinanceConfigPanel
          channel={channel}
          subscriptionTier={subscriptionTier}
          hex={hex}
        />
      );
    case "sports":
      return (
        <SportsConfigPanel
          channel={channel}
          subscriptionTier={subscriptionTier}
          hex={hex}
        />
      );
    case "rss":
      return (
        <RssConfigPanel
          channel={channel}
          subscriptionTier={subscriptionTier}
          hex={hex}
        />
      );
    case "fantasy":
      return (
        <FantasyConfigPanel
          channel={channel}
          subscriptionTier={subscriptionTier}
          hex={hex}
        />
      );
    case "predictions":
      return (
        <PredictionsConfigPanel
          channel={channel}
          subscriptionTier={subscriptionTier}
          hex={hex}
        />
      );
    default:
      return (
        <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto gap-3 p-6">
          <h2 className="text-base font-semibold text-fg">
            No settings available
          </h2>
          <p className="text-sm text-fg-3 leading-relaxed">
            There are no settings for this channel.
          </p>
        </div>
      );
  }
}
