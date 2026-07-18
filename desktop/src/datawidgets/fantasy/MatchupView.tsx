/**
 * MatchupView — full head-to-head with both teams' rosters as tables.
 *
 * Shows the MatchupHero up top, then one column per team. Within each
 * team column: a Hitters table and a Pitchers table (or whatever
 * position types the sport uses). Starters go in the main tables; bench
 * and IR players render in subdued bench tables below.
 */
import { useMemo, useState } from "react";
import { Minus } from "lucide-react";
import { MatchupHero } from "./MatchupHero";
import { PlayerStatsTable } from "./PlayerStatsTable";
import { StatsWindowPicker } from "./RosterView";
import type { StatsWindow } from "./PlayerStatsTable";
import { isBenchPosition, userMatchupContext } from "./types";
import type { LeagueResponse, RosterEntry, RosterPlayer } from "./types";

interface MatchupViewProps {
  league: LeagueResponse | null;
}

export function MatchupView({ league }: MatchupViewProps) {
  const ctx = useMemo(() => (league ? userMatchupContext(league) : null), [league]);
  const [window, setWindow] = useState<StatsWindow>("week");

  if (!league || !ctx) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[12px] text-fg-3">
        No active matchup for this league this week.
      </div>
    );
  }

  const { user, opponent } = ctx;
  const userRoster = league.rosters?.find((r) => r.team_key === user.team_key) ?? null;
  const opponentRoster =
    league.rosters?.find((r) => r.team_key === opponent.team_key) ?? null;

  const catalog = league.data.stat_catalog ?? null;
  const hasTodayStats = [userRoster, opponentRoster].some((r) =>
    r?.data.players.some(
      (p) => p.player_stats_today && Object.keys(p.player_stats_today).length > 0,
    ),
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <MatchupHero league={league} />

      <div className="flex items-center gap-3">
        <StatsWindowPicker
          value={window}
          onChange={setWindow}
          todayDisabled={!hasTodayStats}
        />
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-4">
          {window === "today" ? "Today (Eastern)" : `Week ${ctx.matchup.week}`}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TeamColumn
          title={user.name}
          subtitle="Your team"
          roster={userRoster}
          catalog={catalog}
          window={window}
          highlight
        />
        <div className="relative">
          <TeamColumn
            title={opponent.name}
            subtitle="Opponent"
            roster={opponentRoster}
            catalog={catalog}
            window={window}
          />
          <div className="pointer-events-none absolute -left-5 top-1/2 hidden -translate-y-1/2 rounded-full border border-edge/50 bg-surface p-1 shadow-sm lg:block">
            <Minus size={10} className="text-fg-3" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Team column ──────────────────────────────────────────────────

interface TeamColumnProps {
  title: string;
  subtitle: string;
  roster: RosterEntry | null;
  catalog: LeagueResponse["data"]["stat_catalog"];
  window: StatsWindow;
  /** Highlight this column (used for the user's own team). */
  highlight?: boolean;
}

function TeamColumn({
  title,
  subtitle,
  roster,
  catalog,
  window,
  highlight,
}: TeamColumnProps) {
  const players = roster?.data.players ?? [];
  const starters = players.filter((p) => !isBenchPosition(p.selected_position));
  const bench = players.filter((p) => isBenchPosition(p.selected_position));

  const starterGroups = groupByPositionType(starters);
  const benchGroups = groupByPositionType(bench);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-fg">{title}</div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-fg-4">
            {subtitle}
          </div>
        </div>
        {highlight && (
          <span className="rounded bg-accent/15 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-accent">
            You
          </span>
        )}
      </div>

      {starterGroups.length === 0 && (
        <div className="rounded-lg border border-edge/40 bg-surface-2 p-6 text-center text-[11px] text-fg-3">
          Roster not available yet.
        </div>
      )}

      {starterGroups.map(({ positionType, title, players }) => (
        <PlayerStatsTable
          key={`starters-${positionType}`}
          players={players}
          positionType={positionType}
          title={title}
          subtitle={`${players.length}`}
          catalog={catalog ?? null}
          window={window}
        />
      ))}

      {benchGroups.map(({ positionType, title, players }) => (
        <PlayerStatsTable
          key={`bench-${positionType}`}
          players={players}
          positionType={positionType}
          title={`${title} — bench & IR`}
          subtitle={`${players.length}`}
          catalog={catalog ?? null}
          subdued
          window={window}
        />
      ))}
    </div>
  );
}

// ── Position-type grouping (duplicated from RosterView for isolation) ──

interface PositionGroup {
  positionType: string;
  title: string;
  players: RosterPlayer[];
}

const POSITION_TYPE_LABELS: Record<string, string> = {
  B: "Hitters",
  P: "Pitchers",
  O: "Offense",
  D: "Defense",
  K: "Kickers",
};

function groupByPositionType(players: RosterPlayer[]): PositionGroup[] {
  const buckets = new Map<string, RosterPlayer[]>();
  for (const p of players) {
    const key = p.position_type || "B";
    const bucket = buckets.get(key) ?? [];
    bucket.push(p);
    buckets.set(key, bucket);
  }
  const order = ["B", "O", "P", "D", "K"];
  const groups: PositionGroup[] = [];
  for (const key of order) {
    if (buckets.has(key)) {
      groups.push({
        positionType: key,
        title: POSITION_TYPE_LABELS[key] ?? key,
        players: buckets.get(key)!,
      });
      buckets.delete(key);
    }
  }
  for (const [key, players] of buckets.entries()) {
    groups.push({
      positionType: key,
      title: POSITION_TYPE_LABELS[key] ?? key,
      players,
    });
  }
  return groups;
}
