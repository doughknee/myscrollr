/**
 * Fantasy FeedTab — redesigned as a multi-view consumption experience.
 *
 * Organized around the rituals of a fantasy season:
 *   - Overview: multi-league weekly scorecard + primary league hero
 *   - Matchup:  live head-to-head with starting lineups
 *   - Standings: playoff-aware standings for the primary league
 *   - Roster:   user's (or any team's) roster with injury spotlight
 *
 * A league switcher appears when the user has 2+ active leagues, so each
 * sub-view follows a single "current" league.  The Feed is deliberately
 * read-only; import / disconnect / tier gating lives on the Configure
 * tab.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  Activity,
  ClipboardList,
  LayoutGrid,
  Star,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions } from "../../api/queries";
import { useShell } from "../../shell-context";
import EmptyChannelState from "../../components/EmptyChannelState";
import { OverviewView } from "./OverviewView";
import { MatchupView } from "./MatchupView";
import { StandingsView } from "./StandingsView";
import { RosterView } from "./RosterView";
import {
  SPORT_EMOJI,
  isMatchupLive,
  userMatchupContext,
} from "./types";
import { filterEnabledLeagues, resolvePrimaryLeague } from "./view";
import type { FeedTabProps, ChannelManifest } from "../../types";
import type { FantasySubTab } from "../../preferences";
import type { LeagueResponse, MyLeaguesResponse } from "./types";

// ── Channel manifest ─────────────────────────────────────────────

export const fantasyChannel: ChannelManifest = {
  id: "fantasy",
  name: "Fantasy",
  tabLabel: "Fantasy",
  description: "Yahoo Fantasy Sports leagues",
  hex: "#6366f1",
  icon: Swords,
  info: {
    about:
      "Live matchups, playoff-aware standings, and roster intel for all of " +
      "your Yahoo Fantasy leagues. Scores, injuries, and seedings update in " +
      "near real time as games play out.",
    usage: [
      "Import your leagues from the Configure tab.",
      "Pick a primary league to surface as the hero view.",
      "Flip between Overview, Matchup, Standings, and Roster to manage your teams.",
    ],
  },
  FeedTab: FantasyFeedTab,
};

// ── Helpers ──────────────────────────────────────────────────────

function extractLeagues(data: unknown): LeagueResponse[] {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const resp = data as MyLeaguesResponse;
    return resp.leagues ?? [];
  }
  if (Array.isArray(data)) return data as LeagueResponse[];
  return [];
}

interface SubTabMeta {
  value: FantasySubTab;
  label: string;
  icon: typeof LayoutGrid;
}

const SUB_TABS: SubTabMeta[] = [
  { value: "overview", label: "Overview", icon: LayoutGrid },
  { value: "matchup", label: "Matchup", icon: Swords },
  { value: "standings", label: "Standings", icon: Trophy },
  { value: "roster", label: "Roster", icon: Users },
];

// ── FeedTab ──────────────────────────────────────────────────────

function FantasyFeedTab({ mode, feedContext, onConfigure }: FeedTabProps) {
  const { prefs } = useShell();
  const dp = prefs.channelDisplay.fantasy;

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const fantasyData = dashboard?.data?.fantasy;
  const leagues = useMemo(() => extractLeagues(fantasyData), [fantasyData]);

  // Apply the user's per-league visibility filter: empty = show all.
  // Shared with the ticker via `filterEnabledLeagues`.
  const visibleLeagues = useMemo(
    () => filterEnabledLeagues(leagues, dp.enabledLeagueKeys),
    [leagues, dp.enabledLeagueKeys],
  );

  // Resolve the "primary" league — user override, else first active, else first.
  // Shared with the ticker via `resolvePrimaryLeague`.
  const primaryLeague = useMemo(
    () => resolvePrimaryLeague(visibleLeagues, dp.primaryLeagueKey),
    [visibleLeagues, dp.primaryLeagueKey],
  );

  // Current league the sub-views render against. Defaults to primary.
  const [activeLeagueKey, setActiveLeagueKey] = useState<string | null>(
    primaryLeague?.league_key ?? null,
  );
  useEffect(() => {
    if (!activeLeagueKey && primaryLeague) {
      setActiveLeagueKey(primaryLeague.league_key);
    } else if (
      activeLeagueKey &&
      !visibleLeagues.some((l) => l.league_key === activeLeagueKey)
    ) {
      setActiveLeagueKey(primaryLeague?.league_key ?? null);
    }
  }, [activeLeagueKey, primaryLeague, visibleLeagues]);

  const activeLeague = useMemo(
    () =>
      activeLeagueKey
        ? visibleLeagues.find((l) => l.league_key === activeLeagueKey) ?? null
        : primaryLeague,
    [activeLeagueKey, visibleLeagues, primaryLeague],
  );

  const [subTab, setSubTab] = useState<FantasySubTab>(() => {
    if (dp.defaultSubTab) return dp.defaultSubTab;
    return visibleLeagues.length > 1 ? "overview" : "matchup";
  });

  const handleOpenMatchup = useCallback(() => setSubTab("matchup"), []);
  const handleSelectLeague = useCallback((key: string) => {
    setActiveLeagueKey(key);
    setSubTab("matchup");
  }, []);

  // ── Empty / loading states ───────────────────────────────────
  if (leagues.length === 0) {
    return (
      <EmptyChannelState
        icon={Swords}
        noun="fantasy leagues"
        hasConfig={!!feedContext.__hasConfig}
        dashboardLoaded={!!feedContext.__dashboardLoaded}
        loadingNoun="leagues"
        actionHint="connect your Yahoo account"
        onConfigure={onConfigure}
      />
    );
  }

  if (visibleLeagues.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Activity size={28} className="text-fg-3" />
        <div className="text-[13px] font-semibold text-fg">
          No leagues enabled for viewing
        </div>
        <p className="max-w-sm text-[11px] text-fg-3">
          Every one of your imported leagues is currently hidden. Enable at
          least one in the Configure tab to see your matchups, standings, and
          rosters here.
        </p>
        <button
          type="button"
          onClick={onConfigure}
          className="mt-1 rounded-md bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20 cursor-pointer"
        >
          Open Configure
        </button>
      </div>
    );
  }

  const liveCount = visibleLeagues.filter((l) => {
    const ctx = userMatchupContext(l);
    return ctx && isMatchupLive(ctx.matchup);
  }).length;

  return (
    <div className={clsx("flex h-full flex-col", mode === "compact" && "text-[12px]")}>
      {/* Top bar: sub-tabs + live pulse */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-edge/30 bg-surface px-3 py-2">
        <div className="flex gap-1">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const disabled = tab.value !== "overview" && !activeLeague;
            const active = subTab === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setSubTab(tab.value)}
                disabled={disabled}
                className={clsx(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                  active
                    ? "bg-accent/15 text-accent"
                    : "text-fg-3 hover:bg-surface-hover hover:text-fg-2",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-fg-3">
          <span>
            {visibleLeagues.length} league{visibleLeagues.length === 1 ? "" : "s"}
          </span>
          {liveCount > 0 && (
            <span className="inline-flex items-center gap-1 text-live">
              <span className="h-1.5 w-1.5 rounded-full bg-live animate-pulse" />
              {liveCount} live
            </span>
          )}
        </div>
      </div>

      {/* Secondary bar: league switcher when 2+ leagues AND not in overview */}
      {visibleLeagues.length > 1 && subTab !== "overview" && (
        <LeagueSwitcher
          leagues={visibleLeagues}
          activeKey={activeLeague?.league_key ?? null}
          primaryKey={primaryLeague?.league_key ?? null}
          onSelect={setActiveLeagueKey}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <motion.div
          key={subTab + (activeLeague?.league_key ?? "none")}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          {subTab === "overview" && (
            <OverviewView
              leagues={visibleLeagues}
              primaryLeagueKey={primaryLeague?.league_key ?? null}
              onSelectLeague={handleSelectLeague}
              onOpenMatchup={handleOpenMatchup}
            />
          )}
          {subTab === "matchup" && <MatchupView league={activeLeague} />}
          {subTab === "standings" && <StandingsView league={activeLeague} />}
          {subTab === "roster" && <RosterView league={activeLeague} />}
        </motion.div>
      </div>
    </div>
  );
}

// ── League switcher pill bar ─────────────────────────────────────

interface LeagueSwitcherProps {
  leagues: LeagueResponse[];
  activeKey: string | null;
  primaryKey: string | null;
  onSelect: (key: string) => void;
}

function LeagueSwitcher({ leagues, activeKey, primaryKey, onSelect }: LeagueSwitcherProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-edge/30 bg-surface-2/40 px-3 py-1.5">
      <ClipboardList size={12} className="shrink-0 text-fg-3" />
      <div className="flex items-center gap-1">
        {leagues.map((l) => {
          const active = l.league_key === activeKey;
          const isPrimary = l.league_key === primaryKey;
          const ctx = userMatchupContext(l);
          const live = ctx && isMatchupLive(ctx.matchup);
          return (
            <button
              key={l.league_key}
              type="button"
              onClick={() => onSelect(l.league_key)}
              className={clsx(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                active
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-edge/40 text-fg-3 hover:border-accent/40 hover:text-fg-2",
              )}
            >
              <span aria-hidden>{SPORT_EMOJI[l.game_code] ?? "🏆"}</span>
              <span className="max-w-[140px] truncate">{l.name}</span>
              {isPrimary && (
                <Star size={10} className="fill-accent stroke-accent" />
              )}
              {live && (
                <span className="ml-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Note: `resolvePrimaryLeague` now lives in ./view.ts so the ticker
// can consume the same logic.
