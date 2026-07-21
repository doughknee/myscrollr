/**
 * Shell context — shared state between the root layout and child routes.
 *
 * Split into two contexts for render performance:
 *   - ShellContext  (stable)  — prefs, auth, callbacks, manifests. Changes
 *     only on explicit user action. Consumed by all routes.
 *   - ShellDataContext (volatile) — widgets and dashboard data. Changes on
 *     every TanStack Query refetch / CDC event. Only consumed by routes
 *     that actually need live data (feed, ticker).
 *
 * Routes that need preferences, auth state, or shell handlers consume
 * this context via useShell(). Routes that also need live dashboard data
 * additionally call useShellData().
 */
import { createContext, useContext } from "react";
import type { AppPreferences } from "./preferences";
import type { SubscriptionTier } from "./auth";
import type { WidgetId, DataWidgetRow, SubscriptionInfo } from "./api/client";
import type { DashboardResponse } from "./types";
import type { DataWidgetManifest, WidgetManifest } from "./types";

// ── Stable context (prefs, auth, callbacks, manifests) ──────────

export interface ShellState {
  prefs: AppPreferences;
  onPrefsChange: (prefs: AppPreferences) => void;
  authenticated: boolean;
  tier: SubscriptionTier;
  subscriptionInfo: SubscriptionInfo | null;
  onLogin: () => void;
  onLogout: () => void;
  autostartEnabled: boolean;
  onAutostartChange: (enabled: boolean) => void;
  appVersion: string;

  /** All registered widget manifests (static). */
  allDataWidgetManifests: DataWidgetManifest[];
  /** All registered widget manifests (static). */
  allWidgets: WidgetManifest[];
  /** Toggle a widget's visibility on the ticker. */
  onToggleDataWidgetTicker: (widgetType: WidgetId, visible: boolean) => void;
  /** Toggle a widget's presence on the ticker. */
  onToggleWidgetTicker: (widgetId: string) => void;
  /** Add a new widget via API. */
  onAddWidget: (widgetType: WidgetId) => void;
  /** Delete a widget via API. */
  onDeleteWidget: (widgetType: WidgetId) => void;
  /** Toggle a widget on/off entirely. */
  onToggleWidget: (widgetId: string) => void;
  /** Navigate to a source by ID. */
  onSelectItem: (id: string) => void;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within RootLayout");
  return ctx;
}

// ── Volatile data context (widgets + dashboard) ────────────────

export interface ShellDataState {
  /** User's widget records from the dashboard API. */
  widgets: DataWidgetRow[];
  /** Dashboard query response (for initial data snapshots). */
  dashboard: DashboardResponse | undefined;
}

export const ShellDataContext = createContext<ShellDataState | null>(null);

export function useShellData(): ShellDataState {
  const ctx = useContext(ShellDataContext);
  if (!ctx) throw new Error("useShellData must be used within RootLayout");
  return ctx;
}
