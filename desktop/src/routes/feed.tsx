/**
 * Home route — live status dashboard.
 *
 * Shows a glanceable overview of live data from each active widget,
 * plus a compact widget status strip. Discovery and add/remove happen
 * in the Catalog (/catalog), not here.
 */
import { useMemo, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import RouteError from "../components/RouteError";
import { WidgetBar, BarPill } from "../components/widget-bar/Bar";
import SectionNav from "../components/layout/SectionNav";
import { FEED_CARD, FEED_CARD_INTERACTIVE } from "../components/feedCard";
import PageLayout from "../components/layout/PageLayout";
import EmptySection from "../components/layout/EmptySection";
import { useShell, useShellData } from "../shell-context";
import { useCatalog } from "../hooks/useCatalog";
import { widgetManifest, sourceForWidget, canonicalOrder } from "../marketplace";
import { scopeSourceData } from "../utils/widgetScope";
import { WIDGET_ORDER } from "../widgets/registry";
import { getStore } from "../lib/store";
import { formatTemp, weatherCodeToIcon } from "../widgets/weather/types";
import { loadMonitors } from "../widgets/uptime/types";
import { loadRepoData } from "../widgets/github/types";
import {
  LS_CLOCK_FORMAT,
  LS_TIMER_STATE,
  LS_WEATHER_CITIES,
  LS_WEATHER_UNIT,
  LS_SYSMON_DATA,
} from "../constants";
import {
  formatEffectiveWidgetTickerStatus,
  getEffectiveWidgetTickerStatus,
} from "../utils/tickerStatus";
import type { DataWidgetRow } from "../api/client";
import type { DataWidgetManifest, WidgetManifest } from "../types";
import type { TempUnit } from "../preferences";
import type { SystemInfo } from "../hooks/useSysmonData";
import type { TimerState } from "../widgets/timer/types";
import type { SavedCity } from "../widgets/weather/types";

function formatTimerDuration(ms: number): string {
  const totalSecs = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getTimerValue(): string {
  const state = getStore<TimerState | null>(LS_TIMER_STATE, null);
  if (!state) return "Idle";

  const elapsed = state.startedAt == null
    ? state.bankedMs
    : state.bankedMs + (Date.now() - state.startedAt);

  if (state.startedAt == null && elapsed <= 0) return "Idle";

  const ms = state.mode === "stopwatch"
    ? elapsed
    : Math.max(0, state.targetSecs * 1000 - elapsed);

  return formatTimerDuration(ms);
}

// ── Route ───────────────────────────────────────────────────────

export const Route = createFileRoute("/feed")({
  component: HomePage,
  errorComponent: RouteError,
});

function HomePage() {
  const navigate = useNavigate();
  const shell = useShell();
  const { widgets, dashboard } = useShellData();
  // Sort order comes from the catalog, so the memo below must re-run when it
  // changes — otherwise a server-added widget sorts by a stale index.
  const catalogVersion = useCatalog();
  const {
    allDataWidgetManifests,
    allWidgets,
    authenticated,
    onLogin,
  } = shell;

  const enabledWidgets = shell.prefs.widgets.enabledWidgets;


  const openTickerSettings = useCallback(() => {
    navigate({ to: "/customize" });
  }, [navigate]);

  // Resolve each enabled widget row to a render manifest — the coarse source's
  // FeedTab carrying the widget's own name/id — then order by the catalog's
  // canonical order. Handles split widgets (sports_mlb, finance_stocks, …).
  const orderedDataWidgets = useMemo(() => {
    const items = widgets
      .filter((c) => c.enabled)
      .map((ch) => {
        const manifest = widgetManifest(ch.widget_type) as
          | DataWidgetManifest
          | undefined;
        return manifest ? { ch, manifest } : null;
      })
      .filter(
        (x): x is { ch: DataWidgetRow; manifest: DataWidgetManifest } => x !== null,
      );
    const order = canonicalOrder();
    return items.sort(
      (a, b) =>
        order.indexOf(a.ch.widget_type) - order.indexOf(b.ch.widget_type),
    );
  }, [widgets, catalogVersion]);

  const orderedWidgets = useMemo(
    () =>
      WIDGET_ORDER.map((id) => {
        if (!enabledWidgets.includes(id)) return null;
        return allWidgets.find((w) => w.id === id) ?? null;
      }).filter(Boolean) as WidgetManifest[],
    [enabledWidgets, allWidgets],
  );

  const hasAnySources = orderedDataWidgets.length > 0 || orderedWidgets.length > 0;

  return (
    <PageLayout
      title="Home"
      subtitle="Your live feed at a glance"
      width="wide"
      noTopPadding
    >
      {/* WCB — same persistent chrome as every other page. The section
          nav is always present (it's how you leave Home for settings);
          the ticker-manage action only appears once there's a ticker
          worth managing. */}
      <WidgetBar>
        <SectionNav active="home" />
        {hasAnySources && (
          <div className="ml-auto">
            <BarPill active={false} onClick={openTickerSettings}>
              Manage ticker
            </BarPill>
          </div>
        )}
      </WidgetBar>
      {/* Home uses the standard PageLayout chassis (px-5 py-5,
          max-w-6xl) so it lines up with Catalog and every other
          wide route. The inner wrapper just owns vertical rhythm
          between sections (space-y-5, no dangling margin on the
          last child). Content under the WCB starts at pt-4, same as
          Customize/Support. */}
      <div className="space-y-5 pt-4">
      {/* Empty state — hero. Shown when the user has no widgets and
          no enabled widgets. Disappears the moment they add their
          first source. This IS the post-wizard first-run experience —
          a single primary CTA, no opinionated defaults. */}
      {!hasAnySources && (
        <EmptySection
          icon={Sparkles}
          title="Welcome to Scrollr"
          description="Your radar is empty. Add widgets from the Catalog to start tracking what matters to you."
          action={
            authenticated ? (
              <button
                onClick={() => navigate({ to: "/catalog" })}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent text-surface hover:bg-accent/90 hover:shadow-glow-sm"
              >
                <Plus size={15} strokeWidth={2.5} />
                Browse the Catalog
              </button>
            ) : (
              <button
                onClick={onLogin}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent text-surface hover:bg-accent/90 hover:shadow-glow-sm"
              >
                Sign in to get started
              </button>
            )
          }
        />
      )}

      {/* DataWidgetRow sections — stagger in on first paint so the Home
          page reveals its data instead of slamming everything in
          at once. */}
      {orderedDataWidgets.map(({ ch, manifest }, idx) => {
        return (
          <div
            key={ch.widget_type}
          >
            <WidgetSection
              widget={ch}
              manifest={manifest}
              data={dashboard?.data}
              onViewAll={() =>
                navigate({
                  to: "/widget/$id",
                  params: { id: ch.widget_type },
                })
              }
              onRowClick={() =>
                navigate({
                  to: "/widget/$id",
                  params: { id: ch.widget_type },
                })
              }
              // Config lives inside the widget now — every CTA lands on
              // the feed, where the bar carries the configuration.
              onConfigure={() =>
                navigate({
                  to: "/widget/$id",
                  params: { id: ch.widget_type },
                })
              }
            />
          </div>
        );
      })}

      {/* Widget strip */}
      {orderedWidgets.length > 0 && (
        <div
        >
          <WidgetStrip
            widgets={orderedWidgets}
            getTickerStatus={(id) =>
              formatEffectiveWidgetTickerStatus(
                getEffectiveWidgetTickerStatus(shell.prefs, id),
              )
            }
            onNavigate={(id) =>
              navigate({
                to: "/widget/$id",
                params: { id },
              })
            }
          />
        </div>
      )}
      </div>
    </PageLayout>
  );
}

// ── DataWidgetRow section ─────────────────────────────────────────────

interface WidgetSectionProps {
  widget: DataWidgetRow;
  manifest: DataWidgetManifest;
  data: Record<string, unknown> | undefined;
  onViewAll: () => void;
  onRowClick: () => void;
  onConfigure: () => void;
}

function WidgetSection({
  widget,
  manifest,
  data,
  onViewAll,
  onRowClick,
  onConfigure,
}: WidgetSectionProps) {
  const Icon = manifest.icon;
  const type = widget.widget_type;
  // Resolve the widget id to its coarse source (dashboard.data is source-keyed)
  // and scope the payload to this one widget's config — an NFL widget shows only
  // NFL, finance_stocks only stocks, news_bbc only BBC. Mirrors the ticker.
  const source = sourceForWidget(type) ?? type;
  // Normalizing, grouping and rendering all come off the manifest now — a
  // source owns its own Home preview in datawidgets/{source}/home.tsx.
  const widgetData = useMemo(() => {
    const raw = data?.[source];
    const rows = manifest.normalizeHome
      ? manifest.normalizeHome(raw)
      : Array.isArray(raw)
        ? (raw as unknown[])
        : [];
    return scopeSourceData(
      source,
      rows,
      widget.config as Record<string, unknown> | undefined,
    );
  }, [source, data, widget.config, manifest]);
  return (
    <section>
      {/* Section header */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${manifest.hex}15`, color: manifest.hex }}
        >
          <Icon size={16} />
        </div>
        <span className="text-sm font-semibold text-fg flex-1">
          {manifest.name}
        </span>
        <button
          onClick={onViewAll}
          className="group flex items-center gap-1 text-ui-chip font-medium text-fg-4 hover:text-fg-2"
        >
          View all
          <ChevronRight size={12} />
        </button>
      </div>

      {/* Ranked rows — each source picks its own most
          interesting items; see its home.tsx. */}
        <div
          key="data"
          className="rounded-lg border border-edge/20 overflow-hidden divide-y divide-edge/10 cursor-pointer hover:bg-base-200/30 "
          onClick={onRowClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRowClick();
          }}
        >
          <manifest.HomeRows
            data={widgetData}
            dashboard={data}
            onConfigure={onConfigure}
          />
        </div>
    </section>
  );
}

// ── Widget strip ────────────────────────────────────────────────

interface WidgetStripProps {
  widgets: WidgetManifest[];
  getTickerStatus: (id: string) => string;
  onNavigate: (id: string) => void;
}

function WidgetStrip({
  widgets,
  getTickerStatus,
  onNavigate,
}: WidgetStripProps) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-ui-section font-mono font-semibold text-fg-4 uppercase tracking-wider flex-1">
          Widgets
        </h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {widgets.map((widget) => (
          <WidgetChip
            key={widget.id}
            widget={widget}
            tickerStatus={getTickerStatus(widget.id)}
            onClick={() => onNavigate(widget.id)}
          />
        ))}
      </div>
    </section>
  );
}

interface WidgetChipProps {
  widget: WidgetManifest;
  tickerStatus: string;
  onClick: () => void;
}

function WidgetChip({
  widget,
  tickerStatus,
  onClick,
}: WidgetChipProps) {
  const Icon = widget.icon;
  const value = getWidgetValue(widget.id);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={clsx(
        FEED_CARD,
        FEED_CARD_INTERACTIVE,
        "group w-full text-left",
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span style={{ color: widget.hex }} className="shrink-0">
          <Icon size={14} />
        </span>
        <span className="text-ui-meta font-medium text-fg truncate flex-1">
          {widget.tabLabel}
        </span>
        <TickerStatusBadge label={tickerStatus} />
      </div>

      <p className="text-sm font-medium text-fg-2 tabular-nums truncate">
        {value}
      </p>
    </div>
  );
}

function TickerStatusBadge({ label }: { label: string }) {
  const isOff = label === "Not on ticker";
  return (
    <span
      className={clsx(
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        isOff
          ? "border-edge/30 text-fg-4 bg-base-200/40"
          : "border-accent/25 text-accent bg-accent/10",
      )}
    >
      {label}
    </span>
  );
}

// ── Widget cached values ────────────────────────────────────────

function getWidgetValue(id: string): string {
  switch (id) {
    case "clock": {
      const format = getStore<string>(LS_CLOCK_FORMAT, "12h");
      return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: format === "12h",
      }).format(new Date());
    }
    case "timer":
      return getTimerValue();
    case "weather": {
      const cities = getStore<SavedCity[]>(LS_WEATHER_CITIES, []);
      const unit = getStore<string>(LS_WEATHER_UNIT, "fahrenheit") as TempUnit;
      if (cities.length === 0) return "No cities";
      const first = cities[0];
      if (!first.weather) return first.location.name;
      const temp = formatTemp(first.weather.temperature, unit, true);
      const icon = weatherCodeToIcon(first.weather.weatherCode);
      return `${icon} ${temp}`;
    }
    case "sysmon": {
      const info = getStore<SystemInfo | null>(LS_SYSMON_DATA, null);
      if (!info) return "Waiting for data";
      const parts = [`CPU ${Math.round(info.cpuUsage)}%`];
      if (info.memTotal > 0) {
        const ramPct = Math.round((info.memUsed / info.memTotal) * 100);
        parts.push(`RAM ${ramPct}%`);
      }
      if (info.gpuUsage != null) {
        parts.push(`GPU ${Math.round(info.gpuUsage)}%`);
      }
      return parts.join("  ·  ");
    }
    case "uptime": {
      const monitors = loadMonitors();
      if (monitors.length === 0) return "No monitors";
      const up = monitors.filter((m) => m.status === "up").length;
      const down = monitors.filter((m) => m.status !== "up").length;
      if (down > 0) return `${up} up / ${down} down`;
      return `${up} up`;
    }
    case "github": {
      const repos = loadRepoData();
      if (repos.length === 0) return "No repos";
      const passing = repos.filter((r) => r.status === "success").length;
      const failing = repos.filter((r) => r.status === "failure").length;
      if (failing > 0) return `${passing} passing / ${failing} failing`;
      return `${passing} passing`;
    }
    default:
      return "";
  }
}
