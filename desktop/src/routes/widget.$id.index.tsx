/**
 * Widget route — renders the widget feed.
 *
 * URL: /widget/:id  (id: "clock" | "weather" | "sysmon" | "uptime" | "github" | "timer")
 *
 * The configuration tab is gone — every setting lives inside the widget
 * itself (gear popover). NOTE: this is deliberately an INDEX route
 * (widget.$id.index.tsx, not widget.$id.tsx) so it doesn't become
 * widget.$id.info.tsx's layout parent and demand an Outlet.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
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
      {/* Entrance to match the data-source pages (v1.1.1): utility
          content fades up instead of popping in. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.04, ease: [0.22, 0.61, 0.36, 1] }}
        className="h-full"
      >
        <widget.FeedTab mode="comfort" feedContext={{ __dashboardLoaded: true }} />
      </motion.div>
    </SourcePageLayout>
  );
}
