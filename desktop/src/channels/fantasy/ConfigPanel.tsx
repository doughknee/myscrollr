/**
 * Fantasy ConfigPanel — gutted to a thin wrapper (in-widget config pass,
 * PR 5). The whole OAuth + import state machine moved to
 * ./YahooConnectFlow.tsx, which the FeedTab now mounts in-feed; this
 * page keeps rendering the same flow (inside PageLayout's fillHeight
 * scroller) until the configure-page teardown deletes it.
 */
import YahooConnectFlow from "./YahooConnectFlow";
import type { Channel } from "../../api/client";
import type { SubscriptionTier } from "../../auth";

interface FantasyConfigPanelProps {
  channel: Channel;
  subscriptionTier: SubscriptionTier;
  hex: string;
}

export default function FantasyConfigPanel({ hex }: FantasyConfigPanelProps) {
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="w-full max-w-2xl mx-auto flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <YahooConnectFlow hex={hex} />
      </div>
    </div>
  );
}
