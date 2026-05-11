import { useState, useMemo, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { LayoutGrid, Search, Radio, Boxes } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

import { defaultPinForNewWidget } from "../preferences";
import { getCatalogItems, CATEGORY_LABELS, CANONICAL_ORDER } from "../marketplace";
import type { CatalogCategory, CatalogItem } from "../marketplace";
import { channelsApi } from "../api/client";
import type { Channel, ChannelType } from "../api/client";
import { dashboardQueryOptions, queryKeys } from "../api/queries";
import type { DashboardResponse } from "../types";
import { useShell, useShellData } from "../shell-context";
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

type FilterTab = "all" | CatalogCategory;

const FILTER_TABS: { key: FilterTab; label: string; icon: LucideIcon; hint: string }[] = [
  { key: "all", label: "All", icon: LayoutGrid, hint: "Show every channel and widget" },
  { key: "channel", label: CATEGORY_LABELS["channel"], icon: Radio, hint: "Show only data channels" },
  { key: "widget", label: CATEGORY_LABELS["widget"], icon: Boxes, hint: "Show only utility widgets" },
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
        const channelType = item.id as ChannelType;

        // Optimistic insert: write a placeholder channel into the
        // dashboard cache immediately so the Sidebar + CatalogCard
        // "Added" badge flip on the next paint. Without this the user
        // saw a 0.5-1s gap between click and any visible state change
        // — the network round-trip to `POST /users/me/channels` plus
        // the forced `/dashboard` refetch were both on the critical
        // path. CDC + a background refetch reconcile the placeholder
        // with the real row a moment later.
        const optimisticChannel: Channel & { logto_sub: string } = {
          id: -Date.now(), // ephemeral negative id, replaced on reconcile
          channel_type: channelType,
          enabled: true,
          ticker_enabled: true,
          config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          logto_sub: "",
        };

        const previous = queryClient.getQueryData<DashboardResponse>(
          queryKeys.dashboard,
        );

        queryClient.setQueryData<DashboardResponse>(
          queryKeys.dashboard,
          (old) => {
            if (!old) {
              return {
                data: {},
                channels: [optimisticChannel],
              } as DashboardResponse;
            }
            // Don't double-insert if the channel is somehow already
            // present (e.g. CDC raced us).
            const existing = old.channels ?? [];
            if (existing.some((c) => c.channel_type === channelType)) {
              return old;
            }
            return {
              ...old,
              channels: [...existing, optimisticChannel],
            };
          },
        );

        // Navigate immediately — the channel page's queries will fire
        // in parallel with the create call below.
        navigate({
          to: "/channel/$type/$tab",
          params: { type: item.id, tab: "feed" },
        });
        toast.success(`${item.name} added`);

        // Fire the network call without blocking the UI. On success
        // we reconcile the optimistic row with the server response.
        // On failure we roll back and surface the error.
        channelsApi
          .create(channelType)
          .then((created) => {
            queryClient.setQueryData<DashboardResponse>(
              queryKeys.dashboard,
              (old) => {
                if (!old) return old;
                const channels = (old.channels ?? []).map((c) =>
                  c.id === optimisticChannel.id
                    ? ({ ...created, logto_sub: c.logto_sub } as Channel & {
                        logto_sub: string;
                      })
                    : c,
                );
                return { ...old, channels };
              },
            );
            // Quietly resync in the background so any server-side
            // fields we didn't model (logto_sub, etc.) line up.
            queryClient.invalidateQueries({
              queryKey: queryKeys.dashboard,
              refetchType: "none",
            });
          })
          .catch((err) => {
            // Roll back the optimistic insert.
            queryClient.setQueryData<DashboardResponse>(
              queryKeys.dashboard,
              previous,
            );
            const message =
              err instanceof Error ? err.message : "Failed to add channel";
            toast.error(`Couldn't add ${item.name}: ${message}`);
          });
      } else {
        const nextEnabled = [...prefs.widgets.enabledWidgets, item.id];
        const nextOnTicker = [...prefs.widgets.widgetsOnTicker, item.id];
        // Auto-pin newly added widgets to the right side so they land
        // in the static pinned zone instead of disappearing into the
        // scrolling tape. Preserve any existing pin config (re-adding
        // a previously-removed widget honors the user's last choice).
        // Walkthrough fix 2026-05-11 — see preferences.ts:defaultPinForNewWidget.
        const nextPinned = { ...prefs.widgets.pinnedWidgets };
        if (!nextPinned[item.id]) {
          nextPinned[item.id] = defaultPinForNewWidget();
        }
        onPrefsChange({
          ...prefs,
          widgets: {
            ...prefs.widgets,
            enabledWidgets: nextEnabled,
            widgetsOnTicker: nextOnTicker,
            pinnedWidgets: nextPinned,
          },
        });
        toast.success(`${item.name} added`);
        navigate({ to: "/widget/$id/$tab", params: { id: item.id, tab: "feed" } });
      }
    },
    [navigate, queryClient, prefs, onPrefsChange],
  );

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
