/**
 * CatalogHub — the catalog's landing view (frame 01 / 05 of the design).
 *
 * A search hero with example chips, one tile per kind, "New this month",
 * and "In your ticker" with the slot line. Everything here is a door into
 * the directory; nothing is a list you scroll.
 */
import { Check, Search } from "lucide-react";

import { CATEGORY_LABELS } from "../../marketplace";
import type { CatalogItem, WidgetCategory } from "../../marketplace";
import type { SlotUsage } from "../SlotMeter";
import CatalogCard, { LogoTile } from "./CatalogCard";
import { CATEGORY_ORDER, byNewest, isNew } from "./catalogSearch";
import type { CatalogKind } from "./catalogSearch";

export interface CatalogViewShared {
  /** Every visible catalog item, in canonical order. */
  items: CatalogItem[];
  addedIds: Set<string>;
  slots: SlotUsage;
  capped: boolean;
  onOpen: (item: CatalogItem) => void;
  onAdd: (item: CatalogItem) => void;
  onRemove: (item: CatalogItem) => void;
  onUpgrade: () => void;
  /** Opens the hidden Custom RSS entry's panel; absent if the catalog lacks it. */
  onCustomRss?: () => void;
  onRequestWidget: () => void;
}

interface CatalogHubProps extends CatalogViewShared {
  onSearch: (q: string) => void;
  onKind: (kind: CatalogKind) => void;
  onSeeAllNew: () => void;
}

/** What people look for; the last one is a deliberate miss so the
 *  request path is one click from the front door. */
const TRIES = ["NFL", "Bitcoin", "Weather", "Hacker News", "Kalshi", "Eredivisie"];

const BLURBS: Record<WidgetCategory, string> = {
  sports: "Live scores from the leagues you follow",
  finance: "Quotes, watchlists and calendars",
  news: "Headlines from publications and feeds",
  fantasy: "Your leagues, matchups and standings",
  predictions: "Live odds from prediction markets",
  utility: "Clocks, weather, dev status and more",
};

const NEW_CAP = 4;
const TILE_LOGOS = 5;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-mono text-ui-section text-fg-3">{children}</h2>;
}

export function slotLine(slots: SlotUsage): string {
  return slots.finite
    ? `${slots.used} of ${slots.max} slots used`
    : `${slots.used} added · unlimited slots`;
}

export default function CatalogHub({
  items,
  addedIds,
  slots,
  capped,
  onOpen,
  onAdd,
  onRemove,
  onUpgrade,
  onCustomRss,
  onRequestWidget,
  onSearch,
  onKind,
  onSeeAllNew,
}: CatalogHubProps) {
  const now = new Date();
  const fresh = byNewest(items.filter((i) => isNew(i.addedAt, now)));
  const yours = items.filter((i) => addedIds.has(i.id));

  const tiles = CATEGORY_ORDER.map((cat) => {
    const list = items.filter((i) => i.category === cat);
    return {
      cat,
      list,
      added: list.filter((i) => addedIds.has(i.id)).length,
      fresh: list.filter((i) => isNew(i.addedAt, now)).length,
    };
  }).filter((t) => t.list.length > 0);

  return (
    <div className="mx-auto w-full max-w-[880px] pt-9 pb-7">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <h1 className="mb-3.5 text-center text-[22px] leading-7 font-bold tracking-tight text-fg">
        What do you want on your ticker?
      </h1>
      <div className="relative mx-auto mb-2.5 max-w-[640px]">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-4"
        />
        <input
          type="search"
          defaultValue=""
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search widgets"
          placeholder={`Search ${items.length} widgets — a league, a publication, a tool`}
          autoComplete="off"
          className="h-11 w-full rounded-[10px] border border-accent/35 bg-surface-raised pr-3.5 pl-10 text-[14px] text-fg shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_8%,transparent)] placeholder:text-fg-4 focus:border-accent/60 focus:outline-none"
        />
      </div>
      <div className="mb-8 flex flex-wrap items-center justify-center gap-1.5 text-ui-meta text-fg-4">
        <span>Try</span>
        {TRIES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onSearch(t)}
            className="cursor-pointer rounded-full border border-edge/80 px-2.5 py-0.5 whitespace-nowrap text-fg-3 hover:border-edge-2 hover:text-fg-2"
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Browse by kind ─────────────────────────────────────── */}
      <div className="mb-2.5">
        <SectionTitle>Browse by kind</SectionTitle>
      </div>
      <div className="mb-6 grid grid-cols-4 gap-2.5">
        {tiles.map(({ cat, list, added, fresh: freshCount }) => (
          <button
            key={cat}
            type="button"
            onClick={() => onKind(cat)}
            aria-label={`${CATEGORY_LABELS[cat]}, ${list.length} widgets`}
            className="relative flex min-h-[104px] cursor-pointer flex-col gap-2.5 overflow-hidden rounded-xl border border-edge/55 bg-surface-raised px-3 pt-3 pb-2.5 text-left hover:border-edge-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: `linear-gradient(to bottom, ${list[0].hex}26, transparent 60%)`,
              }}
            />
            <div className="relative flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] leading-5 font-bold text-fg">
                  {CATEGORY_LABELS[cat]}
                </div>
                <div className="text-[11.5px] leading-4 text-fg-3">
                  {BLURBS[cat]}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-base-150/90 px-1.5 text-ui-chip font-semibold text-fg-3">
                {list.length}
              </span>
            </div>
            {/* Wraps: five logos, "+n" and two labels don't all fit a
                212px tile, and a clipped "1 add" is worse than a third
                line (the grid row grows for every tile). */}
            <div className="relative mt-auto flex flex-wrap items-center gap-x-[5px] gap-y-1">
              {list.slice(0, TILE_LOGOS).map((i) => (
                <LogoTile key={i.id} item={i} size={22} radius="rounded-[5px]" />
              ))}
              {list.length > TILE_LOGOS && (
                <span className="ml-0.5 text-ui-chip text-fg-4">
                  +{list.length - TILE_LOGOS}
                </span>
              )}
              <span className="ml-auto flex gap-1.5 text-ui-chip font-medium whitespace-nowrap">
                {freshCount > 0 && (
                  <span className="text-accent-purple">{freshCount} new</span>
                )}
                {added > 0 && <span className="text-accent">{added} added</span>}
              </span>
            </div>
          </button>
        ))}
        <div className="flex min-h-[104px] flex-col justify-center gap-[3px] rounded-xl border border-dashed border-edge/80 p-3">
          <div className="text-ui-body font-semibold text-fg">Something else?</div>
          <div className="text-[11.5px] leading-4 text-fg-4">
            Paste any RSS feed, or tell us what's missing.
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {onCustomRss && (
              <button
                type="button"
                onClick={onCustomRss}
                className="cursor-pointer rounded-[7px] border border-edge/80 px-2 py-[3px] text-ui-chip font-medium whitespace-nowrap text-fg-3 hover:border-edge-2 hover:text-fg"
              >
                Custom RSS
              </button>
            )}
            <button
              type="button"
              onClick={onRequestWidget}
              className="cursor-pointer rounded-[7px] border border-edge/80 px-2 py-[3px] text-ui-chip font-medium whitespace-nowrap text-fg-3 hover:border-edge-2 hover:text-fg"
            >
              Request
            </button>
          </div>
        </div>
      </div>

      {/* ── New this month ─────────────────────────────────────── */}
      {fresh.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-2">
            <SectionTitle>New this month</SectionTitle>
            {fresh.length > NEW_CAP && (
              <button
                type="button"
                onClick={onSeeAllNew}
                className="ml-auto cursor-pointer text-ui-chip text-fg-3 underline decoration-fg-4/40 hover:text-fg"
              >
                See all new
              </button>
            )}
          </div>
          <div className="mb-6 grid grid-cols-4 gap-2">
            {fresh.slice(0, NEW_CAP).map((item) => (
              <div
                key={item.id}
                className="relative overflow-hidden rounded-[10px] border border-edge/55 bg-surface-raised"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: `linear-gradient(to right, ${item.hex}26, transparent 70%)`,
                  }}
                />
                <div className="relative">
                  <CatalogCard
                    item={item}
                    added={addedIds.has(item.id)}
                    variant="row"
                    onOpen={onOpen}
                    onAdd={addedIds.has(item.id) ? undefined : onAdd}
                    onRemove={onRemove}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── In your ticker ─────────────────────────────────────── */}
      <div className="mb-2 flex items-center gap-2">
        <SectionTitle>In your ticker</SectionTitle>
        <span className="ml-auto text-ui-chip text-fg-4">{slotLine(slots)}</span>
        {capped && (
          <button
            type="button"
            onClick={onUpgrade}
            className="cursor-pointer rounded-lg bg-warn/15 px-2.5 py-[3px] text-ui-chip font-semibold text-warn hover:bg-warn/25"
          >
            Upgrade for unlimited
          </button>
        )}
      </div>
      {yours.length === 0 ? (
        <p className="text-ui-meta text-fg-4">
          Nothing yet — pick a kind above, or search for something.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {yours.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpen(item)}
              className="flex cursor-pointer items-center gap-[7px] rounded-lg border border-edge/55 bg-surface-raised py-[5px] pr-2 pl-1.5 hover:border-edge-2"
            >
              <LogoTile item={item} size={16} radius="rounded" />
              <span className="text-ui-meta font-medium whitespace-nowrap text-fg">
                {item.name}
              </span>
              <Check size={11} strokeWidth={3} className="text-accent" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
