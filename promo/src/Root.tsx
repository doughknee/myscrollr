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

const FPS = 60;
const SIX_SECONDS = 6 * FPS;

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
          myScore: 151.8,
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
          // The walk-off: starts behind on 149.9 and crosses 151.7 while
          // the camera is on it. The crossing is the shot.
          countUpFrom: 149.9,
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
          points: 21.9,
          projection: 24.0,
          accent: "top" as const,
          live: true,
          countUpFrom: 8.3,
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
