/**
 * MatchupView — head-to-head as position-vs-position slot rows.
 *
 * Replaces the two side-by-side raw-stat tables. A fantasy matchup is
 * decided slot against slot, so the view is built that way: one row per
 * lineup slot, your player on the left, theirs on the right, the slot
 * name between them. Raw stat grids still exist on the Roster tab for
 * anyone who wants the numbers; this view answers "am I winning".
 *
 * Live treatment (red clocks, points flash) depends on per-player game
 * state, which is not in the Yahoo payload — see gameStateForPlayer().
 * Everything here degrades to "—" when it's absent.
 */
import { useMemo } from "react";
import { clsx } from "clsx";
import { MatchupHero } from "./MatchupHero";
import { StatsWindowPicker } from "./RosterView";
import type { StatsWindow } from "./PlayerStatsTable";
import { findTopBench, findTopScorer } from "./playerStats";
import {
  compactStatLine,
  gameStateForPlayer,
  isBenchPosition,
  isMatchupFinal,
  pointsRemaining,
  slotRows,
  teamScore,
  userMatchupContext,
} from "./types";
import type {
  LeagueResponse,
  MatchupTeam,
  RosterPlayer,
  SlotRow,
  StatCatalog,
} from "./types";

interface MatchupViewProps {
  league: LeagueResponse | null;
  /** Shared with RosterView so the two tabs stay in the same window. */
  window: StatsWindow;
  onWindowChange: (w: StatsWindow) => void;
}

export function MatchupView({
  league,
  window,
  onWindowChange,
}: MatchupViewProps) {
  const ctx = useMemo(
    () => (league ? userMatchupContext(league) : null),
    [league],
  );

  if (!league || !ctx) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[12px] text-fg-3">
        No active matchup for this league this week.
      </div>
    );
  }

  const { matchup, user, opponent } = ctx;
  const userPlayers =
    league.rosters?.find((r) => r.team_key === user.team_key)?.data.players ??
    [];
  const oppPlayers =
    league.rosters?.find((r) => r.team_key === opponent.team_key)?.data
      .players ?? [];
  const catalog = league.data.stat_catalog ?? null;

  const rows = useMemo(
    () => slotRows(userPlayers, oppPlayers),
    [userPlayers, oppPlayers],
  );
  const benchRows = useMemo(
    () => slotRows(userPlayers, oppPlayers, true),
    [userPlayers, oppPlayers],
  );

  const hasTodayStats = [...userPlayers, ...oppPlayers].some(
    (p) => p.player_stats_today && Object.keys(p.player_stats_today).length > 0,
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <MatchupHero league={league} />

      <div className="flex items-center gap-3">
        <StatsWindowPicker
          value={window}
          onChange={onWindowChange}
          todayDisabled={!hasTodayStats}
        />
        <span className="font-mono text-[11px] uppercase tracking-wider text-fg-4">
          {window === "today" ? "Today (Eastern)" : `Week ${matchup.week}`}
        </span>
      </div>

      <InsightChips players={userPlayers} catalog={catalog} window={window} />

      <SlotCard
        rows={rows}
        user={user}
        opponent={opponent}
        catalog={catalog}
        window={window}
        final={isMatchupFinal(matchup)}
      />

      {benchRows.length > 0 && (
        <SlotCard
          rows={benchRows}
          user={user}
          opponent={opponent}
          catalog={catalog}
          window={window}
          final={isMatchupFinal(matchup)}
          subdued
          note={`${pointsRemaining(user).toFixed(1)} pts left on your bench · ${pointsRemaining(opponent).toFixed(1)} on theirs`}
        />
      )}
    </div>
  );
}

// ── Insight chips ────────────────────────────────────────────────

function InsightChips({
  players,
  catalog,
  window,
}: {
  players: RosterPlayer[];
  catalog: StatCatalog | null;
  window: StatsWindow;
}) {
  const top = findTopScorer(players);
  const live =
    players.find((p) => gameStateForPlayer(p).kind === "live") ?? null;
  const bench = findTopBench(players);

  // "+2.2 over K. Walker" — the bench player's edge over the weakest
  // starter they could have replaced. Only meaningful once someone has
  // actually scored less than them.
  const benchEdge = useMemo(() => {
    if (!bench) return null;
    const starters = players.filter(
      (p) =>
        !isBenchPosition(p.selected_position) &&
        typeof p.player_points === "number",
    );
    let worst: RosterPlayer | null = null;
    for (const s of starters) {
      if (!worst || (s.player_points ?? 0) < (worst.player_points ?? 0))
        worst = s;
    }
    if (!worst) return null;
    const delta = (bench.player_points ?? 0) - (worst.player_points ?? 0);
    if (delta <= 0) return null;
    return { delta, over: shortName(worst.name.full) };
  }, [bench, players]);

  if (!top && !live && !bench) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {top && (
        <InsightChip
          player={top}
          label="Top scorer"
          value={fmt(top.player_points)}
          valueClass="text-up"
          sub={`proj ${fmt(projOf(top))}`}
        />
      )}
      {live && (
        <InsightChip
          player={live}
          label="In the game"
          value={fmt(live.player_points)}
          valueClass="text-up pts-flash"
          sub={gameStateForPlayer(live).label}
          subClass="text-live font-semibold"
        />
      )}
      {bench && (
        <InsightChip
          player={bench}
          label="Best on bench"
          value={fmt(bench.player_points)}
          valueClass="text-fg"
          sub={
            benchEdge
              ? `+${benchEdge.delta.toFixed(1)} over ${benchEdge.over}`
              : "—"
          }
        />
      )}
    </div>
  );
}

function InsightChip({
  player,
  label,
  value,
  valueClass,
  sub,
  subClass,
}: {
  player: RosterPlayer;
  label: string;
  value: string;
  valueClass?: string;
  sub: string;
  subClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-edge/40 bg-surface-2/40 px-3 py-2.5">
      <Avatar player={player} size={32} />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] uppercase tracking-wider text-fg-4">
          {label}
        </div>
        <div className="truncate text-[12px] font-semibold text-fg">
          {player.name.full}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div
          className={clsx(
            "font-mono text-[14px] font-bold tabular-nums",
            valueClass,
          )}
        >
          {value}
        </div>
        <div className={clsx("font-mono text-[11px] text-fg-4", subClass)}>
          {sub}
        </div>
      </div>
    </div>
  );
}

// ── Slot card ────────────────────────────────────────────────────

function SlotCard({
  rows,
  user,
  opponent,
  catalog,
  window,
  final,
  subdued,
  note,
}: {
  rows: SlotRow[];
  user: MatchupTeam;
  opponent: MatchupTeam;
  catalog: StatCatalog | null;
  window: StatsWindow;
  final: boolean;
  subdued?: boolean;
  note?: string;
}) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-lg border",
        subdued
          ? "border-edge/30 bg-surface-2/40"
          : "border-edge/40 bg-surface",
      )}
    >
      <div
        className={clsx(
          "grid items-center gap-2 border-b border-edge/40 px-3 py-2",
          "grid-cols-[minmax(0,1fr)_64px_48px_64px_minmax(0,1fr)]",
          subdued ? "bg-surface-2/60" : "bg-surface-2",
        )}
      >
        <span className="truncate font-mono text-[11px] uppercase tracking-wider text-fg-3">
          {user.name}
          <span className="ml-1 text-accent">· You</span>
        </span>
        <span />
        <span />
        <span />
        <span className="truncate text-right font-mono text-[11px] uppercase tracking-wider text-fg-3">
          {opponent.name}
        </span>
      </div>

      {note && (
        <div className="border-b border-edge/20 px-3 py-1.5 font-mono text-[11px] text-fg-4">
          {note}
        </div>
      )}

      {rows.map((row, i) => (
        <SlotRowView
          key={`${row.slot}-${row.user?.player_key ?? "x"}-${row.opponent?.player_key ?? "x"}-${i}`}
          row={row}
          catalog={catalog}
          window={window}
        />
      ))}

      {!subdued && (
        <TotalsFooter user={user} opponent={opponent} final={final} />
      )}
    </div>
  );
}

function SlotRowView({
  row,
  catalog,
  window,
}: {
  row: SlotRow;
  catalog: StatCatalog | null;
  window: StatsWindow;
}) {
  const mine = row.user?.player_points ?? null;
  const theirs = row.opponent?.player_points ?? null;
  const userLeads = mine !== null && theirs !== null && mine > theirs;
  const oppLeads = mine !== null && theirs !== null && theirs > mine;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_64px_48px_64px_minmax(0,1fr)] items-center gap-2 border-t border-edge/20 px-3 py-2">
      <PlayerCell player={row.user} catalog={catalog} window={window} />
      <PointsCell player={row.user} leads={userLeads} align="right" />
      <div className="flex justify-center">
        <span className="rounded-full border border-edge/50 bg-surface-2 px-1.5 py-[1px] font-mono text-[11px] uppercase tracking-wider text-fg-4">
          {row.slot}
        </span>
      </div>
      <PointsCell player={row.opponent} leads={oppLeads} align="left" />
      <PlayerCell
        player={row.opponent}
        catalog={catalog}
        window={window}
        mirrored
      />
    </div>
  );
}

function PlayerCell({
  player,
  catalog,
  window,
  mirrored,
}: {
  player: RosterPlayer | null;
  catalog: StatCatalog | null;
  window: StatsWindow;
  mirrored?: boolean;
}) {
  if (!player) return <div />;
  const game = gameStateForPlayer(player);
  const played =
    typeof player.player_points === "number" && player.player_points !== 0;
  const line = compactStatLine(player, catalog, window);

  return (
    <div
      className={clsx(
        "flex min-w-0 items-start gap-2",
        mirrored && "flex-row-reverse text-right",
      )}
    >
      <Avatar player={player} size={28} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold text-fg">
          {player.name.full}
        </div>
        <div className="truncate font-mono text-[11px] text-fg-4">
          {player.editorial_team_abbr} · {player.display_position} ·{" "}
          <span
            className={clsx(
              game.kind === "live" && "font-semibold text-live",
              game.kind === "upcoming" && "font-semibold text-fg-2",
            )}
          >
            {game.label}
          </span>
        </div>
        <div className="truncate text-[11px] text-fg-3">
          {line || (played ? "" : "Yet to play")}
        </div>
      </div>
    </div>
  );
}

function PointsCell({
  player,
  leads,
  align,
}: {
  player: RosterPlayer | null;
  leads: boolean;
  align: "left" | "right";
}) {
  if (!player) return <div />;
  const pts = player.player_points;
  const live = gameStateForPlayer(player).kind === "live";
  const unplayed = pts === null || pts === undefined;

  return (
    <div
      className={clsx(
        "tabular-nums",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <div
        className={clsx(
          "font-mono text-[14px] font-bold",
          live && "pts-flash text-up",
          !live && unplayed && "text-fg-4",
          !live && !unplayed && (leads ? "text-fg" : "text-fg-3"),
        )}
      >
        {unplayed ? "—" : fmt(pts)}
      </div>
      <div className="font-mono text-[11px] text-fg-4">
        proj {fmt(projOf(player))}
      </div>
    </div>
  );
}

function TotalsFooter({
  user,
  opponent,
  final,
}: {
  user: MatchupTeam;
  opponent: MatchupTeam;
  final: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_64px_48px_64px_minmax(0,1fr)] items-center gap-2 border-t border-edge/40 bg-surface-2/60 px-3 py-2">
      <span className="truncate font-mono text-[11px] uppercase tracking-wider text-fg-4">
        Scored{!final && ` · proj ${fmt(user.projected_points)}`}
      </span>
      <span className="text-right font-mono text-[13px] font-bold tabular-nums text-fg">
        {teamScore(user).toFixed(1)}
      </span>
      <span className="text-center font-mono text-[11px] uppercase tracking-wider text-fg-4">
        Tot
      </span>
      <span className="text-left font-mono text-[13px] font-bold tabular-nums text-fg">
        {teamScore(opponent).toFixed(1)}
      </span>
      <span className="truncate text-right font-mono text-[11px] uppercase tracking-wider text-fg-4">
        {!final && `proj ${fmt(opponent.projected_points)} · `}Scored
      </span>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────

function Avatar({ player, size }: { player: RosterPlayer; size: number }) {
  if (player.image_url) {
    return (
      <img
        src={player.image_url}
        alt=""
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full bg-surface-3"
    />
  );
}

function fmt(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(1);
}

/** "K. Walker" — enough to identify without wrapping the chip. */
function shortName(full: string): string {
  const parts = full.split(" ");
  if (parts.length < 2) return full;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/**
 * Per-player projection. Flagged in the handoff as needing confirmation
 * that Yahoo exposes it for NFL; absent it, this returns null and every
 * caller renders "—" rather than a fabricated number.
 */
function projOf(player: RosterPlayer): number | null {
  const v = player.projected_points;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
