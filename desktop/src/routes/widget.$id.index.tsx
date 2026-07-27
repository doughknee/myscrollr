/**
 * Widget route — THE source page. Every widget renders here (REL-49):
 * data widgets (finance_stocks, sports_nfl, news_bbc, predictions, …)
 * and local utilities (clock, weather, sysmon, uptime, github, timer).
 * The one route for every widget — /channel/$type was retired with the
 * rest of the "widget" vocabulary.
 *
 * One route for every source means every swap is a same-route swap —
 * PageLayout stays mounted
 * (bar roll + feed crossfade) plays on ALL s. The old
 * channel/widget route split made cross-kind swaps hard-cut.
 *
 * NOTE: this is deliberately an INDEX route (widget.$id.index.tsx,
 * not widget.$id.tsx) so it doesn't become widget.$id.info.tsx's
 * layout parent and demand an Outlet.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";
import { widgetManifest, isUtilityWidget } from "../marketplace";
import { useCatalog } from "../hooks/useCatalog";
import { dashboardQueryOptions } from "../api/queries";
import type { DataWidgetManifest, WidgetManifest } from "../types";

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
  // Subscribing re-renders this page on a catalog swap; widgetManifest and
  // isUtilityWidget below then read the current catalog rather than the one
  // that happened to be loaded at mount.
  useCatalog();

  const manifest = widgetManifest(id) as
    | DataWidgetManifest
    | WidgetManifest
    | undefined;

  if (!manifest) {
    return (
      <PageLayout title="Widget not found" width="narrow">
        <div className="flex flex-col items-center justify-center text-center max-w-sm mx-auto gap-3 py-12">
          <p className="text-sm text-fg-3">
            The widget &ldquo;{id}&rdquo; is not installed.
          </p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={manifest.name}
      parentLabel="Home"
      onParentClick={() => navigate({ to: "/feed" })}
      // The feed is data-dense (grids of trade cards, score cards, RSS
      // articles): full width, flush to the content area — the feed's own
      // components own their padding.
      width="wide"
      noContentPadding
      // Source→source swaps overlap-crossfade so the (identical) WidgetBar
      // shell reads as stationary chrome; only the bar's contents and the
      // feed animate.
    >
      <div className="h-full">
        <WidgetFeed id={id} manifest={manifest} />
      </div>
    </PageLayout>
  );
}

function WidgetFeed({
  id,
  manifest,
}: {
  id: string;
  manifest: DataWidgetManifest | WidgetManifest;
}) {
  const { data: dashboard, isFetching: dashboardFetching } = useQuery(
    dashboardQueryOptions(),
  );

  // Local utilities have no server row — their data is always "loaded".
  // Asked of the catalog, not of the renderer registry: registry presence is
  // a different question, and substituting it is what made every utility
  // widget vanish in v1.1.11.
  if (isUtilityWidget(id)) {
    return (
      <manifest.FeedTab mode="comfort" feedContext={{ __dashboardLoaded: true }} />
    );
  }

  // Data widgets: dashboard-driven feed context. An optimistic add row
  // (id < 0, seeded by useAddWidget while the create request is in
  // flight) can't have data yet — treat it as refreshing so the
  // empty-state CTA never flashes in the gap before the post-create
  // refetch starts (v1.1.1 round 3).
  const pendingAdd = (dashboard?.widgets ?? []).some(
    (ch) => ch.widget_type === id && ch.id < 0,
  );

  const feedContext = {
    __dashboardLoaded: dashboard !== undefined,
    __refreshing: dashboardFetching || pendingAdd,
    __hasConfig: (dashboard?.widgets ?? []).some(
      (ch) => ch.widget_type === id && ch.enabled,
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
          className="flex items-center gap-3 "
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
