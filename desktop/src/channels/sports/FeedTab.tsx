/**
 * Sports FeedTab — desktop-native.
 *
 * Tabbed container with Scores, Schedule, and Standings views.
 * Scores shows real-time game scoreboard cards via CDC/SSE.
 * Schedule filters upcoming pre-games by date.
 * Standings fetches league standings from the API.
 *
 * Controls bar between the tab bar and content provides:
 *   - LeagueFilter dropdown (filter games by league)
 *   - StatusFilter pill buttons (All / Live / Upcoming / Final)
 */
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { clsx } from "clsx";
import { Trophy, Filter } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions } from "../../api/queries";
import { useSportsConfig } from "../../hooks/useSportsConfig";
import { ScoresTab } from "./ScoresTab";
import { ScheduleTab } from "./ScheduleTab";
import { StandingsTab } from "./StandingsTab";
import EmptyChannelState from "../../components/EmptyChannelState";
import FreshnessPill from "../../components/FreshnessPill";
import type { Game, FeedTabProps, ChannelManifest } from "../../types";
import type { FavoriteTeam } from "../../hooks/useSportsConfig";

// ── Channel manifest ─────────────────────────────────────────────

export const sportsChannel: ChannelManifest = {
  id: "sports",
  name: "Sports",
  tabLabel: "Sports",
  description: "Live scores and game updates",
  hex: "#f97316",
  icon: Trophy,
  info: {
    about:
      "Follow live scores across NFL, NBA, MLB, NHL, MLS, and more. " +
      "Scores update automatically with a visual flash when they change.",
    usage: [
      "Open Configure to pick your leagues.",
      "Live games show a pulsing indicator and scores update automatically.",
      "Final scores highlight the winning team in bold.",
    ],
  },
  FeedTab: SportsFeedTab,
};

// ── Types ────────────────────────────────────────────────────────

type SportsTab = "scores" | "schedule" | "standings";
export type StatusFilter = "all" | "live" | "upcoming" | "final";

// ── LeagueFilter ─────────────────────────────────────────────────

interface LeagueFilterProps {
  leagues: string[];
  selected: Set<string>;
  onToggle: (league: string) => void;
  onClearAll: () => void;
}

function LeagueFilter({ leagues, selected, onToggle, onClearAll }: LeagueFilterProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeCount = selected.size;

  if (leagues.length === 0) return null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-ui-meta transition-colors cursor-pointer whitespace-nowrap",
          activeCount > 0
            ? "border-accent/50 text-accent"
            : "border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
        )}
      >
        <Filter size={12} />
        <span>Leagues</span>
        {activeCount > 0 && (
          <span className="bg-accent/20 text-accent rounded-full px-1.5 text-ui-chip font-medium">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-52 bg-surface-2 border border-edge/50 rounded-lg shadow-lg z-[5] py-1 max-h-64 overflow-y-auto">
          {leagues.map((league) => {
            const isActive = selected.has(league);
            return (
              <button
                key={league}
                onClick={() => onToggle(league)}
                className={clsx(
                    "flex items-center gap-2 w-full px-3 py-1.5 text-left text-ui-meta transition-colors cursor-pointer",
                  isActive ? "text-fg-2" : "text-fg-3 hover:text-fg-2",
                )}
              >
                <span
                  className={clsx(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center text-ui-chip shrink-0",
                    isActive
                      ? "bg-accent/25 border-accent/50 text-accent"
                      : "border-edge/50",
                  )}
                >
                  {isActive && "\u2713"}
                </span>
                <span className="flex-1 truncate">{league}</span>
              </button>
            );
          })}
          {activeCount > 0 && (
            <>
              <div className="h-px bg-edge/40 my-1" />
              <button
                onClick={() => {
                  onClearAll();
                  setOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-ui-meta text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
              >
                Clear all filters
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── StatusFilter pills ───────────────────────────────────────────

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "upcoming", label: "Upcoming" },
  { value: "final", label: "Final" },
];

// ── Helper: build set of favorite team names ─────────────────────

function buildFavoriteSet(favorites: Record<string, FavoriteTeam>): Set<string> {
  const set = new Set<string>();
  for (const ft of Object.values(favorites)) {
    set.add(ft.teamName);
  }
  return set;
}

// ── FeedTab ──────────────────────────────────────────────────────

function SportsFeedTab({ mode, feedContext, onConfigure }: FeedTabProps) {
  const [tab, setTab] = useState<SportsTab>("scores");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [leagueFilter, setLeagueFilter] = useState<Set<string>>(new Set());
  const { leagues, display, favoriteTeams } = useSportsConfig();

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const games = useMemo(
    () => (dashboard?.data?.sports as Game[] | undefined) ?? [],
    [dashboard?.data?.sports],
  );

  // Unique leagues from current games for the filter dropdown
  const availableLeagues = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) {
      if (g.league) set.add(g.league);
    }
    return Array.from(set).sort();
  }, [games]);

  // Favorite team names as a Set for fast lookup
  const favoriteTeamNames = useMemo(
    () => buildFavoriteSet(favoriteTeams),
    [favoriteTeams],
  );

  // Most-recent update across all games — drives the FreshnessPill.
  const latestUpdated = useMemo(() => {
    let latest = 0;
    for (const g of games) {
      if (!g.updated_at) continue;
      const ts = new Date(g.updated_at).getTime();
      if (Number.isFinite(ts) && ts > latest) latest = ts;
    }
    return latest > 0 ? new Date(latest).toISOString() : null;
  }, [games]);

  const toggleLeague = useCallback((league: string) => {
    setLeagueFilter((prev) => {
      const next = new Set(prev);
      if (next.has(league)) next.delete(league);
      else next.add(league);
      return next;
    });
  }, []);

  const clearLeagueFilter = useCallback(() => {
    setLeagueFilter(new Set());
  }, []);

  if (games.length === 0 && leagues.length === 0) {
    return (
      <EmptyChannelState
        icon={Trophy}
        noun="leagues"
        hasConfig={!!feedContext.__hasConfig}
        dashboardLoaded={!!feedContext.__dashboardLoaded}
        loadingNoun="scores"
        actionHint="pick your leagues"
        onConfigure={onConfigure}
      />
    );
  }

  return (
    <div>
      {/* Navigation + controls — single bar */}
      <div className="sticky top-0 z-10 flex items-center px-3 py-2 bg-surface border-b border-edge/30">
        {/* Tabs — far left */}
        <div className="flex gap-1">
          {(["scores", "schedule", "standings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                tab === t
                  ? "bg-accent/10 text-accent"
                  : "text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
              )}
            >
              {t === "scores" ? "Scores" : t === "schedule" ? "Schedule" : "Standings"}
            </button>
          ))}
        </div>

        {tab !== "standings" && latestUpdated && (
          <div className="ml-2">
            <FreshnessPill lastUpdated={latestUpdated} label="score" />
          </div>
        )}

        {/* Status pills + league filter — far right (scores & schedule only) */}
        {tab !== "standings" && (
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex gap-1">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={clsx(
                    "px-2.5 py-1 rounded-full text-ui-meta font-medium transition-colors cursor-pointer",
                    statusFilter === opt.value
                      ? "bg-accent/15 text-accent"
                      : "text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <LeagueFilter
              leagues={availableLeagues}
              selected={leagueFilter}
              onToggle={toggleLeague}
              onClearAll={clearLeagueFilter}
            />
          </div>
        )}
      </div>

      {/* Tab content */}
      {tab === "scores" && (
        <ScoresTab
          games={games}
          mode={mode}
          display={display}
          favoriteTeams={favoriteTeamNames}
          leagueFilter={leagueFilter}
          statusFilter={statusFilter}
        />
      )}
      {tab === "schedule" && (
        <ScheduleTab
          games={games}
          display={display}
          favoriteTeams={favoriteTeamNames}
          leagueFilter={leagueFilter}
          statusFilter={statusFilter}
        />
      )}
      {tab === "standings" && (
        <StandingsTab
          leagues={leagues}
          favoriteTeams={favoriteTeamNames}
        />
      )}
    </div>
  );
}
