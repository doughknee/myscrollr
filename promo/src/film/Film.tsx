/**
 * "The moment it happens, you already know." One continuous shot.
 *
 * The bar is the through-line: it runs from frame 0 to the last frame and
 * never cuts. The camera moves around it. The desktop behind it is the
 * app's own window, from the marketing screenshot set.
 *
 * TIME. Every event is a second of film time in the variant's cue sheet
 * (`cues`), measured off the track's own onsets (audio/analyze.py), so a
 * cut is a number edit. With no cue sheet the film runs on a 120 BPM grid.
 *
 * MOTION. Besides the cuts, the picture breathes with the track on every
 * frame: `features` carries per-frame kick / snare / hat / loudness
 * envelopes (0..1) extracted from the same window. The camera, the bar's
 * glow, the band's LIVE dot, the titles and the background all read them.
 * Big hits get anticipation (a dip in the frames before) and a punch.
 */
import { AbsoluteFill, Audio, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Bar, BAR_H, BAR_W, type BarState, type Tick } from "./Bar";
import { CATALOG_FLY, THEMES, WIDGETS } from "./data";

export const FPS = 30;
/**
 * Layout per aspect. Landscape is the master; portrait keeps the same
 * world (the bar is still 1920 wide, overflowing the right edge) and the
 * same cue sheet, with the camera closer and the titles stacked.
 */
interface Layout { W: number; H: number; titleLeft: number; titleSize: number; lowTop: number; midTop: number; highTop: number; end: number[]; endSize: number; chip: (i: number) => [number, number]; shots: [number, number, number, number, number, number] }
const LAND: Layout = { W: 1920, H: 1080, titleLeft: 136, titleSize: 104, lowTop: 690, midTop: 330, highTop: 70, end: [196, 272, 322, 614, 790, 500], endSize: 150, chip: (i) => [200 + (i % 4) * 175 + (i > 3 ? 70 : 0), 870 + Math.floor(i / 4) * 58], shots: [120, 130, 1180, 560, 180, 1240] };
const PORT: Layout = { W: 1080, H: 1920, titleLeft: 64, titleSize: 66, lowTop: 1120, midTop: 640, highTop: 120, end: [380, 450, 492, 760, 900, 640], endSize: 104, chip: (i) => [150 + (i % 4) * 210 + (i > 3 ? 60 : 0), 1700 + Math.floor(i / 4) * 58], shots: [40, 520, 1000, 120, 760, 1000] };

/** The cue sheet, in seconds of film time. */
export interface Cues {
  /** The Bears score. */
  TD: number;
  /** Second line of the opening title. */
  TD_LINE2: number;
  /** The camera is released after the hit. */
  TD_RELEASE: number;
  TO_STOCKS: number;
  /** Price ticks on the stocks page: [second, column, up?]. */
  TICKS: [number, number, boolean][];
  TO_NEWS: number;
  PULL_OUT: number;
  /** "One bar above your work." */
  DESK_TITLE: number;
  HOP: number;
  HOP_TITLE: number;
  PUSH_IN: number;
  WIDGETS_TITLE: number;
  /** When each catalog chip lands on the band, by chip index. */
  CHIPS: number[];
  TO_GITHUB: number;
  GITHUB_TITLE: number;
  /** Palette flips, one per entry. */
  THEMES: number[];
  THEMES_TITLE: number;
  /** End card: logo, label, line 1, line 2, button, url. */
  END: number[];
  OUT: number;
}

export interface Features { kick: number[]; snare: number[]; hat: number[]; rms: number[] }

export type FilmProps = {
  /** 9:16 for Shorts/Reels: the camera stays closer and the titles stack. */
  portrait?: boolean;
  bpm: number;
  songStart?: number;
  song?: string;
  cues?: Cues;
  features?: Features;
};

/** The 120 BPM grid, as the film was first cut. */
export const GRID: Cues = {
  TD: 1.5, TD_LINE2: 1.57, TD_RELEASE: 2.23, TO_STOCKS: 3, TICKS: [[3.5, 0, true], [4, 1, true]], TO_NEWS: 4.5, PULL_OUT: 5, DESK_TITLE: 6, HOP: 7.5, HOP_TITLE: 7.83,
  PUSH_IN: 9, WIDGETS_TITLE: 9.33, CHIPS: [10.5, 9.9, 10.03, 10.17, 10.3, 10.43, 10.57, 10.7], TO_GITHUB: 10.5, GITHUB_TITLE: 10.7,
  THEMES: [11.9, 12.3, 12.7, 13.1, 13.5, 13.9, 14.3], THEMES_TITLE: 11.83, END: [14, 14.33, 14.47, 14.73, 15.33, 15.53], OUT: 18.5,
};
export const durationFor = (p: FilmProps) => Math.round((p.cues ?? GRID).OUT * FPS * (p.cues ? 1 : 120 / p.bpm));

const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const INOUT = Easing.bezier(0.65, 0, 0.35, 1);
const r = (f: number, a: number, b: number, e = OUT) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });

/** Frames of the cue sheet. */
interface E { TD: number; TD_LINE2: number; TD_RELEASE: number; TO_STOCKS: number; TICKS: Tick[]; TO_NEWS: number; PULL_OUT: number; DESK_TITLE: number; HOP: number; HOP_TITLE: number; PUSH_IN: number; WIDGETS_TITLE: number; CHIPS: number[]; TO_GITHUB: number; GITHUB_TITLE: number; THEMES: number[]; THEMES_TITLE: number; END: number[]; OUT: number }
function toFrames(c: Cues, fps: number): E {
  const s = (x: number) => Math.round(x * fps);
  return {
    TD: s(c.TD), TD_LINE2: s(c.TD_LINE2), TD_RELEASE: s(c.TD_RELEASE), TO_STOCKS: s(c.TO_STOCKS), TICKS: c.TICKS.map(([t, cell, up]) => ({ at: s(t), cell, up })),
    TO_NEWS: s(c.TO_NEWS), PULL_OUT: s(c.PULL_OUT), DESK_TITLE: s(c.DESK_TITLE), HOP: s(c.HOP), HOP_TITLE: s(c.HOP_TITLE), PUSH_IN: s(c.PUSH_IN), WIDGETS_TITLE: s(c.WIDGETS_TITLE),
    CHIPS: c.CHIPS.map(s), TO_GITHUB: s(c.TO_GITHUB), GITHUB_TITLE: s(c.GITHUB_TITLE), THEMES: c.THEMES.map(s), THEMES_TITLE: s(c.THEMES_TITLE), END: c.END.map(s), OUT: s(c.OUT),
  };
}

function barState(f: number, E: E): BarState {
  const turns = [
    { at: 0, w: 0 },
    { at: E.TO_STOCKS, w: 1 },
    { at: E.TO_NEWS, w: 2 },
    { at: E.TO_GITHUB, w: 3 },
  ];
  let cur = turns[0];
  let prev: number | null = null;
  for (const t of turns) if (f >= t.at) { prev = cur === t ? null : cur.w; cur = t; }
  if (cur.at === 0) prev = null;
  return { widget: cur.w, since: cur.at, prev, scored: f >= E.TD, scoredAt: E.TD, dark: true };
}

/** The dip before a hit and the punch on it: one shape for every big hit. */
function hit(f: number, at: number, punch = 0.09, dip = 0.012): number {
  if (f < at) return -dip * r(f, at - 14, at - 2, INOUT);
  return punch * interpolate(f, [at, at + 2, at + 30], [0, 1, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
}

/**
 * Camera: scale and the world point at the frame's centre.
 *
 * Two kinds of segment. A DRIFT is linear: a slow push or pan at constant
 * speed, so the frame is never dead between events. A MOVE is eased: the
 * big reframings (pull-out, hop, push-in, end). The punches and dips of
 * the hits sit on top of either.
 */
type Key = [number, number, number, number, "drift" | "move"];
function camera(f: number, E: E, kick: number, portrait: boolean): { s: number; x: number; y: number } {
  const end = E.END[0];
  // The band's left edge must stay on screen: x <= (W/2)/s at every scale.
  const keys: Key[] = portrait ? [
    [0, 2.5, 206, 100, "drift"],
    [E.TO_STOCKS, 2.36, 222, 104, "drift"],
    [E.TO_NEWS, 2.22, 238, 112, "drift"],
    [E.PULL_OUT, 2.1, 250, 120, "move"],
    [E.PULL_OUT + 36, 1.0, 540, 960, "drift"],
    [E.HOP, 1.03, 536, 972, "move"],
    [E.HOP + 25, 1.08, 540, 1000, "drift"],
    [E.PUSH_IN, 1.1, 544, 1010, "move"],
    [E.PUSH_IN + 32, 2.2, 240, 1832, "drift"],
    [E.TO_GITHUB + 18, 2.15, 248, 1836, "move"],
    [E.THEMES[0], 1.5, 340, 1850, "drift"],
    [end - 18, 1.45, 350, 1846, "move"],
    [end, 1.0, 540, 960, "drift"],
    [E.OUT, 1.02, 540, 966, "drift"],
  ] : [
    // frame, scale, focusX, focusY, how we get to the NEXT key
    [0, 2.75, 318, 108, "drift"],
    [E.TO_STOCKS, 2.56, 366, 112, "drift"],
    [E.TO_NEWS, 2.36, 404, 128, "drift"],
    [E.PULL_OUT, 2.2, 432, 140, "move"],
    [E.PULL_OUT + 36, 1.0, 960, 540, "drift"],
    [E.HOP, 1.04, 952, 556, "move"],
    [E.HOP + 25, 1.1, 960, 600, "drift"],
    [E.PUSH_IN, 1.13, 968, 616, "move"],
    [E.PUSH_IN + 32, 2.3, 340, 985, "drift"],
    [E.TO_GITHUB + 18, 2.24, 362, 990, "move"],
    [E.THEMES[0], 1.6, 560, 1010, "drift"],
    [end - 18, 1.55, 590, 1004, "move"],
    [end, 1.0, 960, 540, "drift"],
    [E.OUT, 1.02, 960, 546, "drift"],
  ];
  let i = 0;
  while (i < keys.length - 2 && f >= keys[i + 1][0]) i++;
  const [f0, s0, x0, y0, how] = keys[i];
  const [f1, s1, x1, y1] = keys[i + 1];
  // The pull-out settles with a small overshoot: the bar lands in place.
  const SETTLE = Easing.bezier(0.2, 0.9, 0.3, 1.04);
  const ease = f0 === E.PULL_OUT ? SETTLE : INOUT;
  const t = f1 === f0 ? 1 : how === "move" ? r(f, f0, f1, ease) : Math.min(1, Math.max(0, (f - f0) / (f1 - f0)));
  // No punch on the end hit: the bar's glide is the event there.
  const punches = hit(f, E.TD) + hit(f, E.TO_STOCKS, 0.06) + hit(f, E.TO_NEWS, 0.06) + hit(f, E.TO_GITHUB, 0.06);
  // The kick is a slow breath here, a third of a percent; the bar's glow carries the beat.
  const breath = 0.0035 * kick;
  return { s: (s0 + (s1 - s0) * t) * (1 + punches + breath), x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
}

const SANS = "Archivo, 'Plus Jakarta Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const INK = "var(--color-fg, #e2e2ec)";
const MINT = "var(--color-accent, #34d399)";
const MUTE = "var(--color-fg-3, #9292a4)";
const SURFACE = "var(--color-surface, #0b0b13)";

/**
 * The site's type system, not a generic promo's: a `// SEC 01 / NAME` mono
 * label with the band's edge-bar segment in the widget's colour, then an
 * uppercase Archivo headline whose second line is outlined in mint, as the
 * hero on myscrollr.com sets it. Every title sits on its own scrim so it
 * never fights the window behind it. `line2At` lets the second line land
 * on its own hit.
 */
function Title({ f, at, out, line2At, label, hex = MINT, line1, line2, sub, top, left, align = "left", size = 104, scrim = "bottom", breathe = 0, pc = 1 }: {
  f: number; at: number; out: number; line2At?: number; label: string; hex?: string; line1?: string; line2?: string; sub?: string;
  top: number; left?: number; align?: "left" | "center"; size?: number; scrim?: "top" | "bottom" | "center" | "none"; breathe?: number; pc?: number;
}) {
  const a = r(f, at, at + 12 * pc);
  const a2 = r(f, line2At ?? at + 6, (line2At ?? at + 6) + 12 * pc);
  const o = 1 - r(f, out, out + 10 * pc, INOUT);
  if (a <= 0 || o <= 0) return null;
  const center = align === "center";
  const grad = scrim === "bottom"
    ? "linear-gradient(to top, color-mix(in srgb, var(--color-surface, #0b0b13) 96%, transparent) 0%, color-mix(in srgb, var(--color-surface, #0b0b13) 86%, transparent) 45%, transparent 100%)"
    : "linear-gradient(to bottom, color-mix(in srgb, var(--color-surface, #0b0b13) 96%, transparent) 0%, color-mix(in srgb, var(--color-surface, #0b0b13) 86%, transparent) 45%, transparent 100%)";
  const line = (text: string, outline: boolean, k: number) => (
    <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: size, lineHeight: 0.92, letterSpacing: "-0.02em", textTransform: "uppercase", color: outline ? "transparent" : INK, WebkitTextStroke: outline ? `3px ${MINT}` : undefined, whiteSpace: "nowrap", opacity: k, transform: `translateY(${(1 - k) * 18}px) scale(${1 + 0.006 * breathe})`, transformOrigin: center ? "50% 50%" : "0 50%" }}>{text}</div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, opacity: a * o, pointerEvents: "none" }}>
      {scrim === "center" && <div style={{ position: "absolute", inset: 0, background: "radial-gradient(62% 48% at 50% 46%, color-mix(in srgb, var(--color-surface, #0b0b13) 94%, transparent) 0%, color-mix(in srgb, var(--color-surface, #0b0b13) 70%, transparent) 60%, transparent 100%)" }} />}
      {(scrim === "top" || scrim === "bottom") && <div style={{ position: "absolute", left: 0, right: 0, [scrim]: 0, height: 520, background: grad }} />}
      <div style={{ position: "absolute", top, left: center ? 0 : left, right: center ? 0 : undefined, textAlign: center ? "center" : "left", transform: `translateY(${(1 - a) * 24}px)` }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14, fontFamily: MONO, fontSize: 19, letterSpacing: "0.22em", textTransform: "uppercase", color: MUTE, marginBottom: 22 }}>
          <span style={{ display: "block", width: 5, height: 22, background: hex, borderRadius: 1 }} />
          {label}
        </div>
        {line1 && line(line1, false, 1)}
        {line2 && a2 > 0 && line(line2, true, a2)}
        {sub && (
          <div style={{ marginTop: 24, fontFamily: MONO, fontSize: 19, letterSpacing: "0.2em", textTransform: "uppercase", color: MUTE, opacity: a2 }}>{sub}</div>
        )}
      </div>
    </div>
  );
}

/**
 * The film's pace: a bell over its length. Durations are multiplied by
 * this, so the opening breathes, the GitHub landing and the palettes cut
 * tight, and the end card slows down again. Peak and width in seconds.
 */
function pace(sec: number, peak: number, width: number): number {
  return 1.35 - 0.65 * Math.exp(-(((sec - peak) / width) ** 2));
}

export function Film({ bpm, songStart, song, cues, features, portrait = false }: FilmProps) {
  const L = portrait ? PORT : LAND;
  const { W, H } = L;
  const real = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const E = toFrames(cues ?? GRID, fps);
  // The virtual frame on the 120 BPM grid (identity with a cue sheet).
  const f = cues ? real : (real * bpm) / 120;
  // Envelopes are read through a short window so nothing jabs: ~3 frames
  // to rise, ~12 to fall. The raw per-frame value is a transient, and a
  // picture that follows transients twitches.
  const smooth = (arr: number[] | undefined, rise = 3, fall = 12) => {
    if (!arr) return 0;
    const i = Math.min(arr.length - 1, Math.max(0, Math.round(real)));
    let v = 0;
    for (let k = 0; k <= fall; k++) {
      const j = i - k;
      if (j < 0) break;
      const w = k < rise ? (k + 1) / rise : 1 - (k - rise) / (fall - rise + 1);
      v = Math.max(v, (arr[j] ?? 0) * w);
    }
    return v;
  };
  const kick = smooth(features?.kick), hat = smooth(features?.hat, 2, 8);
  const snare = 0;
  const pc = pace(real / fps, (cues ?? GRID).TO_GITHUB, 7);

  const state = { ...barState(f, E), dark: !THEMES[Math.min(THEMES.length - 1, E.THEMES.filter((t) => f >= t).length)].endsWith("-light") };
  // The dwell: the lit pill fills from the swap-in to the next swap at a
  // constant rate and is full on that frame, as the app's own dwell works.
  // GitHub's runs to the end card.
  const nextSwap = [E.TO_STOCKS, E.TO_NEWS, E.TO_GITHUB, E.END[0]][state.widget];
  const fill = Math.min(1, Math.max(0, (f - state.since) / Math.max(1, nextSwap - state.since)));
  const arm = f < nextSwap ? r(f, nextSwap - 12, nextSwap - 1, Easing.in(Easing.quad)) : 0;
  const fadeIn = r(f, 0, 10, Easing.out(Easing.quad));
  const cam = camera(f, E, kick, portrait);
  const end = E.END[0];
  // The hop: a lift in the frames before (anticipation), then the drop.
  // The hop has the swap's shape: arm (glow builds, a lift), then the drop
  // lands on the hit with a two-frame settle and a bloom under the bar.
  const hopArm = f < E.HOP ? r(f, E.HOP - 12, E.HOP - 1, Easing.in(Easing.quad)) : 0;
  const lift = -8 * hopArm;
  const drop = interpolate(f, [E.HOP, E.HOP + 10], [0, H - BAR_H], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.5, 0, 0.2, 1) });
  const settle = f >= E.HOP + 10 ? -5 * interpolate(f, [E.HOP + 10, E.HOP + 13, E.HOP + 20], [0, 1, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) }) : 0;
  // From the start of the end zoom-out, the bar is placed in SCREEN space:
  // it holds where it is while the frame widens around it, then moves the
  // short distance to the card's centre, one monotonic motion. Its world
  // position is derived from the camera each frame.
  const zoomStart = end - 18;
  const endGlide = f >= zoomStart ? interpolate(f, [end, end + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.3, 0, 0.15, 1) }) : 0;
  const screenAtZoomStart = (() => { const c = camera(zoomStart, E, 0, portrait); return H / 2 + (H - BAR_H - c.y) * c.s; })();
  const screenY = screenAtZoomStart + (L.end[5] - screenAtZoomStart) * endGlide;
  const barTop = f >= zoomStart ? cam.y + (screenY - H / 2) / cam.s : lift + drop + settle;
  const landBloom = f >= end ? interpolate(f, [end + 18, end + 21, end + 52], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : f >= E.HOP + 10 ? interpolate(f, [E.HOP + 10, E.HOP + 12, E.HOP + 30], [0, 1, 0], { extrapolateRight: "clamp" }) : 0;
  const themeIdx = Math.min(THEMES.length - 1, E.THEMES.filter((t) => f >= t).length);
  const theme = THEMES[themeIdx];
  const dark = !theme.endsWith("-light");
  // The app's windows are dark screenshots: they leave before the frame starts changing colour.
  const shots = 1 - r(f, E.THEMES[0] - 12, E.THEMES[0] - 1);
  // A flash on each palette flip.
  const lastFlip = E.THEMES.filter((t) => f >= t).pop();
  const flipFlash = lastFlip === undefined ? 0 : interpolate(f - lastFlip, [0, 1, 6], [0, 0.1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const endIn = r(f, end, end + 4);
  // The desktop steps back whenever a title is up.
  const dimDesk =
    f < E.PULL_OUT ? 0.22
    : f < E.DESK_TITLE ? 0.22 + 0.78 * r(f, E.PULL_OUT + 10, E.PULL_OUT + 34)
    : f < E.HOP - 8 ? 1 - 0.62 * r(f, E.DESK_TITLE, E.DESK_TITLE + 12)
    : f < E.HOP + 12 ? 0.38 + 0.62 * r(f, E.HOP - 8, E.HOP + 2)
    : f < E.PUSH_IN ? 1 - 0.62 * r(f, E.HOP + 12, E.HOP + 26)
    : f < end ? 1 - 0.5 * r(f, E.PUSH_IN, E.PUSH_IN + 32)
    : 0.5 - 0.5 * r(f, end, end + 20);

  // The world: 1920x1080, scaled about the camera's focus.
  const tx = W / 2 - cam.x * cam.s;
  const ty = H / 2 - cam.y * cam.s;
  const hex = WIDGETS[state.widget].hex ?? MINT;

  // Catalog chips: each pops in during the widgets title, flies for a third
  // of a second and lands on the band on its own hit of the riser.
  // Chips pop on the hats after the widgets title: the first eight frames
  // past it where the hat envelope rises above 0.5, at least 3 frames apart.
  const pops: number[] = [];
  if (features?.hat) {
    for (let k = E.WIDGETS_TITLE + 2; k < E.CHIPS[1] - 6 && pops.length < CATALOG_FLY.length; k++) {
      if (features.hat[k] > 0.5 && (features.hat[k - 1] ?? 0) <= features.hat[k] && (pops.length === 0 || k - pops[pops.length - 1] >= 3)) pops.push(k);
    }
  }
  const chips = CATALOG_FLY.map((c, i) => {
    const land = E.CHIPS[i] ?? E.TO_GITHUB;
    const pop = pops[i] ?? E.WIDGETS_TITLE + 4 + i * 4;
    const a = r(f, pop, pop + 12);
    const go = r(f, land - 11 * pc, land, Easing.in(Easing.cubic));
    const gone = f > land + 2;
    if (a <= 0 || gone) return null;
    const [sx, sy] = L.chip(i);
    const ex = 96;
    const ey = H - BAR_H + 20;
    const x = sx + (ex - sx) * go;
    const y = sy + (ey - sy) * go;
    const sc = (0.6 + 0.4 * a) * (1 - go * 0.55);
    return (
      <div key={c.id} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%,-50%) scale(${sc})`, opacity: a * (1 - go * 0.6), display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", borderRadius: 7, background: "var(--color-base-150, #1c1c2c)", border: "1px solid var(--color-edge, #303040)", fontFamily: SANS, fontWeight: 700, fontSize: 15, color: INK, boxShadow: "0 10px 30px rgba(0,0,0,.5)", whiteSpace: "nowrap" }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: c.hex, display: "block" }} />
        {c.name}
      </div>
    );
  });
  // The band takes a hit as each chip lands.
  const lastLand = E.CHIPS.filter((t) => f >= t).sort((p, q) => q - p)[0];
  const landFlash = lastLand === undefined ? 0 : interpolate(f - lastLand, [0, 1, 10], [0, 0.32, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const step = (i: number, len = 10) => r(f, E.END[i], E.END[i] + len);

  return (
    <AbsoluteFill id="app-shell" data-theme={theme} style={{ background: SURFACE, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "#0b0b13", opacity: 1 - fadeIn, zIndex: 10, pointerEvents: "none" }} />
      {song && songStart !== undefined && (
        <Audio
          src={staticFile(song)}
          startFrom={Math.round(songStart * fps)}
          volume={(fr) => interpolate(fr, [0, 8, durationInFrames - 45, durationInFrames - 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        />
      )}
      <div style={{ position: "absolute", inset: 0 }}>
        {/* World */}
        <div style={{ position: "absolute", left: 0, top: 0, width: Math.max(W, BAR_W), height: H, transform: `translate(${tx}px, ${ty}px) scale(${cam.s})`, transformOrigin: "0 0" }}>
          {/* Desktop */}
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 10%, var(--color-surface-2, #181825) 0%, var(--color-surface, #0b0b13) 100%)", opacity: dimDesk }}>
            {/* The dot grid catches the hats. */}
            <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(circle, rgba(255,255,255,${(0.04 + 0.05 * hat).toFixed(3)}) 1px, transparent 1.2px)`, backgroundSize: "40px 40px" }} />
            <Img src={staticFile("shots/sports.png")} style={{ position: "absolute", left: L.shots[0], top: L.shots[1], width: L.shots[2], borderRadius: 12, boxShadow: "0 30px 90px rgba(0,0,0,.6)", opacity: 0.55 * shots }} />
            <Img src={staticFile("shots/home.png")} style={{ position: "absolute", left: L.shots[3], top: L.shots[4], width: L.shots[5], borderRadius: 12, boxShadow: "0 40px 110px rgba(0,0,0,.75)", opacity: shots }} />
          </div>
          {/* The bar. Its glow is the kick. */}
          <div style={{ position: "absolute", left: 0, top: barTop, width: BAR_W, height: BAR_H, boxShadow: `0 12px 50px rgba(0,0,0,.55), 0 0 ${Math.round(8 + 34 * kick + 40 * hopArm + 60 * landBloom)}px ${hex}${Math.round(30 + 70 * kick + 60 * hopArm + 90 * landBloom).toString(16).padStart(2, "0")}` }}>
            <Bar frame={f} state={state} fill={fill} arm={arm} pulse={kick} ticks={E.TICKS} bandFlash={landFlash} roll={Math.round(12 * pc)} />
            {flipFlash > 0 && <div style={{ position: "absolute", inset: 0, background: INK, opacity: flipFlash, pointerEvents: "none" }} />}
          </div>
          {chips}
        </div>
      </div>

      {/* Screen-space type */}
      <Title f={f} at={10} out={E.TO_STOCKS - 8} line2At={E.TD_LINE2} label="// live desktop ticker" hex="#013369" line1="The moment it happens," line2="you already know." top={L.lowTop} left={L.titleLeft} size={L.titleSize} breathe={snare} pc={pc} />
      <Title f={f} at={E.TO_STOCKS + 2} out={E.TO_NEWS - 4} label="sec 01 / markets" hex="#7c3aed" line1="One page" line2="at a time." top={L.lowTop} left={L.titleLeft} size={L.titleSize} breathe={snare} pc={pc} />
      <Title f={f} at={E.TO_NEWS + 2} out={E.PULL_OUT + 20} label="sec 02 / headlines" hex="#c8102e" line1="No tab" line2="to babysit." top={L.lowTop} left={L.titleLeft} size={L.titleSize} breathe={snare} pc={pc} />

      <Title f={f} at={E.DESK_TITLE} out={E.HOP - 16} label="sec 03 / on your desktop" line1="One bar" line2="above your work." sub="64 px · every monitor · always on top" top={L.midTop} align="center" size={L.titleSize + 8} scrim="center" breathe={snare} pc={pc} />
      <Title f={f} at={E.HOP_TITLE} out={E.PUSH_IN + 6} label="sec 03 / on your desktop" line1="Top or bottom." sub="it's your bar. park it." top={L.midTop + 30} align="center" size={L.titleSize + 8} scrim="center" breathe={snare} pc={pc} />

      <Title f={f} at={E.WIDGETS_TITLE} out={E.TO_GITHUB} label="sec 04 / pick widgets" hex="#f97316" line1="56 widgets." sub="& counting" top={L.highTop} left={L.titleLeft} size={L.titleSize} scrim="top" breathe={snare} pc={pc} />
      <Title f={f} at={E.GITHUB_TITLE} out={end - 5} label={themeIdx > 0 ? "sec 05 / dress it" : "sec 04 / pick widgets"} hex={themeIdx > 0 ? MINT : "#f97316"} line1="Watch the bar" line2="change." sub={themeIdx > 0 ? `20 palettes · ${theme.replace(/-(dark|light)$/, (m) => " " + m.slice(1)).replace("-", " ")}` : undefined} top={L.highTop} left={L.titleLeft} size={L.titleSize} scrim="top" breathe={snare} pc={pc} />

      {/* End card: the site's hero, built hit by hit. Every element POPS on its hit (scale snap, two frames to full), nothing fades or slides. */}
      {f >= end && (() => {
        const pop = (i: number) => {
          const k = r(f, E.END[i], E.END[i] + 6, Easing.bezier(0.2, 1.4, 0.4, 1));
          const o = r(f, E.END[i], E.END[i] + 2);
          return { opacity: o, transform: `scale(${0.82 + 0.18 * k})`, transformOrigin: "50% 50%" } as const;
        };
        return (
          <div style={{ position: "absolute", inset: 0, opacity: endIn }}>

            <div style={{ position: "absolute", left: 0, right: 0, top: L.end[0], display: "flex", justifyContent: "center", alignItems: "center", gap: 16, ...pop(0) }}>
              <Img src={staticFile("logo.svg")} style={{ width: 60, height: 60 }} />
              <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 64, letterSpacing: "-0.04em", color: INK, lineHeight: 1 }}>
                scrollr<span style={{ color: MINT }}>.</span>
              </span>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: L.end[1], textAlign: "center", fontFamily: MONO, fontSize: 18, letterSpacing: "0.22em", textTransform: "uppercase", color: MUTE, ...pop(1) }}>
              free · open source · macos / windows / linux
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: L.end[2], textAlign: "center", fontFamily: SANS, fontWeight: 900, fontSize: L.endSize, lineHeight: 0.9, letterSpacing: "-0.02em", textTransform: "uppercase", color: INK, ...pop(2) }}>
              Your live
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: L.end[3], textAlign: "center", fontFamily: SANS, fontWeight: 900, fontSize: L.endSize, lineHeight: 0.9, letterSpacing: "-0.02em", textTransform: "uppercase", color: "transparent", WebkitTextStroke: `3px ${MINT}`, ...pop(3) }}>
              Desktop ticker
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: L.end[4], textAlign: "center", display: "flex", flexWrap: "wrap", padding: "0 40px", justifyContent: "center", gap: 16 }}>
              <span style={{ position: "relative", display: "inline-block", background: MINT, color: SURFACE, fontFamily: SANS, fontWeight: 800, fontSize: 30, padding: "20px 40px", borderRadius: 6, ...pop(4) }}>
                Download Scrollr
                <span style={{ position: "absolute", top: -12, right: -12, background: SURFACE, color: MINT, border: `1px solid ${MINT}`, fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", padding: "4px 7px", borderRadius: 4 }}>FREE</span>
              </span>
              <span style={{ display: "inline-block", border: "1px solid var(--color-edge, #303040)", color: INK, fontFamily: SANS, fontWeight: 700, fontSize: 30, padding: "19px 36px", borderRadius: 6, ...pop(5) }}>myscrollr.com</span>
            </div>
          </div>
        );
      })()}
    </AbsoluteFill>
  );
}
