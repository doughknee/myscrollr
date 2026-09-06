/**
 * Catalog — one route, two views (design_handoff_catalog/, REL-215).
 *
 * The HUB is where you arrive: a search hero, one tile per kind, what's
 * new, what's yours. A tile or a typed query drops into the DIRECTORY: a
 * kind rail on the left, grouped rows on the right. Both are sub-states
 * of this one route — `?kind=` / `?q=` select the directory, neither is
 * the hub — so Back and deep links work and the two views never drift
 * on gating, slots or the open panel.
 *
 * Rules (the design's Behavior card):
 *   - typing anywhere → directory results grouped by kind; clearing the
 *     field returns to the last kind, not the hub;
 *   - picking a kind in the rail clears the query;
 *   - + adds in place; ✓ removes with a toast undo; the row body opens
 *     the slide-over panel;
 *   - zero matches → request card + closest group;
 *   - at slot cap, + opens the panel (where the upgrade path lives) and
 *     the cap reads on the sidebar chip, the rail and the hub line.
 */
import { useCallback, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-shell";

import {
  CATEGORY_LABELS,
  canonicalOrder,
  catalogItemById,
  getCatalogItems,
} from "../marketplace";
import type { CatalogItem } from "../marketplace";
import { dashboardQueryOptions } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import { useCatalog } from "../hooks/useCatalog";
import { useAddWidget } from "../hooks/useAddWidget";
import { useRemoveWidget } from "../hooks/useRemoveWidget";
import { getMaxWidgets, tierMeets } from "../tierLimits";
import { useSlotUsage } from "../components/SlotMeter";
import WidgetPanel from "../components/marketplace/WidgetPanel";
import CatalogHub from "../components/marketplace/CatalogHub";
import CatalogDirectory from "../components/marketplace/CatalogDirectory";
import { kindFromSearch } from "../components/marketplace/catalogSearch";
import type { CatalogKind, CatalogSort } from "../components/marketplace/catalogSearch";
import QueryErrorBanner from "../components/QueryErrorBanner";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";

// ── Route ───────────────────────────────────────────────────────

export interface CatalogSearch {
  /** Open panel — deep-links and survives reload. */
  widget?: string;
  /** Directory kind. "all" or a category; anything else reads as all. */
  kind?: string;
  /** Directory query. Present (even with a kind) → search results. */
  q?: string;
  sort?: CatalogSort;
}

const SORTS: CatalogSort[] = ["az", "popular", "new"];

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
  errorComponent: RouteError,
  validateSearch: (search: Record<string, unknown>): CatalogSearch => {
    const out: CatalogSearch = {};
    const widget = str(search.widget);
    const kind = str(search.kind);
    const q = str(search.q);
    const sort = str(search.sort);
    if (widget) out.widget = widget;
    if (kind) out.kind = kind;
    if (q) out.q = q;
    if (sort && (SORTS as string[]).includes(sort)) out.sort = sort as CatalogSort;
    return out;
  },
});

export const UPGRADE_URL = "https://myscrollr.com/uplink";

// ── Page ────────────────────────────────────────────────────────

function CatalogPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { prefs, authenticated, tier, onLogin } = useShell();
  const { widgets } = useShellData();
  const { error: dashboardError } = useQuery(dashboardQueryOptions());

  const addWidget = useAddWidget();
  const removeWidget = useRemoveWidget();

  // The catalog is the one surface whose entire content IS the catalog,
  // so it subscribes: a refresh must swap the shelves underneath it.
  const catalogVersion = useCatalog();
  // Hidden entries are off the shelves but still resolve by id, so a
  // widget someone already has keeps its name, colour and page — and the
  // hub's "Custom RSS" chip can open the hidden entry's panel.
  const allItems = useMemo(() => {
    const order = canonicalOrder();
    const rank = (i: CatalogItem) => {
      const at = order.indexOf(i.id);
      return at === -1 ? Number.MAX_SAFE_INTEGER : at;
    };
    return getCatalogItems()
      .filter((i) => !i.hidden)
      .sort((a, b) => rank(a) - rank(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogVersion]);
  const customRss = useMemo(
    () => catalogItemById("rss_custom") ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogVersion],
  );

  const view: "hub" | "dir" = search.kind || search.q ? "dir" : "hub";
  const kind = kindFromSearch(search.kind);
  const query = search.q ?? "";

  // ── Navigation ────────────────────────────────────────────────

  const go = useCallback(
    (next: CatalogSearch, replace = false) =>
      void navigate({ to: "/catalog", search: next, replace }),
    [navigate],
  );

  const goHub = useCallback(() => go({}), [go]);
  const goKind = useCallback(
    (k: CatalogKind) => go({ kind: k, ...(search.sort ? { sort: search.sort } : {}) }),
    [go, search.sort],
  );
  // Typing: the first keystroke enters the directory (a history entry
  // Back can return from); the rest rewrite it in place. Clearing goes
  // back to the last kind, never to the hub.
  const onQueryChange = useCallback(
    (q: string) => {
      const base = search.sort ? { sort: search.sort } : {};
      if (q === "") {
        go({ ...base, kind: search.kind ?? "all" }, true);
        return;
      }
      go(
        { ...base, ...(search.kind ? { kind: search.kind } : {}), q },
        Boolean(search.q),
      );
    },
    [go, search.kind, search.q, search.sort],
  );
  const onSortChange = useCallback(
    (sort: CatalogSort | undefined) =>
      go(
        {
          kind: search.kind ?? "all",
          ...(search.q ? { q: search.q } : {}),
          ...(sort ? { sort } : {}),
        },
        true,
      ),
    [go, search.kind, search.q],
  );

  const setOpen = useCallback(
    (item: CatalogItem | null) =>
      go(
        {
          ...(search.kind ? { kind: search.kind } : {}),
          ...(search.q ? { q: search.q } : {}),
          ...(search.sort ? { sort: search.sort } : {}),
          ...(item ? { widget: item.id } : {}),
        },
        true,
      ),
    [go, search.kind, search.q, search.sort],
  );

  const onUpgrade = useCallback(() => void open(UPGRADE_URL), []);
  const onRequestWidget = useCallback(
    () => void navigate({ to: "/support" }),
    [navigate],
  );

  // ── Gating ────────────────────────────────────────────────────

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

  const handleRemove = useCallback(
    (item: CatalogItem) => void removeWidget(item),
    [removeWidget],
  );

  // ── Panel ─────────────────────────────────────────────────────

  const openItem = useMemo(() => {
    if (!search.widget) return null;
    return (
      allItems.find((i) => i.id === search.widget) ??
      // Hidden entries (Custom RSS) open from the hub's "Something else?"
      catalogItemById(search.widget) ??
      null
    );
  }, [allItems, search.widget]);

  const related = useMemo(() => {
    if (!openItem) return [];
    return allItems
      .filter((i) => i.category === openItem.category && i.id !== openItem.id)
      .slice(0, 3);
  }, [allItems, openItem]);

  const gating = openItem
    ? lockedFor(openItem)
    : { added: false, tierLocked: false, slotLocked: false };

  const crumb = query
    ? `Search “${query.trim()}”`
    : kind === "all"
      ? "All widgets"
      : CATEGORY_LABELS[kind];

  const shared = {
    items: allItems,
    addedIds,
    slots,
    capped,
    onOpen: setOpen,
    onAdd: handleAdd,
    onRemove: handleRemove,
    onUpgrade,
    onCustomRss: customRss ? () => setOpen(customRss) : undefined,
    onRequestWidget,
  };

  return (
    <PageLayout
      // While the panel is open the page IS that widget, so the title
      // takes its name and "Catalog" steps back to being the parent —
      // otherwise the breadcrumb reads "Catalog / Catalog".
      title={openItem ? openItem.name : view === "dir" ? crumb : "Catalog"}
      width="wide"
      fillHeight={view === "dir"}
      noContentPadding={view === "dir"}
      parentLabel={openItem || view === "dir" ? "Catalog" : undefined}
      onParentClick={
        openItem ? () => setOpen(null) : view === "dir" ? goHub : undefined
      }
    >
      {dashboardError && (
        <div className="mx-5 mt-4">
          <QueryErrorBanner error={dashboardError} />
        </div>
      )}

      {view === "hub" ? (
        <CatalogHub
          {...shared}
          onSearch={onQueryChange}
          onKind={goKind}
          onSeeAllNew={() => go({ kind: "all", sort: "new" })}
        />
      ) : (
        <CatalogDirectory
          {...shared}
          kind={kind}
          query={query}
          sort={search.sort}
          authenticated={authenticated}
          onLogin={onLogin}
          onQueryChange={onQueryChange}
          onKindChange={goKind}
          onSortChange={onSortChange}
          onOverview={goHub}
        />
      )}

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
        onUpgrade={onUpgrade}
        onPick={setOpen}
      />
    </PageLayout>
  );
}
