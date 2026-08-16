/**
 * The timing contract every promo-chip composition shares.
 *
 * All three comps are 6s but reach their final state by ~1.5s and hold
 * it flat for the remaining 4.5s. That is deliberate and it is for the
 * NLE, not for looks: an overlay you trim from the tail is only safe if
 * every frame past the settle point is identical, so a cut can land
 * anywhere after 90 without changing what's on screen.
 *
 * Everything here is a pure function of the frame. Nothing uses Motion,
 * a spring instance, or a wall clock, because Remotion renders by
 * setting a frame and screenshotting — animations that advance on their
 * own schedule either don't move at all or move differently on every
 * render. That lesson cost a whole afternoon the first time.
 */
import { Easing, interpolate } from "remotion";

/** Frames, at 60fps. */
export const T = {
  /** Slide-up + fade in. */
  enterEnd: 20,
  /** Numbers begin counting once the chip has arrived. */
  countStart: 20,
  countEnd: 70,
  /** Bars fill slightly behind the numbers so they read as a result. */
  barStart: 26,
  barEnd: 82,
  /**
   * Everything is settled by here. Nothing in any comp may move after
   * this frame — see the module note.
   */
  settled: 90,
} as const;

/** How far the chip travels on entrance, in canvas px before scaling. */
const RISE = 26;

/**
 * Entrance: up and in. Returns a style, so a caller can spread it onto
 * whatever wrapper it already has rather than nesting another div.
 */
export function entrance(frame: number) {
  const t = interpolate(frame, [0, T.enterEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    // Decelerating, so the chip arrives rather than stops. A linear
    // entrance on a 20-frame move reads mechanical at 60fps.
    easing: Easing.out(Easing.cubic),
  });
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * RISE}px)`,
  };
}

/**
 * A number counting to its final value.
 *
 * `from` is optional on every comp: when it's undefined the value is
 * simply held, because a chip that isn't the subject of the shot
 * shouldn't be animating a number nobody is looking at.
 */
export function countUp(frame: number, to: number, from?: number): number {
  if (from === undefined || from === to) return to;
  return interpolate(frame, [T.countStart, T.countEnd], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

/**
 * Bar fill, 0..1 of its target. Same shape as countUp but on its own
 * slightly later window, so the bar trails the number it summarises
 * instead of racing it.
 */
export function barFill(frame: number, to: number): number {
  return interpolate(frame, [T.barStart, T.barEnd], [0, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

/**
 * The LIVE dot's pulse.
 *
 * A raw sine of the frame, which matters for two reasons: it never
 * needs a start value, and it is continuous — so a clip trimmed at any
 * frame past the settle point still cuts mid-breath rather than
 * snapping. Held between 0.4 and 1.0 to match the app's own dot.
 *
 * This is the one thing that keeps moving after T.settled. It is a
 * deliberate exception to the hold rule: a "LIVE" badge that has
 * stopped breathing reads as a frozen screenshot, which is the exact
 * impression the whole video exists to dispel.
 */
export function livePulse(frame: number): number {
  const cycle = 78; // ~1.3s, the app's own period
  return 0.4 + 0.3 * (1 + Math.sin((frame / cycle) * Math.PI * 2));
}

/**
 * Spring overshoot for ScorePop.
 *
 * Hand-rolled rather than Remotion's `spring()` because this one needs
 * to be readable and tunable by whoever is cutting the video: `bounce`
 * is how far past 1 it goes, `settle` is when it stops. A critically
 * damped analytic curve, sampled per frame, so it is still a pure
 * function of the frame like everything else here.
 */
export function pop(
  frame: number,
  { delay = 0, bounce = 0.34, settle = 34 } = {},
): number {
  const f = frame - delay;
  if (f <= 0) return 0;
  if (f >= settle) return 1;
  const t = f / settle;
  // Decaying cosine: overshoots once, then converges on 1.
  const decay = Math.exp(-4.2 * t);
  return 1 + bounce * decay * -Math.cos(t * Math.PI * 2.1);
}
