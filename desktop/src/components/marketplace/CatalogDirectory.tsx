/**
 * CatalogDirectory — the catalog's browsing view (frames 02–04, 06).
 *
 * A kind rail on the left, one titled block per kind on the right with
 * rows shelved by `group`. A query searches every kind and shows hits
 * grouped by kind; zero hits shows a request card and the closest group
 * we do have instead of an empty state.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";

import { CATEGORY_LABELS } from "../../marketplace";
import type { CatalogItem, WidgetCategory } from "../../marketplace";
import { requestCatalogWidget } from "../../api/client";
import { WidgetBar } from "../widget-bar/Bar";
import { Segmented } from "../widget-bar/Segmented";
import EmptySection from "../layout/EmptySection";
import CatalogCard from "./CatalogCard";
import type { CatalogViewShared } from "./CatalogHub";
import {
  CATEGORY_ORDER,
  byName,
  byNewest,
  closestGroup,
  groupByShelf,
  matchesQuery,
  missName,
  showGroupHeaders,
} from "./catalogSearch";
import type { CatalogKind, CatalogSort, Shelf } from "./catalogSearch";

interface CatalogDirectoryProps extends CatalogViewShared {
  kind: CatalogKind;
  query: string;
  sort?: CatalogSort;
  authenticated: boolean;
  onLogin: () => void;
  onQueryChange: (q: string) => void;
  onKindChange: (kind: CatalogKind) => void;
  onSortChange: (sort: CatalogSort | undefined) => void;
  onOverview: () => void;
}

interface Block {
  key: string;
  title: string;
  sub: string;
  showHeads: boolean;
  shelves: Shelf<CatalogItem>[];
}

const kindLabel = (kind: CatalogKind) =>
  kind === "all" ? "All widgets" : CATEGORY_LABELS[kind];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "es"}`;

const anchorId = (block: string, group: string) =>
  `catalog-${block}-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

// ── Blocks ──────────────────────────────────────────────────────

function kindBlock(
  cat: WidgetCategory,
  list: CatalogItem[],
  addedIds: Set<string>,
  sort: CatalogSort | undefined,
): Block {
  const added = list.filter((i) => addedIds.has(i.id)).length;
  const sub = `${list.length} widget${list.length === 1 ? "" : "s"} · ${added} in your ticker`;
  if (sort === "az") {
    return { key: cat, title: CATEGORY_LABELS[cat], sub, showHeads: false, shelves: [{ key: "", items: byName(list) }] };
  }
  const shelves = groupByShelf(list);
  return {
    key: cat,
    title: CATEGORY_LABELS[cat],
    sub,
    showHeads: showGroupHeaders(list.length, shelves.length),
    shelves,
  };
}

export function buildBlocks(
  items: CatalogItem[],
  kind: CatalogKind,
  query: string,
  sort: CatalogSort | undefined,
  addedIds: Set<string>,
): { blocks: Block[]; miss: boolean; summary: string; closest?: string } {
  if (query.trim()) {
    const hits = items.filter((i) => matchesQuery(i, query));
    if (hits.length > 0) {
      const blocks = CATEGORY_ORDER.map((cat) => {
        const list = hits.filter((i) => i.category === cat);
        return {
          key: cat,
          title: CATEGORY_LABELS[cat],
          sub: plural(list.length, "match"),
          showHeads: false,
          shelves: [{ key: "", items: sort === "az" ? byName(list) : list }],
        };
      }).filter((b) => b.shelves[0].items.length > 0);
      return { blocks, miss: false, summary: plural(hits.length, "match") };
    }
    // A miss: the closest group by hint, else the kind being browsed.
    const group = closestGroup(query);
    const list = group
      ? items.filter((i) => i.group === group)
      : kind === "all"
        ? []
        : items.filter((i) => i.category === kind);
    const blocks: Block[] = list.length
      ? [{
          key: "closest",
          title: "Closest matches",
          sub: group ?? kindLabel(kind),
          showHeads: false,
          shelves: [{ key: "", items: list }],
        }]
      : [];
    return { blocks, miss: true, summary: "0 exact matches", closest: group };
  }

  if (sort === "new") {
    return {
      blocks: [{
        key: "new",
        title: "Newest first",
        sub: `${items.length} widgets`,
        showHeads: false,
        shelves: [{ key: "", items: byNewest(items) }],
      }],
      miss: false,
      summary: "",
    };
  }

  const cats = kind === "all" ? CATEGORY_ORDER : [kind];
  const blocks = cats
    .map((cat) => kindBlock(cat, items.filter((i) => i.category === cat), addedIds, sort))
    .filter((b) => b.shelves.some((s) => s.items.length > 0));
  return { blocks, miss: false, summary: "" };
}

// ── Miss card ───────────────────────────────────────────────────

function MissCard({
  query,
  authenticated,
  onLogin,
  onCustomRss,
}: {
  query: string;
  authenticated: boolean;
  onLogin: () => void;
  onCustomRss?: () => void;
}) {
  const name = missName(query);
  const [state, setState] = useState<
    { status: "idle" } | { status: "sending" } | { status: "done"; count: number }
  >({ status: "idle" });

  const request = async () => {
    if (!authenticated) {
      onLogin();
      return;
    }
    setState({ status: "sending" });
    try {
      const { count } = await requestCatalogWidget(query);
      setState({ status: "done", count });
    } catch {
      setState({ status: "idle" });
      toast.error(`Couldn't send the request for ${name}`);
    }
  };

  return (
    <section className="mb-5 flex items-center gap-4 rounded-xl border border-edge/60 bg-base-150/60 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] leading-5 font-bold text-fg">
          No “{name}” widget yet
        </div>
        <div className="mt-0.5 text-ui-meta text-fg-3">
          Requests are counted and the most-asked ones ship first — we'll tell
          you when it lands. Below are the closest things we do have.
        </div>
      </div>
      {state.status === "done" ? (
        <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-[7px] text-ui-meta font-semibold whitespace-nowrap text-accent">
          <Check size={13} strokeWidth={2.5} />
          Requested ·{" "}
          {state.count === 1
            ? "you're the first to ask"
            : `${state.count} people have asked`}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void request()}
          disabled={state.status === "sending"}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-[7px] text-ui-meta font-semibold whitespace-nowrap text-[#0b1a14] hover:bg-accent/90 disabled:opacity-60"
        >
          <Plus size={13} strokeWidth={2.5} />
          {authenticated ? `Request ${name}` : "Sign in to request"}
        </button>
      )}
      {onCustomRss && (
        <button
          type="button"
          onClick={onCustomRss}
          className="shrink-0 cursor-pointer rounded-lg border border-edge px-3 py-[7px] text-ui-meta font-medium whitespace-nowrap text-fg-3 hover:border-edge-2 hover:text-fg"
        >
          Use a custom RSS feed
        </button>
      )}
    </section>
  );
}

// ── Component ───────────────────────────────────────────────────

type SortTab = "kind" | CatalogSort;

export default function CatalogDirectory({
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
  kind,
  query,
  sort,
  authenticated,
  onLogin,
  onQueryChange,
  onKindChange,
  onSortChange,
  onOverview,
}: CatalogDirectoryProps) {
  // The field is its own source of truth while you type; the URL catches
  // up a tick later, and a rail click (which clears the query) resets it.
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);

  const { blocks, miss, summary, closest } = buildBlocks(items, kind, query, sort, addedIds);

  const rail = (["all", ...CATEGORY_ORDER] as CatalogKind[])
    .map((k) => ({
      kind: k,
      count: k === "all" ? items.length : items.filter((i) => i.category === k).length,
    }))
    .filter((r) => r.count > 0);

  const row = (item: CatalogItem) => {
    const added = addedIds.has(item.id);
    return (
      <CatalogCard
        key={item.id}
        item={item}
        added={added}
        variant="row"
        onOpen={onOpen}
        onAdd={added ? undefined : onAdd}
        onRemove={onRemove}
      />
    );
  };

  return (
    <>
      <WidgetBar>
        <div className="relative w-[300px]">
          <Search
            size={13}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-4"
          />
          <input
            type="search"
            value={draft}
            autoFocus={query !== ""}
            onChange={(e) => {
              setDraft(e.target.value);
              onQueryChange(e.target.value);
            }}
            aria-label="Search widgets"
            placeholder={`Search ${items.length} widgets`}
            autoComplete="off"
            className="w-full rounded-[7px] border border-edge/80 bg-surface-raised py-1.5 pr-2.5 pl-7 text-ui-meta text-fg placeholder:text-fg-4 focus:border-accent/50 focus:outline-none"
          />
        </div>
        {summary && <span className="text-ui-meta text-fg-4">{summary}</span>}
        {capped && (
          <button
            type="button"
            onClick={onUpgrade}
            className="cursor-pointer rounded-lg bg-warn/12 px-2.5 py-1 text-ui-chip font-semibold whitespace-nowrap text-warn hover:bg-warn/20"
          >
            All {slots.max} slots used · remove one to swap, or upgrade
          </button>
        )}
        <div className="ml-auto">
          <Segmented<SortTab>
            ariaLabel="Sort"
            layoutGroupId="catalog-sort"
            value={sort ?? "kind"}
            onChange={(v) => onSortChange(v === "kind" ? undefined : v)}
            options={[
              { value: "kind", label: "By kind" },
              { value: "az", label: "A–Z" },
              { value: "popular", label: "Popular" },
            ]}
          />
        </div>
      </WidgetBar>

      <div className="flex min-h-0 flex-1">
        {/* ── Rail ─────────────────────────────────────────────── */}
        <nav
          aria-label="Kinds"
          className="flex w-[184px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-edge/40 px-2 py-2.5 scrollbar-thin"
        >
          <button
            type="button"
            onClick={onOverview}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-fg-3 hover:bg-base-150 hover:text-fg-2"
          >
            <ArrowLeft size={13} />
            Overview
          </button>
          <div className="mx-2.5 my-1.5 h-px bg-edge/50" />
          <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-fg">
            <span className="flex size-4 items-center justify-center rounded bg-accent/15 text-accent">
              <Check size={10} strokeWidth={3} />
            </span>
            <span className="flex-1">Your ticker</span>
            <span className={clsx("text-ui-chip", capped ? "text-warn" : "text-fg-4")}>
              {slots.finite ? `${slots.used}/${slots.max}` : slots.used}
            </span>
          </div>
          <div className="mx-2.5 my-1.5 h-px bg-edge/50" />
          {rail.map((r) => {
            const active = !query && r.kind === kind;
            return (
              <button
                key={r.kind}
                type="button"
                onClick={() => onKindChange(r.kind)}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium",
                  active
                    ? "bg-accent/12 text-accent"
                    : "text-fg-3 hover:bg-base-150 hover:text-fg-2",
                )}
              >
                <span className="flex-1">{kindLabel(r.kind)}</span>
                <span className={clsx("text-ui-chip", active ? "text-accent/70" : "text-fg-4")}>
                  {r.count}
                </span>
              </button>
            );
          })}
          <div className="mt-auto px-2.5 pt-2.5 pb-1 text-ui-chip text-fg-4">
            Don't see it?{" "}
            <button
              type="button"
              onClick={onRequestWidget}
              className="cursor-pointer text-fg-3 underline decoration-fg-4/40 hover:text-fg"
            >
              Request a widget
            </button>
          </div>
        </nav>

        {/* ── Blocks ───────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 overflow-y-auto px-5 pt-4 pb-7 scrollbar-thin [scrollbar-gutter:stable]">
          {sort === "popular" && (
            <p className="mb-4 text-ui-meta text-fg-4">
              Popularity isn't tracked yet — this is the catalog's own order.
            </p>
          )}
          {miss && (
            <MissCard
              key={query}
              query={query}
              authenticated={authenticated}
              onLogin={onLogin}
              onCustomRss={onCustomRss}
            />
          )}
          {blocks.length === 0 && !miss && (
            <EmptySection
              icon={Search}
              title="Nothing here"
              description="Pick another kind from the rail."
            />
          )}
          {blocks.map((block) => (
            <div key={block.key} className="mb-5">
              <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
                <h1 className="text-[16px] leading-[22px] font-bold text-fg">
                  {block.title}
                </h1>
                <span className="text-ui-meta whitespace-nowrap text-fg-4">
                  {block.sub}
                </span>
                {block.showHeads && (
                  <div className="ml-auto flex flex-wrap justify-end gap-1.5">
                    {block.shelves.map((s) => (
                      <a
                        key={s.key}
                        href={`#${anchorId(block.key, s.key)}`}
                        onClick={(e) => {
                          e.preventDefault();
                          document
                            .getElementById(anchorId(block.key, s.key))
                            ?.scrollIntoView({ block: "start", behavior: "smooth" });
                        }}
                        className="rounded-full border border-edge/70 px-2 py-0.5 text-ui-chip whitespace-nowrap text-fg-3 hover:border-edge-2 hover:text-fg"
                      >
                        {s.key || "Other"}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {block.shelves.map((shelf) => (
                <section
                  key={shelf.key || "ungrouped"}
                  id={anchorId(block.key, shelf.key)}
                  className="mb-4 scroll-mt-4"
                >
                  {block.showHeads && (
                    <div className="mb-1.5 flex items-center gap-2 px-2.5">
                      <h2 className="font-mono text-ui-section whitespace-nowrap text-fg-3">
                        {shelf.key || "Other"}
                      </h2>
                      <span className="text-ui-chip text-fg-4">{shelf.items.length}</span>
                      <div className="h-px flex-1 bg-edge/50" />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {shelf.items.map(row)}
                  </div>
                </section>
              ))}
            </div>
          ))}
          {miss && closest === undefined && blocks.length === 0 && (
            <p className="text-ui-meta text-fg-4">
              Try a league, a publication or a tool — or pick a kind from the rail.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
