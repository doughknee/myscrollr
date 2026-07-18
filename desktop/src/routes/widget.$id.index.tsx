/**
 * Widget route — THE source page. Every widget renders here (REL-49):
 * data widgets (finance_stocks, sports_nfl, news_bbc, predictions, …)
 * and local utilities (clock, weather, sysmon, uptime, github, timer).
 * /channel/$type is a redirect shim onto this route.
 *
 * One route for every source means every swap is a same-route swap —
 * PageLayout stays mounted and the full stableChrome choreography
 * (bar roll + feed crossfade) plays on ALL transitions. The old
 * channel/widget route split made cross-kind swaps hard-cut.
 *
 * NOTE: this is deliberately an INDEX route (widget.$id.index.tsx,
 * not widget.$id.tsx) so it doesn't become widget.$id.info.tsx's
 * layout parent and demand an Outlet.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RouteError from "../components/RouteError";
import SourcePageLayout, { SourceNotFound } from "../components/SourcePageLayout";
import { widgetManifest } from "../marketplace";
import { getWidget } from "../widgets/registry";
import { dashboardQueryOptions } from "../api/queries";
import type { ChannelManifest, WidgetManifest } from "../types";

export const Route = createFileRoute("/widget/$id/")({
  // Data widgets need the dashboard; ensuring it here is harmless for
  // utilities (the shell keeps it warm anyway).
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(dashboardQueryOptions()),
  component: WidgetRoute,
  pendingComponent: WidgetPending,
  errorComponent: RouteError,
});

function WidgetRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  // Resolves data widgets (per-league/per-feed splits + legacy coarse
  // ids) AND local utilities.
  const manifest = widgetManifest(id) as
    | ChannelManifest
    | WidgetManifest
    | undefined;

  if (!manifest) {
    return <SourceNotFound kind="Widget" name={id} />;
  }

  return (
    <SourcePageLayout name={manifest.name} onBack={() => navigate({ to: "/feed" })}>
      <div className="h-full">
        <WidgetFeed id={id} manifest={manifest} />
      </div>
    </SourcePageLayout>
  );
}

function WidgetFeed({
  id,
  manifest,
}: {
  id: string;
  manifest: ChannelManifest | WidgetManifest;
}) {
  const { data: dashboard, isFetching: dashboardFetching } = useQuery(
    dashboardQueryOptions(),
  );

  // Local utilities have no server row — their data is always "loaded".
  if (getWidget(id)) {
    return (
      <manifest.FeedTab mode="comfort" feedContext={{ __dashboardLoaded: true }} />
    );
  }

  // Data widgets: dashboard-driven feed context. An optimistic add row
  // (id < 0, seeded by useAddWidget while the create request is in
  // flight) can't have data yet — treat it as refreshing so the
  // empty-state CTA never flashes in the gap before the post-create
  // refetch starts (v1.1.1 round 3).
  const pendingAdd = (dashboard?.channels ?? []).some(
    (ch) => ch.channel_type === id && ch.id < 0,
  );

  const feedContext = {
    __dashboardLoaded: dashboard !== undefined,
    __refreshing: dashboardFetching || pendingAdd,
    __hasConfig: (dashboard?.channels ?? []).some(
      (ch) => ch.channel_type === id && ch.enabled,
    ),
  };

  return (
    <manifest.FeedTab mode="comfort" widgetId={id} feedContext={feedContext} />
  );
}

function WidgetPending() {
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
