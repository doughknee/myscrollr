import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import CategoryPicker from "./CategoryPicker";
import { useChannelConfig } from "../../hooks/useChannelConfig";
import { predictionsCatalogOptions, dashboardQueryOptions } from "../../api/queries";
import { getLimit } from "../../tierLimits";
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
  subscriptionTier,
}: PredictionsConfigPanelProps) {
  const { error, setError, saving, updateItems } =
    useChannelConfig<string[]>("predictions", "favorites");

  const config = channel.config as PredictionsChannelConfig;
  const favorites = Array.isArray(config?.favorites) ? config.favorites : [];
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  // Reuse the existing `symbols` tier cap for the pinned-markets limit —
  // predictions does not introduce its own tier-limit field in v1.
  const max = getLimit(subscriptionTier, "symbols");

  // ── Queries ────────────────────────────────────────────────────

  const {
    data: catalog = [],
    isLoading: catalogLoading,
    isError: catalogError,
  } = useQuery(predictionsCatalogOptions());

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const markets = useMemo(
    () => (dashboard?.data?.predictions as Prediction[] | undefined) ?? [],
    [dashboard?.data?.predictions],
  );

  // ── Handlers ───────────────────────────────────────────────────

  const addMarket = useCallback(
    (ticker: string) => {
      if (favoriteSet.has(ticker)) return;
      if (favorites.length >= max) return;
      updateItems([...favorites, ticker]);
    },
    [favorites, favoriteSet, updateItems, max],
  );

  const removeMarket = useCallback(
    (ticker: string) => {
      updateItems(favorites.filter((t) => t !== ticker));
    },
    [favorites, updateItems],
  );

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto h-full flex flex-col min-h-0 gap-3 pt-1">
      {/* Error banner */}
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

      {/* Unified favorites + catalog manager — fills remaining height */}
      <div className="flex-1 min-h-0">
        <CategoryPicker
          favorites={favorites}
          catalog={catalog}
          markets={markets}
          onAdd={addMarket}
          onRemove={removeMarket}
          loading={catalogLoading}
          error={catalogError}
          max={max}
          subscriptionTier={subscriptionTier}
          saving={saving}
        />
      </div>
    </div>
  );
}
