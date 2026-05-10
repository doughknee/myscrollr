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
  Pencil,
  Check,
  ChevronRight,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import { motion, AnimatePresence } from "motion/react";
import RouteError from "../components/RouteError";
import Tooltip from "../components/Tooltip";
import RowSelector from "../components/RowSelector";
import TickerLayoutSummary from "../components/TickerLayoutSummary";
import PageLayout from "../components/layout/PageLayout";
import EmptySection from "../components/layout/EmptySection";
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
import {
  getChannelTickerRow,
  getWidgetTickerRow,
} from "../preferences";
import { useTickerLayout } from "../hooks/useTickerLayout";
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
    onLogin,
  } = shell;

  const enabledWidgets = shell.prefs.widgets.enabledWidgets;
  const homePreview = shell.prefs.homePreview;

  // Single source of truth for layout state, shared with Settings →
  // Ticker, the Settings → Ticker source picker, and the tray submenus.
  // Pre-refactor each surface computed its own `maxRows` from this same
  // prefs blob and they kept drifting (Home derived from row count,
  // Settings derived from tier cap). The hook collapses both into one
  // shape so every screen renders in lockstep.
  const tickerLayout = useTickerLayout(
    shell.prefs,
    shell.onPrefsChange,
    shell.tier,
  );
  const { rows: layoutRows, tierMaxRows, canAddRow } = tickerLayout;

  // RowSelector buttons collapse to [Off][On] when only one row exists,
  // and expand to [Off][Row 1]…[Row N] otherwise. The picker reflects
  // the *actual* layout (not the tier cap) so users don't see ghost
  // rows; the +Add affordance below grows the layout in-place.
  const pickerRows = Math.max(1, layoutRows.length);

  const setHomePreview = useCallback(
    (channelType: string, keys: string[]) => {
      const next: HomePreview = { ...homePreview, [channelType]: keys };
      shell.onPrefsChange({ ...shell.prefs, homePreview: next });
    },
    [homePreview, shell],
  );

  // ── Unified ticker row selector handlers ────────────────────────
  // Channel row change updates BOTH layers atomically:
  //   1. tickerLayout.rows[i].sources[]   (client-side prefs)
  //   2. Channel.ticker_enabled            (server-side master gate)
  // See preferences.ts §"Unified ticker row selector helpers".
  const handleChannelRowChange = useCallback(
    (channelType: ChannelType, row: number | null) => {
      tickerLayout.setSourceRow(channelType, row);
      // Server-side flag: enable when assigned to any row, disable for "off".
      // onToggleChannelTicker is async but fire-and-forget here — the existing
      // handler shows a toast on failure and re-syncs from the dashboard refetch.
      onToggleChannelTicker(channelType, row !== null);
    },
    [tickerLayout, onToggleChannelTicker],
  );

  const handleWidgetRowChange = useCallback(
    (widgetId: string, row: number | null) => {
      tickerLayout.setSourceRow(widgetId, row);
    },
    [tickerLayout],
  );

  // ── +Add row handlers ────────────────────────────────────────
  // Single-click flow: create a new row AND assign the source to it,
  // so Home users never have to leave the page to grow the ticker.
  // A no-op (returns null) when the layout is at the tier cap.
  const handleChannelAddRow = useCallback(
    (channelType: ChannelType) => {
      const newRow = tickerLayout.addRow(channelType);
      if (newRow !== null) {
        // The source might have been off-ticker before (server flag
        // false). Flip it on alongside the layout change so both layers
        // stay consistent.
        onToggleChannelTicker(channelType, true);
      }
    },
    [tickerLayout, onToggleChannelTicker],
  );

  const handleWidgetAddRow = useCallback(
    (widgetId: string) => {
      tickerLayout.addRow(widgetId);
    },
    [tickerLayout],
  );

  // Plain "add an empty row" handler used by the layout summary strip.
  // No source seeding — useful when the user just wants a second row
  // and will populate it later.
  const handleAddEmptyRow = useCallback(() => {
    tickerLayout.addRow();
  }, [tickerLayout]);

  const openTickerSettings = useCallback(() => {
    navigate({ to: "/settings", search: { tab: "ticker" } });
  }, [navigate]);

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
    <PageLayout
      title="Home"
      subtitle="Your live feed at a glance"
      width="wide"
      noContentPadding
    >
      {/* Home renders flush to the content area with no PageLayout
          padding. The content wrapper here owns its own padding /
          rhythm: space-y-5 between sections, no dangling margin on
          the last child. */}
      <div className="space-y-5">
      {/* Empty state — hero. Shown when the user has no channels and
          no enabled widgets. Disappears the moment they add their
          first source. This IS the post-wizard first-run experience —
          a single primary CTA, no opinionated defaults. */}
      {!hasAnySources && (
        <EmptySection
          icon={Sparkles}
          title="Welcome to Scrollr"
          description="Your radar is empty. Add channels and widgets from the Catalog to start tracking what matters to you."
          action={
            authenticated ? (
              <button
                onClick={() => navigate({ to: "/catalog" })}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent text-surface hover:bg-accent/90 transition-all duration-200 active:scale-95 hover:shadow-glow-sm"
              >
                <Plus size={15} strokeWidth={2.5} />
                Browse the Catalog
              </button>
            ) : (
              <button
                onClick={onLogin}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-accent text-surface hover:bg-accent/90 transition-all duration-200 active:scale-95 hover:shadow-glow-sm"
              >
                Sign in to get started
              </button>
            )
          }
        />
      )}

      {/* Ticker preview — read-only summary of "what's on your radar".
          TickerLayoutSummary draws its own card chrome, so we render
          it directly instead of wrapping it in another PageSection
          card (which would have nested two cards and doubled padding).
          The "Manage" CTA already exists inside the summary's header. */}
      {hasAnySources && (
        <TickerLayoutSummary
          rows={layoutRows}
          tierMaxRows={tierMaxRows}
          canAddRow={canAddRow}
          onAddRow={handleAddEmptyRow}
          onOpenSettings={openTickerSettings}
          channelManifests={allChannelManifests}
          widgetManifests={allWidgets}
        />
      )}

      {/* Channel sections — stagger in on first paint so the Home
          page reveals its data instead of slamming everything in
          at once. */}
      {orderedChannels.map(({ ch, manifest }, idx) => {
        const channelData = dashboard?.data?.[ch.channel_type];
        const hasData = Array.isArray(channelData) && channelData.length > 0;
        const targetTab = hasData ? "feed" : "configuration";
        const currentRow = getChannelTickerRow(shell.prefs, ch);
        return (
          <motion.div
            key={ch.channel_type}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.28,
              delay: 0.05 + idx * 0.05,
              ease: [0.22, 0.61, 0.36, 1],
            }}
          >
            <ChannelSection
              channel={ch}
              manifest={manifest}
              data={dashboard?.data}
              currentRow={currentRow}
              maxRows={pickerRows}
              canAddRow={canAddRow}
              onAddRow={() =>
                handleChannelAddRow(ch.channel_type as ChannelType)
              }
              onRowChange={(next) =>
                handleChannelRowChange(ch.channel_type as ChannelType, next)
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
          </motion.div>
        );
      })}

      {/* Widget strip */}
      {orderedWidgets.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.28,
            delay: 0.05 + orderedChannels.length * 0.05,
            ease: [0.22, 0.61, 0.36, 1],
          }}
        >
          <WidgetStrip
            widgets={orderedWidgets}
            maxRows={pickerRows}
            canAddRow={canAddRow}
            onWidgetAddRow={handleWidgetAddRow}
            getWidgetRow={(id) => getWidgetTickerRow(shell.prefs, id)}
            onWidgetRowChange={handleWidgetRowChange}
            onNavigate={(id) =>
              navigate({
                to: "/widget/$id/$tab",
                params: { id, tab: "feed" },
              })
            }
          />
        </motion.div>
      )}
      </div>
    </PageLayout>
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
  /** Currently assigned ticker row, or null for off. */
  currentRow: number | null;
  /**
   * Number of rows currently in the layout (reflects what the user has
   * built, not the tier cap). Drives the RowSelector's button count.
   */
  maxRows: number;
  /** Whether the layout has room for another row at the user's tier. */
  canAddRow: boolean;
  /**
   * Single-click handler: create a new row in the layout AND assign
   * this channel to it. Called from the RowSelector's trailing
   * `[+ Add]` button.
   */
  onAddRow: () => void;
  /** Called when the user picks a different row or "Off". */
  onRowChange: (row: number | null) => void;
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
  currentRow,
  maxRows,
  canAddRow,
  onAddRow,
  onRowChange,
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

        {/* Edit toggle */}
        {groups.length > 0 && (
          <Tooltip content={editing ? "Done editing" : "Edit preview"}>
            <button
              onClick={() => setEditing(!editing)}
              aria-label={editing ? "Done editing" : `Edit ${manifest.name} preview`}
              className={clsx(
                "w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 active:scale-90",
                editing
                  ? "text-accent bg-accent/10"
                  : hasSelections
                    ? "text-accent hover:bg-surface-hover"
                    : "text-fg-4/60 hover:text-fg-2 hover:bg-surface-hover",
              )}
            >
              <motion.span
                key={editing ? "check" : "pencil"}
                initial={{ opacity: 0, scale: 0.7, rotate: -30 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 22 }}
              >
                {editing ? <Check size={14} /> : <Pencil size={14} />}
              </motion.span>
            </button>
          </Tooltip>
        )}

        {/* Row selector — replaces the legacy Eye/EyeOff toggle so users
            can pick exactly which ticker row a channel appears on (Off /
            Row 1 / 2 / 3) instead of a binary visibility flip that
            silently fought with the Settings source picker.
            The trailing `[+ Add]` button (when canAddRow) creates a
            new row and assigns this channel to it in a single click. */}
        <RowSelector
          value={currentRow}
          maxRows={maxRows}
          disabled={!channel.enabled}
          disabledHint={
            !channel.enabled ? "Enable from the Catalog first" : undefined
          }
          onChange={onRowChange}
          ariaLabel={`${manifest.name} ticker row`}
          canAddRow={canAddRow}
          onAddRow={onAddRow}
        />

        {/* View all */}
        {!editing && (
          <button
            onClick={onViewAll}
            className="group flex items-center gap-1 text-[11px] font-medium text-fg-4 hover:text-fg-2 transition-all duration-150 active:scale-95"
          >
            View all
            <ChevronRight
              size={12}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </button>
        )}
      </div>

      {/* Edit mode picker / data rows cross-fade. Wrapped in
          AnimatePresence with mode='wait' so toggling the Pencil/Check
          button transitions one panel out before the other in. */}
      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.div
            key="edit"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
            className="rounded-lg border border-accent/20 bg-accent/[0.03] overflow-hidden divide-y divide-edge/10 mb-3"
          >
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="text-[11px] font-medium text-fg-3">
                Choose up to {MAX_PREVIEW} to show on Home
              </span>
              {hasSelections && (
                <button
                  onClick={() => onSelectionChange([])}
                  className="text-[11px] font-medium text-fg-4 hover:text-fg-2 transition-colors active:scale-95"
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
                    "flex items-center gap-3 px-4 py-2.5 w-full text-left transition-all duration-150 active:scale-[0.99]",
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
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 25 }}
                      >
                        <Check size={10} className="text-surface" strokeWidth={3} />
                      </motion.span>
                    )}
                  </span>
                  <span className="text-xs text-fg truncate flex-1">
                    {getGroupLabel(type, key, channelData)}
                  </span>
                </button>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="data"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
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
          </motion.div>
        )}
      </AnimatePresence>
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
  /** Number of rows currently in the layout. */
  maxRows: number;
  /** Whether the layout has room for another row at the user's tier. */
  canAddRow: boolean;
  /** Read the row a widget is currently assigned to (null = off). */
  getWidgetRow: (id: string) => number | null;
  /** Move a widget to the given row (null = off). */
  onWidgetRowChange: (id: string, row: number | null) => void;
  /** Create a new row and assign this widget to it. */
  onWidgetAddRow: (id: string) => void;
  onNavigate: (id: string) => void;
}

function WidgetStrip({
  widgets,
  maxRows,
  canAddRow,
  getWidgetRow,
  onWidgetRowChange,
  onWidgetAddRow,
  onNavigate,
}: WidgetStripProps) {
  return (
    <section>
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
            currentRow={getWidgetRow(widget.id)}
            maxRows={maxRows}
            canAddRow={canAddRow}
            onAddRow={() => onWidgetAddRow(widget.id)}
            onRowChange={(row) => onWidgetRowChange(widget.id, row)}
            onClick={() => onNavigate(widget.id)}
          />
        ))}
      </div>
    </section>
  );
}

interface WidgetChipProps {
  widget: WidgetManifest;
  currentRow: number | null;
  maxRows: number;
  canAddRow: boolean;
  onAddRow: () => void;
  onRowChange: (row: number | null) => void;
  onClick: () => void;
}

function WidgetChip({
  widget,
  currentRow,
  maxRows,
  canAddRow,
  onAddRow,
  onRowChange,
  onClick,
}: WidgetChipProps) {
  const Icon = widget.icon;
  const value = getWidgetValue(widget.id);

  // Note: this used to be a single <button> wrapping the whole chip, but
  // the RowSelector is a radiogroup of <button>s — nesting buttons is
  // invalid HTML. The outer container is now a div with role="button"
  // + tabIndex so the chip body still acts as a click target while the
  // RowSelector renders cleanly inside it.
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
      className="group rounded-lg border bg-base-200/40 border-edge/20 hover:bg-base-200/60 p-3 transition-colors text-left cursor-pointer w-full"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span style={{ color: widget.hex }} className="shrink-0">
          <Icon size={14} />
        </span>
        <span className="text-xs font-medium text-fg truncate flex-1">
          {widget.tabLabel}
        </span>
      </div>

      <p className="text-sm font-medium text-fg-2 tabular-nums truncate mb-2">
        {value}
      </p>

      {/* Row selector — replaces the legacy Eye/EyeOff toggle. Click events
          inside the radiogroup are stopPropagation'd by RowSelector itself
          so they don't trigger the chip's navigate-on-click. The
          trailing `[+ Add]` button creates a new row and assigns the
          widget to it in a single tap (when the layout isn't already
          at the tier cap). */}
      <RowSelector
        value={currentRow}
        maxRows={maxRows}
        onChange={onRowChange}
        ariaLabel={`${widget.tabLabel} ticker row`}
        canAddRow={canAddRow}
        onAddRow={onAddRow}
      />
    </div>
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
