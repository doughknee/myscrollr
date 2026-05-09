import { useState, useMemo, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import clsx from "clsx";
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

export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
  errorComponent: RouteError,
});

// ── Category filter options ─────────────────────────────────────

type FilterTab = "all" | CatalogCategory;

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "channel", label: CATEGORY_LABELS["channel"] },
  { key: "widget", label: CATEGORY_LABELS["widget"] },
];

// ── Sort order: enabled first, then canonical order ─────────────
// (CANONICAL_ORDER is exported from marketplace.ts; we import it
//  alongside the other catalog primitives below.)

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

  // All catalog items (static, computed once)
  const allItems = useMemo(() => getCatalogItems(), []);

  // Enabled IDs
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

  // Filtered + sorted items
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

  // Note: removal is no longer a Catalog action. Source removal lives
  // on the source page header (Trash + Undo toast) — single canonical
  // home per verb. See spec 2026-05-09-desktop-ia-refactor-design.md.

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="p-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[11px] font-mono font-semibold text-fg-4 uppercase tracking-wider mb-1">
          Catalog
        </h1>
        <p className="text-xs text-fg-4">
          Add channels and widgets to your ticker
        </p>
      </div>

      {/* Dashboard error banner */}
      {dashboardError && (
        <div className="mb-4">
          <QueryErrorBanner error={dashboardError} />
        </div>
      )}

      {/* Category filter tabs */}
      <div className="flex items-center gap-1 mb-5">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              filter === tab.key
                ? "bg-accent/10 text-accent"
                : "text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleItems.map((item) => (
          <CatalogCard
            key={item.id}
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
        ))}
      </div>
    </div>
  );
}
