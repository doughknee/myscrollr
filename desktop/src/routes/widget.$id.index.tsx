/**
 * Widget route — renders the widget feed.
 *
 * URL: /widget/:id  (id: "clock" | "weather" | "sysmon" | "uptime" | "github" | "timer")
 *
 * The configuration tab is gone — every setting lives inside the widget
 * itself (its top bar). NOTE: this is deliberately an INDEX route
 * (widget.$id.index.tsx, not widget.$id.tsx) so it doesn't become
 * widget.$id.info.tsx's layout parent and demand an Outlet.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import RouteError from "../components/RouteError";
import SourcePageLayout, { SourceNotFound } from "../components/SourcePageLayout";
import { getWidget } from "../widgets/registry";

export const Route = createFileRoute("/widget/$id/")({
  component: WidgetRoute,
  errorComponent: RouteError,
});

function WidgetRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const widget = getWidget(id);
  if (!widget) {
    return <SourceNotFound kind="Widget" name={id} />;
  }

  return (
    <SourcePageLayout
      name={widget.name}
      onBack={() => navigate({ to: "/feed" })}
    >
      {/* No local entrance wrapper: SourcePageLayout's stableChrome
          container already provides the fade-up (a second motion.div
          here compounded the entrance and made widgets feel different
          from channels). h-full preserved — the stableChrome container
          doesn't provide it in noContentPadding mode. */}
      <div className="h-full">
        <widget.FeedTab mode="comfort" feedContext={{ __dashboardLoaded: true }} />
      </div>
    </SourcePageLayout>
  );
}
