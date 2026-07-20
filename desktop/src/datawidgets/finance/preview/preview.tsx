/**
 * Finance channel preview harness — dev-only, browser-only entry.
 *
 * Mounts the REAL FinanceFeedTab (no mocks of channel code) in a plain
 * browser with the minimum scaffolding it needs: the app stylesheet, a
 * ShellContext with STATEFUL display prefs (bar writes re-render like
 * the real shell), and a TanStack Query cache seeded once with a
 * deterministic inline fixture (queries disabled — static data; live
 * behavior is verified in Tauri).
 *
 * Mirrors channels/predictions/preview/ — see that harness for the
 * pattern rationale. Symbol ADD/REMOVE mutations are not exercised here
 * (no authenticated API in a browser); the Symbols view is asserted
 * render-only, and persistence rides the same useDataWidgetConfig hook the
 * Configure page has always used.
 */
// FIRST: evaluate the channel registry before ../FeedTab. FinanceFeedTab
// imports marketplace → registry → (eager glob) every channel FeedTab; if
// this entry starts at ../FeedTab instead, that cycle re-enters the
// half-evaluated module and throws a TDZ ReferenceError. The real app
// always evaluates the registry first — mirror it.
import "../../registry";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../style.css";
import { ShellContext, type ShellState } from "../../../shell-context";
import {
  dashboardQueryOptions,
  financeCatalogOptions,
  type TrackedSymbol,
} from "../../../api/queries";
import {
  migrateFinanceDisplay,
  type AppPreferences,
} from "../../../preferences";
import { financeDataWidget } from "../FeedTab";
import type { DataWidgetType } from "../../../api/client";
import type { FeedTabProps, Trade } from "../../../types";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") ?? "scrollr-light";
const density =
  params.get("density") === "compact" ? ("compact" as const) : ("comfort" as const);
const widgetId = params.get("widget") ?? "finance_stocks";

// ── Deterministic fixture ────────────────────────────────────────
// Fabricated inline: finance rows have no per-market nuances worth a
// snapshot file (prices are static in the harness anyway).

const CATEGORIES: [string, string[]][] = [
  ["Tech", ["AAPL", "MSFT", "GOOG", "AMZN", "META", "NVDA", "AMD", "INTC", "CRM", "ORCL"]],
  ["Auto", ["TSLA", "F", "GM", "RIVN", "TM"]],
  ["Energy", ["XOM", "CVX", "SHEL", "BP"]],
  ["Retail", ["WMT", "COST", "TGT", "HD"]],
  ["ETF", ["SPY", "QQQ", "VTI", "DIA", "IWM"]],
  ["Crypto", ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD"]],
];

const catalog: TrackedSymbol[] = CATEGORIES.flatMap(([category, symbols]) =>
  symbols.flatMap((symbol) => {
    const base = {
      symbol,
      name: `${symbol.replace("/USD", "")} ${category === "Crypto" ? "" : "Inc."}`.trim(),
      category,
    };
    // Pad the universe (~130 rows) so the feed scrolls well past the
    // viewport — the sticky-pin check needs ≥300px of travel.
    const variants = Array.from({ length: 3 }, (_, n) => ({
      ...base,
      symbol: `${symbol}${n + 2}`,
      name: `${base.name} ${n + 2}`,
    }));
    return [base, ...variants];
  }),
);

// Stable pseudo-random price/change per symbol (index-seeded, no RNG).
const trades: Trade[] = catalog.map((entry, i) => {
  const price = 20 + ((i * 37) % 400) + 0.25;
  const pct = (((i * 13) % 90) - 40) / 10; // -4.0 … +4.9, mixed signs
  return {
    id: i + 1,
    symbol: entry.symbol,
    price,
    previous_close: price - pct,
    percentage_change: pct.toFixed(2),
    direction: pct > 0 ? "up" : pct < 0 ? "down" : undefined,
    last_updated: "2026-07-17T12:00:00Z",
    link: "https://www.google.com/finance",
  };
});

const tracked = catalog
  .filter((c) => c.category !== "Crypto")
  .slice(0, 12)
  .map((c) => c.symbol);

function main(): void {
  // Queries disabled: the seeded snapshot IS the dataset.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  queryClient.setQueryData(dashboardQueryOptions().queryKey, {
    data: { finance: trades },
    channels: [
      {
        id: 1,
        channel_type: widgetId as DataWidgetType,
        enabled: true,
        ticker_enabled: true,
        created_at: "2026-07-17T00:00:00Z",
        updated_at: "2026-07-17T00:00:00Z",
        logto_sub: "preview",
        config: { symbols: tracked },
      },
    ],
  });
  queryClient.setQueryData(financeCatalogOptions().queryKey, catalog);

  const initialPrefs = {
    widgetDisplay: {
      finance: {
        ...migrateFinanceDisplay(undefined),
      },
    },
  } as unknown as AppPreferences;

  const noop = (): void => {};
  const shellBase = {
    authenticated: false,
    tier: "free",
    subscriptionInfo: null,
    onLogin: noop,
    onLogout: noop,
    autostartEnabled: false,
    onAutostartChange: noop,
    appVersion: "preview",
    allDataWidgetManifests: [],
    allWidgets: [],
    onToggleChannelTicker: noop,
    onToggleWidgetTicker: noop,
    onAddChannel: noop,
    onDeleteChannel: noop,
    onToggleWidget: noop,
    onSelectItem: noop,
  };

  const feedContext = {
    __hasConfig: true,
    __dashboardLoaded: true,
    __refreshing: false,
  } as FeedTabProps["feedContext"];

  const FeedTab = financeDataWidget.FeedTab;

  function Harness() {
    const [prefs, setPrefs] = useState<AppPreferences>(initialPrefs);
    const shell = {
      ...shellBase,
      prefs,
      onPrefsChange: setPrefs,
    } as unknown as ShellState;
    return (
      <QueryClientProvider client={queryClient}>
        <ShellContext.Provider value={shell}>
          {/* Page-scroll like the app: PageLayout's feed mode scrolls the
              PAGE, not the FeedTab (sticky pins against this scroller). */}
          <div
            id="app-shell"
            data-theme={theme}
            className="h-screen overflow-y-auto scrollbar-thin bg-surface text-fg font-sans"
          >
            <FeedTab
              mode={density}
              feedContext={feedContext}
              widgetId={widgetId}
            />
          </div>
        </ShellContext.Provider>
      </QueryClientProvider>
    );
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}

main();
