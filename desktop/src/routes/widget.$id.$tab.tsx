/**
 * Widget route — renders widget feed or configuration.
 *
 * URL: /widget/:id/:tab
 *   - id: "clock" | "weather" | "sysmon" | "uptime" | "github"
 *   - tab: "feed" | "configuration"
 *
 * Source-level actions (remove with Undo toast) are in the header bar.
 * Display preferences for widgets live as part of the Configure tab —
 * the IA refactor (2026-05-09) made channel and widget pages share the
 * same 2-tab structure (Feed / Configure).
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import RouteError from "../components/RouteError";
import SourcePageLayout, { parseSourceTab, SourceNotFound } from "../components/SourcePageLayout";
import { getWidget } from "../widgets/registry";
import WidgetConfigPanel from "../widgets/WidgetConfigPanel";
import { useShell } from "../shell-context";
import { useUndoableAction } from "../hooks/useUndoableAction";
import { disableWidget } from "../preferences";

export const Route = createFileRoute("/widget/$id/$tab")({
  component: WidgetRoute,
  errorComponent: RouteError,
});

function WidgetRoute() {
  const { id, tab: rawTab } = Route.useParams();
  const navigate = useNavigate();
  const tab = parseSourceTab(rawTab);

  const widget = getWidget(id);
  // Undoable wrapper for the Trash button. Pre-Phase-1 widget removal
  // was completely silent — clicked Trash → widget gone from sidebar,
  // ticker, and pinned slots, with no toast and no recovery. We snapshot
  // the prefs blob, mutate via `disableWidget` (a pure helper that
  // strips the widget from `enabledWidgets` and `widgetsOnTicker`), and
  // sonner shows a 5-second Undo toast. Click Undo → restored prefs
  // re-flow through the cross-window store sync so the sidebar / ticker
  // re-add the widget without a refresh.
  const undoable = useUndoableAction();

  if (!widget) {
    return <SourceNotFound kind="Widget" name={id} />;
  }

  return (
    <SourcePageLayout
      name={widget.name}
      description={tab === "configuration" ? "Configure" : undefined}
      activeTab={tab}
      onTabChange={(t) =>
        navigate({ to: "/widget/$id/$tab", params: { id, tab: t } })
      }
      onBack={() => navigate({ to: "/feed" })}
      onRemove={() => {
        undoable(
          {
            label: `Removed ${widget.name}`,
            description: "Widget hidden from sidebar and ticker.",
          },
          (current) => disableWidget(current, id),
        );
        // Navigate away regardless of undo state — the user explicitly
        // asked to leave this widget's page. Clicking Undo from /feed
        // restores the widget but keeps you on /feed, which is fine
        // (the widget reappears in the sidebar; the user can click
        // back into it if they want).
        navigate({ to: "/feed" });
      }}
      sourceKind="widget"
    >
      {/* Entrance to match the data-source pages (v1.1.1): utility
          content fades up instead of popping in. Keyed by tab so
          switching Feed ↔ Configure replays it. */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.04, ease: [0.22, 0.61, 0.36, 1] }}
        className="h-full"
      >
        {tab === "feed" && <WidgetFeedTab widget={widget} />}
        {tab === "configuration" && <WidgetConfigTab id={id} />}
      </motion.div>
    </SourcePageLayout>
  );
}

function WidgetFeedTab({
  widget,
}: {
  widget: NonNullable<ReturnType<typeof getWidget>>;
}) {
  const feedContext = {
    __dashboardLoaded: true,
  };
  return <widget.FeedTab mode="comfort" feedContext={feedContext} />;
}

function WidgetConfigTab({ id }: { id: string }) {
  const shell = useShell();

  return (
    <WidgetConfigPanel
      widgetId={id}
      prefs={shell.prefs}
      onPrefsChange={shell.onPrefsChange}
    />
  );
}
