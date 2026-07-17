/**
 * Kalshi channel preview harness — dev-only, browser-only entry.
 *
 * Mounts the REAL PredictionsFeedTab (no mocks of channel code) in a plain
 * browser with the minimum scaffolding the component needs:
 *   - the app stylesheet + a themed #app-shell wrapper (tokens attach to
 *     `#app-shell[data-theme]`),
 *   - a ShellContext with display prefs,
 *   - a TanStack Query cache seeded ONCE from the local predictions API
 *     (queries disabled — static data; live behavior is verified in Tauri).
 *
 * No Tauri APIs are exercised: `isKalshiAvailable()` is false in a browser,
 * and the pref store falls back gracefully. See index.html for usage.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../style.css";
import { ShellContext, type ShellState } from "../../../shell-context";
import {
  dashboardQueryOptions,
  predictionsCatalogOptions,
} from "../../../api/queries";
import {
  migratePredictionsDisplay,
  type AppPreferences,
} from "../../../preferences";
import { predictionsChannel } from "../FeedTab";
import type { FeedTabProps, Prediction } from "../../../types";
// Static snapshot of the local predictions API (:8085 has no CORS; the
// fixture keeps screenshots deterministic anyway). Refresh with:
//   curl -s http://localhost:8085/predictions > desktop/src/channels/predictions/preview/fixture.json
import fixture from "./fixture.json";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") ?? "scrollr-light";
const density =
  params.get("density") === "compact" ? ("compact" as const) : ("comfort" as const);
/** `?demo=1`: inject synthetic start_times, a >2-leg event and a candles
 *  fetch shim so the LIVE badge, "Starts in" countdown, "+N more" and the
 *  history chart are photographable — states today's payload can't produce
 *  (see ui-review/NOTES.md, B3 + shared-code log). Dev harness only. */
const demo = params.get("demo") === "1";

// ── Tauri bridge mock (harness-only) ─────────────────────────────
// Makes `isKalshiAvailable()` true in the browser so the Markets/Positions
// switcher renders and the My Positions panel is drivable with a mocked
// open-position portfolio (A2 verification). Unknown commands reject —
// every channel caller already tolerates that.
function installTauriMock(predictions: Prediction[]): void {
  const lead = predictions[0];
  const second =
    predictions.find(
      (p) => p.ticker !== lead?.ticker && p.event_ticker !== lead?.event_ticker,
    ) ?? lead;
  const portfolio = {
    balance_cents: 148_250,
    positions: [
      {
        ticker: lead?.ticker ?? "DEMO-T1",
        position: 15,
        side: "yes",
        count: 15,
        exposure_cents: 15 * Math.max(1, (lead?.yes_price ?? 47) - 3),
        realized_pnl_cents: 0,
        total_traded_cents: 705,
        fees_paid_cents: 7,
        resting_orders_count: 0,
      },
      {
        ticker: second?.ticker ?? "DEMO-T2",
        position: -4,
        side: "no",
        count: 4,
        exposure_cents: 4 * Math.max(1, 100 - (second?.yes_price ?? 58) - 2),
        realized_pnl_cents: 120,
        total_traded_cents: 168,
        fees_paid_cents: 2,
        resting_orders_count: 1,
      },
    ],
    fills: [
      {
        ticker: lead?.ticker ?? "DEMO-T1",
        side: "yes",
        action: "buy",
        count: 15,
        price_cents: Math.max(1, (lead?.yes_price ?? 47) - 3),
        is_taker: true,
        created_time: new Date(Date.now() - 42 * 60_000).toISOString(),
      },
      {
        ticker: second?.ticker ?? "DEMO-T2",
        side: "no",
        action: "buy",
        count: 4,
        price_cents: Math.max(1, 100 - (second?.yes_price ?? 58) - 2),
        is_taker: false,
        created_time: new Date(Date.now() - 3 * 3600_000).toISOString(),
      },
    ],
    resting_orders: [
      {
        ticker: second?.ticker ?? "DEMO-T2",
        side: "no",
        action: "buy",
        price_cents: 35,
        remaining_count: 6,
        created_time: new Date(Date.now() - 60 * 60_000).toISOString(),
      },
    ],
  };

  const commands: Record<string, () => unknown> = {
    kalshi_status: () => ({ connected: true, key_id: "DEMO-KEY", env: "demo" }),
    kalshi_portfolio: () => portfolio,
    kalshi_start_user_stream: () => undefined,
    kalshi_stop_user_stream: () => undefined,
    kalshi_disconnect: () => undefined,
    "plugin:shell|open": () => undefined,
  };

  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    // @tauri-apps/api v2 entry points used by the channel.
    invoke: (cmd: string) =>
      cmd in commands
        ? Promise.resolve(commands[cmd]())
        : Promise.reject(new Error(`mock: unhandled command ${cmd}`)),
    transformCallback: () => 0,
    metadata: { currentWindow: { label: "preview" }, currentWebview: { label: "preview" } },
  };
}

// ── Demo-state injection (?demo=1) ───────────────────────────────

function injectDemoStates(predictions: Prediction[]): Prediction[] {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const rows = predictions.map((p) => ({ ...p })) as (Prediction & {
    start_time?: string;
  })[];

  // Group indices per event, in payload order.
  const byEvent = new Map<string, number[]>();
  rows.forEach((p, i) => {
    const key = p.event_ticker || p.ticker;
    byEvent.set(key, [...(byEvent.get(key) ?? []), i]);
  });
  const twoLeg = [...byEvent.values()].filter((idx) => idx.length === 2);

  // 1. LIVE: first two-leg event — started 30m ago, closes in 3h.
  if (twoLeg[0]) {
    for (const i of twoLeg[0]) {
      rows[i].start_time = iso(-30 * 60_000);
      rows[i].close_time = iso(3 * 3600_000);
    }
  }
  // 2. Starts soon: second two-leg event — starts in 3h.
  if (twoLeg[1]) {
    for (const i of twoLeg[1]) {
      rows[i].start_time = iso(3 * 3600_000);
      rows[i].close_time = iso(2 * 24 * 3600_000);
    }
  }
  // 3. Multi-outcome: third two-leg event gains two synthetic legs so the
  //    card truncates ("+2 more") and the detail lists all four by price.
  if (twoLeg[2]) {
    const [a] = twoLeg[2];
    const base = rows[a];
    const clone = (n: number, title: string, price: number): Prediction & {
      start_time?: string;
    } => ({
      ...base,
      id: `${base.id}-demo${n}`,
      ticker: `${base.ticker}-DEMO${n}`,
      title,
      subtitle: title,
      yes_price: price,
      prev_yes_price: price - (n === 3 ? 2 : -1),
      event_rank: 2 + n,
    });
    rows.push(clone(3, "Field (any other)", 9), clone(4, "No winner declared", 4));
  }
  return rows;
}

/** Real-shape candles (matching the probed Kalshi payload) for the demo:
 *  seeded straight into the query cache per ticker, since the real fetch
 *  needs the authed prod API the browser harness doesn't have. */
function demoCandles(): { candlesticks: unknown[] } {
  const nowSec = Math.floor(Date.now() / 1000);
  const candlesticks = Array.from({ length: 168 }, (_, i) => {
    const t = nowSec - (168 - i) * 3600;
    const v = 0.47 + 0.13 * Math.sin(i / 14) + 0.04 * Math.sin(i / 3.1);
    return {
      end_period_ts: t,
      price: { close_dollars: v.toFixed(4), mean_dollars: v.toFixed(4) },
      volume_fp: "12.00",
    };
  });
  return { candlesticks };
}

function main(): void {
  let predictions = fixture as unknown as Prediction[];
  if (demo) {
    predictions = injectDemoStates(predictions);
  }
  installTauriMock(predictions);

  // Queries disabled: the seeded snapshot IS the dataset. Keeps screenshots
  // deterministic and avoids the authenticated /dashboard path entirely.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  queryClient.setQueryData(dashboardQueryOptions().queryKey, {
    data: { predictions },
  });
  queryClient.setQueryData(predictionsCatalogOptions().queryKey, []);
  if (demo) {
    // Pre-fill the per-ticker candlesticks cache so the detail chart
    // renders (staleTime keeps the seeded data fresh; no fetch fires).
    for (const p of predictions) {
      queryClient.setQueryData(["predictions-candlesticks", p.ticker], demoCandles());
    }
  }

  const initialPrefs = {
    channelDisplay: {
      predictions: {
        ...migratePredictionsDisplay(undefined),
        feedDensity: density,
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
    allChannelManifests: [],
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

  const FeedTab = predictionsChannel.FeedTab;

  // Prefs are STATE so the in-widget gear popover's writes re-render the
  // feed like the real shell (persistence itself is Tauri-only).
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
              PAGE, not the FeedTab — the harness must mirror that or
              sticky bugs hide (they did; see NOTES.md). */}
          <div
            id="app-shell"
            data-theme={theme}
            className="h-screen overflow-y-auto scrollbar-thin bg-surface text-fg font-sans"
          >
            <FeedTab
              mode={density}
              feedContext={feedContext}
              onConfigure={noop}
              widgetId="predictions"
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
