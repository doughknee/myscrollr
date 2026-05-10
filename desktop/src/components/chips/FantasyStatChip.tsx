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
  isMatchupFinal,
  isMatchupLive,
  streakLabel,
  teamScore,
  userMatchupContext,
  userRoster,
  userStanding,
} from "../../channels/fantasy/types";
import { findTopScorer } from "../../channels/fantasy/playerStats";
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
 *   - `topScorer` — "★ LeBron 42.3"
 *
 * Segments render only when their data is available for this league
 * (e.g. `standingsPosition` skips pre-season; `topScorer` skips rosters
 * with all-zero points). A league with ZERO ticker-enabled items
 * collapses to a name-only chip so the user still sees something
 * meaningful per-league.
 *
 * The 4 "Player stats" venues (`topThreeScorers`, `worstStarter`,
 * `benchOpportunity`, `injuryDetail`) used to render here as inline
 * segments. They are now emitted as standalone chips on the rail by
 * `ScrollrTicker`'s fantasy bucket builder, using `FollowedPlayerChip`
 * with an `accent` prop. This keeps the league chip focused on
 * matchup-level context while letting per-player stats stand on their
 * own where they're easier to scan.
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

    // The four "Player stats" venues (topThreeScorers, worstStarter,
    // benchOpportunity, injuryDetail) USED to render here as inline
    // segments. They are now emitted as standalone chips on the rail
    // by ScrollrTicker — see the fantasy bucket builder there.
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
//
// Per-player selection helpers (findTopN / findWorstStarter /
// findTopBench / findInjuredPlayers / shortStatus / formatPts) used to
// live here. They moved to ../../channels/fantasy/playerStats.ts when
// the player-stat segments were extracted to standalone ticker chips
// — both this file and ScrollrTicker now share them.

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
