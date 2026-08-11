import { Composition } from "remotion";

import { Beat1Hook } from "./beats/Beat1Hook";
import "./styles.css";

/**
 * 2560x1440 60p per the storyboard.
 *
 * Beat 1 stands alone as its own composition rather than a sequence
 * inside the full cut, so it can be rendered and judged in isolation
 * before the other five exist. When they do, HeroCut composes the same
 * components on a timeline and this stays as the isolation harness.
 */
export function RemotionRoot() {
  return (
    <>
      <Composition
        id="HeroLoop"
        component={Beat1Hook}
        durationInFrames={600}
        fps={60}
        width={2560}
        height={1440}
      />
    </>
  );
}
