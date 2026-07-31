/**
 * Catalog — browse and act.
 *
 * Was a browse-only grid split into "Your widgets" / "Discover", with
 * every transaction one navigation away on the widget's info page. It's
 * a store now: cards add in place, and details open in a slide-over so
 * you keep your place in the shelf you were reading.
 *
 * Browsing All shows one shelf per category in canonical order, which
 * beats Your/Discover for the thing people actually do here — look for a
 * kind of thing. Filtering or searching collapses to a single section,
 * and the "In your ticker" strip (which subsumed both the old Your
 * section and the slot banner) hides, because at that point you are
 * shopping, not auditing.
 */
import { useCallback, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Search } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import clsx from "clsx";

import {
  CATEGORY_LABELS,
  canonicalOrder,
  getCatalogItems,
  readableTextOn,
} from "../marketplace";
import type { CatalogItem, WidgetCategory } from "../marketplace";
import { dashboardQueryOptions } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import { useCatalog } from "../hooks/useCatalog";
import { useAddWidget } from "../hooks/useAddWidget";
import { useRemoveWidget } from "../hooks/useRemoveWidget";
import { getMaxWidgets, tierMeets } from "../tierLimits";
import { SlotPills, useSlotUsage } from "../components/SlotMeter";
import CatalogCard from "../components/marketplace/CatalogCard";
import WidgetPanel from "../components/marketplace/WidgetPanel";
import QueryErrorBanner from "../components/QueryErrorBanner";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";
import EmptySection from "../components/layout/EmptySection";
import { WidgetBar } from "../components/widget-bar/Bar";
import { Segmented } from "../components/widget-bar/Segmented";

// ── Route ───────────────────────────────────────────────────────

type FilterTab = "all" | WidgetCategory;

const CATEGORY_ORDER: WidgetCategory[] = [
  "sports",
  "finance",
  "news",
  "fantasy",
  "predictions",
  "utility",
];

export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
  errorComponent: RouteError,
  // The open panel is a search param so it deep-links, survives reload,
  // and gives Back somewhere sensible to go.
  validateSearch: (search: Record<string, unknown>): { widget?: string } =>
    typeof search.widget === "string" && search.widget
      ? { widget: search.widget }
      : {},
});

// ── Spotlight ───────────────────────────────────────────────────
//
// Editorial, so it is hardcoded rather than derived: the point is a
// human saying "start here", and all three are zero-config — nothing to
// set up before they show you something.

const SPOTLIGHT: { id: string; tagline: string }[] = [
  { id: "finance_stocks", tagline: "Zero setup — instant quotes" },
  { id: "predictions", tagline: "Read the room" },
  { id: "clock", tagline: "Always on time" },
];

// ── Page ────────────────────────────────────────────────────────

function CatalogPage() {
  const navigate = useNavigate();
  const { widget: openId } = Route.useSearch();
  const { prefs, authenticated, tier, onLogin } = useShell();
  const { widgets } = useShellData();
  const { error: dashboardError } = useQuery(dashboardQueryOptions());

  const [filter, setFilter] = useState<FilterTab>("all");
  const [query, setQuery] = useState("");

  const addWidget = useAddWidget();
  const removeWidget = useRemoveWidget();

  // The catalog is the one surface whose entire content IS the catalog,
  // so it subscribes: a refresh must swap the shelves underneath it.
  const catalogVersion = useCatalog();
  const allItems = useMemo(() => getCatalogItems(), [catalogVersion]);

  // Deliberately two different sets. "Added" counts every row so a
  // disabled widget still reads as added and can't be added twice; the
  // slot meter counts enabled rows only, matching the server's gate.
  const addedIds = useMemo(
    () =>
      new Set([
        ...widgets.map((w) => w.widget_type),
        ...prefs.widgets.enabledWidgets,
      ]),
    [widgets, prefs.widgets.enabledWidgets],
  );

  const slots = useSlotUsage();
  const browsing = filter === "all" && query.trim() === "";

  // ── Selection ─────────────────────────────────────────────────

  const openItem = useMemo(
    () => allItems.find((i) => i.id === openId) ?? null,
    [allItems, openId],
  );

  const setOpen = useCallback(
    (item: CatalogItem | null) => {
      void navigate({
        to: "/catalog",
        search: item ? { widget: item.id } : {},
        replace: true,
      });
    },
    [navigate],
  );

  const maxSlots = getMaxWidgets(tier);
  const capped = slots.finite && slots.used >= maxSlots;

  const lockedFor = useCallback(
    (item: CatalogItem) => {
      const added = addedIds.has(item.id);
      const tierLocked =
        authenticated &&
        item.requiredTier !== "free" &&
        !tierMeets(tier, item.requiredTier);
      return {
        added,
        tierLocked,
        slotLocked: capped && !added && !tierLocked,
      };
    },
    [addedIds, authenticated, tier, capped],
  );

  // At capacity (or gated) the + opens the panel instead of adding —
  // the panel is where the upgrade path is explained.
  const handleAdd = useCallback(
    (item: CatalogItem) => {
      const { tierLocked, slotLocked } = lockedFor(item);
      if (!authenticated || tierLocked || slotLocked) {
        setOpen(item);
        return;
      }
      void addWidget(item);
    },
    [addWidget, authenticated, lockedFor, setOpen],
  );

  // ── Shelves ───────────────────────────────────────────────────

  const matches = useCallback(
    (item: CatalogItem) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return `${item.name} ${item.description} ${CATEGORY_LABELS[item.category]}`
        .toLowerCase()
        .includes(q);
    },
    [query],
  );

  const shelves = useMemo(() => {
    const order = canonicalOrder();
    const rank = (i: CatalogItem) => {
      const at = order.indexOf(i.id);
      return at === -1 ? Number.MAX_SAFE_INTEGER : at;
    };
    const pool = allItems
      .filter((i) => (filter === "all" ? true : i.category === filter))
      .filter(matches)
      .sort((a, b) => rank(a) - rank(b));

    if (browsing) {
      return CATEGORY_ORDER.map((cat) => ({
        key: cat as string,
        title: CATEGORY_LABELS[cat],
        items: pool.filter((i) => i.category === cat),
      })).filter((s) => s.items.length > 0);
    }
    return [
      {
        key: "results",
        title: filter === "all" ? "Results" : CATEGORY_LABELS[filter],
        items: pool,
      },
    ].filter((s) => s.items.length > 0);
  }, [allItems, filter, matches, browsing]);

  const spotlight = useMemo(
    () =>
      browsing
        ? SPOTLIGHT.map((s) => ({
            ...s,
            item: allItems.find((i) => i.id === s.id),
          })).filter((s): s is typeof s & { item: CatalogItem } =>
            Boolean(s.item),
          )
        : [],
    [allItems, browsing],
  );

  const yourItems = useMemo(
    () => allItems.filter((i) => addedIds.has(i.id)),
    [allItems, addedIds],
  );

  const related = useMemo(() => {
    if (!openItem) return [];
    return allItems
      .filter((i) => i.category === openItem.category && i.id !== openItem.id)
      .slice(0, 3);
  }, [allItems, openItem]);

  const cardFor = (item: CatalogItem, variant: "rich" | "compact") => {
    const { added } = lockedFor(item);
    return (
      <CatalogCard
        key={item.id}
        item={item}
        added={added}
        variant={variant}
        onOpen={setOpen}
        onAdd={added ? undefined : handleAdd}
      />
    );
  };

  const gating = openItem
    ? lockedFor(openItem)
    : { added: false, tierLocked: false, slotLocked: false };

  return (
    <PageLayout
      // While the panel is open the page IS that widget, so the title
      // takes its name and "Catalog" steps back to being the parent —
      // otherwise the breadcrumb reads "Catalog / Catalog".
      title={openItem ? openItem.name : "Catalog"}
      width="wide"
      noTopPadding
      parentLabel={openItem ? "Catalog" : undefined}
      onParentClick={openItem ? () => setOpen(null) : undefined}
    >
      <WidgetBar>
        <Segmented
          ariaLabel="Filter by category"
          value={filter}
          // Picking a category clears the query: the pill and a stale
          // search term otherwise compose into a result set that looks
          // like the pill is broken.
          onChange={(k) => {
            setFilter(k);
            setQuery("");
          }}
          options={[
            { value: "all" as FilterTab, label: "All" },
            ...CATEGORY_ORDER.map((c) => ({
              value: c as FilterTab,
              label: CATEGORY_LABELS[c],
            })),
          ]}
        />
        <div className="relative ml-auto w-[220px]">
          <Search
            size={13}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-4"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search widgets"
            placeholder="Search widgets"
            autoComplete="off"
            className="w-full rounded-[7px] border border-edge/80 bg-surface-raised py-1.5 pr-2.5 pl-7 text-ui-meta text-fg placeholder:text-fg-4 focus:border-accent/50 focus:outline-none"
          />
        </div>
      </WidgetBar>

      {dashboardError && (
        <div className="mt-4">
          <QueryErrorBanner error={dashboardError} />
        </div>
      )}

      <div className="mx-auto w-full max-w-[1000px] pt-4 pb-8">
        {/* ── In your ticker ─────────────────────────────────── */}
        {browsing && yourItems.length > 0 && (
          <section className="mb-5 flex flex-col gap-2.5 rounded-xl border border-edge/50 bg-base-150/45 px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-mono text-ui-section text-fg-3">
                In your ticker
              </h2>
              <div className="ml-auto flex items-center gap-2.5">
                <SlotPills usage={slots} />
                <span className="text-ui-chip text-fg-4">
                  {slots.finite
                    ? `${slots.used} of ${slots.max} slots free`
                    : `${slots.used} added · unlimited slots`}
                </span>
                {capped && (
                  <button
                    type="button"
                    onClick={() => void open("https://myscrollr.com/uplink")}
                    className="shrink-0 cursor-pointer rounded-lg bg-warn/15 px-2.5 py-1 text-ui-chip font-semibold text-warn hover:bg-warn/25"
                  >
                    Upgrade
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {yourItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setOpen(item)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-edge/55 bg-surface-raised px-2.5 py-1.5 hover:border-edge"
                >
                  <span
                    className="flex size-[18px] shrink-0 items-center justify-center rounded text-white"
                    style={{
                      background: `linear-gradient(135deg, ${item.hex} 0%, ${item.hex}b8 100%)`,
                    }}
                  >
                    <item.icon size={10} />
                  </span>
                  <span className="text-ui-meta font-medium text-fg">
                    {item.name}
                  </span>
                  <Check size={11} strokeWidth={3} className="text-accent" />
                </button>
              ))}
              {/* Ghost chips make an abstract number concrete: three
                  empty outlines read as "room for three more" faster
                  than "3 of 6 slots free" does. */}
              {slots.finite &&
                Array.from({ length: Math.max(0, slots.max - slots.used) }).map(
                  (_, i) => (
                    <span
                      key={`empty-${i}`}
                      className="flex items-center gap-2 rounded-lg border border-dashed border-edge/70 px-2.5 py-1.5 text-ui-meta text-fg-4"
                    >
                      empty slot
                    </span>
                  ),
                )}
            </div>
          </section>
        )}

        {/* ── Spotlight ──────────────────────────────────────── */}
        {spotlight.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 font-mono text-ui-section text-fg-3">
              Spotlight
            </h2>
            <div className="grid grid-cols-3 gap-3">
              {spotlight.map(({ item, tagline }) => {
                const textOn = readableTextOn(item.hex);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setOpen(item)}
                    className="flex cursor-pointer flex-col items-start gap-2.5 rounded-xl p-3.5 text-left"
                    style={{
                      background: `linear-gradient(135deg, ${item.hex} 0%, ${item.hex}d8 100%)`,
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white"
                        style={{ color: item.hex }}
                      >
                        <item.icon size={18} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span
                          className="text-ui-body font-bold"
                          style={{ color: textOn }}
                        >
                          {item.name}
                        </span>
                        <span
                          className="font-mono text-ui-section opacity-80"
                          style={{ color: textOn }}
                        >
                          {tagline}
                        </span>
                      </span>
                    </div>
                    <p
                      className="text-ui-meta leading-relaxed opacity-90"
                      style={{ color: textOn }}
                    >
                      {item.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Shelves ────────────────────────────────────────── */}
        {shelves.length === 0 ? (
          <EmptySection
            icon={Search}
            title="Nothing matches"
            description="Try a different word, or pick another category."
          />
        ) : (
          shelves.map((shelf) => (
            <section key={shelf.key} className="mb-6 last:mb-0">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="font-mono text-ui-section text-fg-3">
                  {shelf.title}
                </h2>
                <span className="rounded-full bg-base-150 px-2 py-0.5 text-ui-chip font-semibold text-fg-3">
                  {shelf.items.length}
                </span>
              </div>
              {/* Sports go compact: league descriptions are boilerplate,
                  so 14 rich cards would be 14 restatements of one
                  sentence. */}
              <div
                className={clsx(
                  "grid gap-2.5",
                  shelf.key === "sports" ? "grid-cols-4" : "grid-cols-3 gap-3",
                )}
              >
                {shelf.items.map((item) =>
                  cardFor(item, shelf.key === "sports" ? "compact" : "rich"),
                )}
              </div>
            </section>
          ))
        )}

        {/* ── Request a widget ───────────────────────────────── */}
        {browsing && (
          <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-edge/70 px-4 py-3.5">
            <div>
              <div className="text-ui-body font-semibold text-fg">
                Don't see what you want?
              </div>
              <div className="text-ui-meta text-fg-4">
                Tell us what you'd put in your ticker.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void navigate({ to: "/support" })}
              className="shrink-0 cursor-pointer rounded-[7px] border border-edge/80 px-3 py-1.5 text-ui-chip font-medium text-fg-3 hover:border-edge hover:text-fg"
            >
              Request a widget
            </button>
          </section>
        )}
      </div>

      <WidgetPanel
        item={openItem}
        added={gating.added}
        tierLocked={gating.tierLocked}
        slotLocked={gating.slotLocked}
        authenticated={authenticated}
        related={related}
        onClose={() => setOpen(null)}
        onAdd={(item) => void addWidget(item)}
        onRemove={(item) => {
          void removeWidget(item);
          setOpen(null);
        }}
        onOpenWidget={(item) => {
          void navigate({ to: "/widget/$id", params: { id: item.id } });
        }}
        onSignIn={onLogin}
        onUpgrade={() => void open("https://myscrollr.com/uplink")}
        onPick={setOpen}
      />
    </PageLayout>
  );
}
