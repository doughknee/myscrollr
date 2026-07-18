/**
 * OverviewView — weekly scorecard across every enabled fantasy league.
 *
 * Shows a summary hero ("You're 2-1 this week"), the primary league's
 * live matchup in full detail, and a compact strip of every other
 * league's matchup below. The user can click any secondary tile to make
 * it the active/primary league.
 */
import { useMemo } from "react";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { Flame, Medal, TrendingDown, TrendingUp } from "lucide-react";
import {
  isMatchupFinal,
  isMatchupLive,
  teamScore,
  userMatchupContext,
  userStanding,
  countInjuries,
  userRoster,
} from "./types";
import { MatchupHero } from "./MatchupHero";
import { FEED_CARD, FEED_CARD_INTERACTIVE } from "../../components/feedCard";
import type { LeagueResponse } from "./types";

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
  const primary = useMemo(() => {
    if (primaryLeagueKey) {
      const match = leagues.find((l) => l.league_key === primaryLeagueKey);
      if (match) return match;
    }
    // Fallback: prefer an active league with a live matchup, then any active league.
    const live = leagues.find((l) => {
      const ctx = userMatchupContext(l);
      return ctx && isMatchupLive(ctx.matchup);
    });
    if (live) return live;
    const active = leagues.find((l) => !l.data.is_finished);
    return active ?? leagues[0] ?? null;
  }, [leagues, primaryLeagueKey]);

  const week = useMemo(() => summarizeWeek(leagues), [leagues]);
  const totalInjuries = useMemo(
    () => leagues.reduce((n, l) => n + countInjuries(userRoster(l)), 0),
    [leagues],
  );

  if (leagues.length === 0) return null;

  const showScorecard = leagues.length > 1;
  const others = primary
    ? leagues.filter((l) => l.league_key !== primary.league_key)
    : leagues;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Scorecard — only relevant with 2+ leagues */}
      {showScorecard && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          className="rounded-xl border border-edge/40 bg-surface-2/80 p-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15">
              <Flame size={18} className="text-accent" />
            </div>
            <div className="flex-1">
              <div className="font-mono text-[10px] uppercase tracking-wider text-fg-3">
                This week across all leagues
              </div>
              <div className="text-base font-bold text-fg">
                {week.wins}W · {week.losses}L{week.ties > 0 ? ` · ${week.ties}T` : ""}
                {week.live > 0 && (
                  <span className="ml-2 font-mono text-[11px] font-medium text-live">
                    · {week.live} live
                  </span>
                )}
              </div>
              {week.points > 0 && (
                <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-3">
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp size={11} className="text-up" />
                    {week.points.toFixed(1)} pts
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <TrendingDown size={11} className="text-down" />
                    {week.pointsAgainst.toFixed(1)} against
                  </span>
                  {totalInjuries > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-warn">
                        {totalInjuries} injured roster spot{totalInjuries === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <RecordMedal record={week} />
          </div>
        </motion.div>
      )}

      {/* Primary league hero */}
      {primary && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32, delay: 0.05 }}
        >
          <MatchupHero league={primary} onClick={onOpenMatchup} />
        </motion.div>
      )}

      {/* Other leagues strip */}
      {others.length > 0 && (
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-3">
            Other leagues
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {others.map((l, i) => (
              <motion.div
                key={l.league_key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 380,
                  damping: 34,
                  delay: 0.08 + i * 0.03,
                }}
              >
                <MiniLeagueTile
                  league={l}
                  onClick={() => onSelectLeague(l.league_key)}
                />
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────

function RecordMedal({ record }: { record: WeekSummary }) {
  if (record.wins === 0 && record.losses === 0 && record.ties === 0) return null;
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

function MiniLeagueTile({
  league,
  onClick,
}: {
  league: LeagueResponse;
  onClick: () => void;
}) {
  const ctx = userMatchupContext(league);
  const standing = userStanding(league);
  const live = ctx ? isMatchupLive(ctx.matchup) : false;
  const final = ctx ? isMatchupFinal(ctx.matchup) : false;
  const myPts = ctx ? teamScore(ctx.user) : null;
  const oppPts = ctx ? teamScore(ctx.opponent) : null;
  const myWinning = myPts !== null && oppPts !== null && myPts > oppPts;
  const myLosing = myPts !== null && oppPts !== null && myPts < oppPts;

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        FEED_CARD,
        FEED_CARD_INTERACTIVE,
        "flex w-full items-center gap-3 text-left",
        live && "border-live/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold text-fg">
            {league.name}
          </span>
          {live && (
            <span className="rounded-full bg-live/20 px-1.5 py-[1px] font-mono text-[8px] font-medium uppercase tracking-wider text-live">
              Live
            </span>
          )}
        </div>
        {standing && (
          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-fg-3">
            {standing.rank ? `#${standing.rank}` : "—"} · {standing.wins}-
            {standing.losses}
            {standing.ties > 0 ? `-${standing.ties}` : ""}
          </div>
        )}
      </div>
      {ctx ? (
        <div className="text-right font-mono tabular-nums">
          <div
            className={clsx(
              "text-sm font-bold",
              final && myWinning && "text-up",
              final && myLosing && "text-down",
              !final && myWinning && "text-up",
            )}
          >
            {(myPts ?? 0).toFixed(1)}
            <span className="mx-1 text-fg-3">–</span>
            {(oppPts ?? 0).toFixed(1)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-fg-3">
            {final ? "Final" : live ? "In progress" : `Wk ${ctx.matchup.week}`}
          </div>
        </div>
      ) : (
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-3">
          No matchup
        </div>
      )}
    </button>
  );
}

// ── Week summary ─────────────────────────────────────────────────

interface WeekSummary {
  wins: number;
  losses: number;
  ties: number;
  live: number;
  points: number;
  pointsAgainst: number;
}

function summarizeWeek(leagues: LeagueResponse[]): WeekSummary {
  const summary: WeekSummary = {
    wins: 0,
    losses: 0,
    ties: 0,
    live: 0,
    points: 0,
    pointsAgainst: 0,
  };
  for (const league of leagues) {
    const ctx = userMatchupContext(league);
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
