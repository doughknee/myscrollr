/**
 * Status — what's actually working right now.
 *
 * Two halves, in the order the user cares about:
 *   1. Your connection — how this app is receiving updates. Derived
 *      from the same `sse-status` Tauri event + `deliveryMode` pref
 *      the shell reads, through the same `useDeliveryHealth` hook, so
 *      this page and the TopBar indicator can't disagree.
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
import { RefreshCw } from "lucide-react";
import clsx from "clsx";
import PageLayout from "../components/layout/PageLayout";
import PageSection from "../components/layout/PageSection";
import RouteError from "../components/RouteError";
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
// sports service backs every league). So they get their own labels,
// worded the way users see them elsewhere in the app.
const SERVICE_LABELS: Record<string, string> = {
  fantasy: "Fantasy",
  finance: "Finance",
  predictions: "Kalshi",
  rss: "News",
  sports: "Sports",
};

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

  const rows: { label: string; state: string | undefined }[] = health.data
    ? [
        { label: "Database", state: health.data.database },
        { label: "Cache", state: health.data.redis },
        ...Object.entries(health.data.services)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, state]) => ({
            label: SERVICE_LABELS[id] ?? id,
            state,
          })),
      ]
    : [];

  // Core reports "degraded" when any dependency is down; a failed
  // fetch means we can't reach core at all.
  const overall = health.isError
    ? { label: "Can't reach Scrollr", tone: "error" as const }
    : !health.data
      ? { label: "Checking…", tone: "muted" as const }
      : isOk(health.data.status)
        ? { label: "All systems normal", tone: "ok" as const }
        : { label: "Some services are degraded", tone: "warning" as const };

  const deliveryTone =
    delivery.state === "live"
      ? ("ok" as const)
      : delivery.state === "polling"
        ? ("muted" as const)
        : delivery.state === "stale"
          ? ("warning" as const)
          : ("error" as const);

  return (
    <PageLayout title="Status" subtitle="Live service health">
      <PageSection
        title="Your connection"
        description="How this app is receiving updates right now."
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-1.5">
            <StatusDot tone={deliveryTone} />
          </span>
          <div className="min-w-0">
            <p className="text-ui-body font-medium">{delivery.label}</p>
            <p className="text-ui-meta text-fg-3 mt-0.5">
              {delivery.description}
            </p>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="Scrollr services"
        description="Reported by the Scrollr backend."
        sectionAction={
          <button
            onClick={() => health.refetch()}
            disabled={health.isFetching}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-ui-chip font-medium text-fg-3 hover:text-fg hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            <RefreshCw
              size={12}
              className={health.isFetching ? "animate-spin" : undefined}
            />
            Refresh
          </button>
        }
      >
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface-2/60 border border-edge/40">
          <StatusDot tone={overall.tone} />
          <span className="text-ui-body font-medium">{overall.label}</span>
        </div>

        {health.isError ? (
          <p className="mt-3 text-ui-meta text-fg-3">
            The app couldn't reach the Scrollr API. Your network or the
            service may be down — the app keeps showing the last data it
            fetched.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-edge/30">
            {rows.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between py-2"
              >
                <span className="text-ui-body text-fg-2">{row.label}</span>
                <span className="flex items-center gap-2">
                  <StatusDot tone={isOk(row.state) ? "ok" : "error"} />
                  <span
                    className={clsx(
                      "text-ui-meta font-mono uppercase tracking-wider",
                      isOk(row.state) ? "text-fg-4" : "text-error",
                    )}
                  >
                    {row.state ?? "unknown"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </PageLayout>
  );
}

// ── Dot ─────────────────────────────────────────────────────────

function StatusDot({ tone }: { tone: "ok" | "warning" | "error" | "muted" }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "shrink-0 w-1.5 h-1.5 rounded-full",
        tone === "ok"
          ? "bg-success"
          : tone === "warning"
            ? "bg-warning"
            : tone === "error"
              ? "bg-error"
              : "bg-fg-4",
      )}
    />
  );
}
