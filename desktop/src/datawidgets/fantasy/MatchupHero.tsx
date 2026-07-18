/**
 * MatchupHero — the tentpole element of the Fantasy channel.
 *
 * Renders the user's current head-to-head matchup as a large, animated
 * card. Live scores pulse on update, the win-probability bar slides with
 * each refresh, and projected finals are shown as faint numbers next to
 * the live score. This is the single visual that sells the channel.
 */
import { useEffect, useRef } from "react";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, Zap } from "lucide-react";
import {
  SPORT_EMOJI,
  sportLabel,
  estimateWinProbability,
  isMatchupLive,
  isMatchupFinal,
  teamScore,
  userMatchupContext,
  userPreviousMatchup,
} from "./types";
import type { LeagueResponse, MatchupTeam } from "./types";

interface MatchupHeroProps {
  league: LeagueResponse;
  /** Compact variant for multi-league Overview grids. */
  compact?: boolean;
  /** Optional click handler — links the hero to a deeper view. */
  onClick?: () => void;
}

export function MatchupHero({ league, compact = false, onClick }: MatchupHeroProps) {
  const ctx = userMatchupContext(league);
  const previous = userPreviousMatchup(league);

  if (!ctx) {
    return <MatchupHeroEmpty league={league} compact={compact} />;
  }

  const { matchup, user, opponent } = ctx;
  const live = isMatchupLive(matchup);
  const final = isMatchupFinal(matchup);
  const winProb = estimateWinProbability(matchup, league.team_key);

  const myPts = teamScore(user);
  const oppPts = teamScore(opponent);
  const myWinning = myPts > oppPts;
  const tied = Math.abs(myPts - oppPts) < 0.05;

  const myColor = final
    ? myWinning
      ? "text-up"
      : "text-down"
    : myWinning
      ? "text-up"
      : tied
        ? "text-fg"
        : "text-fg";
  const oppColor = final
    ? myWinning
      ? "text-down"
      : "text-up"
    : myWinning
      ? "text-fg"
      : tied
        ? "text-fg"
        : "text-fg";

  const statusLabel = final
    ? matchup.is_tied
      ? "Tied"
      : myWinning
        ? "You won"
        : "You lost"
    : live
      ? "Live"
      : `Week ${matchup.week}`;

  return (
    <button
      onClick={onClick}
      className={clsx(
        "group relative w-full overflow-hidden rounded-xl border text-left transition-all",
        "bg-gradient-to-br from-surface-2 via-surface to-surface-2",
        "border-edge/50 hover:border-accent/40",
        onClick && "cursor-pointer",
        compact ? "p-3" : "p-4 md:p-5",
      )}
      disabled={!onClick}
      type="button"
    >
      {/* Ambient glow when live */}
      {live && (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-xl"
          style={{
            background:
              "radial-gradient(circle at 50% 0%, rgba(244, 63, 94, 0.12), transparent 60%)",
          }}
          initial={{ opacity: 0.6 }}
          animate={{ opacity: [0.55, 0.9, 0.55] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Header row */}
      <div className="relative z-10 flex items-center gap-2">
        <span aria-hidden className="text-[15px]">
          {SPORT_EMOJI[league.game_code] ?? "🏆"}
        </span>
        <div className="flex flex-col leading-tight min-w-0 flex-1">
          <span className={clsx("font-mono uppercase tracking-wider text-[9px] text-fg-3")}>
            {sportLabel(league.game_code)} · Week {matchup.week}
            {matchup.is_playoffs && (
              <span className="ml-1 text-accent">· Playoffs</span>
            )}
          </span>
          <span className="truncate text-[12px] font-semibold text-fg">
            {league.name}
          </span>
        </div>
        <StatusPill status={statusLabel} live={live} />
      </div>

      {/* Matchup row */}
      <div
        className={clsx(
          "relative z-10 mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3",
        )}
      >
        {/* User team */}
        <TeamSide
          team={user}
          compact={compact}
          align="left"
          isUser
          colorClass={myColor}
        />

        {/* Center score */}
        <div
          className={clsx(
            "flex flex-col items-center tabular-nums font-mono",
            compact ? "gap-0.5" : "gap-1",
          )}
        >
          <div className={clsx("font-bold", compact ? "text-xl" : "text-3xl")}>
            <AnimatedScore value={myPts} colorClass={myColor} />
            <span className="mx-1 text-fg-3">–</span>
            <AnimatedScore value={oppPts} colorClass={oppColor} />
          </div>
          {(user.projected_points !== null || opponent.projected_points !== null) && (
            <div className="flex items-center gap-1 text-[10px] text-fg-3">
              <span>proj</span>
              <span>{formatProjection(user.projected_points)}</span>
              <span>·</span>
              <span>{formatProjection(opponent.projected_points)}</span>
            </div>
          )}
        </div>

        {/* Opponent team */}
        <TeamSide
          team={opponent}
          compact={compact}
          align="right"
          colorClass={oppColor}
        />
      </div>

      {/* Win probability bar */}
      {winProb !== null && (live || !final) && (
        <div className="relative z-10 mt-3">
          <WinProbabilityBar probability={winProb} />
          <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-wider text-fg-3">
            <span>You {Math.round(winProb * 100)}%</span>
            <span>{Math.round((1 - winProb) * 100)}% Opp</span>
          </div>
        </div>
      )}

      {/* Last week footnote */}
      {previous && !compact && (
        <div className="relative z-10 mt-3 flex items-center gap-2 border-t border-edge/40 pt-2 font-mono text-[10px] text-fg-3">
          <Zap size={10} className="text-fg-3" />
          <span>
            Last week: {previous.user.name.split(" ").slice(0, 2).join(" ")}{" "}
            <span className="tabular-nums">
              {teamScore(previous.user).toFixed(1)} – {teamScore(previous.opponent).toFixed(1)}
            </span>{" "}
            vs {previous.opponent.name.split(" ").slice(0, 2).join(" ")}
          </span>
        </div>
      )}
    </button>
  );
}

// ── Subcomponents ────────────────────────────────────────────────

function TeamSide({
  team,
  compact,
  align,
  colorClass,
  isUser,
}: {
  team: MatchupTeam;
  compact: boolean;
  align: "left" | "right";
  colorClass: string;
  isUser?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex min-w-0 items-center gap-2",
        align === "right" && "flex-row-reverse",
      )}
    >
      {team.team_logo ? (
        <img
          src={team.team_logo}
          alt=""
          className={clsx(
            "shrink-0 rounded-md object-cover",
            compact ? "h-7 w-7" : "h-10 w-10",
          )}
        />
      ) : (
        <div
          className={clsx(
            "shrink-0 rounded-md bg-surface-3",
            compact ? "h-7 w-7" : "h-10 w-10",
          )}
        />
      )}
      <div
        className={clsx(
          "flex min-w-0 max-w-full overflow-hidden flex-col leading-tight",
          align === "right" ? "items-end text-right" : "items-start text-left",
        )}
      >
        <span className={clsx("block max-w-full truncate text-[12px] font-semibold", colorClass)}>
          {team.name}
          {isUser && (
            <span className="ml-1 rounded bg-accent/20 px-1 py-[1px] font-mono text-[8px] uppercase tracking-wider text-accent">
              You
            </span>
          )}
        </span>
        {team.manager_name && (
          <span className="block max-w-full truncate text-[10px] text-fg-3">
            {team.manager_name}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, live }: { status: string; live: boolean }) {
  return (
    <span
      className={clsx(
        "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider",
        live
          ? "border border-live/40 bg-live/15 text-live"
          : "border border-edge/60 bg-surface-2 text-fg-3",
      )}
    >
      {live && (
        <motion.span
          className="h-1.5 w-1.5 rounded-full bg-live"
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {status}
    </span>
  );
}

function AnimatedScore({ value, colorClass }: { value: number; colorClass: string }) {
  const prev = useRef(value);
  const delta = value - prev.current;
  useEffect(() => {
    prev.current = value;
  }, [value]);
  return (
    <span className={clsx("relative inline-block tabular-nums", colorClass)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={value.toFixed(1)}
          initial={{ y: delta > 0 ? -12 : delta < 0 ? 12 : 0, opacity: delta !== 0 ? 0 : 1 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: delta > 0 ? 12 : -12, opacity: 0, position: "absolute" }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="inline-block"
        >
          {value.toFixed(1)}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function formatProjection(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

function WinProbabilityBar({ probability }: { probability: number }) {
  const pct = Math.max(4, Math.min(96, probability * 100));
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <motion.div
        className="h-full rounded-full bg-up"
        style={{ width: `${pct}%` }}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ type: "spring", stiffness: 130, damping: 24 }}
      />
    </div>
  );
}

// ── Empty state variant ──────────────────────────────────────────

function MatchupHeroEmpty({
  league,
  compact,
}: {
  league: LeagueResponse;
  compact: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-edge/40 bg-surface-2/50",
        compact ? "p-3" : "p-4",
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-[15px]">
          {SPORT_EMOJI[league.game_code] ?? "🏆"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-fg">
            {league.name}
          </div>
          <div className="text-[10px] text-fg-3">
            {sportLabel(league.game_code)} · {league.season}
          </div>
        </div>
        <Trophy size={14} className="text-fg-3" />
      </div>
      <p className="mt-3 text-[11px] text-fg-3">
        No matchup scheduled{league.data.is_finished ? " — season is complete." : " this week."}
      </p>
    </div>
  );
}
