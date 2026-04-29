/**
 * Home route — live status dashboard.
 *
 * Shows a glanceable overview of live data from each active channel,
 * plus a compact widget status strip. Discovery and add/remove happen
 * in the Catalog (/catalog), not here.
 */
import { useState, useMemo, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Eye,
  EyeOff,
  Pencil,
  Check,
  ChevronRight,
  Settings,
} from "lucide-react";
import clsx from "clsx";
import RouteError from "../components/RouteError";
import Tooltip from "../components/Tooltip";
import { useShell, useShellData } from "../shell-context";
import { CHANNEL_ORDER } from "../channels/registry";
import { WIDGET_ORDER } from "../widgets/registry";
import { getStore } from "../lib/store";
import { timeAgo } from "../utils/format";
import { formatTemp, weatherCodeToIcon } from "../widgets/weather/types";
import { loadMonitors } from "../widgets/uptime/types";
import { loadRepoData } from "../widgets/github/types";
import {
  LS_CLOCK_FORMAT,
  LS_WEATHER_CITIES,
  LS_WEATHER_UNIT,
  LS_SYSMON_DATA,
} from "../constants";
import { isChannelTickerEnabled } from "../api/client";
import type { ChannelType, Channel } from "../api/client";
import type {
  ChannelManifest,
  WidgetManifest,
  Trade,
  Game,
  RssItem,
} from "../types";
import type { TempUnit, HomePreview } from "../preferences";
import type { SystemInfo } from "../hooks/useSysmonData";
import type { SavedCity } from "../widgets/weather/types";

const MAX_PREVIEW = 5;

// ── Route ───────────────────────────────────────────────────────

export const Route = createFileRoute("/feed")({
  component: HomePage,
  errorComponent: RouteError,
});

function HomePage() {
  const navigate = useNavigate();
  const shell = useShell();
  const { channels, dashboard } = useShellData();
  const {
    allChannelManifests,
    allWidgets,
    authenticated,
    onToggleChannelTicker,
    onToggleWidgetTicker,
    onLogin,
  } = shell;

  const enabledWidgets = shell.prefs.widgets.enabledWidgets;
  const widgetsOnTicker = shell.prefs.widgets.widgetsOnTicker;
  const homePreview = shell.prefs.homePreview;

  const setHomePreview = useCallback(
    (channelType: string, keys: string[]) => {
      const next: HomePreview = { ...homePreview, [channelType]: keys };
      shell.onPrefsChange({ ...shell.prefs, homePreview: next });
    },
    [homePreview, shell],
  );

  const orderedChannels = useMemo(
    () =>
      CHANNEL_ORDER.map((id) => {
        const ch = channels.find((c) => c.channel_type === id);
        const manifest = allChannelManifests.find((m) => m.id === id);
        return ch && manifest ? { ch, manifest } : null;
      }).filter(Boolean) as { ch: Channel; manifest: ChannelManifest }[],
    [channels, allChannelManifests],
  );

  const orderedWidgets = useMemo(
    () =>
      WIDGET_ORDER.map((id) => {
        if (!enabledWidgets.includes(id)) return null;
        return allWidgets.find((w) => w.id === id) ?? null;
      }).filter(Boolean) as WidgetManifest[],
    [enabledWidgets, allWidgets],
  );

  const hasAnySources = orderedChannels.length > 0 || orderedWidgets.length > 0;

  return (
    <div className="p-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[11px] font-mono font-semibold text-fg-4 uppercase tracking-wider mb-1">
          Home
        </h1>
        <p className="text-xs text-fg-4">Your live feed at a glance</p>
      </div>

      {/* Empty state */}
      {!hasAnySources && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <h2 className="text-base font-semibold text-fg mb-2">
            Welcome to Scrollr
          </h2>
          <p className="text-sm text-fg-3 mb-4 max-w-sm">
            Add channels like Finance, Sports, or RSS from the Catalog, then
            configure what you want to track.
          </p>
          {authenticated ? (
            <button
              onClick={() => navigate({ to: "/catalog" })}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-surface hover:bg-accent/90 transition-colors"
            >
              Browse Catalog
            </button>
          ) : (
            <button
              onClick={onLogin}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-surface hover:bg-accent/90 transition-colors"
            >
              Sign in to get started
            </button>
          )}
        </div>
      )}

      {/* Channel sections */}
      {orderedChannels.map(({ ch, manifest }) => {
        const channelData = dashboard?.data?.[ch.channel_type];
        const hasData = Array.isArray(channelData) && channelData.length > 0;
        const targetTab = hasData ? "feed" : "configuration";
        return (
          <ChannelSection
            key={ch.channel_type}
            channel={ch}
            manifest={manifest}
            data={dashboard?.data}
            tickerEnabled={isChannelTickerEnabled(ch)}
            onToggleTicker={() =>
              onToggleChannelTicker(
                ch.channel_type as ChannelType,
                !isChannelTickerEnabled(ch),
              )
            }
            selectedKeys={homePreview[ch.channel_type] ?? []}
            onSelectionChange={(keys) =>
              setHomePreview(ch.channel_type, keys)
            }
            onViewAll={() =>
              navigate({
                to: "/channel/$type/$tab",
                params: { type: ch.channel_type, tab: "feed" },
              })
            }
            onRowClick={() =>
              navigate({
                to: "/channel/$type/$tab",
                params: { type: ch.channel_type, tab: targetTab },
              })
            }
            onConfigure={() =>
              navigate({
                to: "/channel/$type/$tab",
                params: { type: ch.channel_type, tab: "configuration" },
              })
            }
          />
        );
      })}

      {/* Widget strip */}
      {orderedWidgets.length > 0 && (
        <WidgetStrip
          widgets={orderedWidgets}
          widgetsOnTicker={widgetsOnTicker}
          onToggleTicker={onToggleWidgetTicker}
          onNavigate={(id) =>
            navigate({
              to: "/widget/$id/$tab",
              params: { id, tab: "feed" },
            })
          }
        />
      )}
    </div>
  );
}

// ── Group key extractors ────────────────────────────────────────

function getGroups(type: string, data: unknown): string[] {
  const arr = Array.isArray(data) ? data : [];
  switch (type) {
    case "finance":
      return [...new Set((arr as Trade[]).map((t) => t.symbol))];
    case "sports":
      return [...new Set((arr as Game[]).map((g) => g.league))];
    case "rss":
      return [...new Set((arr as RssItem[]).map((i) => i.source_name))];
    case "fantasy":
      return [...new Set(
        arr.map((l: Record<string, unknown>) =>
          String(l.league_key ?? l.league_name ?? l.name ?? ""),
        ).filter(Boolean),
      )];
    default:
      return [];
  }
}

function getGroupLabel(type: string, key: string, data: unknown): string {
  if (type !== "fantasy") return key;
  const arr = Array.isArray(data) ? data : [];
  const league = arr.find(
    (l: Record<string, unknown>) =>
      String(l.league_key ?? "") === key || String(l.league_name ?? "") === key,
  ) as Record<string, unknown> | undefined;
  return league
    ? String(league.league_name ?? league.name ?? key)
    : key;
}

// ── Channel section ─────────────────────────────────────────────

interface ChannelSectionProps {
  channel: Channel;
  manifest: ChannelManifest;
  data: Record<string, unknown> | undefined;
  tickerEnabled: boolean;
  onToggleTicker: () => void;
  selectedKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  onViewAll: () => void;
  onRowClick: () => void;
  onConfigure: () => void;
}

function ChannelSection({
  channel,
  manifest,
  data,
  tickerEnabled,
  onToggleTicker,
  selectedKeys,
  onSelectionChange,
  onViewAll,
  onRowClick,
  onConfigure,
}: ChannelSectionProps) {
  const [editing, setEditing] = useState(false);
  const Icon = manifest.icon;
  const type = channel.channel_type;
  const channelData = data?.[type];
  const groups = useMemo(() => getGroups(type, channelData), [type, channelData]);
  const hasSelections = selectedKeys.length > 0;

  function toggleGroup(key: string) {
    if (selectedKeys.includes(key)) {
      onSelectionChange(selectedKeys.filter((k) => k !== key));
    } else if (selectedKeys.length < MAX_PREVIEW) {
      onSelectionChange([...selectedKeys, key]);
    }
  }

  return (
    <section className="mb-6">
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

        {/* Edit toggle */}
        {groups.length > 0 && (
          <Tooltip content={editing ? "Done editing" : "Edit preview"}>
            <button
              onClick={() => setEditing(!editing)}
              aria-label={editing ? "Done editing" : `Edit ${manifest.name} preview`}
              className={clsx(
                "w-7 h-7 flex items-center justify-center rounded-lg transition-colors",
                editing
                  ? "text-accent bg-accent/10"
                  : hasSelections
                    ? "text-accent hover:bg-surface-hover"
                    : "text-fg-4/60 hover:text-fg-2 hover:bg-surface-hover",
              )}
            >
              {editing ? <Check size={14} /> : <Pencil size={14} />}
            </button>
          </Tooltip>
        )}

        {/* Eye toggle */}
        <Tooltip content={tickerEnabled ? "Hide from ticker" : "Show on ticker"}>
          <button
            onClick={onToggleTicker}
            aria-label={
              tickerEnabled
                ? `Hide ${manifest.name} from ticker`
                : `Show ${manifest.name} on ticker`
            }
            className={clsx(
              "w-7 h-7 flex items-center justify-center rounded-lg transition-colors",
              tickerEnabled
                ? "text-fg-3 hover:text-fg hover:bg-surface-hover"
                : "text-fg-4/60 hover:text-fg-2 hover:bg-surface-hover",
            )}
          >
            {tickerEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </Tooltip>

        {/* View all */}
        {!editing && (
          <button
            onClick={onViewAll}
            className="flex items-center gap-1 text-[11px] font-medium text-fg-4 hover:text-fg-2 transition-colors"
          >
            View all
            <ChevronRight size={12} />
          </button>
        )}
      </div>

      {/* Edit mode: group picker */}
      {editing && (
        <div className="rounded-lg border border-accent/20 bg-accent/[0.03] overflow-hidden divide-y divide-edge/10 mb-3">
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-fg-3">
              Choose up to {MAX_PREVIEW} to show on Home
            </span>
            {hasSelections && (
              <button
                onClick={() => onSelectionChange([])}
                className="text-[11px] font-medium text-fg-4 hover:text-fg-2 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
          {groups.map((key) => {
            const isSelected = selectedKeys.includes(key);
            const atLimit = selectedKeys.length >= MAX_PREVIEW && !isSelected;
            return (
              <button
                key={key}
                onClick={() => toggleGroup(key)}
                disabled={atLimit}
                className={clsx(
                  "flex items-center gap-3 px-4 py-2.5 w-full text-left transition-colors",
                  atLimit
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-accent/[0.04] cursor-pointer",
                )}
              >
                <span
                  className={clsx(
                    "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                    isSelected
                      ? "bg-accent border-accent"
                      : "border-edge/40",
                  )}
                >
                  {isSelected && (
                    <Check size={10} className="text-surface" strokeWidth={3} />
                  )}
                </span>
                <span className="text-xs text-fg truncate flex-1">
                  {getGroupLabel(type, key, channelData)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Data rows */}
      {!editing && (
        <div
          className="rounded-lg border border-edge/20 overflow-hidden divide-y divide-edge/10 cursor-pointer hover:bg-base-200/30 transition-colors"
          onClick={onRowClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRowClick();
          }}
        >
          {type === "finance" && (
            <FinanceRows data={channelData} filter={selectedKeys} onConfigure={onConfigure} />
          )}
          {type === "sports" && (
            <SportsRows data={channelData} filter={selectedKeys} onConfigure={onConfigure} />
          )}
          {type === "rss" && (
            <RssRows data={channelData} filter={selectedKeys} onConfigure={onConfigure} />
          )}
          {type === "fantasy" && (
            <FantasyRows data={channelData} filter={selectedKeys} onConfigure={onConfigure} />
          )}
        </div>
      )}
    </section>
  );
}

// ── Finance rows ────────────────────────────────────────────────

function FinanceRows({ data, filter, onConfigure }: { data: unknown; filter: string[]; onConfigure: () => void }) {
  const trades = Array.isArray(data) ? (data as Trade[]) : [];
  if (trades.length === 0) return <EmptyDataRow channelType="finance" onConfigure={onConfigure} />;

  const filtered =
    filter.length > 0
      ? trades.filter((t) => filter.includes(t.symbol))
      : trades;

  const sorted = [...filtered]
    .sort(
      (a, b) =>
        Math.abs(Number(b.percentage_change ?? 0)) -
        Math.abs(Number(a.percentage_change ?? 0)),
    )
    .slice(0, MAX_PREVIEW);

  if (sorted.length === 0)
    return <EmptyDataRow channelType="finance" />;

  return (
    <>
      {sorted.map((t) => {
        const pct = Number(t.percentage_change ?? 0);
        const isUp = pct >= 0;
        return (
          <div key={t.symbol} className="flex items-center px-4 py-2.5 gap-4">
            <span className="text-xs font-mono font-semibold text-fg w-20 truncate">
              {t.symbol}
            </span>
            <span className="text-xs text-fg-2 tabular-nums">
              $
              {Number(t.price).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span
              className={clsx(
                "text-xs font-medium tabular-nums ml-auto",
                isUp ? "text-green-400" : "text-red-400",
              )}
            >
              {isUp ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
            </span>
          </div>
        );
      })}
    </>
  );
}

// ── Sports rows ─────────────────────────────────────────────────

function SportsRows({ data, filter, onConfigure }: { data: unknown; filter: string[]; onConfigure: () => void }) {
  const games = Array.isArray(data) ? (data as Game[]) : [];
  if (games.length === 0) return <EmptyDataRow channelType="sports" onConfigure={onConfigure} />;

  const filtered =
    filter.length > 0
      ? games.filter((g) => filter.includes(g.league))
      : games;

  const priority: Record<string, number> = { in: 0, pre: 1, post: 2 };
  const sorted = [...filtered]
    .sort(
      (a, b) =>
        (priority[a.state ?? "post"] ?? 3) -
        (priority[b.state ?? "post"] ?? 3),
    )
    .slice(0, MAX_PREVIEW);

  if (sorted.length === 0)
    return <EmptyDataRow channelType="sports" />;

  return (
    <>
      {sorted.map((g) => {
        const isLive = g.state === "in";
        return (
          <div key={g.id} className="flex items-center px-4 py-2.5 gap-3">
            {isLive && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <span className="text-[10px] font-mono font-semibold text-fg-4 uppercase w-10 shrink-0 truncate">
              {g.league}
            </span>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {g.away_team_logo && (
                <img
                  src={g.away_team_logo}
                  alt=""
                  className="w-4 h-4 shrink-0 object-contain"
                />
              )}
              <span className="text-xs text-fg-2 truncate">
                {g.away_team_name || g.away_team_code}
              </span>
              <span className="text-xs text-fg-3 tabular-nums shrink-0">
                {g.away_team_score} – {g.home_team_score}
              </span>
              <span className="text-xs text-fg-2 truncate">
                {g.home_team_name || g.home_team_code}
              </span>
              {g.home_team_logo && (
                <img
                  src={g.home_team_logo}
                  alt=""
                  className="w-4 h-4 shrink-0 object-contain"
                />
              )}
            </div>
            <span className="text-[10px] text-fg-4 shrink-0 truncate max-w-24">
              {g.short_detail ?? g.status_short ?? ""}
            </span>
          </div>
        );
      })}
    </>
  );
}

// ── RSS rows ────────────────────────────────────────────────────

function RssRows({ data, filter, onConfigure }: { data: unknown; filter: string[]; onConfigure: () => void }) {
  const items = Array.isArray(data) ? (data as RssItem[]) : [];
  if (items.length === 0) return <EmptyDataRow channelType="rss" onConfigure={onConfigure} />;

  const filtered =
    filter.length > 0
      ? items.filter((i) => filter.includes(i.source_name))
      : items;

  const sorted = [...filtered]
    .sort((a, b) => {
      const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
      const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, MAX_PREVIEW);

  if (sorted.length === 0)
    return <EmptyDataRow channelType="rss" />;

  return (
    <>
      {sorted.map((item) => (
        <div key={item.id} className="flex items-center px-4 py-2.5 gap-3">
          <span className="text-xs text-fg flex-1 truncate">{item.title}</span>
          <span className="text-[10px] text-fg-4 shrink-0">
            {item.source_name}
          </span>
          <span className="text-[10px] text-fg-4/60 shrink-0 w-8 text-right">
            {timeAgo(item.published_at)}
          </span>
        </div>
      ))}
    </>
  );
}

// ── Fantasy rows ────────────────────────────────────────────────

function FantasyRows({ data, filter, onConfigure }: { data: unknown; filter: string[]; onConfigure: () => void }) {
  const leagues = Array.isArray(data) ? data : [];
  if (leagues.length === 0) return <EmptyDataRow channelType="fantasy" onConfigure={onConfigure} />;

  const filtered =
    filter.length > 0
      ? leagues.filter((l: Record<string, unknown>) => {
          const key = String(l.league_key ?? l.league_name ?? l.name ?? "");
          return filter.includes(key);
        })
      : leagues;

  const preview = filtered.slice(0, MAX_PREVIEW);

  if (preview.length === 0)
    return <EmptyDataRow channelType="fantasy" />;

  return (
    <>
      {preview.map((league: Record<string, unknown>, i: number) => {
        const name = (league.league_name ?? league.name ?? "League") as string;
        const myScore = league.my_score ?? league.team_points;
        const oppScore = league.opp_score ?? league.opponent_points;
        const hasMatchup = myScore != null && oppScore != null;

        return (
          <div key={i} className="flex items-center px-4 py-2.5 gap-3">
            <span className="text-xs text-fg flex-1 truncate">{name}</span>
            {hasMatchup && (
              <span className="text-xs text-fg-3 tabular-nums">
                {String(myScore)} – {String(oppScore)}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Empty data row ──────────────────────────────────────────────

const EMPTY_HINTS: Record<string, { message: string; action: string }> = {
  finance: { message: "No stocks configured yet", action: "choose what to track" },
  sports: { message: "No leagues configured yet", action: "pick your leagues" },
  rss: { message: "No feeds configured yet", action: "add websites to follow" },
  fantasy: { message: "No leagues imported yet", action: "connect Yahoo Fantasy" },
};

function EmptyDataRow({
  channelType,
  onConfigure,
}: {
  channelType?: string;
  onConfigure?: () => void;
}) {
  const hint = channelType ? EMPTY_HINTS[channelType] : undefined;
  return (
    <div className="px-4 py-5 text-center">
      <p className="text-xs text-fg-3 font-medium mb-1">
        {hint?.message ?? "Nothing to show"}
      </p>
      {hint && onConfigure && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onConfigure();
          }}
          className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent/80 transition-colors"
        >
          <Settings size={11} />
          Open Settings to {hint.action}
        </button>
      )}
    </div>
  );
}

// ── Widget strip ────────────────────────────────────────────────

interface WidgetStripProps {
  widgets: WidgetManifest[];
  widgetsOnTicker: string[];
  onToggleTicker: (id: string) => void;
  onNavigate: (id: string) => void;
}

function WidgetStrip({
  widgets,
  widgetsOnTicker,
  onToggleTicker,
  onNavigate,
}: WidgetStripProps) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-[11px] font-mono font-semibold text-fg-4 uppercase tracking-wider flex-1">
          Widgets
        </h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {widgets.map((widget) => (
          <WidgetChip
            key={widget.id}
            widget={widget}
            tickerEnabled={widgetsOnTicker.includes(widget.id)}
            onToggleTicker={() => onToggleTicker(widget.id)}
            onClick={() => onNavigate(widget.id)}
          />
        ))}
      </div>
    </section>
  );
}

interface WidgetChipProps {
  widget: WidgetManifest;
  tickerEnabled: boolean;
  onToggleTicker: () => void;
  onClick: () => void;
}

function WidgetChip({
  widget,
  tickerEnabled,
  onToggleTicker,
  onClick,
}: WidgetChipProps) {
  const Icon = widget.icon;
  const value = getWidgetValue(widget.id);

  return (
    <button
      onClick={onClick}
      className="group rounded-lg border bg-base-200/40 border-edge/20 hover:bg-base-200/60 p-3 transition-colors text-left cursor-pointer w-full"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span style={{ color: widget.hex }} className="shrink-0">
          <Icon size={14} />
        </span>
        <span className="text-xs font-medium text-fg truncate flex-1">
          {widget.tabLabel}
        </span>

        {/* Eye toggle */}
        <Tooltip content={tickerEnabled ? "Hide from ticker" : "Show on ticker"}>
          <div
            role="switch"
            aria-checked={tickerEnabled}
            aria-label={tickerEnabled ? "Hide from ticker" : "Show on ticker"}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggleTicker();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onToggleTicker();
              }
            }}
            className={clsx(
              "w-6 h-6 flex items-center justify-center rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0",
              tickerEnabled
                ? "text-fg-3 hover:text-fg hover:bg-surface-hover"
                : "text-fg-4/60 hover:text-fg-2 hover:bg-surface-hover",
            )}
          >
            {tickerEnabled ? <Eye size={12} /> : <EyeOff size={12} />}
          </div>
        </Tooltip>
      </div>

      <p className="text-sm font-medium text-fg-2 tabular-nums truncate">
        {value}
      </p>
    </button>
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
