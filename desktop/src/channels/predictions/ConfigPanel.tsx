/**
 * Predictions ConfigPanel — v1.1.5 "Kalshi Cleans Up".
 *
 * ONE simple page, all client-side:
 *   1. Watchlist — manage your starred markets (the only personalization).
 *   2. Ticker — what the ticker shows when nothing is starred.
 *   3. Display — per-element visibility (feed/ticker) + feed density.
 *
 * Server-side channel config is RETIRED: the old `config.categories`
 * universe filter and the hidden `config.favorites` watchlist mirror are
 * gone. The payload is the full curated set for everyone, so there is
 * nothing left for server config to do. A one-time migration imports any
 * legacy favorites into the local watchlist and clears both keys in a
 * single write (clearing `categories` is required — a lingering server
 * filter would silently hide markets from the new all-client UI).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Radio, Eye } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { channelsApi } from "../../api/client";
import {
  predictionsCatalogOptions,
  dashboardQueryOptions,
} from "../../api/queries";
import DisplayItemsGrid from "../../components/settings/DisplayItemsGrid";
import { useShell } from "../../shell-context";
import {
  getWatchlist,
  saveWatchlist,
  withToggled,
} from "./watchlist";
import type { Channel } from "../../api/client";
import type { Prediction } from "../../types";
import type { SubscriptionTier } from "../../auth";
import type { PredictionsDisplayPrefs } from "../../preferences";

// ── Types ────────────────────────────────────────────────────────

interface PredictionsConfigPanelProps {
  channel: Channel;
  subscriptionTier: SubscriptionTier;
  hex: string;
}

interface LegacyPredictionsConfig {
  categories?: string[];
  favorites?: string[];
}

/** Ticker fallback choices — mirrors PredictionsDisplayPrefs.defaultSort
 *  minus "alpha" (nobody wants an alphabetical ticker rail). */
const TICKER_FALLBACKS: {
  value: PredictionsDisplayPrefs["defaultSort"];
  label: string;
  hint: string;
}[] = [
  { value: "trending", label: "Trending", hint: "hottest by 24h volume" },
  { value: "movers", label: "Movers", hint: "biggest probability swings" },
  { value: "closing", label: "Closing soon", hint: "nearest to close" },
];

// ── Component ────────────────────────────────────────────────────

export default function PredictionsConfigPanel({
  channel,
}: PredictionsConfigPanelProps) {
  const { prefs, onPrefsChange } = useShell();
  const dp = prefs.channelDisplay.predictions;
  const queryClient = useQueryClient();

  const patchDisplay = useCallback(
    (patch: Partial<PredictionsDisplayPrefs>) => {
      onPrefsChange({
        ...prefs,
        channelDisplay: {
          ...prefs.channelDisplay,
          predictions: { ...prefs.channelDisplay.predictions, ...patch },
        },
      });
    },
    [prefs, onPrefsChange],
  );

  // ── Queries (titles for the watchlist rows) ────────────────────

  const { data: catalog = [] } = useQuery(predictionsCatalogOptions());
  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const markets = useMemo(
    () => (dashboard?.data?.predictions as Prediction[] | undefined) ?? [],
    [dashboard?.data?.predictions],
  );

  // ── Watchlist (local stars — the ONLY personalization) ────────

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

  /** A starred ticker with no live row left the curated set — its price
   *  is frozen, so the feed/ticker no longer show it. Label it here so
   *  the watchlist stays legible instead of silently shrinking. */
  const isTracked = useCallback(
    (ticker: string): boolean => markets.some((m) => m.ticker === ticker),
    [markets],
  );

  // ── One-time legacy config migration (v1.1.5) ─────────────────
  // Pre-v1.1.5 configs carried `categories` (server-side universe filter)
  // and `favorites` (hidden watchlist mirror). Import favorites into the
  // local stars, then clear BOTH keys in one write so the server stops
  // narrowing this user's payload.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;

    const config = (channel.config ?? {}) as LegacyPredictionsConfig;
    const favorites = Array.isArray(config.favorites) ? config.favorites : [];
    const categories = Array.isArray(config.categories) ? config.categories : [];
    if (favorites.length === 0 && categories.length === 0) return;

    // 1) Absorb legacy pins/mirror into the local watchlist.
    if (favorites.length > 0) {
      const current = getWatchlist();
      const merged = Array.from(new Set([...current, ...favorites]));
      const imported = merged.length - current.length;
      if (imported > 0) {
        saveWatchlist(merged);
        setWatchlist(merged);
        toast.success(
          `Moved ${imported} pinned market${imported === 1 ? "" : "s"} to your watchlist`,
          { description: "Stars are the one list now — managed right here." },
        );
      }
    }

    // 2) Clear both legacy keys in a single write (two racing updates
    //    would each send a stale merged config and resurrect the other
    //    key). The API keeps honoring these fields for old clients; this
    //    client simply stops using them.
    void channelsApi
      .update(channel.channel_type, {
        config: { ...(channel.config ?? {}), categories: [], favorites: [] },
      })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .catch(() => {
        // Non-fatal: the server filter just lingers until the next visit
        // retries. The panel itself is fully functional either way.
        migratedRef.current = false;
      });
  }, [channel.config, channel.channel_type, queryClient]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-7 pt-1">
      {/* ── Watchlist: the one personalization ─────────────────── */}
      <section className="flex flex-col gap-2">
        <h3 className="px-3 text-sm font-semibold text-fg flex items-center gap-1.5">
          <Star size={14} className="text-fg-3" />
          Watchlist
        </h3>
        <p className="px-3 text-ui-meta leading-relaxed text-fg-3">
          Star markets from any card — they take over your ticker and get
          their own feed lens. Markets stay while they're among Scrollr's
          top markets; settled ones show in "Resolved today" for a day.
        </p>
        {watchlist.length > 0 ? (
          <div className="flex flex-col gap-1 px-3">
            {watchlist.map((ticker) => {
              const tracked = isTracked(ticker);
              return (
                <div
                  key={ticker}
                  className="flex items-center gap-2 rounded-lg border border-edge/30 bg-base-100/40 px-2.5 py-1.5"
                >
                  <Star
                    size={12}
                    className={clsx(
                      "shrink-0 fill-current",
                      tracked ? "text-amber-400" : "text-fg-4",
                    )}
                  />
                  <span
                    className={clsx(
                      "min-w-0 flex-1 truncate text-ui-meta",
                      tracked ? "text-fg-2" : "text-fg-4",
                    )}
                    title={titleFor(ticker)}
                  >
                    {titleFor(ticker)}
                  </span>
                  {!tracked && (
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-fg-4">
                      no longer tracked
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => unstar(ticker)}
                    aria-label={`Remove ${ticker} from watchlist`}
                    className="shrink-0 rounded-md px-2 py-0.5 text-ui-chip font-medium text-fg-4 transition-colors hover:bg-error/10 hover:text-error cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mx-3 flex items-center gap-2.5 rounded-lg border border-edge/30 bg-base-150/30 px-3 py-2.5 text-ui-meta text-fg-3">
            <Star size={13} className="shrink-0 text-fg-4" />
            No starred markets yet — tap the ☆ on any market card and it
            appears here and on your ticker.
          </div>
        )}
      </section>

      {/* ── Ticker: no-stars fallback ───────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h3 className="px-3 text-sm font-semibold text-fg flex items-center gap-1.5">
          <Radio size={14} className="text-fg-3" />
          Ticker
        </h3>
        <p className="px-3 text-ui-meta leading-relaxed text-fg-3">
          With no stars, the ticker shows the top 15 markets by:
        </p>
        <div className="flex flex-wrap gap-1.5 px-3">
          {TICKER_FALLBACKS.map((opt) => {
            const active = (dp.defaultSort ?? "trending") === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => patchDisplay({ defaultSort: opt.value })}
                aria-pressed={active}
                title={opt.hint}
                className={clsx(
                  "rounded-full px-3 py-1.5 text-ui-meta font-medium transition-colors cursor-pointer",
                  active
                    ? "bg-accent/15 font-semibold text-accent"
                    : "border border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Display: visibility + density ───────────────────────── */}
      <section className="flex flex-col gap-2">
        <h3 className="px-3 text-sm font-semibold text-fg flex items-center gap-1.5">
          <Eye size={14} className="text-fg-3" />
          Display
        </h3>
        <div className="px-3">
          <DisplayItemsGrid
            sections={[
              {
                rows: [
                  {
                    key: "showDelta",
                    label: "Probability delta",
                    description: "▲/▼ move vs the previous price",
                    value: dp.showDelta,
                  },
                  {
                    key: "showCategory",
                    label: "Category badge",
                    description: "Politics, Sports, Economics, …",
                    value: dp.showCategory,
                  },
                  {
                    key: "showVolume",
                    label: "Volume",
                    description: "Trailing-24h contract volume",
                    value: dp.showVolume,
                  },
                  {
                    key: "showCloseTime",
                    label: "Close countdown",
                    description: "Time until the market closes",
                    value: dp.showCloseTime,
                  },
                ],
              },
            ]}
            onChange={(changes) =>
              patchDisplay(changes as Partial<PredictionsDisplayPrefs>)
            }
          />
        </div>
        <div className="flex items-center gap-2 px-3 pt-1">
          <span className="text-ui-meta text-fg-3">Feed density</span>
          <div className="flex gap-1">
            {(["comfort", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => patchDisplay({ feedDensity: d })}
                aria-pressed={dp.feedDensity === d}
                className={clsx(
                  "rounded-full px-3 py-1 text-ui-meta font-medium capitalize transition-colors cursor-pointer",
                  dp.feedDensity === d
                    ? "bg-accent/15 font-semibold text-accent"
                    : "border border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
