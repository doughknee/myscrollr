import { useState, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, Search, Boxes, Trophy, TrendingUp, Rss, Gamepad2, LineChart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { getCatalogItems, CATEGORY_LABELS, CANONICAL_ORDER } from "../marketplace";
import type { WidgetCategory, CatalogItem } from "../marketplace";
import { dashboardQueryOptions } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import { getMaxWidgets } from "../tierLimits";
import { useAddWidget } from "../hooks/useAddWidget";
import CatalogCard from "../components/marketplace/CatalogCard";
import QueryErrorBanner from "../components/QueryErrorBanner";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";
import PageSection from "../components/layout/PageSection";
import EmptySection from "../components/layout/EmptySection";


export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
  errorComponent: RouteError,
});

// ── Category filter options ─────────────────────────────────────

type FilterTab = "all" | WidgetCategory;

const CATEGORY_ICONS: Record<WidgetCategory, LucideIcon> = {
  sports: Trophy,
  finance: TrendingUp,
  news: Rss,
  fantasy: Gamepad2,
  predictions: LineChart,
  utility: Boxes,
};

const FILTER_TABS: { key: FilterTab; label: string; icon: LucideIcon; hint: string }[] = [
  { key: "all", label: "All", icon: LayoutGrid, hint: "Show every widget" },
  ...(
    ["sports", "finance", "news", "fantasy", "predictions", "utility"] as WidgetCategory[]
  ).map((c) => ({
    key: c,
    label: CATEGORY_LABELS[c],
    icon: CATEGORY_ICONS[c],
    hint: `Show ${CATEGORY_LABELS[c]} widgets`,
  })),
];

// ── Sort order: enabled first, then canonical order ─────────────

function sortItems(items: CatalogItem[], enabledIds: Set<string>): CatalogItem[] {
  return [...items].sort((a, b) => {
    const aEnabled = enabledIds.has(a.id) ? 0 : 1;
    const bEnabled = enabledIds.has(b.id) ? 0 : 1;
    if (aEnabled !== bEnabled) return aEnabled - bEnabled;
    return CANONICAL_ORDER.indexOf(a.id) - CANONICAL_ORDER.indexOf(b.id);
  });
}

// ── Page component ──────────────────────────────────────────────

function CatalogPage() {
  const navigate = useNavigate();
  const { prefs, authenticated, tier, onLogin } = useShell();
  const { channels } = useShellData();
  const { error: dashboardError, isLoading } = useQuery(dashboardQueryOptions());
  const handleAdd = useAddWidget();

  const [filter, setFilter] = useState<FilterTab>("all");

  const allItems = useMemo(() => getCatalogItems(), []);

  const enabledChannelIds = useMemo(
    () => new Set(channels.map((ch) => ch.channel_type)),
    [channels],
  );
  const enabledWidgetIds = useMemo(
    () => new Set(prefs.widgets.enabledWidgets),
    [prefs.widgets.enabledWidgets],
  );
  const allEnabledIds = useMemo(
    () => new Set([...enabledChannelIds, ...enabledWidgetIds]),
    [enabledChannelIds, enabledWidgetIds],
  );

  // Widget/slot model (2026-06-30): a plan caps how many widgets run at
  // once. Slots in use = ENABLED channels + enabled local widgets — the
  // server gate counts `WHERE enabled = true`, and the downgrade prune
  // disables (never deletes) over-cap rows, so counting disabled rows here
  // would lock the catalog for users the server would happily accept. At
  // capacity, the catalog locks *new* adds (already-added items stay
  // interactive). nil/Infinity = unlimited.
  const slotsAtCapacity = useMemo(() => {
    const used =
      channels.filter((ch) => ch.enabled).length +
      prefs.widgets.enabledWidgets.length;
    return used >= getMaxWidgets(tier);
  }, [channels, prefs.widgets.enabledWidgets.length, tier]);

  const visibleItems = useMemo(() => {
    const filtered = filter === "all"
      ? allItems
      : allItems.filter((item) => item.category === filter);
    return sortItems(filtered, allEnabledIds);
  }, [allItems, filter, allEnabledIds]);

  // ── Render ──────────────────────────────────────────────────
  //
  // Catalog uses an in-page tab band (All / Channels / Widgets) at the
  // top of the content. Pre-2026-05-11 this lived in a hidden
  // breadcrumb dropdown — testers couldn't find the filter switcher.

  return (
    <PageLayout
      title="Catalog"
      width="wide"
      tabs={{
        items: FILTER_TABS.map((t) => ({
          key: t.key,
          label: t.label,
          description: t.hint,
        })),
        activeKey: filter,
        onChange: (key) => setFilter(key as FilterTab),
      }}
    >
      {dashboardError && (
        <div className="mb-4">
          <QueryErrorBanner error={dashboardError} />
        </div>
      )}

      {visibleItems.length === 0 ? (
        <EmptySection
          icon={Search}
          title="Nothing here"
          description="No items match this filter. Try a different category."
        />
      ) : (
        <PageSection variant="grid">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={filter}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="grid grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {visibleItems.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.22,
                    delay: Math.min(i * 0.018, 0.25),
                    ease: [0.22, 0.61, 0.36, 1],
                  }}
                >
                  <CatalogCard
                    item={item}
                    enabled={allEnabledIds.has(item.id)}
                    tier={tier}
                    authenticated={authenticated}
                    slotsAtCapacity={slotsAtCapacity}
                    dashboardLoading={isLoading}
                    onAdd={handleAdd}
                    onLogin={onLogin}
                    onInfo={(it) =>
                      navigate({ to: "/widget/$id/info", params: { id: it.id } })
                    }
                    onOpen={(it) => {
                      if (it.kind === "data") {
                        navigate({ to: "/channel/$type/$tab", params: { type: it.id, tab: "feed" } });
                      } else {
                        navigate({ to: "/widget/$id/$tab", params: { id: it.id, tab: "feed" } });
                      }
                    }}
                    onConfigure={(it) => {
                      // The catalog is the one surface for adding AND setting
                      // up a widget — no Options-menu hunting (widget/slot
                      // redesign, 2026-06-30).
                      if (it.kind === "data") {
                        navigate({ to: "/channel/$type/$tab", params: { type: it.id, tab: "configuration" } });
                      } else {
                        navigate({ to: "/widget/$id/$tab", params: { id: it.id, tab: "configuration" } });
                      }
                    }}
                  />
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>
        </PageSection>
      )}
    </PageLayout>
  );
}
