import { useState, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  Boxes,
  Gamepad2,
  Layers,
  LayoutGrid,
  LineChart,
  Rss,
  Search,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { open } from "@tauri-apps/plugin-shell";
import clsx from "clsx";

import { getCatalogItems, CATEGORY_LABELS, CANONICAL_ORDER } from "../marketplace";
import type { WidgetCategory, CatalogItem } from "../marketplace";
import { dashboardQueryOptions } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import { getMaxWidgets } from "../tierLimits";
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

// ── Sort modes (v1.1.1 round 3): the "Your widgets"/"Discover" split
//    replaced the old enabled-first sort, so sorting is now an explicit
//    header control applied within each section. ──────────────────

type SortMode = "featured" | "az";

const SORT_OPTIONS: { key: SortMode; label: string; icon: LucideIcon }[] = [
  { key: "featured", label: "Featured", icon: Sparkles },
  { key: "az", label: "A–Z", icon: ArrowDownAZ },
];

function orderItems(items: CatalogItem[], sort: SortMode): CatalogItem[] {
  return [...items].sort((a, b) =>
    sort === "az"
      ? a.name.localeCompare(b.name)
      : CANONICAL_ORDER.indexOf(a.id) - CANONICAL_ORDER.indexOf(b.id),
  );
}

// ── Page component ──────────────────────────────────────────────

function CatalogPage() {
  const navigate = useNavigate();
  const { prefs, tier } = useShell();
  const { channels } = useShellData();
  const { error: dashboardError } = useQuery(dashboardQueryOptions());

  const [filter, setFilter] = useState<FilterTab>("all");
  const [sort, setSort] = useState<SortMode>("featured");

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
  const slots = useMemo(() => {
    const used =
      channels.filter((ch) => ch.enabled).length +
      prefs.widgets.enabledWidgets.length;
    const max = getMaxWidgets(tier);
    return { used, max, atCapacity: used >= max };
  }, [channels, prefs.widgets.enabledWidgets.length, tier]);

  // Filter → split into "yours" vs "discover" → sort within each.
  const { yourItems, discoverItems } = useMemo(() => {
    const filtered =
      filter === "all"
        ? allItems
        : allItems.filter((item) => item.category === filter);
    return {
      yourItems: orderItems(
        filtered.filter((item) => allEnabledIds.has(item.id)),
        sort,
      ),
      discoverItems: orderItems(
        filtered.filter((item) => !allEnabledIds.has(item.id)),
        sort,
      ),
    };
  }, [allItems, filter, sort, allEnabledIds]);

  // ── Header copy: the slot budget, stated once and visibly ────
  const finiteMax = Number.isFinite(slots.max);
  const openSlots = finiteMax ? (slots.max as number) - slots.used : Infinity;
  const slotHeadline = !finiteMax
    ? `${slots.used} widget${slots.used === 1 ? "" : "s"} added`
    : slots.atCapacity
      ? `All ${slots.max} widget slots in use`
      : `${slots.used} of ${slots.max} widget slots used`;
  const slotSub = !finiteMax
    ? "Unlimited slots on your plan — add away."
    : slots.atCapacity
      ? "Remove a widget to free a slot, or upgrade for more."
      : slots.used === 0
        ? "Fresh start — pick your first widget below."
        : `${openSlots} open slot${openSlots === 1 ? "" : "s"} — room for more.`;

  const cardFor = (item: CatalogItem, i: number) => (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        delay: Math.min(0.06 + i * 0.018, 0.3),
        ease: [0.22, 0.61, 0.36, 1],
      }}
    >
      <CatalogCard
        item={item}
        enabled={allEnabledIds.has(item.id)}
        onInfo={(it) =>
          navigate({ to: "/widget/$id/info", params: { id: it.id } })
        }
      />
    </motion.div>
  );

  const countChip = (n: number) => (
    <span className="rounded-full bg-base-150 px-2 py-0.5 text-ui-chip font-semibold text-fg-3">
      {n}
    </span>
  );

  // ── Render ──────────────────────────────────────────────────
  //
  // Catalog uses an in-page tab band (category filters) in the TopBar,
  // then a content header owning the slot budget + sort control, then
  // two sections: what you have, and what you could add (v1.1.1 r3).

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

      {/* ── Catalog header: slot budget + sort (v1.1.1 round 3).
          The counter lives HERE now — cards never nag, and the old
          at-capacity banner folded into this band (warn tint +
          Upgrade button when full). ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.02, ease: [0.22, 0.61, 0.36, 1] }}
        className={clsx(
          "mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border px-4 py-3",
          slots.atCapacity && finiteMax
            ? "border-warn/25 bg-warn/[0.06]"
            : "border-edge/40 bg-base-150/30",
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              slots.atCapacity && finiteMax
                ? "bg-warn/15 text-warn"
                : "bg-accent/10 text-accent",
            )}
          >
            <Layers size={16} />
          </span>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-ui-body font-semibold text-fg-1">
                {slotHeadline}
              </span>
              {/* Slot meter — one pill per slot, filled as used. */}
              {finiteMax && (
                <span className="flex items-center gap-1" aria-hidden>
                  {Array.from({ length: slots.max as number }, (_, i) => (
                    <span
                      key={i}
                      className={clsx(
                        "h-1.5 w-4 rounded-full transition-colors",
                        i < slots.used
                          ? slots.atCapacity
                            ? "bg-warn"
                            : "bg-accent"
                          : "bg-edge/60",
                      )}
                    />
                  ))}
                </span>
              )}
            </div>
            <div className="text-ui-chip text-fg-4">{slotSub}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {slots.atCapacity && finiteMax && (
            <button
              onClick={() => void open("https://myscrollr.com/uplink")}
              className="shrink-0 rounded-lg bg-warn/15 px-3 py-1.5 text-ui-chip font-semibold text-warn transition-colors hover:bg-warn/25"
            >
              Upgrade
            </button>
          )}
          {/* Sort control — lives in the header, applies within each
              section below. */}
          <div
            className="flex items-center rounded-lg border border-edge/40 bg-base-150/40 p-0.5"
            role="group"
            aria-label="Sort widgets"
          >
            {SORT_OPTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
                className={clsx(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-ui-chip font-medium transition-colors",
                  sort === s.key
                    ? "bg-surface text-fg-1 shadow-soft-sm"
                    : "text-fg-4 hover:text-fg-2",
                )}
              >
                <s.icon size={12} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {yourItems.length === 0 && discoverItems.length === 0 ? (
        <EmptySection
          icon={Search}
          title="Nothing here"
          description="No items match this filter. Try a different category."
        />
      ) : (
        // No initial={false} here — it would propagate presence-context
        // suppression and block the card entrances on page arrival
        // (same bug PageLayout had until v1.1.1).
        <AnimatePresence mode="wait">
          <motion.div
            key={`${filter}-${sort}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* ── Your widgets ── */}
            {yourItems.length > 0 && (
              <PageSection
                variant="grid"
                title="Your widgets"
                badge={countChip(yourItems.length)}
              >
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {yourItems.map(cardFor)}
                </div>
              </PageSection>
            )}

            {/* ── Discover new widgets ── */}
            <PageSection
              variant="grid"
              title="Discover new widgets"
              badge={
                discoverItems.length > 0 ? countChip(discoverItems.length) : undefined
              }
            >
              {discoverItems.length > 0 ? (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {discoverItems.map((item, i) =>
                    cardFor(item, yourItems.length + i),
                  )}
                </div>
              ) : (
                <EmptySection
                  compact
                  icon={Sparkles}
                  title="You've added everything here"
                  description="Check another category for more widgets."
                />
              )}
            </PageSection>
          </motion.div>
        </AnimatePresence>
      )}
    </PageLayout>
  );
}
