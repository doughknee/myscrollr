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
import { StrictMode } from "react";
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

function main(): void {
  const predictions = fixture as unknown as Prediction[];

  // Queries disabled: the seeded snapshot IS the dataset. Keeps screenshots
  // deterministic and avoids the authenticated /dashboard path entirely.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  queryClient.setQueryData(dashboardQueryOptions().queryKey, {
    data: { predictions },
  });
  queryClient.setQueryData(predictionsCatalogOptions().queryKey, []);

  const prefs = {
    channelDisplay: {
      predictions: {
        ...migratePredictionsDisplay(undefined),
        feedDensity: density,
      },
    },
  } as unknown as AppPreferences;

  const noop = (): void => {};
  const shell = {
    prefs,
    onPrefsChange: noop,
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
  } as unknown as ShellState;

  const feedContext = {
    __hasConfig: true,
    __dashboardLoaded: true,
    __refreshing: false,
  } as FeedTabProps["feedContext"];

  const FeedTab = predictionsChannel.FeedTab;

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ShellContext.Provider value={shell}>
          <div
            id="app-shell"
            data-theme={theme}
            className="h-screen overflow-hidden bg-surface text-fg font-sans"
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
    </StrictMode>,
  );
}

main();
