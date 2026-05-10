import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import SymbolManager from "./SymbolManager";
import { useChannelConfig } from "../../hooks/useChannelConfig";
import { financeCatalogOptions, dashboardQueryOptions } from "../../api/queries";
import { getLimit } from "../../tierLimits";
import type { Channel } from "../../api/client";
import type { Trade } from "../../types";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface FinanceConfigPanelProps {
  channel: Channel;
  subscriptionTier: SubscriptionTier;
  hex: string;
}

interface FinanceChannelConfig {
  symbols?: string[];
}

// ── Component ────────────────────────────────────────────────────

export default function FinanceConfigPanel({
  channel,
  subscriptionTier,
}: FinanceConfigPanelProps) {
  const { error, setError, saving, updateItems } =
    useChannelConfig<string[]>("finance", "symbols");

  const config = channel.config as FinanceChannelConfig;
  const symbols = Array.isArray(config?.symbols) ? config.symbols : [];
  const symbolSet = useMemo(() => new Set(symbols), [symbols]);
  const maxSymbols = getLimit(subscriptionTier, "symbols");

  // ── Queries ────────────────────────────────────────────────────

  const {
    data: catalog = [],
    isLoading: catalogLoading,
    isError: catalogError,
  } = useQuery(financeCatalogOptions());

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const trades = useMemo(
    () => (dashboard?.data?.finance as Trade[] | undefined) ?? [],
    [dashboard?.data?.finance],
  );

  // ── Handlers ───────────────────────────────────────────────────

  const addSymbol = useCallback(
    (sym: string) => {
      if (symbolSet.has(sym)) return;
      if (symbols.length >= maxSymbols) return;
      updateItems([...symbols, sym]);
    },
    [symbols, symbolSet, updateItems, maxSymbols],
  );

  const removeSymbol = useCallback(
    (sym: string) => {
      updateItems(symbols.filter((s) => s !== sym));
    },
    [symbols, updateItems],
  );

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 pb-8">
      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-[11px] text-error flex items-center justify-between">
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

      {/* Unified watchlist + catalog manager */}
      <SymbolManager
        symbols={symbols}
        catalog={catalog}
        trades={trades}
        onAdd={addSymbol}
        onRemove={removeSymbol}
        loading={catalogLoading}
        error={catalogError}
        maxSymbols={maxSymbols}
        subscriptionTier={subscriptionTier}
        saving={saving}
      />
    </div>
  );
}
