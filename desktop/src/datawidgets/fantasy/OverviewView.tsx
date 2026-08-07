/**
 * OverviewView — mission control across every enabled fantasy league.
 *
 * Three bands: the weekly scorecard, an ON THE FIELD strip of the
 * players actually moving right now, and one uniform card per league.
 *
 * The old layout showed the primary league twice — once as a full
 * MatchupHero and again in the "Other leagues" strip — and gave the
 * secondary leagues a thinner treatment that made them read as less
 * real. Both are gone: every league gets the same card, live ones sort
 * first, and the primary one is the same card spanning two columns.
 */
import { useMemo } from "react";
import { clsx } from "clsx";
import { Flame, Medal, TrendingDown, TrendingUp } from "lucide-react";
import {
  countInjuries,
  estimateWinProbability,
  gameStateForPlayer,
  isBenchPosition,
  isMatchupFinal,
  isMatchupLive,
  teamScore,
  userMatchupContext,
  userRoster,
  userStanding,
} from "./types";
import type { LeagueResponse, RosterPlayer } from "./types";

interface OverviewViewProps {
  leagues: LeagueResponse[];
  primaryLeagueKey: string | null;
  onSelectLeague: (leagueKey: string) => void;
  onOpenMatchup: () => void;
}

export function OverviewView({
  leagues,
  primaryLeagueKey,
  onSelectLeague,
  onOpenMatchup,
}: OverviewViewProps) {
  const week = useMemo(() => summarizeWeek(leagues), [leagues]);
  const totalInjuries = useMemo(
    () => leagues.reduce((n, l) => n + countInjuries(userRoster(l)), 0),
    [leagues],
  );
  const field = useMemo(() => onTheField(leagues), [leagues]);

  // Live leagues first, then the primary, then the rest — the ordering a
  // user scans in when something is happening.
  const ordered = useMemo(() => {
    const score = (l: LeagueResponse) => {
      const ctx = userMatchupContext(l);
      if (ctx && isMatchupLive(ctx.matchup)) return 0;
      if (l.league_key === primaryLeagueKey) return 1;
      if (ctx && !isMatchupFinal(ctx.matchup)) return 2;
      return 3;
    };
    return [...leagues].sort((a, b) => score(a) - score(b));
  }, [leagues, primaryLeagueKey]);

  if (leagues.length === 0) return null;

  const open = (leagueKey: string) => {
    onSelectLeague(leagueKey);
    onOpenMatchup();
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      {leagues.length > 1 && <Scorecard week={week} injuries={totalInjuries} />}

      {field.length > 0 && <OnTheField players={field} />}

      <section className="flex flex-col gap-2">
        <div className="font-mono text-[11px] uppercase tracking-wider text-fg-3">
          Your leagues
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {ordered.map((l) => (
            <LeagueCard
              key={l.league_key}
              league={l}
              primary={l.league_key === primaryLeagueKey}
              onClick={() => open(l.league_key)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Weekly scorecard ─────────────────────────────────────────────

function Scorecard({
  week,
  injuries,
}: {
  week: WeekSummary;
  injuries: number;
}) {
  return (
    <div className="rounded-xl border border-edge/40 bg-surface-2/80 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15">
          <Flame size={18} className="text-accent" />
        </div>
        <div className="flex-1">
          <div className="font-mono text-[11px] uppercase tracking-wider text-fg-3">
            This week across all leagues
          </div>
          <div className="text-base font-bold text-fg">
            {week.wins}W · {week.losses}L
            {week.ties > 0 ? ` · ${week.ties}T` : ""}
            {week.live > 0 && (
              <span className="ml-2 font-mono text-[11px] font-medium text-live">
                · {week.live} live
              </span>
            )}
          </div>
          {week.points > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
              <span className="inline-flex items-center gap-1">
                <TrendingUp size={11} className="text-up" />
                {week.points.toFixed(1)} pts
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <TrendingDown size={11} className="text-down" />
                {week.pointsAgainst.toFixed(1)} against
              </span>
              {injuries > 0 && (
                <>
                  <span>·</span>
                  <span className="text-warn">
                    {injuries} injured roster spot{injuries === 1 ? "" : "s"}
                  </span>
                </>
              )}
              {week.inPlay > 0 && (
                <>
                  <span>·</span>
                  <span className="font-semibold text-live">
                    {week.inPlay} in play
                  </span>
                </>
              )}
              {week.yetToPlay > 0 && (
                <>
                  <span>·</span>
                  <span>{week.yetToPlay} yet to play</span>
                </>
              )}
            </div>
          )}
        </div>
        <RecordMedal record={week} />
      </div>
    </div>
  );
}

function RecordMedal({ record }: { record: WeekSummary }) {
  if (record.wins === 0 && record.losses === 0 && record.ties === 0)
    return null;
  const color =
    record.wins > record.losses
      ? "text-up"
      : record.wins < record.losses
        ? "text-down"
        : "text-fg";
  return (
    <div className={clsx("flex items-center gap-1 text-xs font-bold", color)}>
      <Medal size={14} />
    </div>
  );
}

// ── On the field ─────────────────────────────────────────────────

interface FieldPlayer {
  player: RosterPlayer;
  leagueName: string;
  live: boolean;
}

function OnTheField({ players }: { players: FieldPlayer[] }) {
  const live = players.filter((p) => p.live).length;
  const upcoming = players.length - live;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-fg-3">
          On the field
        </span>
        <span className="font-mono text-[11px] text-fg-4">
          {live} live · {upcoming} upcoming · across all leagues
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {players.map(({ player, leagueName, live: isLive }) => {
          const game = gameStateForPlayer(player);
          return (
            <div
              key={`${leagueName}-${player.player_key}`}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2",
                isLive
                  ? "border-live/35 bg-surface"
                  : "border-edge/40 bg-surface-2/40",
              )}
            >
              <Avatar player={player} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-fg">
                  {player.name.full}
                </div>
                <div className="truncate font-mono text-[11px] text-fg-4">
                  {player.editorial_team_abbr} · {player.display_position} —{" "}
                  {leagueName}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div
                  className={clsx(
                    "font-mono text-[14px] font-bold tabular-nums",
                    isLive ? "pts-flash text-up" : "text-fg-3",
                  )}
                >
                  {isLive
                    ? fmt(player.player_points)
                    : fmt(player.projected_points)}
                </div>
                <div
                  className={clsx(
                    "font-mono text-[11px]",
                    isLive ? "font-semibold text-live" : "text-fg-4",
                  )}
                >
                  {isLive ? game.label : `proj · ${game.label}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── League card ──────────────────────────────────────────────────

function LeagueCard({
  league,
  primary,
  onClick,
}: {
  league: LeagueResponse;
  primary: boolean;
  onClick: () => void;
}) {
  const ctx = userMatchupContext(league);
  const standing = userStanding(league);
  const live = ctx ? isMatchupLive(ctx.matchup) : false;
  const final = ctx ? isMatchupFinal(ctx.matchup) : false;
  const winProb = ctx
    ? estimateWinProbability(ctx.matchup, league.team_key)
    : null;

  const myPts = ctx ? teamScore(ctx.user) : null;
  const oppPts = ctx ? teamScore(ctx.opponent) : null;
  const margin = myPts !== null && oppPts !== null ? myPts - oppPts : null;

  const roster = userRoster(league);
  const top = roster ? topScorer(roster.data.players) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex w-full flex-col gap-3 rounded-[10px] border bg-surface p-3.5 text-left",
        live ? "border-live/35" : "border-edge/50",
        "hover:border-accent/40",
        primary && "lg:col-span-2",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-[14px]">
          🏈
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] uppercase tracking-wider text-fg-4">
            Football
            {ctx && ` · Week ${ctx.matchup.week}`}
            {primary && " · Primary"}
          </div>
          <div className="truncate text-[12px] font-semibold text-fg">
            {league.name}
          </div>
        </div>
        {ctx && (
          <span
            className={clsx(
              "shrink-0 rounded-full px-2 py-[1px] font-mono text-[11px] uppercase tracking-wider",
              live
                ? "bg-live/15 text-live"
                : final
                  ? "bg-surface-2 text-fg-3"
                  : "bg-surface-2 text-fg-3",
            )}
          >
            {live ? "Live" : final ? "Final" : `Wk ${ctx.matchup.week}`}
          </span>
        )}
      </div>

      {!ctx && (
        <div className="py-2 font-mono text-[11px] uppercase tracking-wider text-fg-4">
          No matchup this week
        </div>
      )}

      {ctx && (
        <>
          {/* Score grid */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <TeamSide
              name={ctx.user.name}
              meta={standingLabel(standing)}
              you
              align="left"
            />
            <div className="text-center font-mono tabular-nums">
              <div className="text-[22px] font-bold leading-none text-fg">
                {(myPts ?? 0).toFixed(1)}
                <span className="mx-1 text-fg-3">–</span>
                {(oppPts ?? 0).toFixed(1)}
              </div>
              {!final && (
                <div className="mt-1 text-[11px] text-fg-4">
                  proj {fmt(ctx.user.projected_points)} ·{" "}
                  {fmt(ctx.opponent.projected_points)}
                </div>
              )}
            </div>
            <TeamSide name={ctx.opponent.name} meta={null} align="right" />
          </div>

          {/* Win bar — meaningless once the result is settled */}
          {winProb !== null && !final && (
            <div>
              <div className="h-[5px] w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-up"
                  style={{ width: `${Math.round(winProb * 100)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[11px] uppercase tracking-wider text-fg-4">
                <span>You {Math.round(winProb * 100)}%</span>
                <span>{Math.round((1 - winProb) * 100)}% Opp</span>
              </div>
            </div>
          )}

          {/* Footer: who carried it, and what still matters */}
          <div className="flex items-center justify-between gap-3 border-t border-edge/20 pt-2">
            <span className="truncate text-[11px] text-fg-3">
              {top ? `Top: ${top.name.full} ${fmt(top.player_points)}` : " "}
            </span>
            <Urgency league={league} final={final} margin={margin} />
          </div>
        </>
      )}
    </button>
  );
}

function TeamSide({
  name,
  meta,
  you,
  align,
}: {
  name: string;
  meta: string | null;
  you?: boolean;
  align: "left" | "right";
}) {
  return (
    <div className={clsx("min-w-0", align === "right" && "text-right")}>
      <div className="truncate text-[12px] font-semibold text-fg">
        {name}
        {you && (
          <span className="ml-1 rounded bg-accent/20 px-1 py-[1px] font-mono text-[11px] uppercase tracking-wider text-accent">
            You
          </span>
        )}
      </div>
      {meta && (
        <div className="truncate font-mono text-[11px] tabular-nums text-fg-4">
          {meta}
        </div>
      )}
    </div>
  );
}

/**
 * The one line that says what to do about it. Live matchups name the
 * player who can still change the result; close pre-final ones flag the
 * risk; settled ones just report.
 */
function Urgency({
  league,
  final,
  margin,
}: {
  league: LeagueResponse;
  final: boolean;
  margin: number | null;
}) {
  const roster = userRoster(league);
  const players = roster?.data.players ?? [];
  const starters = players.filter((p) => !isBenchPosition(p.selected_position));
  const liveStarter = starters.find(
    (p) => gameStateForPlayer(p).kind === "live",
  );
  const yetToPlay = starters.filter(
    (p) => gameStateForPlayer(p).kind === "upcoming",
  ).length;

  if (final) {
    if (margin === null) return null;
    const won = margin > 0;
    return (
      <span
        className={clsx(
          "shrink-0 font-mono text-[11px] font-semibold",
          won ? "text-up" : "text-down",
        )}
      >
        {won ? "Won" : "Lost"} by {Math.abs(margin).toFixed(1)}
      </span>
    );
  }

  if (liveStarter && margin !== null && margin < 0) {
    // Smallest tenth that actually wins, not the tie.
    const need = Math.ceil((-margin + 0.05) * 10) / 10;
    return (
      <span className="shrink-0 font-mono text-[11px] font-semibold text-live">
        {lastName(liveStarter.name.full)} in play · need {need.toFixed(1)}
      </span>
    );
  }

  if (yetToPlay > 0) {
    const close = margin !== null && Math.abs(margin) < 10;
    return (
      <span
        className={clsx(
          "shrink-0 font-mono text-[11px] font-semibold",
          close ? "text-warn" : "text-fg-3",
        )}
      >
        {yetToPlay} yet to play{close ? " · one-score game" : ""}
      </span>
    );
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────────────────

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

function lastName(full: string): string {
  const parts = full.split(" ");
  return parts[parts.length - 1] ?? full;
}

function standingLabel(
  standing: ReturnType<typeof userStanding>,
): string | null {
  if (!standing) return null;
  const rank = standing.rank ? `#${standing.rank}` : "—";
  const record = `${standing.wins}-${standing.losses}${standing.ties > 0 ? `-${standing.ties}` : ""}`;
  return `${rank} · ${record}`;
}

function topScorer(players: RosterPlayer[]): RosterPlayer | null {
  let best: RosterPlayer | null = null;
  for (const p of players) {
    if (isBenchPosition(p.selected_position)) continue;
    if (typeof p.player_points !== "number") continue;
    if (!best || p.player_points > (best.player_points ?? 0)) best = p;
  }
  return best;
}

/**
 * Every starter across every league who is mid-game or still to play.
 * Live first, then upcoming. Empty whenever per-player game state is
 * absent, which is why the strip hides itself rather than rendering an
 * empty band.
 */
function onTheField(leagues: LeagueResponse[]): FieldPlayer[] {
  const out: FieldPlayer[] = [];
  for (const league of leagues) {
    const roster = userRoster(league);
    if (!roster) continue;
    for (const player of roster.data.players) {
      if (isBenchPosition(player.selected_position)) continue;
      const kind = gameStateForPlayer(player).kind;
      if (kind !== "live" && kind !== "upcoming") continue;
      out.push({ player, leagueName: league.name, live: kind === "live" });
    }
  }
  return out.sort((a, b) => Number(b.live) - Number(a.live));
}

// ── Week summary ─────────────────────────────────────────────────

interface WeekSummary {
  wins: number;
  losses: number;
  ties: number;
  live: number;
  points: number;
  pointsAgainst: number;
  inPlay: number;
  yetToPlay: number;
}

function summarizeWeek(leagues: LeagueResponse[]): WeekSummary {
  const summary: WeekSummary = {
    wins: 0,
    losses: 0,
    ties: 0,
    live: 0,
    points: 0,
    pointsAgainst: 0,
    inPlay: 0,
    yetToPlay: 0,
  };
  for (const league of leagues) {
    const ctx = userMatchupContext(league);
    const roster = userRoster(league);
    for (const p of roster?.data.players ?? []) {
      if (isBenchPosition(p.selected_position)) continue;
      const kind = gameStateForPlayer(p).kind;
      if (kind === "live") summary.inPlay += 1;
      else if (kind === "upcoming") summary.yetToPlay += 1;
    }
    if (!ctx) continue;
    summary.points += teamScore(ctx.user);
    summary.pointsAgainst += teamScore(ctx.opponent);
    if (isMatchupLive(ctx.matchup)) summary.live += 1;
    if (isMatchupFinal(ctx.matchup)) {
      const my = teamScore(ctx.user);
      const opp = teamScore(ctx.opponent);
      if (ctx.matchup.is_tied || Math.abs(my - opp) < 0.01) summary.ties += 1;
      else if (my > opp) summary.wins += 1;
      else summary.losses += 1;
    }
  }
  return summary;
}
