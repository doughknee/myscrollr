/**
 * Pins Motion's clock to Remotion's frame.
 *
 * WITHOUT THIS, ANY MOTION ANIMATION IN A COMPOSITION IS NONDETERMINISTIC.
 *
 * Motion animates on requestAnimationFrame. Remotion has no clock — it
 * sets `remotion_setFrame`, waits for React and any delayRender handles,
 * then screenshots — and it does not seek WAAPI animations or patch
 * performance.now(). So an animation left to itself advances by WALL
 * CLOCK between screenshots, which has nothing to do with video time: on
 * a slow render it barely moves, on a fast one it finishes early, and
 * the same composition renders differently every run.
 *
 * Motion supports this case directly rather than by trick.
 * `MotionGlobalConfig.useManualTiming` makes the render batcher read
 * `frameData.timestamp` instead of `performance.now()` and stop
 * recomputing its own delta, and `frameSteps` exposes the loop so it can
 * be pumped by hand at exactly frame/fps.
 */
import {
  frameData,
  frameSteps,
  MotionGlobalConfig,
  time,
} from "motion";
import { useLayoutEffect } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

MotionGlobalConfig.useManualTiming = true;

/**
 * The batcher's own unrolled order (motion-dom `createRenderBatcher`).
 * Pumping out of order silently produces stale layout reads.
 */
const STEPS = [
  "setup",
  "read",
  "resolveKeyframes",
  "preUpdate",
  "update",
  "preRender",
  "render",
  "postRender",
] as const;

/**
 * Call once per composition, above any Motion component.
 *
 * Two halves, and both are load-bearing:
 *
 * 1. During render, anchor `time.now()` to this frame. Motion stamps an
 *    animation's start time when it's created, which happens in the
 *    CHILD's layout effect — and child effects run before the parent's.
 *    Anchoring in an effect would be too late, and every animation would
 *    start from whenever the previous batch happened to run.
 *
 * 2. In a layout effect, pump the loop to this frame. Parent layout
 *    effects run after children's, so by this point the frame's DOM is
 *    committed and any animation it started is registered.
 */
export function useMotionClock(): void {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  // Anchors time.now() only. Deliberately NOT frameData.timestamp:
  // the effect below needs the PREVIOUS frame's timestamp to compute a
  // delta, and setting it here zeroes that delta on every frame, which
  // silently freezes every animation mid-roll.
  time.set(ms);

  useLayoutEffect(() => {
    // Clamped at 0: Remotion renders frames in order, but `still`
    // renders one frame cold, where the previous timestamp is 0 and a
    // seek backwards would otherwise hand Motion a negative delta.
    frameData.delta = Math.max(ms - frameData.timestamp, 0);
    frameData.timestamp = ms;
    frameData.isProcessing = true;
    for (const step of STEPS) frameSteps[step].process(frameData);
    frameData.isProcessing = false;

    // Neutralise the rAF loop until the next pump. Motion's batcher is
    // still SCHEDULED by requestAnimationFrame — useManualTiming only
    // stops it recomputing `delta`, it does not stop it running — so a
    // stray batch would otherwise re-process the frame with the delta we
    // last set and advance everything a second time.
    frameData.delta = 0;

    seekWaapi(ms);
  });
}

/**
 * The other clock, and the one that actually broke this.
 *
 * Motion hands transform and opacity to the browser's Web Animations
 * API whenever it can, because the compositor runs them off the main
 * thread. Those animations are driven by the DOCUMENT TIMELINE, not by
 * Motion's batcher, so `useManualTiming` has no authority over them at
 * all — and Remotion doesn't seek them either (there is no
 * `getAnimations` call anywhere in @remotion/renderer). Nothing was
 * controlling that clock, which is why two renders of frames 120-140
 * differed on all 21 even after the batcher was fully pinned.
 *
 * AnimateNumber's digit roll is exactly this: y-translate plus opacity.
 *
 * KNOWN CEILING: this pins the timing but not the last sub-pixel. Stray
 * rAF batches still fire between Remotion frames, and one that lands
 * while a just-created animation is briefly live measures the DOM
 * mid-transition, which a layout animation then bakes in. Two renders of
 * frames 120-140 agree on 3 and differ by a few hundred bytes on the
 * rest — visually identical, not bit-identical. The complete fix is to
 * stop Motion's loop by replacing requestAnimationFrame before `motion`
 * evaluates; that was tried and Remotion needs rAF itself, so it breaks
 * rendering outright. Revisit only if a render ever has to be
 * reproducible bit-for-bit.
 *
 * So: pause every WAAPI animation the moment it appears, remember the
 * video time it was created at, and seek it by hand. An animation first
 * seen during this frame's commit starts at 0, which is correct — that
 * is the frame the DOM change happened on.
 */
const waapiStart = new WeakMap<Animation, number>();

function seekWaapi(ms: number): void {
  for (const animation of document.getAnimations()) {
    let start = waapiStart.get(animation);
    if (start === undefined) {
      start = ms;
      waapiStart.set(animation, ms);
      // Detaches it from the document timeline. Without this the
      // compositor keeps advancing it between screenshots.
      animation.pause();
    }
    try {
      animation.currentTime = ms - start;
    } catch {
      // Seeking an animation whose effect has already been torn down
      // throws. It has nothing left to contribute to the frame.
    }
  }
}
