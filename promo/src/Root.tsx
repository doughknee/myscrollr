/**
 * Promo chip overlays — transparent, 60fps, for compositing in Resolve.
 *
 * CANVAS SIZES are deliberately much larger than the chips. Each comp
 * renders its chip at 2x the real ticker size and leaves room around
 * it, so a 200% punch-in on a 1080p timeline is still sampling real
 * pixels rather than upscaling. The margin also has to clear the chip's
 * own glow and flash ring, which sit outside its border box — a canvas
 * fitted tightly to the chip clips them and the crop is visible against
 * a moving background.
 *
 * DURATIONS are all 6s while the animation finishes by ~1.5s. The tail
 * is there to be trimmed: every frame past 90 is identical (bar the
 * LIVE dot, which breathes on purpose), so a cut can land anywhere.
 */
import { Composition } from "remotion";
import "./styles.css";
import { LeagueChip } from "./promo-chips/LeagueChip";
import { PlayerChip } from "./promo-chips/PlayerChip";
import { ScorePop } from "./promo-chips/ScorePop";
import { TickerRail } from "./promo-chips/TickerRail";

const FPS = 60;
const SIX_SECONDS = 6 * FPS;
/** The rail is a bed, not a beat — it runs under a whole section. */
const THIRTY_SECONDS = 30 * FPS;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="LeagueChip"
        component={LeagueChip}
        durationInFrames={SIX_SECONDS}
        fps={FPS}
        width={1920}
        height={640}
        defaultProps={{
          leagueName: "The Sunday Money League",
          teamName: "Brunch Money",
          opponentName: "Fourth and Long",
          week: 12,
          status: "live" as const,
          myScore: 149.9,
          opponentScore: 151.7,
          projection: 168.8,
          topScorer: {
            name: "Hurts",
            team: "PHI",
            position: "QB",
            points: 28.1,
          },
          record: { wins: 8, losses: 3 },
          rank: 2,
          numTeams: 8,
          streak: { type: "win" as const, value: 3 },
          // THE WALK-OFF. `myScore` is the total BEFORE the plays, so
          // the chip opens 149.9-151.7 — behind by 1.8 — and the events
          // add to it:
          //
          //   f50  a catch, +1.4  -> 151.3, still behind by 0.4. This is
          //        the beat that does the work. Close enough to taste and
          //        still losing is the only frame in the film that makes
          //        a viewer lean in.
          //   f110 a touchdown, +6.6 -> 157.9, and the lead flips inside
          //        the count. Score turns green, win% jumps, spine surges,
          //        ring flares — all derived, none of it choreographed
          //        separately.
          //
          // Settles by ~f192, leaving 168 frames of frozen tail to trim.
          scoreEvents: [
            { at: 50, points: 1.4, kind: "catch" as const },
            { at: 110, points: 6.6, kind: "td" as const },
          ],
          scale: 2,
        }}
      />

      <Composition
        id="PlayerChip"
        component={PlayerChip}
        durationInFrames={SIX_SECONDS}
        fps={FPS}
        width={1280}
        height={520}
        defaultProps={{
          name: "Achane",
          team: "MIA",
          position: "W/R/T",
          // Before the plays. The events below are the same two that
          // move the league chip, so the two comps can be cut together
          // and agree with each other frame for frame.
          points: 8.3,
          projection: 24.0,
          accent: "top" as const,
          live: true,
          scoreEvents: [
            { at: 50, points: 1.4, kind: "catch" as const },
            { at: 110, points: 6.6, kind: "td" as const },
          ],
          scale: 2,
        }}
      />

      <Composition
        id="TickerRail"
        component={TickerRail}
        durationInFrames={THIRTY_SECONDS}
        fps={FPS}
        // 2x a 1920-wide bar. Drop it on a 1080p timeline at 50% for a
        // pixel-exact bar, or leave it at 100% to punch in.
        width={3840}
        height={280}
        defaultProps={{
          // FIVE leagues for THIRTY seconds, and the count is arithmetic
          // rather than taste: a chip is ~548px before scaling, the
          // viewport is 1920 of those, and the drift covers 630 across
          // the comp. Five puts ~3.5 on screen at once and lets the
          // fifth arrive as the first leaves, so the bar is never static
          // and never runs out of rail.
          //
          // The plays are spaced so each one lands while ITS chip is on
          // screen, and far enough apart that each reads as its own
          // event. Most chips never score — a bar where everything is
          // always erupting has no significant moments left.
          leagues: [
            {
              leagueName: "Dynasty or Bust",
              teamName: "Regression Candidates",
              opponentName: "Air Yards Only",
              week: 12,
              status: "final" as const,
              myScore: 184.5,
              opponentScore: 151.0,
              projection: 184.5,
              topScorer: {
                name: "Allen",
                team: "BUF",
                position: "QB",
                points: 36.9,
              },
              record: { wins: 9, losses: 2 },
              rank: 1,
              numTeams: 8,
              // Finished. Nothing left to happen, which is the point of
              // having it here — it is the calm the others move against.
            },
            {
              leagueName: "Work League (Keeper)",
              teamName: "Third and Inches",
              opponentName: "Gridiron Ghosts",
              week: 12,
              status: "live" as const,
              myScore: 90.9,
              opponentScore: 83.6,
              projection: 101.3,
              topScorer: {
                name: "St. Brown",
                team: "DET",
                position: "WR",
                points: 21.9,
              },
              record: { wins: 6, losses: 5 },
              rank: 4,
              numTeams: 8,
              // Already ahead, so this one extends a lead rather than
              // stealing one. No flare — that belongs to the crossing.
              scoreEvents: [{ at: 420, points: 6.6, kind: "td" as const }],
            },
            {
              leagueName: "The Sunday Money League",
              teamName: "Brunch Money",
              opponentName: "Fourth and Long",
              week: 12,
              status: "live" as const,
              myScore: 149.9,
              opponentScore: 151.7,
              projection: 168.8,
              topScorer: {
                name: "Hurts",
                team: "PHI",
                position: "QB",
                points: 28.1,
              },
              record: { wins: 8, losses: 3 },
              rank: 2,
              numTeams: 8,
              streak: { type: "win" as const, value: 3 },
              // The story. Behind by 1.8; the catch at f120 gets it to
              // 151.3 — still behind, by 0.4 — and it sits there for
              // eleven seconds, which is the whole point. The touchdown
              // at f780 crosses.
              scoreEvents: [
                { at: 120, points: 1.4, kind: "catch" as const },
                { at: 780, points: 6.6, kind: "td" as const },
              ],
            },
            {
              leagueName: "College Buddies",
              teamName: "Bad Beats Only",
              opponentName: "The Group Chat",
              week: 12,
              status: "live" as const,
              myScore: 112.4,
              opponentScore: 118.9,
              projection: 131.2,
              topScorer: {
                name: "Nacua",
                team: "LAR",
                position: "WR",
                points: 24.3,
              },
              record: { wins: 7, losses: 4 },
              rank: 3,
              numTeams: 10,
              scoreEvents: [{ at: 1150, points: 8.4, kind: "big" as const }],
            },
            {
              leagueName: "Waiver Wire Wars",
              teamName: "Handcuff Central",
              opponentName: "Streaming Service",
              week: 12,
              status: "live" as const,
              myScore: 96.2,
              opponentScore: 94.8,
              projection: 108.7,
              topScorer: {
                name: "Kittle",
                team: "SF",
                position: "TE",
                points: 18.6,
              },
              record: { wins: 5, losses: 6 },
              rank: 6,
              numTeams: 10,
              scoreEvents: [{ at: 1500, points: 3, kind: "fg" as const }],
            },
          ],
          drift: 0.35,
          scale: 2,
        }}
      />

      <Composition
        id="ScorePop"
        component={ScorePop}
        durationInFrames={SIX_SECONDS}
        fps={FPS}
        width={1080}
        height={520}
        defaultProps={{
          value: 13.6,
          unit: "PTS",
          tone: "up" as const,
          showSign: true,
          bounce: 0.34,
          scale: 2,
        }}
      />
    </>
  );
};
