/**
 * The film (promo/src/film): one 18.5s shot of the real bar, built from
 * the app's own page cells.
 */
import { Composition } from "remotion";
import "./styles.css";
import { FPS, Film, durationFor, type FilmProps } from "./film/Film";
import { HERO_FPS, HERO_FRAMES, HERO_H, HERO_W, Hero } from "./film/Hero";

export const RemotionRoot: React.FC = () => (
  <>
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
  <Composition
    id="FilmPortrait"
    component={Film}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={durationFor({ bpm: 120 })}
    defaultProps={{ bpm: 120, portrait: true }}
    calculateMetadata={({ props }) => ({ durationInFrames: durationFor(props), props: { ...props, portrait: true } })}
  />
  <Composition id="HeroLoop" component={Hero} fps={HERO_FPS} width={HERO_W} height={HERO_H} durationInFrames={HERO_FRAMES} />
  <Composition id="HeroLoopLight" component={Hero} fps={HERO_FPS} width={HERO_W} height={HERO_H} durationInFrames={HERO_FRAMES} defaultProps={{ theme: "scrollr-light" }} />
  </>
);
