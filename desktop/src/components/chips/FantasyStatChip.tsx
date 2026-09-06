import { clsx } from "clsx";
import { motion } from "motion/react";
import { AnimateNumber } from "motion-plus/react";
import type { ReactNode } from "react";
import type { ChipColorMode } from "../../preferences";
import type { LeagueResponse } from "../../datawidgets/fantasy/types";
import {
  SPORT_EMOJI,
  countInjuries,
  estimateWinProbability,
  fmtPlayerPoints,
  isMatchupFinal,
  isMatchupLive,
  streakLabel,
  teamScore,
  userMatchupContext,
  userRoster,
  userStanding,
} from "../../datawidgets/fantasy/types";
import { findTopScorer } from "../../datawidgets/fantasy/playerStats";
import {
  getChipColors,
  chipBaseClasses,
  stableNum,
  NUM_WIDTH,
} from "./chipColors";
import { ChipSpine } from "./ChipSpine";
import { ChipFlash, useChangeFlash } from "./ChipFlash";

interface FantasyStatChipProps {
  league: LeagueResponse;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  onClick?: () => void;
  /**
   * Roll the score's digits when it changes instead of swapping them.
   *
   * OFF BY DEFAULT, and that default is load-bearing. `#app-shell` stills
   * every animation so the main window gets a steady bar — but that rule
   * is CSS, and AnimateNumber animates through WAAPI, which
   * `animation: none` has no authority over. So this can't be
   * attribute-gated the way the spine glow and marquee are; it has to be
   * refused in React or it would quietly break the calm-app decision.
   *
   * The ticker window, which has no such rule, opts in.
   */
  rollScore?: boolean;
}

interface StatSegment {
  key: string;
  text: string;
  tone?: "neutral" | "up" | "down" | "live";
  /**
   * Rendered instead of `text` when present. `text` stays required and
   * accurate regardless — it's the accessible label and the fallback.
   */
  node?: ReactNode;
  /**
   * Characters of width to reserve, for segments whose value changes
   * while the chip is on screen. Without it a score gaining a digit
   * widens the chip and shoves every chip after it along the rail.
   * Omit for segments whose text is fixed for the life of the chip.
   */
  width?: number;
}

/**
 * Compact fantasy ticker chip: one per league, a fixed set of segments
 * (docs/CHIP_SPEC.md §8 — nothing on the rail is user-selected).
 *
 * Single row when `comfort=false`, two rows when true. The segments:
 *   Matchup-derived:  "Wk 5" · LIVE / FINAL / PRE · "89.5–76.2" ·
 *                     "Proj 95.2" · "62%"
 *   Standings-derived: "6-3" · "3rd/10" · "W3"
 *   Roster-derived:    "2 IR" · "★ LeBron 42.3"
 *
 * Each renders only when its data exists for this league (standings
 * skip pre-season; the top scorer skips an all-zero roster), so a
 * league with nothing yet collapses to a name-only chip.
 *
 * Per-player items (top scorers, worst starter, bench top, injury
 * report) are standalone chips emitted by the fantasy ticker source
 * with `FollowedPlayerChip` + an `accent`, not segments here.
 */
export default function FantasyStatChip({
  league,
  comfort,
  colorMode = "widget",
  onClick,
  rollScore = false,
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

    primarySegments.push({ key: "week", text: `Wk ${ctx.matchup.week}` });

    if (live)
      primarySegments.push({ key: "status", text: "LIVE", tone: "live" });
    else if (final) primarySegments.push({ key: "status", text: "FINAL" });
    else if (ctx.matchup.status === "preevent")
      primarySegments.push({ key: "status", text: "PRE" });

    const scoreText = `${fmtPlayerPoints(myPts)}–${fmtPlayerPoints(oppPts)}`;
    primarySegments.push({
      key: "score",
      text: scoreText,
      tone: scoreTone,
      // Both sides plus the separator. Reserved as one block so the
      // dash never walks left as a score crosses into three figures.
      width: NUM_WIDTH.teamScore * 2 + 1,
      node: rollScore ? (
        <RollingScore myPts={myPts} oppPts={oppPts} label={scoreText} />
      ) : undefined,
    });

    if (typeof ctx.user.projected_points === "number") {
      primarySegments.push({
        key: "proj",
        text: `Proj ${ctx.user.projected_points.toFixed(1)}`,
      });
    }

    const wp = estimateWinProbability(ctx.matchup, league.team_key);
    if (wp !== null) {
      primarySegments.push({
        key: "wp",
        text: `${Math.round(wp * 100)}%`,
        tone: wp >= 0.5 ? "up" : "down",
        // 65% -> 100% gains a digit, and a win probability crossing
        // three figures is exactly the moment the rail must hold
        // still rather than nudge every chip along.
        width: NUM_WIDTH.percent,
      });
    }
  }

  // ── Standings-derived (secondary row) ───────────────────────
  if (standing) {
    const { wins, losses, ties } = standing;
    const record =
      ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    secondarySegments.push({ key: "record", text: record });

    if (typeof standing.rank === "number") {
      secondarySegments.push({
        key: "rank",
        text: `${ordinal(standing.rank)}/${league.data.num_teams ?? "?"}`,
      });
    }

    if (standing.streak_value > 0) {
      secondarySegments.push({
        key: "streak",
        text: streakLabel(standing.streak_type, standing.streak_value),
        tone: standing.streak_type.toLowerCase().startsWith("w")
          ? "up"
          : "down",
      });
    }
  }

  // ── Roster-derived (secondary row) ──────────────────────────
  if (roster) {
    const injuries = countInjuries(roster);
    if (injuries > 0) {
      secondarySegments.push({
        key: "inj",
        text: `${injuries} IR`,
        tone: "down",
      });
    }

    const top = findTopScorer(roster.data.players);
    if (top) {
      secondarySegments.push({
        key: "top",
        text: `★ ${top.name.last} ${top.player_points!.toFixed(1)}`,
        tone: "up",
      });
    }
  }

  // In compact mode (single-line ticker), pour everything into a
  // single segment list. In comfort mode, the two buckets render on
  // their own rows.
  const allSegments = comfort
    ? primarySegments
    : [...primarySegments, ...secondarySegments];

  // Spine fill. Win probability where we have one; otherwise the share
  // of the combined score the user holds, which is a cruder but always
  // available read. Null only when there's no matchup at all.
  const spineFill = (() => {
    if (!ctx) return null;
    const wp = estimateWinProbability(ctx.matchup, league.team_key);
    if (wp !== null) return wp;
    const mine = teamScore(ctx.user);
    const total = mine + teamScore(ctx.opponent);
    return total > 0 ? mine / total : 0;
  })();
  const userWon = ctx ? teamScore(ctx.user) > teamScore(ctx.opponent) : false;

  // Flash on the USER's score only. The opponent's moving is their
  // business; the chip exists to answer "did anything happen to me".
  const flashToken = useChangeFlash(ctx ? teamScore(ctx.user) : null);

  // ── Render ─────────────────────────────────────────────────

  return (
    <button
      type="button"
      onClick={onClick}
      className={chipBaseClasses(comfort, c, "font-mono whitespace-nowrap")}
    >
      {/* Spine: win probability, so a rail of league chips can be read
          without parsing any of them. Pre-game it's a projection and
          renders at reduced strength; final it fills and takes the
          result's colour. */}
      <ChipFlash token={flashToken} tone={scoreTone === "down" ? "down" : "up"} />
      {ctx && (
        <ChipSpine
          fill={spineFill ?? 0}
          state={final ? "final" : live ? "live" : "pre"}
          tone={final ? (userWon ? "up" : "down") : "accent"}
        />
      )}
      <div
        className={clsx("flex items-center gap-2", comfort && "text-ui-body")}
      >
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
            style={seg.width ? stableNum(seg.width) : undefined}
            className={clsx(
              "tabular-nums font-medium",
              seg.tone === "up" && "text-up",
              seg.tone === "down" && "text-down",
              seg.tone === "live" &&
                "text-live uppercase tracking-wider text-ui-chip",
              !seg.tone && c.textDim,
            )}
          >
            {seg.node ?? seg.text}
          </span>
        ))}
      </div>
      {comfort && (
        <div
          className={clsx("flex items-center gap-2 text-ui-chip", c.textFaint)}
        >
          {ctx && (
            <>
              <span className="uppercase tracking-wider shrink-0">
                {final ? "Final" : live ? "Live" : `Wk ${ctx.matchup.week}`}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate max-w-[160px]">
                vs {ctx.opponent.name}
              </span>
            </>
          )}
          {secondarySegments.map((seg) => (
            <span
              key={seg.key}
              style={seg.width ? stableNum(seg.width) : undefined}
              className={clsx(
                "tabular-nums font-medium shrink-0",
                seg.tone === "up" && "text-up",
                seg.tone === "down" && "text-down",
                !seg.tone && c.textDim,
              )}
            >
              {seg.node ?? seg.text}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Helpers ──────────────────────────────────────────────────
//
// Per-player selection helpers (findTopN / findWorstStarter /
// findTopBench / findInjuredPlayers / shortStatus / formatPts) used to
// live here. They moved to ../../datawidgets/fantasy/playerStats.ts when
// the player-stat segments were extracted to standalone ticker chips
// — both this file and ScrollrTicker now share them.

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * The score, with digits that roll when they change.
 *
 * Mirrors `fmtPlayerPoints` exactly — one fixed decimal — because this
 * renders in place of that string, and a chip that switched between
 * "151.8" and "151.80" mid-game would be worse than no animation.
 *
 * Not bounced. A spring that overshoots makes a settled score wobble,
 * which on a live ticker reads as the number being unsure of itself.
 *
 * The `label` is not optional politeness. AnimateNumber works by
 * rendering EVERY digit 0-9 in each column and translating the right one
 * into view, so the element's own text content is
 * "2345678901234567890…" — a screen reader on the rolling chip would
 * read that instead of the score. The roller is hidden from the
 * accessibility tree and the real string sits beside it.
 */
function RollingScore({
  myPts,
  oppPts,
  label,
}: {
  myPts: number;
  oppPts: number;
  label: string;
}) {
  return (
    <>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        <AnimateNumber {...ROLL}>{myPts}</AnimateNumber>
        <span>–</span>
        <AnimateNumber {...ROLL}>{oppPts}</AnimateNumber>
      </span>
    </>
  );
}

const ROLL = {
  format: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
  locales: "en-US",
    // trend: 1 forces every digit column to spin the SAME way. On auto
    // each column picks its own direction from its own change — going
    // 149.9 to 151.8, the tens roll up while the units and tenths roll
    // down — and three columns moving against each other reads as the
    // number scrambling rather than counting. A score only ever climbs
    // during a game, so up is also the honest direction.
    trend: 1 as const,
  transition: {
    type: "spring" as const,
    visualDuration: 1.8,
    bounce: 0,
    opacity: { duration: 0.15, ease: "linear" as const },
  },
};
