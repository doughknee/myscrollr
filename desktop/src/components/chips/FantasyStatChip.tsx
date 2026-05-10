import { clsx } from "clsx";
import { motion } from "motion/react";
import type { ChipColorMode, FantasyDisplayPrefs } from "../../preferences";
import { shouldShowOnTicker } from "../../preferences";
import type { LeagueResponse } from "../../channels/fantasy/types";
import {
  SPORT_EMOJI,
  countInjuries,
  estimateWinProbability,
  fmtPlayerPoints,
  isBenchPosition,
  isMatchupFinal,
  isMatchupLive,
  streakLabel,
  teamScore,
  userMatchupContext,
  userRoster,
  userStanding,
} from "../../channels/fantasy/types";
import { getChipColors, chipBaseClasses } from "./chipColors";

interface FantasyStatChipProps {
  league: LeagueResponse;
  prefs: FantasyDisplayPrefs;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  onClick?: () => void;
}

interface StatSegment {
  key: string;
  text: string;
  tone?: "neutral" | "up" | "down" | "live";
}

/**
 * Compact fantasy ticker chip that renders the ENABLED subset of the
 * per-league items gated by the user's per-item `Venue` prefs.
 *
 * This chip replaces the older `FantasyChip` for ticker use. It keeps
 * the same visual footprint (single row when `comfort=false`, two rows
 * when true) but composes the contents from whichever items the user
 * has routed to the ticker via the Display page's `<DisplayLocationGrid>`
 * controls.
 *
 * Each segment is opt-in:
 *   Matchup-derived:
 *   - `matchupScore` — "My Team 89.5 — 76.2 Opp"
 *   - `matchupStatus` — LIVE / FINAL / PRE badge
 *   - `week` — "Wk 5"
 *   - `projectedPoints` — "Proj 95.2"
 *   - `winProbability` — "62%"
 *   Standings-derived:
 *   - `record` — "6-3"
 *   - `standingsPosition` — "3rd / 10"
 *   - `streak` — "W3"
 *   Roster-derived:
 *   - `injuryCount` — "2 IR"
 *   - `topScorer` — "LeBron 42.3"
 *   Player-stats (Phase 1, 2026-04-25):
 *   - `topThreeScorers` — "Mahomes 32 · Hill 18 · CMC 14"
 *   - `worstStarter` — "Worst: Andrews 0.0"
 *   - `benchOpportunity` — "Bench: Pacheco 18.0"
 *   - `injuryDetail` — "🚨 Saquon OUT, Mixon DTD"
 *
 * Segments render only when their data is available for this league
 * (e.g. `standingsPosition` skips pre-season; `topScorer` skips rosters
 * with all-zero points). A league with ZERO ticker-enabled items
 * collapses to a name-only chip so the user still sees something
 * meaningful per-league.
 */
export default function FantasyStatChip({
  league,
  prefs,
  comfort,
  colorMode = "channel",
  onClick,
}: FantasyStatChipProps) {
  const c = getChipColors(colorMode, "fantasy");
  const ctx = userMatchupContext(league);
  const standing = userStanding(league);
  const roster = userRoster(league);

  // Two segment buckets:
  //   primary  — matchup state ("how am I doing in this game?"):
  //              week, status, score, projected, win%
  //   secondary — context + player highlights ("what should I act on?"):
  //              record, position, streak, injuries, top scorers,
  //              worst, bench, injury details
  //
  // In COMFORT mode, primary segments share row 1 with the league
  // name/emoji and secondary segments live on row 2 next to the
  // opponent (which used to be the only thing on row 2 — sparse).
  // In COMPACT mode, both buckets concat and render inline, same
  // behavior as before.
  const primarySegments: StatSegment[] = [];
  const secondarySegments: StatSegment[] = [];
  let live = false;
  let final = false;
  let scoreTone: "neutral" | "up" | "down" = "neutral";

  // ── Matchup-derived (primary row) ────────────────────────────
  if (ctx) {
    live = isMatchupLive(ctx.matchup);
    final = isMatchupFinal(ctx.matchup);
    const myPts = teamScore(ctx.user);
    const oppPts = teamScore(ctx.opponent);
    if (myPts > oppPts) scoreTone = "up";
    else if (myPts < oppPts) scoreTone = "down";

    if (shouldShowOnTicker(prefs.week)) {
      primarySegments.push({ key: "week", text: `Wk ${ctx.matchup.week}` });
    }

    if (shouldShowOnTicker(prefs.matchupStatus)) {
      if (live) primarySegments.push({ key: "status", text: "LIVE", tone: "live" });
      else if (final) primarySegments.push({ key: "status", text: "FINAL" });
      else if (ctx.matchup.status === "preevent") primarySegments.push({ key: "status", text: "PRE" });
    }

    if (shouldShowOnTicker(prefs.matchupScore)) {
      const scoreText = `${fmtPlayerPoints(myPts)}–${fmtPlayerPoints(oppPts)}`;
      primarySegments.push({ key: "score", text: scoreText, tone: scoreTone });
    }

    if (shouldShowOnTicker(prefs.projectedPoints) && typeof ctx.user.projected_points === "number") {
      primarySegments.push({ key: "proj", text: `Proj ${ctx.user.projected_points.toFixed(1)}` });
    }

    if (shouldShowOnTicker(prefs.winProbability)) {
      const wp = estimateWinProbability(ctx.matchup, league.team_key);
      if (wp !== null) {
        primarySegments.push({
          key: "wp",
          text: `${Math.round(wp * 100)}%`,
          tone: wp >= 0.5 ? "up" : "down",
        });
      }
    }
  }

  // ── Standings-derived (secondary row) ───────────────────────
  if (standing) {
    if (shouldShowOnTicker(prefs.record)) {
      const { wins, losses, ties } = standing;
      const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
      secondarySegments.push({ key: "record", text: record });
    }

    if (shouldShowOnTicker(prefs.standingsPosition) && typeof standing.rank === "number") {
      secondarySegments.push({
        key: "rank",
        text: `${ordinal(standing.rank)}/${league.data.num_teams ?? "?"}`,
      });
    }

    if (shouldShowOnTicker(prefs.streak) && standing.streak_value > 0) {
      secondarySegments.push({
        key: "streak",
        text: streakLabel(standing.streak_type, standing.streak_value),
        tone: standing.streak_type.toLowerCase().startsWith("w") ? "up" : "down",
      });
    }
  }

  // ── Roster-derived (secondary row) ──────────────────────────
  if (roster) {
    if (shouldShowOnTicker(prefs.injuryCount)) {
      const injuries = countInjuries(roster);
      if (injuries > 0) {
        secondarySegments.push({ key: "inj", text: `${injuries} IR`, tone: "down" });
      }
    }

    if (shouldShowOnTicker(prefs.topScorer)) {
      const top = findTopScorer(roster.data.players);
      if (top) {
        secondarySegments.push({
          key: "top",
          text: `★ ${top.name.last} ${top.player_points!.toFixed(1)}`,
          tone: "up",
        });
      }
    }

    // ── Phase 1 player-stats — each as its own visual segment ──
    // Splitting top3 into 3 separate segments (rather than one
    // "A · B · C" blob) gives each player a colored chip-within-the-
    // chip, scannable in a scrolling ticker. Each degrades silently
    // when its data is meaningless (pre-kickoff zeros, healthy
    // roster, single-starter teams).

    if (shouldShowOnTicker(prefs.topThreeScorers)) {
      const top3 = findTopN(roster.data.players, 3, { startersOnly: true });
      // Skip the FIRST entry if topScorer is also enabled — it would
      // be a duplicate. The user opted in to both prefs but they
      // shouldn't see "★ Mahomes 32 · Mahomes 32 · Hill 18 · CMC 14".
      const startIdx = shouldShowOnTicker(prefs.topScorer) && top3.length > 0 ? 1 : 0;
      for (let i = startIdx; i < top3.length; i++) {
        const p = top3[i];
        secondarySegments.push({
          key: `top${i + 1}`,
          text: `${p.name.last} ${formatPts(p.player_points!)}`,
          tone: "up",
        });
      }
    }

    if (shouldShowOnTicker(prefs.worstStarter)) {
      const worst = findWorstStarter(roster.data.players);
      if (worst) {
        secondarySegments.push({
          key: "worst",
          text: `↓ ${worst.name.last} ${formatPts(worst.player_points!)}`,
          tone: "down",
        });
      }
    }

    if (shouldShowOnTicker(prefs.benchOpportunity)) {
      const topBench = findTopBench(roster.data.players);
      if (topBench && (topBench.player_points ?? 0) > 0) {
        secondarySegments.push({
          key: "bench",
          text: `BN ${topBench.name.last} ${formatPts(topBench.player_points!)}`,
        });
      }
    }

    if (shouldShowOnTicker(prefs.injuryDetail)) {
      const injuredText = formatInjuryList(roster.data.players, 2);
      if (injuredText) {
        secondarySegments.push({ key: "injd", text: `🚨 ${injuredText}`, tone: "down" });
      }
    }
  }

  // In compact mode (single-line ticker), pour everything into a
  // single segment list. In comfort mode, the two buckets render on
  // their own rows.
  const allSegments = comfort ? primarySegments : [...primarySegments, ...secondarySegments];

  // ── Render ─────────────────────────────────────────────────

  return (
    <button
      type="button"
      onClick={onClick}
      className={chipBaseClasses(comfort, c, "font-mono whitespace-nowrap")}
    >
      <div className={clsx("flex items-center gap-2", comfort && "text-ui-body")}>
        <span aria-hidden>{SPORT_EMOJI[league.game_code] ?? "🏆"}</span>
        {live && (
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-live"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <span className={clsx("font-medium truncate max-w-[180px]", c.text)}>
          {league.name}
        </span>
        {allSegments.map((seg) => (
          <span
            key={seg.key}
            className={clsx(
              "tabular-nums font-medium",
              seg.tone === "up" && "text-up",
              seg.tone === "down" && "text-down",
              seg.tone === "live" && "text-live uppercase tracking-wider text-ui-chip",
              !seg.tone && c.textDim,
            )}
          >
            {seg.text}
          </span>
        ))}
      </div>
      {comfort && (
        <div className={clsx("flex items-center gap-2 text-ui-chip", c.textFaint)}>
          {ctx && (
            <>
              <span className="uppercase tracking-wider shrink-0">
                {final ? "Final" : live ? "Live" : `Wk ${ctx.matchup.week}`}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate max-w-[160px]">vs {ctx.opponent.name}</span>
            </>
          )}
          {secondarySegments.map((seg) => (
            <span
              key={seg.key}
              className={clsx(
                "tabular-nums font-medium shrink-0",
                seg.tone === "up" && "text-up",
                seg.tone === "down" && "text-down",
                !seg.tone && c.textDim,
              )}
            >
              {seg.text}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Helpers ──────────────────────────────────────────────────

type Player = ReturnType<typeof userRoster> extends infer R
  ? R extends null | undefined
    ? never
    : R extends { data: { players: infer P } }
      ? P extends (infer Elt)[]
        ? Elt
        : never
      : never
  : never;

/** Highest-`player_points` active-roster player with a non-null score. */
function findTopScorer(players: Player[]): Player | null {
  let best: Player | null = null;
  let bestPoints = -Infinity;
  for (const p of players) {
    if (isBenchPosition(p.selected_position)) continue;
    if (p.player_points === null || p.player_points === undefined) continue;
    if (p.player_points > bestPoints) {
      best = p;
      bestPoints = p.player_points;
    }
  }
  return best;
}

/** Top-N players by `player_points`, descending. Ties broken by
 *  the order they appear in the roster (Yahoo's natural sort).
 *  Filters out players with null `player_points`. When
 *  `startersOnly: true`, bench positions are excluded. */
function findTopN(
  players: Player[],
  n: number,
  opts: { startersOnly?: boolean } = {},
): Player[] {
  const candidates = players.filter((p) => {
    if (p.player_points === null || p.player_points === undefined) return false;
    if (opts.startersOnly && isBenchPosition(p.selected_position)) return false;
    return true;
  });
  candidates.sort((a, b) => (b.player_points ?? 0) - (a.player_points ?? 0));
  return candidates.slice(0, n);
}

/** Lowest-`player_points` active-roster (non-bench) player. Returns
 *  null when there are fewer than 2 starters with scores — at that
 *  point "worst" overlaps with `topScorer` and is redundant noise. */
function findWorstStarter(players: Player[]): Player | null {
  const starters = players.filter(
    (p) =>
      !isBenchPosition(p.selected_position) &&
      p.player_points !== null &&
      p.player_points !== undefined,
  );
  if (starters.length < 2) return null;
  starters.sort((a, b) => (a.player_points ?? 0) - (b.player_points ?? 0));
  return starters[0];
}

/** Highest-`player_points` REAL bench player (BN only — explicitly NOT
 *  IR/IL/NA). Used to surface sit/start regret: "you could have started
 *  this benched player instead." Injured-reserve slots aren't sittable
 *  in the conventional sense, so including them in the comparison
 *  would mislead. Returns null when there are no eligible bench players
 *  or none have valid scores. */
function findTopBench(players: Player[]): Player | null {
  let best: Player | null = null;
  let bestPoints = -Infinity;
  for (const p of players) {
    if (!isStrictBench(p.selected_position)) continue;
    if (p.player_points === null || p.player_points === undefined) continue;
    if (p.player_points > bestPoints) {
      best = p;
      bestPoints = p.player_points;
    }
  }
  return best;
}

/** Stricter than `isBenchPosition` — returns true only for actual bench
 *  slots ("BN"), not injured-reserve / not-active slots. Use this when
 *  the question is "could the user have started this player?" */
function isStrictBench(pos: string): boolean {
  return pos.toUpperCase() === "BN";
}

/** Compose a comma-separated list of injured players up to `cap` names,
 *  with "+N more" overflow when the cap is exceeded. Returns "" when
 *  no players have an injury status (so the caller can skip rendering
 *  the whole segment). */
function formatInjuryList(players: Player[], cap: number): string {
  const injured = players.filter((p) => isInjured(p.status));
  if (injured.length === 0) return "";
  const head = injured.slice(0, cap).map((p) => `${p.name.last} ${shortStatus(p.status)}`);
  const overflow = injured.length - cap;
  return overflow > 0 ? `${head.join(", ")}, +${overflow} more` : head.join(", ");
}

/** Yahoo injury-status strings indicating the player isn't fully
 *  available. Matches what users see in the UI: OUT, DTD, IR, IR-R,
 *  PUP, NA, SUSP, etc. Empty / null = healthy. */
function isInjured(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.trim().toUpperCase();
  if (s === "" || s === "HEALTHY" || s === "P") return false;
  return true;
}

/** Squash long Yahoo status codes (IR-R, IR-LT, NA, etc) into the
 *  short form users recognize. Unknown values pass through unchanged. */
function shortStatus(status: string | null | undefined): string {
  if (!status) return "";
  const s = status.trim().toUpperCase();
  if (s.startsWith("IR")) return "IR";
  return s;
}

/** Compact one-decimal fixed-point that matches `fmtPlayerPoints` for
 *  individual-player segments. Centralized so all per-player segments
 *  format identically. */
function formatPts(points: number): string {
  return points.toFixed(1);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
