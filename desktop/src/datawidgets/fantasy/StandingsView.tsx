/**
 * StandingsView — playoff-aware league standings with seeding badges.
 *
 * Groups teams into a "Playoff Bound" bucket above the elimination line
 * and "On The Bubble / Outside" below. The user's team is highlighted.
 */
import { useMemo } from "react";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { Crown, Medal, Shield, Trophy } from "lucide-react";
import { fmtPoints, isPlayoffBound, playoffSpotCount, streakLabel } from "./types";
import type { LeagueResponse, StandingsEntry } from "./types";

interface StandingsViewProps {
  league: LeagueResponse | null;
}

export function StandingsView({ league }: StandingsViewProps) {
  const { sorted, cutoff, userTeamKey } = useMemo(() => {
    if (!league?.standings) return { sorted: [], cutoff: 0, userTeamKey: null };
    const items = [...league.standings].sort((a, b) => {
      const ra = a.rank ?? 999;
      const rb = b.rank ?? 999;
      if (ra !== rb) return ra - rb;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (
        parseFloat(String(b.points_for || 0)) - parseFloat(String(a.points_for || 0))
      );
    });
    return {
      sorted: items,
      cutoff: playoffSpotCount(league),
      userTeamKey: league.team_key ?? null,
    };
  }, [league]);

  if (!league || !league.standings || sorted.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[12px] text-fg-3">
        Standings not available for this league yet.
      </div>
    );
  }

  const inPlayoffs = sorted.filter((t) => isPlayoffBound(t, cutoff));
  const outOfPlayoffs = sorted.filter((t) => !isPlayoffBound(t, cutoff));

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-bold text-fg">
            <Trophy size={14} className="text-accent" />
            {league.name} Standings
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-3">
            {sorted.length} teams · top {cutoff} advance · Week{" "}
            {league.data.current_week ?? "—"}
          </div>
        </div>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-[28px_minmax(0,1fr)_repeat(3,_auto)] items-center gap-3 border-b border-edge/40 px-3 pb-2 font-mono text-[9px] uppercase tracking-wider text-fg-3">
        <span>#</span>
        <span>Team</span>
        <span className="text-right">W-L-T</span>
        <span className="text-right">PF</span>
        <span className="text-right">Streak</span>
      </div>

      {/* Playoff block */}
      {inPlayoffs.length > 0 && (
        <div className="space-y-[1px] overflow-hidden rounded-lg border border-up/30 bg-up/[0.04]">
          {inPlayoffs.map((t) => (
            <StandingRow
              key={t.team_key}
              entry={t}
              isUser={t.team_key === userTeamKey}
              zone="playoff"
              seedCap={cutoff}
            />
          ))}
        </div>
      )}

      {/* Cutoff marker */}
      {inPlayoffs.length > 0 && outOfPlayoffs.length > 0 && (
        <div className="relative flex items-center gap-2 py-1">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-warn/60 to-transparent" />
          <span className="font-mono text-[9px] uppercase tracking-wider text-warn">
            Playoff cut line
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-warn/60 to-transparent" />
        </div>
      )}

      {/* Outside block */}
      {outOfPlayoffs.length > 0 && (
        <div className="space-y-[1px] overflow-hidden rounded-lg border border-edge/40 bg-surface-2/40">
          {outOfPlayoffs.map((t) => (
            <StandingRow
              key={t.team_key}
              entry={t}
              isUser={t.team_key === userTeamKey}
              zone="outside"
              seedCap={cutoff}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Standing row ─────────────────────────────────────────────────

function StandingRow({
  entry,
  isUser,
  zone,
  seedCap,
}: {
  entry: StandingsEntry;
  isUser: boolean;
  zone: "playoff" | "outside";
  seedCap: number;
}) {
  const streak = streakLabel(entry.streak_type, entry.streak_value);
  const streakColor = entry.streak_type === "win"
    ? "text-up"
    : entry.streak_type === "loss"
      ? "text-down"
      : "text-fg-3";

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className={clsx(
        "grid grid-cols-[28px_minmax(0,1fr)_repeat(3,_auto)] items-center gap-3 px-3 py-2 font-mono tabular-nums transition-colors",
        isUser && "ring-1 ring-inset ring-accent/50 bg-accent/[0.06]",
        !isUser && zone === "playoff" && "bg-up/[0.02] hover:bg-up/[0.06]",
        !isUser && zone === "outside" && "hover:bg-surface-2",
      )}
    >
      {/* Rank + seed badge */}
      <div className="flex items-center gap-0.5 text-[12px] font-bold text-fg">
        {entry.rank ?? "—"}
        {entry.clinched_playoffs && (
          <Crown size={10} className="text-amber-400" aria-label="Clinched" />
        )}
        {!entry.clinched_playoffs &&
          typeof entry.playoff_seed === "number" &&
          entry.playoff_seed === 1 && (
            <Medal size={10} className="text-amber-400" aria-label="#1 seed" />
          )}
      </div>

      {/* Team name + manager */}
      <div className="flex min-w-0 items-center gap-2 text-[12px]">
        {entry.team_logo ? (
          <img
            src={entry.team_logo}
            alt=""
            className="h-5 w-5 shrink-0 rounded"
          />
        ) : (
          <div className="h-5 w-5 shrink-0 rounded bg-surface-3" />
        )}
        <div className="min-w-0">
          <div
            className={clsx(
              "truncate text-[12px] font-semibold leading-tight",
              isUser && "text-accent",
            )}
          >
            {entry.name}
            {isUser && (
              <span className="ml-1 rounded bg-accent/20 px-1 py-[1px] text-[8px] uppercase tracking-wider">
                You
              </span>
            )}
          </div>
          {entry.manager_name && (
            <div className="truncate text-[9px] text-fg-3">
              {entry.manager_name}
            </div>
          )}
        </div>
      </div>

      {/* Record */}
      <div className="text-right text-[11px] text-fg-2">
        {entry.wins}-{entry.losses}
        {entry.ties > 0 && `-${entry.ties}`}
      </div>

      {/* Points for */}
      <div className="text-right text-[11px] text-fg-2">
        {fmtPoints(entry.points_for)}
      </div>

      {/* Streak */}
      <div className={clsx("text-right text-[11px] font-semibold", streakColor)}>
        {streak}
      </div>

      {/* Seed label for playoff-bound teams */}
      {zone === "playoff" &&
        typeof entry.playoff_seed === "number" &&
        entry.playoff_seed <= seedCap && (
          <div className="col-span-full -mt-1.5 -mb-1 pl-[40px] font-mono text-[9px] uppercase tracking-wider text-up/70">
            {seedLabel(entry.playoff_seed)}
            {entry.clinched_playoffs && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-400">
                <Shield size={9} />
                Clinched
              </span>
            )}
          </div>
        )}
    </motion.div>
  );
}

function seedLabel(seed: number): string {
  if (seed === 1) return "#1 seed · bye";
  if (seed === 2) return "#2 seed · bye";
  return `#${seed} seed`;
}
