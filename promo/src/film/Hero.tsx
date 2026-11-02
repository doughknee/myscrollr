/**
 * The hero loop for myscrollr.com: silent, 1920x640, 10.86s, seamless.
 *
 * NFL with the touchdown at 1.37, the swap to stocks at 5.43 with the
 * ticks, then the swap back to NFL lands exactly on the last frame, so
 * frame 326 is frame 0 and the loop never shows a seam. The camera is
 * a slow sine drift with the loop's period, for the same reason.
 *
 * Same grammar as the film: the pill fills to the swap, arms, the roll,
 * the colour beat, the dot burst, the settle.
 */
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Bar, BAR_H, BAR_W, type BarState, type Tick } from "./Bar";
import { DEFAULT } from "./story";

export const HERO_W = 1920;
export const HERO_H = 640;
export const HERO_FPS = 30;
/** One NFL dwell plus one stocks dwell, from the B cue sheet. */
const SWAP = 163; // 5.43s
export const HERO_FRAMES = SWAP * 2; // 10.86s
const TD = 41; // 1.37s
const TICKS: Tick[] = [[6.4, 0, true], [7.93, 1, true], [8.43, 2, false], [8.7, 3, true]].map(([t, cell, up]) => ({ at: Math.round((t as number) * HERO_FPS), cell: cell as number, up: up as boolean }));

const r = (f: number, a: number, b: number, e = Easing.bezier(0.16, 1, 0.3, 1)) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });
function hit(f: number, at: number, punch = 0.07, dip = 0.012): number {
  if (f < at) return -dip * r(f, at - 14, at - 2, Easing.bezier(0.65, 0, 0.35, 1));
  return punch * interpolate(f, [at, at + 2, at + 30], [0, 1, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
}

export function Hero() {
  const f = useCurrentFrame();
  // Two dwells; the second swap is the loop point, so the roll into NFL is in progress at frame 0.
  const onStocks = f >= SWAP;
  const state: BarState = onStocks
    ? { widget: 1, since: SWAP, prev: 0, scored: true, scoredAt: TD, dark: true }
    : { widget: 0, since: 0, prev: 1, scored: f >= TD, scoredAt: TD, dark: true };
  const nextSwap = onStocks ? HERO_FRAMES : SWAP;
  const fill = Math.min(1, Math.max(0, (f - state.since) / (nextSwap - state.since)));
  const arm = r(f, nextSwap - 12, nextSwap - 1, Easing.in(Easing.quad));
  // On the stocks page the ticks land at their times; on the way out (the
  // first frames of the loop) they have already happened, so the prices
  // the page rolls out with are the ones it rolled in with last time.
  const ticks = onStocks ? TICKS : TICKS.map((k) => ({ ...k, at: k.at - HERO_FRAMES }));

  // A punch is in progress at frame 0 (the loop's own swap): carry its tail.
  const tail = hit(f + HERO_FRAMES, HERO_FRAMES);
  const s = 2.2 * (1 + hit(f, TD, 0.09) + hit(f, SWAP) + hit(f, HERO_FRAMES) + tail);
  const drift = Math.sin((2 * Math.PI * f) / HERO_FRAMES);
  const x = 420 + 36 * drift;
  const y = BAR_H / 2 + 4 * Math.sin((4 * Math.PI * f) / HERO_FRAMES);
  const tx = HERO_W / 2 - x * s;
  const ty = HERO_H / 2 - y * s;
  const hex = DEFAULT.widgets[state.widget].hex ?? "#34d399";

  return (
    <AbsoluteFill id="app-shell" data-theme="scrollr-dark" style={{ background: "radial-gradient(120% 120% at 50% 0%, var(--color-surface-2, #181825) 0%, var(--color-surface, #0b0b13) 100%)", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--color-fg, #fff) 5%, transparent) 1px, transparent 1.2px)", backgroundSize: "40px 40px" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: BAR_W, height: BAR_H, transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: "0 0", boxShadow: `0 12px 50px rgba(0,0,0,.55), 0 0 ${Math.round(10 + 30 * arm)}px ${hex}${Math.round(40 + 90 * arm).toString(16).padStart(2, "0")}` }}>
        <Bar widgets={DEFAULT.widgets} frame={f} state={state} fill={fill} arm={arm} ticks={ticks} roll={12} />
      </div>
    </AbsoluteFill>
  );
}
