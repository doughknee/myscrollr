/**
 * Channel route — renders channel feed or configuration.
 *
 * URL: /channel/:type/:tab
 *   - type: "finance" | "sports" | "rss" | "fantasy"
 *   - tab: "feed" | "configuration"
 *
 * Source-level actions (remove) are in the header bar.
 *
 * The old per-channel Display venue-matrix pages were removed in the
 * widget/slot redesign (2026-06-30). Display venue prefs still persist
 * for backward compat (the ticker reads them) but aren't configured here.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import RouteError from "../components/RouteError";
import SourcePageLayout, { parseSourceTab, SourceNotFound } from "../components/SourcePageLayout";
import { useQuery } from "@tanstack/react-query";
import { widgetManifest } from "../marketplace";
import { dashboardQueryOptions } from "../api/queries";
import ChannelConfigPanel from "../channels/ChannelConfigPanel";
import { useShell } from "../shell-context";
import { loadPref } from "../preferences";
import type { Channel, ChannelType } from "../api/client";
import type { DashboardResponse, DeliveryMode, ChannelManifest } from "../types";

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

  // Resolve the widget id (e.g. "sports_nfl", "finance_stocks") to its coarse
  // source manifest, which owns the FeedTab. Also resolves legacy coarse ids.
  const channel = widgetManifest(type) as ChannelManifest | undefined;
  const { data: dashboard, isFetching: dashboardFetching } = useQuery(dashboardQueryOptions());
  const { onDeleteChannel } = useShell();

  if (!channel) {
    return <SourceNotFound kind="Channel" name={type} />;
  }

  // Subtitle reflects the current sub-route in the breadcrumb:
  //   Home / Sports                   (feed — no subtitle)
  //   Home / Sports / Configure       (configuration tab)
  const subtitle = tab === "configuration" ? "Configure" : undefined;

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
    >
      {tab === "feed" && (
        <ChannelFeedTab
          type={type}
          dashboard={dashboard}
          dashboardFetching={dashboardFetching}
          channel={channel}
          onConfigure={() => navigate({ to: "/channel/$type/$tab", params: { type, tab: "configuration" } })}
        />
      )}
      {tab === "configuration" && (
        <ChannelConfigTab type={type} dashboard={dashboard} />
      )}
    </SourcePageLayout>
  );
}

function ChannelFeedTab({
  type,
  dashboard,
  dashboardFetching,
  channel,
  onConfigure,
}: {
  type: string;
  dashboard: DashboardResponse | undefined;
  dashboardFetching: boolean;
  channel: ChannelManifest;
  onConfigure: () => void;
}) {
  // An optimistic add row (id < 0, seeded by useAddWidget while the
  // create request is in flight) can't have data yet — treat it as
  // refreshing so the Configure CTA never flashes in the gap before
  // the post-create refetch starts (v1.1.1 round 3).
  const pendingAdd = (dashboard?.channels ?? []).some(
    (ch) => ch.channel_type === type && ch.id < 0,
  );

  const feedContext = {
    __dashboardLoaded: dashboard !== undefined,
    __refreshing: dashboardFetching || pendingAdd,
    __hasConfig: (dashboard?.channels ?? []).some(
      (ch) => ch.channel_type === type && ch.enabled,
    ),
  };

  return (
    <channel.FeedTab
      mode="comfort"
      widgetId={type}
      feedContext={feedContext}
      onConfigure={onConfigure}
    />
  );
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

  const manifest = widgetManifest(type);
  const deliveryMode = loadPref<DeliveryMode>("deliveryMode", "polling");

  if (!channelData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto gap-3 p-6">
        <h2 className="text-base font-semibold text-fg">
          Configuration unavailable
        </h2>
        <p className="text-sm text-fg-3 leading-relaxed">
          This source does not have a configuration panel.
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
