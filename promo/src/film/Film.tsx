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
const W = 1920;
const H = 1080;

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
function hit(f: number, at: number, punch = 0.09, dip = 0.02): number {
  if (f < at) return -dip * r(f, at - 9, at - 1, Easing.in(Easing.quad));
  return punch * interpolate(f, [at, at + 2, at + 28], [0, 1, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
}

/** Camera: scale and the world point at the frame's centre, piecewise with eased holds. */
function camera(f: number, E: E, kick: number): { s: number; x: number; y: number } {
  const end = E.END[0];
  const keys: [number, number, number, number][] = [
    // frame, scale, focusX, focusY
    // Settle in, then hold DEAD STILL through the score: the one event
    // reads because nothing else is moving when it lands.
    [0, 2.75, 330, 110],
    [24, 2.6, 350, 110],
    [E.TD_RELEASE, 2.6, 350, 110],
    [E.TD_RELEASE + 24, 2.6, 400, 110],
    [E.TO_STOCKS, 2.3, 420, 130],
    [E.TO_NEWS, 2.1, 450, 150],
    [E.PULL_OUT, 2.1, 450, 150],
    [E.PULL_OUT + 36, 1, 960, 540],
    [E.HOP, 1, 960, 540],
    [E.HOP + 25, 1.08, 960, 600],
    [E.PUSH_IN, 1.08, 960, 600],
    [E.PUSH_IN + 32, 2.3, 340, 985],
    [E.TO_GITHUB + 18, 2.3, 340, 985],
    [E.THEMES[0], 1.6, 760, 1010],
    [end - 24, 1.6, 760, 1010],
    [end + 24, 1, 960, 540],
  ];
  let i = 0;
  while (i < keys.length - 2 && f >= keys[i + 1][0]) i++;
  const [f0, s0, x0, y0] = keys[i];
  const [f1, s1, x1, y1] = keys[i + 1];
  const t = f1 === f0 ? 1 : r(f, f0, f1, INOUT);
  const punches = hit(f, E.TD) + hit(f, E.TO_GITHUB, 0.07) + hit(f, end, 0.05, 0.015) + hit(f, E.HOP, 0.03, 0.012);
  // And the kick, every frame: a breath, not a bounce.
  const breath = 0.014 * kick;
  return { s: (s0 + (s1 - s0) * t) * (1 + punches + breath), x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
}

const SANS = "Archivo, 'Plus Jakarta Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const INK = "#e2e2ec";
const MINT = "#34d399";
const MUTE = "#9292a4";

/**
 * The site's type system, not a generic promo's: a `// SEC 01 / NAME` mono
 * label with the band's edge-bar segment in the widget's colour, then an
 * uppercase Archivo headline whose second line is outlined in mint, as the
 * hero on myscrollr.com sets it. Every title sits on its own scrim so it
 * never fights the window behind it. `line2At` lets the second line land
 * on its own hit.
 */
function Title({ f, at, out, line2At, label, hex = MINT, line1, line2, sub, top, left, align = "left", size = 104, scrim = "bottom", breathe = 0 }: {
  f: number; at: number; out: number; line2At?: number; label: string; hex?: string; line1?: string; line2?: string; sub?: string;
  top: number; left?: number; align?: "left" | "center"; size?: number; scrim?: "top" | "bottom" | "center" | "none"; breathe?: number;
}) {
  const a = r(f, at, at + 12);
  const a2 = r(f, line2At ?? at + 6, (line2At ?? at + 6) + 12);
  const o = 1 - r(f, out, out + 10, INOUT);
  if (a <= 0 || o <= 0) return null;
  const center = align === "center";
  const grad = scrim === "bottom"
    ? "linear-gradient(to top, rgba(11,11,19,.96) 0%, rgba(11,11,19,.86) 45%, rgba(11,11,19,0) 100%)"
    : "linear-gradient(to bottom, rgba(11,11,19,.96) 0%, rgba(11,11,19,.86) 45%, rgba(11,11,19,0) 100%)";
  const line = (text: string, outline: boolean, k: number) => (
    <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: size, lineHeight: 0.92, letterSpacing: "-0.02em", textTransform: "uppercase", color: outline ? "transparent" : INK, WebkitTextStroke: outline ? `3px ${MINT}` : undefined, whiteSpace: "nowrap", opacity: k, transform: `translateY(${(1 - k) * 18}px) scale(${1 + 0.006 * breathe})`, transformOrigin: center ? "50% 50%" : "0 50%" }}>{text}</div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, opacity: a * o, pointerEvents: "none" }}>
      {scrim === "center" && <div style={{ position: "absolute", inset: 0, background: "radial-gradient(62% 48% at 50% 46%, rgba(11,11,19,.94) 0%, rgba(11,11,19,.7) 60%, rgba(11,11,19,0) 100%)" }} />}
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

export function Film({ bpm, songStart, song, cues, features }: FilmProps) {
  const real = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const E = toFrames(cues ?? GRID, fps);
  // The virtual frame on the 120 BPM grid (identity with a cue sheet).
  const f = cues ? real : (real * bpm) / 120;
  const at = (arr: number[] | undefined) => (arr ? arr[Math.min(arr.length - 1, Math.max(0, Math.round(real)))] ?? 0 : 0);
  const kick = at(features?.kick), snare = at(features?.snare), hat = at(features?.hat);

  const state = barState(f, E);
  const dwell = 45;
  // Half-speed from the score to the title's second line: the pill's fill
  // and the page clock stretch while the number lands.
  const warp = f < E.TD ? f : f - 0.5 * Math.min(E.TD_LINE2 - E.TD, f - E.TD);
  const fadeIn = r(f, 0, 10, Easing.out(Easing.quad));
  const cam = camera(f, E, kick);
  const end = E.END[0];
  // The hop: a lift in the frames before (anticipation), then the drop.
  const lift = f < E.HOP ? -10 * r(f, E.HOP - 8, E.HOP - 1, Easing.out(Easing.quad)) : 0;
  const barTop = lift + interpolate(f, [E.HOP, E.HOP + 12], [0, H - BAR_H], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.3, 0, 0.1, 1) });
  const themeIdx = Math.min(THEMES.length - 1, E.THEMES.filter((t) => f >= t).length);
  const theme = THEMES[themeIdx];
  // A flash on each palette flip.
  const lastFlip = E.THEMES.filter((t) => f >= t).pop();
  const flipFlash = lastFlip === undefined ? 0 : interpolate(f - lastFlip, [0, 1, 7], [0, 0.18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const endIn = r(f, end, end + 30);
  // The desktop steps back whenever a title is up.
  const dimDesk =
    f < E.PULL_OUT ? 0.22
    : f < E.DESK_TITLE ? 0.22 + 0.78 * r(f, E.PULL_OUT, E.PULL_OUT + 24)
    : f < E.HOP - 8 ? 1 - 0.62 * r(f, E.DESK_TITLE, E.DESK_TITLE + 12)
    : f < E.HOP + 12 ? 0.38 + 0.62 * r(f, E.HOP - 8, E.HOP + 2)
    : f < E.PUSH_IN ? 1 - 0.62 * r(f, E.HOP + 12, E.HOP + 26)
    : f < end ? 1 - 0.5 * r(f, E.PUSH_IN, E.PUSH_IN + 32)
    : 0.5 - 0.34 * endIn;

  // The world: 1920x1080, scaled about the camera's focus.
  const tx = W / 2 - cam.x * cam.s;
  const ty = H / 2 - cam.y * cam.s;
  const hex = WIDGETS[state.widget].hex ?? MINT;

  // Catalog chips: each pops in during the widgets title, flies for a third
  // of a second and lands on the band on its own hit of the riser.
  const chips = CATALOG_FLY.map((c, i) => {
    const land = E.CHIPS[i] ?? E.TO_GITHUB;
    const pop = E.WIDGETS_TITLE + 4 + i * 4;
    const a = r(f, pop, pop + 12);
    const go = r(f, land - 11, land, Easing.in(Easing.cubic));
    const gone = f > land + 2;
    if (a <= 0 || gone) return null;
    const sx = 200 + (i % 4) * 175 + (i > 3 ? 70 : 0);
    const sy = 870 + Math.floor(i / 4) * 58;
    const ex = 96;
    const ey = 1016 + 20;
    const x = sx + (ex - sx) * go;
    const y = sy + (ey - sy) * go;
    const sc = (0.6 + 0.4 * a) * (1 - go * 0.55);
    return (
      <div key={c.id} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%,-50%) scale(${sc})`, opacity: a * (1 - go * 0.6), display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", borderRadius: 7, background: "#1c1c2c", border: "1px solid #303040", fontFamily: SANS, fontWeight: 700, fontSize: 15, color: "#e2e2ec", boxShadow: "0 10px 30px rgba(0,0,0,.5)", whiteSpace: "nowrap" }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: c.hex, display: "block" }} />
        {c.name}
      </div>
    );
  });
  // The band takes a hit as each chip lands.
  const lastLand = E.CHIPS.filter((t) => f >= t).sort((p, q) => q - p)[0];
  const landFlash = lastLand === undefined ? 0 : interpolate(f - lastLand, [0, 1, 8], [0, 0.5, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const step = (i: number, len = 10) => r(f, E.END[i], E.END[i] + len);

  return (
    <AbsoluteFill style={{ background: "#0b0b13", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "#0b0b13", opacity: 1 - fadeIn, zIndex: 10, pointerEvents: "none" }} />
      {song && songStart !== undefined && (
        <Audio
          src={staticFile(song)}
          startFrom={Math.round(songStart * fps)}
          volume={(fr) => interpolate(fr, [0, 8, durationInFrames - 45, durationInFrames - 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        />
      )}
      <div id="app-shell" data-theme={theme} style={{ position: "absolute", inset: 0 }}>
        {/* World */}
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `translate(${tx}px, ${ty}px) scale(${cam.s})`, transformOrigin: "0 0" }}>
          {/* Desktop */}
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 10%, var(--color-surface-2, #181825) 0%, #0b0b13 100%)", opacity: dimDesk }}>
            {/* The dot grid catches the hats. */}
            <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(circle, rgba(255,255,255,${(0.04 + 0.1 * hat).toFixed(3)}) 1px, transparent 1.2px)`, backgroundSize: "40px 40px" }} />
            <Img src={staticFile("shots/sports.png")} style={{ position: "absolute", left: 120, top: 130, width: 1180, borderRadius: 12, boxShadow: "0 30px 90px rgba(0,0,0,.6)", opacity: 0.55 }} />
            <Img src={staticFile("shots/home.png")} style={{ position: "absolute", left: 560, top: 180, width: 1240, borderRadius: 12, boxShadow: "0 40px 110px rgba(0,0,0,.75)" }} />
          </div>
          {/* The bar. Its glow is the kick. */}
          <div style={{ position: "absolute", left: 0, top: barTop, width: BAR_W, height: BAR_H, boxShadow: `0 12px 50px rgba(0,0,0,.55), 0 0 ${Math.round(8 + 44 * kick)}px ${hex}${Math.round(30 + 80 * kick).toString(16).padStart(2, "0")}` }}>
            <Bar frame={f} warp={warp} state={state} dwell={dwell} pulse={kick} ticks={E.TICKS} bandFlash={landFlash} />
            {flipFlash > 0 && <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flipFlash, pointerEvents: "none" }} />}
          </div>
          {chips}
        </div>
      </div>

      {/* Screen-space type */}
      <Title f={f} at={10} out={E.TO_STOCKS - 8} line2At={E.TD_LINE2} label="// live desktop ticker" hex="#013369" line1="The moment it happens," line2="you already know." top={690} left={136} size={104} breathe={snare} />
      <Title f={f} at={E.TO_STOCKS + 2} out={E.TO_NEWS - 4} label="sec 01 / markets" hex="#7c3aed" line1="One page" line2="at a time." top={690} left={136} size={104} breathe={snare} />
      <Title f={f} at={E.TO_NEWS + 2} out={E.PULL_OUT + 20} label="sec 02 / headlines" hex="#c8102e" line1="No tab" line2="to babysit." top={690} left={136} size={104} breathe={snare} />

      <Title f={f} at={E.DESK_TITLE} out={E.HOP - 16} label="sec 03 / on your desktop" line1="One bar" line2="above your work." sub="64 px · every monitor · always on top" top={330} align="center" size={112} scrim="center" breathe={snare} />
      <Title f={f} at={E.HOP_TITLE} out={E.PUSH_IN + 6} label="sec 03 / on your desktop" line1="Top or bottom." sub="it's your bar. park it." top={360} align="center" size={112} scrim="center" breathe={snare} />

      <Title f={f} at={E.WIDGETS_TITLE} out={E.TO_GITHUB} label="sec 04 / pick widgets" hex="#f97316" line1="56 widgets." sub="& counting" top={70} left={136} size={104} scrim="top" breathe={snare} />
      <Title f={f} at={E.GITHUB_TITLE} out={E.THEMES_TITLE} label="sec 04 / pick widgets" hex="#f97316" line1="Watch the bar" line2="change." top={70} left={136} size={104} scrim="top" breathe={snare} />

      <Title f={f} at={E.THEMES_TITLE} out={end - 4} label="sec 05 / dress it" line1="20 palettes." sub={`${theme.replace("-dark", "").replace("-", " ")} · dark & light`} top={70} left={136} size={104} scrim="top" breathe={snare} />

      {/* End card: the site's hero, built hit by hit. */}
      {f >= end && (
        <div style={{ position: "absolute", inset: 0, opacity: endIn }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(70% 60% at 50% 45%, rgba(11,11,19,.92) 0%, rgba(11,11,19,.6) 100%)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 200, display: "flex", justifyContent: "center", alignItems: "center", gap: 20, transform: `scale(${(0.9 + 0.1 * step(0, 14)) * (1 + 0.025 * kick)})` }}>
            <Img src={staticFile("logo.svg")} style={{ width: 72, height: 72 }} />
            <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 76, letterSpacing: "-0.04em", color: INK, lineHeight: 1 }}>
              scrollr<span style={{ color: MINT }}>.</span>
            </span>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 330, textAlign: "center", fontFamily: MONO, fontSize: 19, letterSpacing: "0.22em", textTransform: "uppercase", color: MUTE, opacity: step(1) }}>
            free · open source · macos / windows / linux
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 400, textAlign: "center", fontFamily: SANS, fontWeight: 900, fontSize: 150, lineHeight: 0.9, letterSpacing: "-0.02em", textTransform: "uppercase", color: INK, opacity: step(2), transform: `translateY(${(1 - step(2)) * 24}px) scale(${1 + 0.006 * snare})` }}>
            Your live
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 540, textAlign: "center", fontFamily: SANS, fontWeight: 900, fontSize: 150, lineHeight: 0.9, letterSpacing: "-0.02em", textTransform: "uppercase", color: "transparent", WebkitTextStroke: `3px ${MINT}`, opacity: step(3), transform: `translateY(${(1 - step(3)) * 24}px) scale(${1 + 0.006 * snare})` }}>
            Desktop ticker
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 730, textAlign: "center" }}>
            <span style={{ position: "relative", display: "inline-block", background: MINT, color: "#141420", fontFamily: SANS, fontWeight: 800, fontSize: 30, padding: "20px 40px", borderRadius: 6, opacity: step(4), transform: `translateY(${(1 - step(4)) * 16}px) scale(${1 + 0.1 * (1 - step(4, 8))})` }}>
              Download Scrollr
              <span style={{ position: "absolute", top: -12, right: -12, background: "#0b0b13", color: MINT, border: `1px solid ${MINT}`, fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", padding: "4px 7px", borderRadius: 4 }}>FREE</span>
            </span>
            <span style={{ display: "inline-block", marginLeft: 18, verticalAlign: "top", border: "1px solid #303040", color: INK, fontFamily: SANS, fontWeight: 700, fontSize: 30, padding: "19px 36px", borderRadius: 6, opacity: step(5), transform: `translateY(${(1 - step(5)) * 16}px)` }}>myscrollr.com</span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}
