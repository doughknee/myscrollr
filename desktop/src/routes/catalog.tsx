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
import { open } from "@tauri-apps/plugin-shell";
import clsx from "clsx";

import { getCatalogItems, CATEGORY_LABELS, canonicalOrder } from "../marketplace";
import type { WidgetCategory, CatalogItem } from "../marketplace";
import { dashboardQueryOptions } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import { useCatalog } from "../hooks/useCatalog";
import {
  SlotPills,
  slotHeadline,
  slotSubline,
  useSlotUsage,
} from "../components/SlotMeter";
import CatalogCard from "../components/marketplace/CatalogCard";
import QueryErrorBanner from "../components/QueryErrorBanner";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";
import PageSection from "../components/layout/PageSection";
import { WidgetBar } from "../components/widget-bar/Bar";
import { Segmented } from "../components/widget-bar/Segmented";
import { SelectMenu } from "../components/widget-bar/SelectMenu";
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
  if (sort === "az") return [...items].sort((a, b) => a.name.localeCompare(b.name));
  // Resolved once per call rather than once per comparison.
  const order = canonicalOrder();
  return [...items].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

// ── Page component ──────────────────────────────────────────────

function CatalogPage() {
  const navigate = useNavigate();
  const { prefs } = useShell();
  const { widgets } = useShellData();
  const { error: dashboardError } = useQuery(dashboardQueryOptions());

  const [filter, setFilter] = useState<FilterTab>("all");
  const [sort, setSort] = useState<SortMode>("featured");

  // The Library is the one surface whose entire content IS the catalog, and
  // it was the one surface not subscribed to it: an empty dep array pinned
  // `allItems` to whatever the bundled snapshot held at mount, so a refresh
  // swapped the catalog underneath and this never re-read it. The version
  // string changes exactly when the catalog does.
  const catalogVersion = useCatalog();
  const allItems = useMemo(() => getCatalogItems(), [catalogVersion]);

  const enabledDataWidgetIds = useMemo(
    () => new Set(widgets.map((ch) => ch.widget_type)),
    [widgets],
  );
  const enabledWidgetIds = useMemo(
    () => new Set(prefs.widgets.enabledWidgets),
    [prefs.widgets.enabledWidgets],
  );
  const allEnabledIds = useMemo(
    () => new Set([...enabledDataWidgetIds, ...enabledWidgetIds]),
    [enabledDataWidgetIds, enabledWidgetIds],
  );

  // Widget/slot model: slot math + meter live in SlotMeter.tsx, shared
  // with the Account page so the two surfaces can't drift (v1.1.2). At
  // capacity, the catalog locks *new* adds (already-added items stay
  // interactive).
  const slots = useSlotUsage();

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

  const cardFor = (item: CatalogItem) => (
    <div key={item.id}>
      <CatalogCard
        item={item}
        enabled={allEnabledIds.has(item.id)}
        onInfo={(it) =>
          navigate({ to: "/widget/$id/info", params: { id: it.id } })
        }
      />
    </div>
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
    <PageLayout title="Catalog" width="wide">
      {/* WCB — same persistent chrome as every source page. Category
          filter (ex-TopBar tab strip) left, sort (ex-slot-band group)
          right, per the bar grammar. */}
      <WidgetBar>
        <Segmented
          ariaLabel="Filter by category"
          value={filter}
          onChange={(k) => setFilter(k)}
          options={FILTER_TABS.map((t) => ({ value: t.key, label: t.label }))}
        />
        <div className="ml-auto">
          <SelectMenu
            ariaLabel="Sort widgets"
            prefix="Sort"
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS.map((s) => ({ value: s.key, label: s.label }))}
          />
        </div>
      </WidgetBar>
      {/* mt-4 on the first band(s) = the pt-4 gap every WCB page keeps
          under the bar (adjacent margins collapse, so both carrying it
          is safe whichever renders first). */}
      {dashboardError && (
        <div className="mt-4 mb-5">
          <QueryErrorBanner error={dashboardError} />
        </div>
      )}

      {/* ── Catalog header: slot budget + sort (v1.1.1 round 3).
          The counter lives HERE now — cards never nag, and the old
          at-capacity banner folded into this band (warn tint +
          Upgrade button when full). ── */}
      <div
        className={clsx(
          "mt-4 mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border px-4 py-3",
          slots.atCapacity && slots.finite
            ? "border-warn/25 bg-warn/[0.06]"
            : "border-edge/40 bg-base-150/30",
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              slots.atCapacity && slots.finite
                ? "bg-warn/15 text-warn"
                : "bg-accent/10 text-accent",
            )}
          >
            <Layers size={16} />
          </span>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-ui-body font-semibold text-fg-1">
                {slotHeadline(slots)}
              </span>
              {/* Slot meter — one pill per slot, filled as used. */}
              <SlotPills usage={slots} />
            </div>
            <div className="text-ui-chip text-fg-4">{slotSubline(slots)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {slots.atCapacity && slots.finite && (
            <button
              onClick={() => void open("https://myscrollr.com/uplink")}
              className="shrink-0 rounded-lg bg-warn/15 px-3 py-1.5 text-ui-chip font-semibold text-warn hover:bg-warn/25"
            >
              Upgrade
            </button>
          )}
          {/* Sort control moved to the WCB (bar grammar: config
              selects live in the bar's right cluster). */}
        </div>
      </div>

      <div>
        {yourItems.length === 0 && discoverItems.length === 0 ? (
          <EmptySection
            icon={Search}
            title="Nothing here"
            description="No items match this filter. Try a different category."
          />
        ) : (
          <>
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
                  {discoverItems.map(cardFor)}
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
          </>
        )}
      </div>
    </PageLayout>
  );
}
