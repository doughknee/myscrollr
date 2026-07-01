import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import SymbolManager from "./SymbolManager";
import { useChannelConfig } from "../../hooks/useChannelConfig";
import { financeCatalogOptions, dashboardQueryOptions } from "../../api/queries";
import { getLimit } from "../../tierLimits";
import { assetClassForWidget } from "../../marketplace";
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
  const channelType = channel.channel_type;
  const assetClass = assetClassForWidget(channelType);
  const { error, setError, saving, updateItems } =
    useChannelConfig<string[]>(channelType, "symbols");

  const config = channel.config as FinanceChannelConfig;
  const symbols = Array.isArray(config?.symbols) ? config.symbols : [];
  const symbolSet = useMemo(() => new Set(symbols), [symbols]);
  const maxSymbols = getLimit(subscriptionTier, "symbols");

  // ── Queries ────────────────────────────────────────────────────

  const {
    data: fullCatalog = [],
    isLoading: catalogLoading,
    isError: catalogError,
  } = useQuery(financeCatalogOptions());

  // Scope the picker to this widget's asset class — the "Crypto" category for
  // the crypto widget, everything else for stocks — so Stocks and Crypto stop
  // sharing one mixed list (and you can't add crypto to Stocks).
  const catalog = useMemo(() => {
    if (!assetClass) return fullCatalog;
    return fullCatalog.filter((item) =>
      assetClass === "crypto"
        ? item.category === "Crypto"
        : item.category !== "Crypto",
    );
  }, [fullCatalog, assetClass]);

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
    // Fill-height column. The SymbolManager inside claims the
    // remaining height after the optional error banner and scrolls
    // its list internally — see PageLayout `fillHeight` mode.
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

      {/* Unified watchlist + catalog manager — fills remaining height */}
      <div className="flex-1 min-h-0">
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
    </div>
  );
}
