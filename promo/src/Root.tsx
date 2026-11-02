/**
 * The film (promo/src/film): one 18.5s shot of the real bar, built from
 * the app's own page cells. The older chip-overlay comps in promo-chips/
 * imported FantasyStatChip, which left with the fantasy widget
 * (SCROLLR-239); they are kept for reference but not registered.
 */
import { Composition } from "remotion";
import "./styles.css";
import { FPS, Film, durationFor, type FilmProps } from "./film/Film";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Film"
    component={Film}
    fps={FPS}
    width={1920}
    height={1080}
    durationInFrames={durationFor({ bpm: 120 })}
    defaultProps={{ bpm: 120 }}
    calculateMetadata={({ props }) => ({ durationInFrames: durationFor(props) })}
  />
);
