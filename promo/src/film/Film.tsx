/**
 * "The moment it happens, you already know." One continuous shot.
 *
 * The bar is the through-line: it runs from frame 0 to the last frame and
 * never cuts. The camera moves around it. The desktop behind it is the
 * app's own window, from the marketing screenshot set.
 *
 * 30fps. The music is 120 BPM, so a beat is 15 frames and every event
 * below sits on one.
 */
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Bar, BAR_H, BAR_W, type BarState } from "./Bar";
import { CATALOG_FLY, THEMES } from "./data";

export const FPS = 30;
export const DURATION = 555;
const W = 1920;
const H = 1080;

const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const INOUT = Easing.bezier(0.65, 0, 0.35, 1);
const r = (f: number, a: number, b: number, e = OUT) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });

// ── Beats ──────────────────────────────────────────────────
const TD = 45; // the Bears score
const TO_STOCKS = 90;
const TO_NEWS = 135;
const PULL_OUT = 150;
const HOP = 225; // bar to the bottom
const PUSH_IN = 270;
const TO_GITHUB = 315;
const THEMES_AT = 345;
const END = 420;

function barState(f: number): BarState {
  const turns = [
    { at: 0, w: 0 },
    { at: TO_STOCKS, w: 1 },
    { at: TO_NEWS, w: 2 },
    { at: TO_GITHUB, w: 3 },
  ];
  let cur = turns[0];
  let prev: number | null = null;
  for (const t of turns) if (f >= t.at) { prev = cur === t ? null : cur.w; cur = t; }
  if (cur.at === 0) prev = null;
  return { widget: cur.w, since: cur.at, prev, scored: f >= TD, scoredAt: TD, dark: true };
}

/** Camera: scale and the world point at the frame's centre, piecewise with eased holds. */
function camera(f: number): { s: number; x: number; y: number } {
  const keys: [number, number, number, number][] = [
    // frame, scale, focusX, focusY
    // Settle in, then hold DEAD STILL through the score: the one event
    // reads because nothing else is moving when it lands.
    [0, 2.75, 330, 110],
    [24, 2.6, 350, 110],
    [TD + 22, 2.6, 350, 110],
    [60, 2.6, 400, 110],
    [TO_STOCKS, 2.3, 420, 130],
    [TO_NEWS, 2.1, 450, 150],
    [PULL_OUT, 2.1, 450, 150],
    [PULL_OUT + 45, 1, 960, 540],
    [HOP, 1, 960, 540],
    [HOP + 25, 1.08, 960, 600],
    [PUSH_IN, 1.08, 960, 600],
    [PUSH_IN + 35, 2.3, 340, 985],
    [TO_GITHUB + 20, 2.3, 340, 985],
    [THEMES_AT + 20, 1.6, 760, 1010],
    [END - 30, 1.6, 760, 1010],
    [END + 30, 1, 960, 540],
  ];
  let i = 0;
  while (i < keys.length - 2 && f >= keys[i + 1][0]) i++;
  const [f0, s0, x0, y0] = keys[i];
  const [f1, s1, x1, y1] = keys[i + 1];
  const t = f1 === f0 ? 1 : r(f, f0, f1, INOUT);
  // A punch on the score: in over 3 frames, back over 20.
  const punch = f < TD ? 0 : interpolate(f, [TD, TD + 2, TD + 28], [0, 1, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return { s: (s0 + (s1 - s0) * t) * (1 + 0.09 * punch), x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
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
 * never fights the window behind it.
 */
function Title({ f, at, out, label, hex = MINT, line1, line2, sub, top, left, align = "left", size = 104, scrim = "bottom" }: {
  f: number; at: number; out: number; label: string; hex?: string; line1?: string; line2?: string; sub?: string;
  top: number; left?: number; align?: "left" | "center"; size?: number; scrim?: "top" | "bottom" | "center" | "none";
}) {
  const a = r(f, at, at + 14);
  const a2 = r(f, at + 6, at + 20);
  const o = 1 - r(f, out, out + 10, INOUT);
  if (a <= 0 || o <= 0) return null;
  const center = align === "center";
  const grad = scrim === "bottom"
    ? "linear-gradient(to top, rgba(11,11,19,.96) 0%, rgba(11,11,19,.86) 45%, rgba(11,11,19,0) 100%)"
    : "linear-gradient(to bottom, rgba(11,11,19,.96) 0%, rgba(11,11,19,.86) 45%, rgba(11,11,19,0) 100%)";
  return (
    <div style={{ position: "absolute", inset: 0, opacity: a * o, pointerEvents: "none" }}>
      {scrim === "center" && <div style={{ position: "absolute", inset: 0, background: "radial-gradient(62% 48% at 50% 46%, rgba(11,11,19,.94) 0%, rgba(11,11,19,.7) 60%, rgba(11,11,19,0) 100%)" }} />}
      {(scrim === "top" || scrim === "bottom") && <div style={{ position: "absolute", left: 0, right: 0, [scrim]: 0, height: 520, background: grad }} />}
      <div style={{ position: "absolute", top, left: center ? 0 : left, right: center ? 0 : undefined, textAlign: center ? "center" : "left", transform: `translateY(${(1 - a) * 24}px)` }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14, fontFamily: MONO, fontSize: 19, letterSpacing: "0.22em", textTransform: "uppercase", color: MUTE, marginBottom: 22 }}>
          <span style={{ display: "block", width: 5, height: 22, background: hex, borderRadius: 1 }} />
          {label}
        </div>
        {line1 && (
          <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: size, lineHeight: 0.92, letterSpacing: "-0.02em", textTransform: "uppercase", color: INK, whiteSpace: "nowrap" }}>{line1}</div>
        )}
        {line2 && (
          <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: size, lineHeight: 0.92, letterSpacing: "-0.02em", textTransform: "uppercase", color: "transparent", WebkitTextStroke: `3px ${MINT}`, whiteSpace: "nowrap", opacity: a2, transform: `translateY(${(1 - a2) * 18}px)` }}>{line2}</div>
        )}
        {sub && (
          <div style={{ marginTop: 24, fontFamily: MONO, fontSize: 19, letterSpacing: "0.2em", textTransform: "uppercase", color: MUTE, opacity: a2 }}>{sub}</div>
        )}
      </div>
    </div>
  );
}

export function Film() {
  const f = useCurrentFrame();
  const state = barState(f);
  const dwell = 45;
  // Half-speed for the half second after the score: the pill's fill and the
  // page clock stretch while the number lands.
  const warp = f < TD ? f : f - 0.5 * Math.min(15, f - TD);
  const fadeIn = r(f, 0, 10, Easing.out(Easing.quad));
  const cam = camera(f);
  const barTop = interpolate(f, [HOP, HOP + 14], [0, H - BAR_H], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });
  const themeIdx = f < THEMES_AT ? 0 : Math.min(THEMES.length - 1, Math.floor((f - THEMES_AT) / 12));
  const theme = THEMES[themeIdx];
  const endIn = r(f, END, END + 40);
  // The desktop steps back whenever a title is up.
  const dimDesk =
    f < PULL_OUT ? 0.22
    // Reveal the desktop clean, then step it back under the title; lift it for the hop.
    : f < PULL_OUT + 28 ? 0.22 + 0.78 * r(f, PULL_OUT, PULL_OUT + 28)
    : f < HOP - 8 ? 1 - 0.62 * r(f, PULL_OUT + 28, PULL_OUT + 44)
    : f < HOP + 12 ? 0.38 + 0.62 * r(f, HOP - 8, HOP + 2)
    : f < PUSH_IN ? 1 - 0.62 * r(f, HOP + 12, HOP + 26)
    : f < END ? 1 - 0.5 * r(f, PUSH_IN, PUSH_IN + 35)
    : 0.5 - 0.34 * endIn;

  // The world: 1920x1080, scaled about the camera's focus.
  const tx = W / 2 - cam.x * cam.s;
  const ty = H / 2 - cam.y * cam.s;

  // Chips flying into the band (f 285..320), then gone.
  const chips = CATALOG_FLY.map((c, i) => {
    const at = PUSH_IN + 12 + i * 4;
    const a = r(f, at, at + 16);
    const go = r(f, TO_GITHUB - 8 + (i === 0 ? 0 : 6), TO_GITHUB + 10 + (i === 0 ? 0 : 6), INOUT);
    if (a <= 0 || go >= 1) return null;
    // Start scattered above the band in world space, converge on the band.
    const sx = 200 + (i % 4) * 175 + (i > 3 ? 70 : 0);
    const sy = 870 + Math.floor(i / 4) * 58;
    const ex = 96;
    const ey = 1016 + 20;
    const x = sx + (ex - sx) * go;
    const y = sy + (ey - sy) * go;
    const sc = (0.6 + 0.4 * a) * (1 - go * 0.6);
    return (
      <div key={c.id} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%,-50%) scale(${sc})`, opacity: a * (1 - go), display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", borderRadius: 7, background: "#1c1c2c", border: "1px solid #303040", fontFamily: SANS, fontWeight: 700, fontSize: 15, color: "#e2e2ec", boxShadow: "0 10px 30px rgba(0,0,0,.5)", whiteSpace: "nowrap" }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: c.hex, display: "block" }} />
        {c.name}
      </div>
    );
  });

  return (
    <AbsoluteFill style={{ background: "#0b0b13", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "#0b0b13", opacity: 1 - fadeIn, zIndex: 10, pointerEvents: "none" }} />
      <div id="app-shell" data-theme={theme} style={{ position: "absolute", inset: 0 }}>
        {/* World */}
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `translate(${tx}px, ${ty}px) scale(${cam.s})`, transformOrigin: "0 0" }}>
          {/* Desktop */}
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 10%, var(--color-surface-2, #181825) 0%, #0b0b13 100%)", opacity: dimDesk }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundImage: "radial-gradient(circle, rgba(255,255,255,.045) 1px, transparent 1.2px)", backgroundSize: "40px 40px" }} />
            {/* The app's own window, behind, and a second one in front. */}
            <Img src={staticFile("shots/sports.png")} style={{ position: "absolute", left: 120, top: 130, width: 1180, borderRadius: 12, boxShadow: "0 30px 90px rgba(0,0,0,.6)", opacity: 0.55 }} />
            <Img src={staticFile("shots/home.png")} style={{ position: "absolute", left: 560, top: 180, width: 1240, borderRadius: 12, boxShadow: "0 40px 110px rgba(0,0,0,.75)" }} />
          </div>
          {/* The bar */}
          <div style={{ position: "absolute", left: 0, top: barTop, width: BAR_W, height: BAR_H, boxShadow: "0 12px 50px rgba(0,0,0,.55)" }}>
            <Bar frame={f} warp={warp} state={state} dwell={dwell} />
          </div>
          {chips}
        </div>
      </div>

      {/* Screen-space type */}
      <Title f={f} at={10} out={TO_STOCKS - 8} label="// live desktop ticker" hex="#013369" line1="The moment it happens," line2={f >= TD ? "you already know." : undefined} top={690} left={136} size={104} />
      <Title f={f} at={TO_STOCKS + 4} out={TO_NEWS - 4} label="sec 01 / markets" hex="#7c3aed" line1="One page" line2="at a time." top={690} left={136} size={104} />
      <Title f={f} at={TO_NEWS + 4} out={PULL_OUT + 24} label="sec 02 / headlines" hex="#c8102e" line1="No tab" line2="to babysit." top={690} left={136} size={104} />

      <Title f={f} at={PULL_OUT + 30} out={HOP - 4} label="sec 03 / on your desktop" line1="One bar" line2="above your work." sub="64 px · every monitor · always on top" top={330} align="center" size={112} scrim="center" />
      <Title f={f} at={HOP + 10} out={PUSH_IN + 8} label="sec 03 / on your desktop" line1="Top or bottom." sub="it's your bar. park it." top={360} align="center" size={112} scrim="center" />

      <Title f={f} at={PUSH_IN + 10} out={TO_GITHUB} label="sec 04 / pick widgets" hex="#f97316" line1="56 widgets." sub="& counting" top={70} left={136} size={104} scrim="top" />
      <Title f={f} at={TO_GITHUB + 6} out={THEMES_AT + 10} label="sec 04 / pick widgets" hex="#f97316" line1="Watch the bar" line2="change." top={70} left={136} size={104} scrim="top" />

      <Title f={f} at={THEMES_AT + 10} out={END - 6} label="sec 05 / dress it" line1="20 palettes." sub={`${theme.replace("-dark", "").replace("-", " ")} · dark & light`} top={70} left={136} size={104} scrim="top" />

      {/* End card: the site's hero, as it is. */}
      {f >= END && (
        <div style={{ position: "absolute", inset: 0, opacity: endIn }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(70% 60% at 50% 45%, rgba(11,11,19,.92) 0%, rgba(11,11,19,.6) 100%)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 200, display: "flex", justifyContent: "center", alignItems: "center", gap: 20, transform: `scale(${0.92 + 0.08 * r(f, END, END + 30)})` }}>
            <Img src={staticFile("logo.svg")} style={{ width: 72, height: 72 }} />
            <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 76, letterSpacing: "-0.04em", color: INK, lineHeight: 1 }}>
              scrollr<span style={{ color: MINT }}>.</span>
            </span>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 330, textAlign: "center", fontFamily: MONO, fontSize: 19, letterSpacing: "0.22em", textTransform: "uppercase", color: MUTE, opacity: r(f, END + 10, END + 24) }}>
            free · open source · macos / windows / linux
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 400, textAlign: "center", fontFamily: SANS, fontWeight: 900, fontSize: 150, lineHeight: 0.9, letterSpacing: "-0.02em", textTransform: "uppercase", color: INK, opacity: r(f, END + 14, END + 30), transform: `translateY(${(1 - r(f, END + 14, END + 30)) * 24}px)` }}>
            Your live
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 540, textAlign: "center", fontFamily: SANS, fontWeight: 900, fontSize: 150, lineHeight: 0.9, letterSpacing: "-0.02em", textTransform: "uppercase", color: "transparent", WebkitTextStroke: `3px ${MINT}`, opacity: r(f, END + 22, END + 38), transform: `translateY(${(1 - r(f, END + 22, END + 38)) * 24}px)` }}>
            Desktop ticker
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 730, textAlign: "center", opacity: r(f, END + 40, END + 58), transform: `translateY(${(1 - r(f, END + 40, END + 58)) * 16}px)` }}>
            <span style={{ position: "relative", display: "inline-block", background: MINT, color: "#141420", fontFamily: SANS, fontWeight: 800, fontSize: 30, padding: "20px 40px", borderRadius: 6 }}>
              Download Scrollr
              <span style={{ position: "absolute", top: -12, right: -12, background: "#0b0b13", color: MINT, border: `1px solid ${MINT}`, fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", padding: "4px 7px", borderRadius: 4 }}>FREE</span>
            </span>
            <span style={{ display: "inline-block", marginLeft: 18, verticalAlign: "top", border: "1px solid #303040", color: INK, fontFamily: SANS, fontWeight: 700, fontSize: 30, padding: "19px 36px", borderRadius: 6 }}>myscrollr.com</span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}
