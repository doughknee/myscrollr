/**
 * Status — what's actually working right now.
 *
 * Two halves, in the order the user cares about:
 *   1. Your connection — how this app is receiving updates. Derived
 *      from the same `sse-status` Tauri event + `deliveryMode` pref
 *      the shell reads, through the same `useDeliveryHealth` hook and
 *      the same DELIVERY_STATE_META icon language as the TopBar
 *      indicator, so the two can't disagree in state OR looks.
 *   2. Scrollr services — the backend's own view, straight from the
 *      public GET /health (database, cache, and each data service).
 *
 * Reached by clicking the connection indicator in the TopBar. That
 * indicator is deliberately terse; the detail it used to cram into a
 * tooltip lives here instead.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Layers,
  Newspaper,
  RefreshCw,
  Trophy,
  TrendingUp,
  Volleyball,
  WifiOff,
  Box,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import PageLayout from "../components/layout/PageLayout";
import PageSection from "../components/layout/PageSection";
import RouteError from "../components/RouteError";
import { DELIVERY_STATE_META } from "../components/ConnectionIndicator";
import { fetchHealth } from "../api/client";
import { loadPref } from "../preferences";
import { useTauriListener } from "../hooks/useTauriListener";
import { useDeliveryHealth } from "../hooks/useDeliveryHealth";
import type { DeliveryMode } from "../types";

export const Route = createFileRoute("/status")({
  component: StatusPage,
  errorComponent: RouteError,
});

/** "healthy" is the only good state core reports. */
const isOk = (s: string | undefined) => s === "healthy";

// Health keys are BACKEND SERVICE names, which don't map onto catalog
// widgets (one finance service backs both Stocks and Crypto; one
// sports service backs every league). So they get their own labels +
// icons, worded the way users see them elsewhere in the app.
const SERVICE_META: Record<string, { label: string; icon: LucideIcon }> = {
  database: { label: "Database", icon: Database },
  redis: { label: "Cache", icon: Layers },
  fantasy: { label: "Fantasy", icon: Trophy },
  finance: { label: "Finance", icon: TrendingUp },
  predictions: { label: "Kalshi", icon: BarChart3 },
  rss: { label: "News", icon: Newspaper },
  sports: { label: "Sports", icon: Volleyball },
};

/** "4s ago" / "2 min ago" — for data-age and checked-at metas. */
function ago(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return `${Math.round(sec / 60)} min ago`;
}

function StatusPage() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    // Live view — refresh while the page is open. /health is cheap
    // (core probes its own deps) and this only runs on-route.
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: false,
  });

  // Same inputs as the shell: seed from the persisted mode, then
  // follow the SSE status broadcast.
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(() =>
    loadPref<DeliveryMode>("deliveryMode", "polling"),
  );
  useTauriListener<{ status: string }>("sse-status", (event) => {
    setDeliveryMode(event.payload.status === "connected" ? "sse" : "polling");
  });
  const delivery = useDeliveryHealth({ deliveryMode });
  const deliveryMeta = DELIVERY_STATE_META[delivery.state];
  const DeliveryIcon = deliveryMeta.icon;

  const rows = health.data
    ? [
        { key: "database", state: health.data.database },
        { key: "redis", state: health.data.redis },
        ...Object.entries(health.data.services)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, state]) => ({ key, state })),
      ]
    : [];

  // Core reports "degraded" when any dependency is down; a failed
  // fetch means we can't reach core at all.
  const overall = health.isError
    ? {
        label: "Can't reach Scrollr",
        detail:
          "Your network or the service may be down — the app keeps showing the last data it fetched.",
        icon: WifiOff,
        cls: "bg-error/10 border-error/20 text-error",
      }
    : !health.data
      ? {
          label: "Checking…",
          detail: "Asking the backend how it's doing.",
          icon: RefreshCw,
          cls: "bg-surface-2/60 border-edge/40 text-fg-3",
        }
      : isOk(health.data.status)
        ? {
            label: "All systems normal",
            detail: "Every service is reporting healthy.",
            icon: CheckCircle2,
            cls: "bg-success/10 border-success/20 text-success",
          }
        : {
            label: "Some services are degraded",
            detail:
              "Affected feeds pause until the service recovers — everything else keeps flowing.",
            icon: AlertTriangle,
            cls: "bg-warning/10 border-warning/20 text-warning",
          };
  const OverallIcon = overall.icon;

  return (
    <PageLayout title="Status" subtitle="Live service health">
      {/* ── Your connection ─────────────────────────────────── */}
      <PageSection
        title="Your connection"
        description="How this app is receiving updates right now."
      >
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
              deliveryMeta.bg,
              deliveryMeta.text,
            )}
          >
            <DeliveryIcon size={16} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <p className="text-ui-body font-semibold text-fg">
              {delivery.state === "live"
                ? "Realtime stream"
                : delivery.state === "polling"
                  ? "Polling fallback"
                  : delivery.label}
            </p>
            <p className="text-ui-meta text-fg-3 mt-0.5">
              {delivery.description}
            </p>
          </div>
          {delivery.ageMs != null && (
            <span className="ml-auto shrink-0 text-ui-meta text-fg-4">
              Data updated {ago(delivery.ageMs)}
            </span>
          )}
        </div>
      </PageSection>

      {/* ── Backend services ────────────────────────────────── */}
      <PageSection
        title="Scrollr services"
        description="Reported by the Scrollr backend."
        sectionAction={
          <div className="flex items-center gap-2">
            {health.dataUpdatedAt > 0 && (
              <span className="text-ui-meta text-fg-4">
                Checked {ago(Date.now() - health.dataUpdatedAt)}
              </span>
            )}
            <button
              onClick={() => health.refetch()}
              disabled={health.isFetching}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-ui-chip font-medium text-fg-3 hover:text-fg hover:bg-surface-hover disabled:opacity-50"
            >
              <RefreshCw
                size={12}
              />
              Refresh
            </button>
          </div>
        }
      >
        <div
          className={clsx(
            "flex items-center gap-3 px-3 py-3 rounded-lg border",
            overall.cls,
          )}
        >
          <OverallIcon
            size={16}
            strokeWidth={2.2}
            className={clsx(
              "shrink-0",
            )}
          />
          <div className="min-w-0">
            <p className="text-ui-body font-semibold">{overall.label}</p>
            <p className="text-ui-meta opacity-75 mt-0.5">{overall.detail}</p>
          </div>
        </div>

        {rows.length > 0 && (
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {rows.map((row) => {
              const meta = SERVICE_META[row.key] ?? {
                label: row.key,
                icon: Box,
              };
              const RowIcon = meta.icon;
              const ok = isOk(row.state);
              return (
                <li
                  key={row.key}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-2/60 border border-edge/40"
                >
                  <RowIcon size={14} className="shrink-0 text-fg-3" />
                  <span className="flex-1 min-w-0 truncate text-ui-body text-fg-2">
                    {meta.label}
                  </span>
                  <span
                    className={clsx(
                      "flex items-center gap-1.5 h-5 px-2 rounded-full text-ui-chip font-medium shrink-0",
                      ok
                        ? "bg-success/10 text-success"
                        : "bg-error/10 text-error",
                    )}
                  >
                    <span
                      aria-hidden
                      className={clsx(
                        "w-1 h-1 rounded-full",
                        ok ? "bg-success" : "bg-error",
                      )}
                    />
                    {ok
                      ? "Healthy"
                      : row.state
                        ? row.state.charAt(0).toUpperCase() + row.state.slice(1)
                        : "Unknown"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>
    </PageLayout>
  );
}
