/**
 * Predictions ConfigPanel — v1.1.4 rethink.
 *
 * Configure's job is the widget's UNIVERSE: which Kalshi categories flow
 * into Scrollr at all (server-side `config.categories` — it filters the
 * dashboard payload). Curation within that universe belongs to the
 * WATCHLIST (stars on any card), which also takes over the ticker.
 *
 * The old server-side "favorites" pin list — a parallel curation
 * mechanism that fought the watchlist — is retired: existing pins
 * auto-migrate into the watchlist once, then the config slot is
 * cleared. The API still honors favorites for old clients.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Star, Layers, Radio } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { useChannelConfig } from "../../hooks/useChannelConfig";
import {
  predictionsCatalogOptions,
  dashboardQueryOptions,
} from "../../api/queries";
import {
  getWatchlist,
  saveWatchlist,
  withToggled,
} from "./watchlist";
import type { Channel } from "../../api/client";
import type { Prediction } from "../../types";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface PredictionsConfigPanelProps {
  channel: Channel;
  subscriptionTier: SubscriptionTier;
  hex: string;
}

interface PredictionsChannelConfig {
  categories?: string[];
  favorites?: string[];
}

// ── Component ────────────────────────────────────────────────────

export default function PredictionsConfigPanel({
  channel,
}: PredictionsConfigPanelProps) {
  const config = channel.config as PredictionsChannelConfig;

  const {
    error,
    setError,
    saving,
    updateItems: updateCategories,
  } = useChannelConfig<string[]>(channel.channel_type, "categories");
  const { updateItems: updateFavorites } = useChannelConfig<string[]>(
    channel.channel_type,
    "favorites",
  );

  const selected = useMemo(
    () =>
      new Set(Array.isArray(config?.categories) ? config.categories : []),
    [config?.categories],
  );

  // ── Queries ────────────────────────────────────────────────────

  const { data: catalog = [] } = useQuery(predictionsCatalogOptions());
  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const markets = useMemo(
    () => (dashboard?.data?.predictions as Prediction[] | undefined) ?? [],
    [dashboard?.data?.predictions],
  );

  // Category universe with counts, from the full tracked catalog (the
  // live payload may already be filtered by this very setting).
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of catalog) {
      const cat = entry.category || "Other";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog]);

  // ── Watchlist (local stars — the ticker's source of truth) ────

  const [watchlist, setWatchlist] = useState<string[]>(() => getWatchlist());

  const unstar = useCallback((ticker: string) => {
    setWatchlist((prev) => {
      const next = withToggled(prev, ticker);
      saveWatchlist(next);
      return next;
    });
  }, []);

  // Resolve display titles: live payload first (has event_title), then
  // the catalog, then the raw ticker.
  const titleFor = useCallback(
    (ticker: string): string => {
      const live = markets.find((m) => m.ticker === ticker);
      if (live) return live.event_title || live.title || ticker;
      const entry = catalog.find((c) => c.ticker === ticker);
      return entry?.title || ticker;
    },
    [markets, catalog],
  );

  // ── One-shot pins → stars migration ───────────────────────────
  // The old Configure wrote server-side `favorites`; those pins now
  // live where every other star lives. Runs once when legacy pins
  // exist, merges them locally, clears the server slot.
  const migratedRef = useRef(false);
  useEffect(() => {
    const favorites = Array.isArray(config?.favorites)
      ? config.favorites
      : [];
    if (migratedRef.current || favorites.length === 0) return;
    migratedRef.current = true;
    const current = getWatchlist();
    const merged = Array.from(new Set([...current, ...favorites]));
    saveWatchlist(merged);
    setWatchlist(merged);
    updateFavorites([]);
    toast.success(
      `Moved ${favorites.length} pinned market${favorites.length === 1 ? "" : "s"} to your watchlist`,
      { description: "Pins and stars are one list now." },
    );
  }, [config?.favorites, updateFavorites]);

  // ── Handlers ───────────────────────────────────────────────────

  const toggleCategory = useCallback(
    (name: string) => {
      const next = new Set(selected);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      updateCategories(Array.from(next));
    },
    [selected, updateCategories],
  );

  const clearCategories = useCallback(
    () => updateCategories([]),
    [updateCategories],
  );

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-7 pt-1">
      {error && (
        <div className="shrink-0 px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-[11px] text-error flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="text-error/60 hover:text-error cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Categories: the widget's universe ─────────────────── */}
      <section className="flex flex-col gap-2">
        <h3 className="px-3 text-sm font-semibold text-fg flex items-center gap-1.5">
          <Layers size={14} className="text-fg-3" />
          Categories
        </h3>
        <p className="px-3 text-ui-meta leading-relaxed text-fg-3">
          Choose which market categories flow into this widget. Nothing
          selected means everything.
        </p>
        <div className="flex flex-wrap gap-1.5 px-3">
          <button
            type="button"
            onClick={clearCategories}
            disabled={saving}
            aria-pressed={selected.size === 0}
            className={clsx(
              "rounded-full px-3 py-1.5 text-ui-meta font-medium transition-colors cursor-pointer disabled:opacity-50",
              selected.size === 0
                ? "bg-accent/15 font-semibold text-accent"
                : "border border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
            )}
          >
            All categories
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => toggleCategory(c.name)}
              disabled={saving}
              aria-pressed={selected.has(c.name)}
              className={clsx(
                "rounded-full px-3 py-1.5 text-ui-meta font-medium transition-colors cursor-pointer disabled:opacity-50",
                selected.has(c.name)
                  ? "bg-accent/15 font-semibold text-accent"
                  : "border border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
              )}
            >
              {c.name}
              <span
                className={clsx(
                  "ml-1.5 font-mono text-ui-chip tabular-nums",
                  selected.has(c.name) ? "text-accent/70" : "text-fg-4",
                )}
              >
                {c.count}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Watchlist: curation + the ticker's source of truth ── */}
      <section className="flex flex-col gap-2">
        <h3 className="px-3 text-sm font-semibold text-fg flex items-center gap-1.5">
          <Radio size={14} className="text-fg-3" />
          Ticker & watchlist
        </h3>
        <p className="px-3 text-ui-meta leading-relaxed text-fg-3">
          Starred markets take over your ticker; with no stars it shows
          the top movers. Star from any market card — this list is just
          the management view.
        </p>
        {watchlist.length > 0 ? (
          <div className="flex flex-col gap-1 px-3">
            {watchlist.map((ticker) => (
              <div
                key={ticker}
                className="flex items-center gap-2 rounded-lg border border-edge/30 bg-base-100/40 px-2.5 py-1.5"
              >
                <Star size={12} className="shrink-0 fill-current text-amber-400" />
                <span
                  className="min-w-0 flex-1 truncate text-ui-meta text-fg-2"
                  title={titleFor(ticker)}
                >
                  {titleFor(ticker)}
                </span>
                <button
                  type="button"
                  onClick={() => unstar(ticker)}
                  aria-label={`Remove ${ticker} from watchlist`}
                  className="shrink-0 rounded-md px-2 py-0.5 text-ui-chip font-medium text-fg-4 transition-colors hover:bg-error/10 hover:text-error cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-3 flex items-center gap-2.5 rounded-lg border border-edge/30 bg-base-150/30 px-3 py-2.5 text-ui-meta text-fg-3">
            <Star size={13} className="shrink-0 text-fg-4" />
            No starred markets yet — tap the ☆ on any market card and it
            appears here and on your ticker.
          </div>
        )}
      </section>
    </div>
  );
}
