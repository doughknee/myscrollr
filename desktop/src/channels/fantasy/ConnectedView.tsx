/**
 * ConnectedView — the management surface for an already-connected Yahoo
 * user. This panel is deliberately quiet: no live scores, no matchup
 * cards, no roster drill-downs. All of that lives in the Feed tab.
 *
 * What the user manages here:
 *   - Pick a primary league (hero treatment in the Feed).
 *   - Enable/disable visibility of individual leagues.
 *   - Reorder by activity.
 *   - Add more leagues (re-run discovery).
 *   - Disconnect.
 */
import { useCallback, useMemo, useState } from "react";
import { clsx } from "clsx";
import { open } from "@tauri-apps/plugin-shell";
import { motion } from "motion/react";
import {
  ChevronDown,
  Eye,
  EyeOff,
  Plus,
  Star,
} from "lucide-react";
import {
  Section,
  DisplayRow,
  ActionRow,
} from "../../components/settings/SettingsControls";
import { useShell } from "../../shell-context";
import { SPORT_EMOJI, sportLabel } from "./types";
import type { LeagueResponse } from "./types";

const LEAGUES_PER_PAGE = 6;

interface ConnectedViewProps {
  leagues: LeagueResponse[];
  yahooConnected: boolean;
  hex: string;
  /** Discovery ran but Yahoo returned zero leagues for this account. */
  noLeaguesFound: boolean;
  onStartDiscovery: () => void;
  onDisconnect: () => void;
}

export function ConnectedView({
  leagues,
  yahooConnected,
  hex,
  noLeaguesFound,
  onStartDiscovery,
  onDisconnect,
}: ConnectedViewProps) {
  const { prefs, onPrefsChange } = useShell();
  const fantasyPrefs = prefs.channelDisplay.fantasy;

  const [visibleCount, setVisibleCount] = useState(LEAGUES_PER_PAGE);
  const [filter, setFilter] = useState<"all" | "active" | "past">("all");

  const sorted = useMemo(() => {
    return [...leagues].sort((a, b) => {
      // Active first, then by season desc, then by name.
      if (a.data.is_finished !== b.data.is_finished) {
        return a.data.is_finished ? 1 : -1;
      }
      const seasonDiff = Number(b.season) - Number(a.season);
      if (seasonDiff !== 0) return seasonDiff;
      return a.name.localeCompare(b.name);
    });
  }, [leagues]);

  const activeCount = sorted.filter((l) => !l.data.is_finished).length;
  const pastCount = sorted.filter((l) => l.data.is_finished).length;
  const filtered = useMemo(() => {
    if (filter === "active") return sorted.filter((l) => !l.data.is_finished);
    if (filter === "past") return sorted.filter((l) => l.data.is_finished);
    return sorted;
  }, [sorted, filter]);
  const visibleLeagues = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const enabledSet = useMemo(() => {
    // Empty enabled list means "all" — reflect that as a fully-enabled state.
    if (!fantasyPrefs.enabledLeagueKeys || fantasyPrefs.enabledLeagueKeys.length === 0) {
      return new Set(leagues.map((l) => l.league_key));
    }
    return new Set(fantasyPrefs.enabledLeagueKeys);
  }, [fantasyPrefs.enabledLeagueKeys, leagues]);

  const updatePrefs = useCallback(
    (patch: Partial<typeof fantasyPrefs>) => {
      onPrefsChange({
        ...prefs,
        channelDisplay: {
          ...prefs.channelDisplay,
          fantasy: { ...fantasyPrefs, ...patch },
        },
      });
    },
    [prefs, fantasyPrefs, onPrefsChange],
  );

  const toggleLeagueVisibility = useCallback(
    (key: string) => {
      const next = new Set(enabledSet);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // If every league is enabled we store [] to mean "all".
      const fullSet = next.size === leagues.length;
      updatePrefs({
        enabledLeagueKeys: fullSet ? [] : Array.from(next),
      });
    },
    [enabledSet, leagues.length, updatePrefs],
  );

  const setPrimary = useCallback(
    (key: string | null) => {
      updatePrefs({
        primaryLeagueKey: key === fantasyPrefs.primaryLeagueKey ? null : key,
      });
    },
    [fantasyPrefs.primaryLeagueKey, updatePrefs],
  );

  return (
    <>
      {/* Overview */}
      {leagues.length > 0 && (
        <Section title="Overview">
          <DisplayRow label="Imported leagues" value={String(leagues.length)} />
          <DisplayRow label="Active this season" value={String(activeCount)} />
          {pastCount > 0 && (
            <DisplayRow label="Finished / past" value={String(pastCount)} />
          )}
        </Section>
      )}

      {/* League management */}
      {leagues.length > 0 && (
        <Section title="Your Leagues">
          <div className="px-3">
            <FilterBar
              filter={filter}
              onChange={(next) => {
                setFilter(next);
                setVisibleCount(LEAGUES_PER_PAGE);
              }}
              counts={{ all: sorted.length, active: activeCount, past: pastCount }}
            />
          </div>

          <div className="mt-2 space-y-1 px-3">
            {visibleLeagues.map((league, i) => (
              <motion.div
                key={league.league_key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 420,
                  damping: 32,
                  delay: i < LEAGUES_PER_PAGE ? i * 0.03 : 0,
                }}
              >
                <LeagueManagementRow
                  league={league}
                  enabled={enabledSet.has(league.league_key)}
                  isPrimary={fantasyPrefs.primaryLeagueKey === league.league_key}
                  onToggleEnabled={() => toggleLeagueVisibility(league.league_key)}
                  onSetPrimary={() => setPrimary(league.league_key)}
                  hex={hex}
                />
              </motion.div>
            ))}

            {filtered.length === 0 && (
              <p className="py-6 text-center text-[11px] text-fg-3">
                No leagues match this filter.
              </p>
            )}

            {hasMore && (
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + LEAGUES_PER_PAGE)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-edge/30 bg-base-250/30 p-3 text-[11px] font-medium text-fg-3 transition-all hover:border-edge/40 hover:text-fg-2 cursor-pointer"
              >
                <ChevronDown size={14} />
                Show {Math.min(filtered.length - visibleCount, LEAGUES_PER_PAGE)} more
              </button>
            )}
          </div>
        </Section>
      )}

      {/* Connected but no leagues */}
      {yahooConnected && leagues.length === 0 && (
        <div className="space-y-3 px-3 py-8 text-center">
          {noLeaguesFound ? (
            <>
              <p className="text-sm font-medium text-fg-2">No Fantasy Leagues Found</p>
              <p className="mx-auto max-w-xs text-[12px] text-fg-3">
                Your Yahoo account doesn&rsquo;t have any Fantasy Sports leagues.
                Join or create a league on Yahoo, then come back and search again.
              </p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => open("https://football.fantasysports.yahoo.com")}
                  className="inline-flex items-center gap-2 rounded-lg border border-edge/30 px-4 py-2 text-[12px] font-medium text-fg-3 transition-colors hover:border-edge/50 hover:text-fg-2 cursor-pointer"
                >
                  Go to Yahoo Fantasy
                </button>
                <button
                  type="button"
                  onClick={onStartDiscovery}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-medium text-white transition-colors cursor-pointer"
                  style={{ background: hex }}
                >
                  Search Again
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[12px] text-fg-3">
                Yahoo account connected — no leagues added yet
              </p>
              <button
                type="button"
                onClick={onStartDiscovery}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-medium text-white transition-colors cursor-pointer"
                style={{ background: hex }}
              >
                <Plus size={14} />
                Find Leagues
              </button>
            </>
          )}
        </div>
      )}

      {/* Account actions */}
      {yahooConnected && (
        <Section title="Account">
          <ActionRow
            label="Add more leagues"
            description="Find and import new Yahoo Fantasy leagues"
            action="Find Leagues"
            onClick={onStartDiscovery}
          />
          <ActionRow
            label="Disconnect Yahoo"
            description="Remove your Yahoo account link and clear imported leagues"
            action="Disconnect"
            actionClass="bg-error/10 text-error hover:bg-error/20"
            onClick={onDisconnect}
          />
        </Section>
      )}
    </>
  );
}

// ── Filter bar ───────────────────────────────────────────────────

function FilterBar({
  filter,
  counts,
  onChange,
}: {
  filter: "all" | "active" | "past";
  counts: { all: number; active: number; past: number };
  onChange: (filter: "all" | "active" | "past") => void;
}) {
  const options: { value: "all" | "active" | "past"; label: string; count: number }[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "active", label: "Active", count: counts.active },
    { value: "past", label: "Past", count: counts.past },
  ];
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => {
        const active = filter === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            disabled={opt.count === 0 && opt.value !== "all"}
            className={clsx(
              "rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
              active
                ? "bg-accent/15 text-accent"
                : "text-fg-3 hover:bg-surface-hover hover:text-fg-2",
              opt.count === 0 && opt.value !== "all" && "cursor-not-allowed opacity-40",
            )}
          >
            {opt.label} <span className="ml-1 font-mono text-fg-4">{opt.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────

function LeagueManagementRow({
  league,
  enabled,
  isPrimary,
  onToggleEnabled,
  onSetPrimary,
  hex,
}: {
  league: LeagueResponse;
  enabled: boolean;
  isPrimary: boolean;
  onToggleEnabled: () => void;
  onSetPrimary: () => void;
  hex: string;
}) {
  const isFinished = league.data.is_finished;
  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
        isPrimary
          ? "border-accent/40 bg-accent/[0.04]"
          : "border-edge/40 bg-surface hover:bg-surface-2",
        !enabled && "opacity-65",
      )}
    >
      <span aria-hidden className="text-[14px]">
        {SPORT_EMOJI[league.game_code] ?? "🏆"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold text-fg">
            {league.name}
          </span>
          {isPrimary && (
            <span className="rounded-full bg-accent/20 px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-wider text-accent">
              Primary
            </span>
          )}
          {isFinished && (
            <span className="rounded-full border border-edge/50 px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-wider text-fg-3">
              Finished
            </span>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-fg-3">
          {sportLabel(league.game_code)} · {league.data.num_teams} teams · {league.season}
        </div>
      </div>

      <IconButton
        label={isPrimary ? "Clear primary" : "Set as primary league"}
        onClick={onSetPrimary}
        active={isPrimary}
        color={hex}
      >
        <Star size={13} className={isPrimary ? "fill-current" : ""} />
      </IconButton>
      <IconButton
        label={enabled ? "Hide from Feed" : "Show in Feed"}
        onClick={onToggleEnabled}
        active={enabled}
        color={hex}
      >
        {enabled ? <Eye size={13} /> : <EyeOff size={13} />}
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  active,
  color,
  children,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer",
        active ? "border-transparent text-white" : "border-edge/40 text-fg-3 hover:text-fg",
      )}
      style={active ? { background: `${color}30`, color, borderColor: `${color}60` } : undefined}
    >
      {children}
    </button>
  );
}


