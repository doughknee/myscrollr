/**
 * The transparent stage every chip composition sits on.
 *
 * THREE THINGS THIS EXISTS TO GET RIGHT, all of which broke a render
 * the first time round:
 *
 * 1. NOTHING PAINTS A BACKGROUND. Not the AbsoluteFill, not the theme
 *    wrapper, not the chip. ProRes 4444 carries alpha, but only for
 *    pixels that were actually transparent — one stray `bg-*` and the
 *    whole overlay arrives in Resolve as an opaque rectangle. The theme
 *    wrapper below is `#app-shell`, NOT `#desktop-shell`, precisely
 *    because the latter carries `height: 100vh` and its own background
 *    while the former only defines colour variables.
 *
 * 2. SCALE, DON'T RESIZE. The chip renders at its real ticker size and
 *    is then scaled up by transform. Rendering it "bigger" by changing
 *    font sizes would produce a chip that is not the shipped design —
 *    different wrapping, different padding ratios. Scaling keeps the
 *    geometry exact and just puts more pixels behind it, which is the
 *    whole point of an oversized canvas.
 *
 * 3. `#app-shell` STILLS CSS ANIMATION, AND THAT IS WANTED HERE. The
 *    app's own keyframes (spine glow, pts flash) advance on a wall
 *    clock, so under frame-stepping they'd either sit still or differ
 *    between renders. Killing them means every moving thing in these
 *    comps is driven by the frame, which is the only way a render is
 *    reproducible.
 */
import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";

export function Stage({
  children,
  scale = 2,
  plate = false,
  livePulse,
}: {
  children: ReactNode;
  /** Multiplier on the chip's real ticker size. */
  scale?: number;
  /**
   * Put the app's own surface colour behind the chip.
   *
   * OFF by default, which is the honest default: in the product the
   * chip's fill is a 6% wash that reads against the app's dark bar. As
   * a standalone overlay there is nothing behind it, so that wash is
   * invisible and the chip composites as glass — border and text only.
   *
   * That looks good over calm footage and becomes unreadable over busy
   * footage. Turn this on and the chip carries its own ground.
   */
  plate?: boolean;
  /**
   * Opacity for the LIVE dot, 0..1, driven per frame.
   *
   * The dot inside FantasyStatChip is a `motion.span` whose keyframes
   * run on Motion's own clock, and that clock does not advance when
   * Remotion steps frames — so the dot renders static no matter what.
   * Rather than change the product for the video's benefit, the pulse
   * is applied from out here as a CSS variable the rule below reads.
   *
   * The coupling is to the dot's `bg-live` class. That is the fragile
   * part: rename it in the app and this silently stops pulsing rather
   * than failing. It's worth it to keep the shipped component untouched.
   */
  livePulse?: number;
}) {
  return (
    <AbsoluteFill
      style={{
        // No backgroundColor. See note 1.
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {livePulse !== undefined && (
        <style>{`#app-shell .bg-live { opacity: ${livePulse.toFixed(3)}; }`}</style>
      )}
      <div
        id="app-shell"
        data-theme="scrollr-dark"
        style={{
          // The plate is the chip's own surface token, not a picked
          // grey, so it tracks the theme rather than drifting from it.
          background: plate ? "var(--color-surface)" : undefined,
          borderRadius: plate ? 6 : undefined,
          transform: `scale(${scale})`,
          // Scale about the centre so the chip stays put as `scale`
          // changes — otherwise retuning the zoom silently reframes it.
          transformOrigin: "center center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}
