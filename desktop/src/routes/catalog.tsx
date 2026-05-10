import { useState, useMemo, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { LayoutGrid, Search, Radio, Boxes } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

import { getCatalogItems, CATEGORY_LABELS, CANONICAL_ORDER } from "../marketplace";
import type { CatalogCategory, CatalogItem } from "../marketplace";
import { channelsApi } from "../api/client";
import type { ChannelType } from "../api/client";
import { dashboardQueryOptions, queryKeys } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import CatalogCard from "../components/marketplace/CatalogCard";
import QueryErrorBanner from "../components/QueryErrorBanner";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";
import PageSection from "../components/layout/PageSection";
import EmptySection from "../components/layout/EmptySection";
import type { OverflowMenuItem } from "../components/OverflowMenu";

export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
  errorComponent: RouteError,
});

// ── Category filter options ─────────────────────────────────────

type FilterTab = "all" | CatalogCategory;

const FILTER_TABS: { key: FilterTab; label: string; icon: LucideIcon; hint: string }[] = [
  { key: "all", label: "All", icon: LayoutGrid, hint: "Show every channel and widget" },
  { key: "channel", label: CATEGORY_LABELS["channel"], icon: Radio, hint: "Show only data channels" },
  { key: "widget", label: CATEGORY_LABELS["widget"], icon: Boxes, hint: "Show only utility widgets" },
];

const TAB_BY_KEY: Record<FilterTab, (typeof FILTER_TABS)[number]> = FILTER_TABS.reduce(
  (acc, t) => {
    acc[t.key] = t;
    return acc;
  },
  {} as Record<FilterTab, (typeof FILTER_TABS)[number]>,
);

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
  const queryClient = useQueryClient();
  const { prefs, onPrefsChange, authenticated, tier, onLogin } = useShell();
  const { channels } = useShellData();
  const { error: dashboardError, isLoading } = useQuery(dashboardQueryOptions());

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

  const visibleItems = useMemo(() => {
    const filtered = filter === "all"
      ? allItems
      : allItems.filter((item) => item.category === filter);
    return sortItems(filtered, allEnabledIds);
  }, [allItems, filter, allEnabledIds]);

  // ── Add handler ─────────────────────────────────────────────

  const handleAdd = useCallback(
    async (item: CatalogItem) => {
      if (item.kind === "channel") {
        await channelsApi.create(item.id as ChannelType);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        toast.success(`${item.name} added`);
        navigate({ to: "/channel/$type/$tab", params: { type: item.id, tab: "feed" } });
      } else {
        const nextEnabled = [...prefs.widgets.enabledWidgets, item.id];
        const nextOnTicker = [...prefs.widgets.widgetsOnTicker, item.id];
        onPrefsChange({
          ...prefs,
          widgets: { ...prefs.widgets, enabledWidgets: nextEnabled, widgetsOnTicker: nextOnTicker },
        });
        toast.success(`${item.name} added`);
        navigate({ to: "/widget/$id/$tab", params: { id: item.id, tab: "feed" } });
      }
    },
    [navigate, queryClient, prefs, onPrefsChange],
  );

  // ── Breadcrumb dropdown — switch the active filter ───────────

  const menuItems: OverflowMenuItem[] = useMemo(() => {
    const items: OverflowMenuItem[] = [];
    for (const t of FILTER_TABS) {
      if (t.key === filter) continue;
      items.push({
        key: t.key,
        label: t.label,
        hint: t.hint,
        icon: t.icon,
        onSelect: () => setFilter(t.key),
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // ── Render ──────────────────────────────────────────────────

  return (
    <PageLayout
      title="Catalog"
      subtitle={TAB_BY_KEY[filter].label}
      width="wide"
      menuItems={menuItems}
      menuLabel="Catalog filter"
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
              className="grid grid-cols-2 lg:grid-cols-3 gap-3"
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
                    dashboardLoading={isLoading}
                    onAdd={handleAdd}
                    onLogin={onLogin}
                    onOpen={(it) => {
                      if (it.kind === "channel") {
                        navigate({ to: "/channel/$type/$tab", params: { type: it.id, tab: "feed" } });
                      } else {
                        navigate({ to: "/widget/$id/$tab", params: { id: it.id, tab: "feed" } });
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
