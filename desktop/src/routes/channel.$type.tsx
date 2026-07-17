/**
 * Channel route — renders the channel feed.
 *
 * URL: /channel/:type  (type: "finance_stocks", "sports_nfl", …)
 *
 * The configuration tab is gone — every setting lives inside the widget
 * itself (bar + gear popover). Source-level actions (remove) are in the
 * header bar's Options pill.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import RouteError from "../components/RouteError";
import SourcePageLayout, { SourceNotFound } from "../components/SourcePageLayout";
import { useQuery } from "@tanstack/react-query";
import { widgetManifest } from "../marketplace";
import { dashboardQueryOptions } from "../api/queries";
import { useShell } from "../shell-context";
import type { ChannelType } from "../api/client";
import type { DashboardResponse, ChannelManifest } from "../types";

export const Route = createFileRoute("/channel/$type")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(dashboardQueryOptions()),
  component: ChannelRoute,
  pendingComponent: ChannelPending,
  errorComponent: RouteError,
});

function ChannelRoute() {
  const { type } = Route.useParams();
  const navigate = useNavigate();

  // Resolve the widget id (e.g. "sports_nfl", "finance_stocks") to its coarse
  // source manifest, which owns the FeedTab. Also resolves legacy coarse ids.
  const channel = widgetManifest(type) as ChannelManifest | undefined;
  const { data: dashboard, isFetching: dashboardFetching } = useQuery(dashboardQueryOptions());
  const { onDeleteChannel } = useShell();

  if (!channel) {
    return <SourceNotFound kind="Channel" name={type} />;
  }

  return (
    <SourcePageLayout
      name={channel.name}
      onBack={() => navigate({ to: "/feed" })}
      onRemove={() => {
        onDeleteChannel(type as ChannelType);
        navigate({ to: "/feed" });
      }}
      sourceKind="channel"
    >
      <ChannelFeedTab
        type={type}
        dashboard={dashboard}
        dashboardFetching={dashboardFetching}
        channel={channel}
      />
    </SourcePageLayout>
  );
}

function ChannelFeedTab({
  type,
  dashboard,
  dashboardFetching,
  channel,
}: {
  type: string;
  dashboard: DashboardResponse | undefined;
  dashboardFetching: boolean;
  channel: ChannelManifest;
}) {
  // An optimistic add row (id < 0, seeded by useAddWidget while the
  // create request is in flight) can't have data yet — treat it as
  // refreshing so the empty-state CTA never flashes in the gap before
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
    <channel.FeedTab mode="comfort" widgetId={type} feedContext={feedContext} />
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
