/**
 * Channel route — renders channel feed or configuration.
 *
 * URL: /channel/:type/:tab
 *   - type: "finance" | "sports" | "rss" | "fantasy"
 *   - tab: "feed" | "configuration"
 *
 * Source-level actions (remove) are in the header bar.
 *
 * Display preferences live as a section inside the Configure tab —
 * the IA refactor (2026-05-09) folded the old Display tab into
 * Configure for symmetry with widgets and to reduce per-source
 * cognitive overhead.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import RouteError from "../components/RouteError";
import SourcePageLayout, { parseSourceTab, SourceNotFound } from "../components/SourcePageLayout";
import { useQuery } from "@tanstack/react-query";
import { getChannel, getAllChannels } from "../channels/registry";
import { dashboardQueryOptions } from "../api/queries";
import ChannelConfigPanel from "../channels/ChannelConfigPanel";
import FinanceDisplayPanel from "../channels/finance/DisplayPanel";
import SportsDisplayPanel from "../channels/sports/DisplayPanel";
import RssDisplayPanel from "../channels/rss/DisplayPanel";
import FantasyDisplayPanel from "../channels/fantasy/DisplayPanel";
import { useShell } from "../shell-context";
import { loadPref } from "../preferences";
import type { Channel, ChannelType } from "../api/client";
import type { DashboardResponse, DeliveryMode } from "../types";

export const Route = createFileRoute("/channel/$type/$tab")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(dashboardQueryOptions()),
  component: ChannelRoute,
  pendingComponent: ChannelPending,
  errorComponent: RouteError,
});

function ChannelRoute() {
  const { type, tab: rawTab } = Route.useParams();
  const navigate = useNavigate();
  const tab = parseSourceTab(rawTab);

  const channel = getChannel(type);
  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const { onDeleteChannel } = useShell();

  if (!channel) {
    return <SourceNotFound kind="Channel" name={type} />;
  }

  // Channels with display preferences. Drives the OverflowMenu's
  // "Display preferences" entry and the /display route's content.
  const HAS_DISPLAY: Record<string, boolean> = {
    finance: true,
    sports: true,
    rss: true,
    fantasy: true,
  };

  // Subtitle reflects the current sub-route in the breadcrumb:
  //   Home / Sports                   (feed — no subtitle)
  //   Home / Sports / Configure       (configuration tab)
  //   Home / Sports / Display         (display tab)
  const subtitle =
    tab === "configuration"
      ? "Configure"
      : tab === "display"
        ? "Display preferences"
        : undefined;

  return (
    <SourcePageLayout
      name={channel.name}
      description={subtitle}
      activeTab={tab}
      onTabChange={(t) =>
        navigate({ to: "/channel/$type/$tab", params: { type, tab: t } })
      }
      onBack={() => navigate({ to: "/feed" })}
      onRemove={() => {
        onDeleteChannel(type as ChannelType);
        navigate({ to: "/feed" });
      }}
      sourceKind="channel"
      hasDisplayPreferences={HAS_DISPLAY[type] ?? false}
    >
      {tab === "feed" && (
        <ChannelFeedTab
          type={type}
          dashboard={dashboard}
          channel={channel}
          onConfigure={() => navigate({ to: "/channel/$type/$tab", params: { type, tab: "configuration" } })}
        />
      )}
      {tab === "configuration" && (
        <ChannelConfigTab type={type} dashboard={dashboard} />
      )}
      {tab === "display" && <ChannelDisplayTab type={type} />}
    </SourcePageLayout>
  );
}

function ChannelFeedTab({
  type,
  dashboard,
  channel,
  onConfigure,
}: {
  type: string;
  dashboard: DashboardResponse | undefined;
  channel: NonNullable<ReturnType<typeof getChannel>>;
  onConfigure: () => void;
}) {
  const feedContext = {
    __dashboardLoaded: dashboard !== undefined,
    __hasConfig: (dashboard?.channels ?? []).some(
      (ch) => ch.channel_type === type && ch.enabled,
    ),
  };

  return <channel.FeedTab mode="comfort" feedContext={feedContext} onConfigure={onConfigure} />;
}

function ChannelConfigTab({
  type,
  dashboard,
}: {
  type: string;
  dashboard: DashboardResponse | undefined;
}) {
  const { tier } = useShell();
  const channelData = (dashboard?.channels ?? []).find(
    (ch) => ch.channel_type === type,
  );

  const manifest = getAllChannels().find((m) => m.id === type);
  const deliveryMode = loadPref<DeliveryMode>("deliveryMode", "polling");

  if (!channelData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto gap-3 p-6">
        <h2 className="text-base font-semibold text-fg">
          Configuration unavailable
        </h2>
        <p className="text-sm text-fg-3 leading-relaxed">
          This channel does not have a configuration panel.
        </p>
      </div>
    );
  }

  return (
    <ChannelConfigPanel
      channelType={type}
      channel={channelData as unknown as Channel}
      subscriptionTier={tier}
      connected={deliveryMode === "sse"}
      hex={manifest?.hex ?? "var(--color-accent)"}
    />
  );
}

function ChannelDisplayTab({ type }: { type: string }) {
  // Per-channel display preferences. Finance has the new live-preview
  // DisplayPanel (2026 polish); the others still use the old
  // venue-grid layout pending the same treatment.
  switch (type) {
    case "finance":
      return <FinanceDisplayPanel />;
    case "sports":
      return <SportsDisplayPanel />;
    case "rss":
      return <RssDisplayPanel />;
    case "fantasy":
      return <FantasyDisplayPanel />;
    default:
      return null;
  }
}

function ChannelPending() {
  return (
    <div className="flex flex-col gap-3 p-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 motion-safe:animate-pulse"
        >
          <div className="w-8 h-8 rounded-lg bg-surface-2" />
          <div className="flex-1 space-y-2">
            <div
              className="h-3 rounded bg-surface-2"
              style={{ width: `${55 + ((i * 17) % 35)}%` }}
            />
            <div
              className="h-2 rounded bg-surface-2/60"
              style={{ width: `${30 + ((i * 23) % 40)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
