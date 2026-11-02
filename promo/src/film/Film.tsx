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
    [0, 2.6, 330, 110],
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
  const punch = f < TD ? 0 : interpolate(f, [TD, TD + 3, TD + 24], [0, 1, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  return { s: (s0 + (s1 - s0) * t) * (1 + 0.06 * punch), x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
}

const SANS = "Archivo, 'Plus Jakarta Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

function Caption({ f, at, out, children, size = 92, top, left, right, align = "left", color = "#e2e2ec" }: {
  f: number; at: number; out: number; children: React.ReactNode; size?: number; top: number; left?: number; right?: number; align?: "left" | "right" | "center"; color?: string;
}) {
  const a = r(f, at, at + 14);
  const o = 1 - r(f, out, out + 10, INOUT);
  if (a <= 0 || o <= 0) return null;
  return (
    <div style={{ position: "absolute", top, left, right, width: align === "center" ? "100%" : undefined, textAlign: align, fontFamily: SANS, fontWeight: 900, fontSize: size, letterSpacing: "-0.03em", lineHeight: 0.95, color, opacity: a * o, transform: `translateY(${(1 - a) * 28}px)`, textShadow: "0 8px 40px rgba(0,0,0,.6)", whiteSpace: "nowrap" }}>
      {children}
    </div>
  );
}

function Label({ f, at, out, children, top, left, right, align = "left" }: { f: number; at: number; out: number; children: React.ReactNode; top: number; left?: number; right?: number; align?: "left" | "right" | "center" }) {
  const a = r(f, at, at + 12);
  const o = 1 - r(f, out, out + 8, INOUT);
  if (a <= 0 || o <= 0) return null;
  return (
    <div style={{ position: "absolute", top, left, right, width: align === "center" ? "100%" : undefined, textAlign: align, fontFamily: MONO, fontSize: 20, letterSpacing: "0.22em", textTransform: "uppercase", color: "#9292a4", opacity: a * o }}>
      {children}
    </div>
  );
}

export function Film() {
  const f = useCurrentFrame();
  const state = barState(f);
  const dwell = 45;
  const cam = camera(f);
  const barTop = interpolate(f, [HOP, HOP + 14], [0, H - BAR_H], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });
  const themeIdx = f < THEMES_AT ? 0 : Math.min(THEMES.length - 1, Math.floor((f - THEMES_AT) / 12));
  const theme = THEMES[themeIdx];
  const endIn = r(f, END, END + 40);
  const dimDesk = (0.3 + 0.7 * r(f, PULL_OUT, PULL_OUT + 45)) * (1 - endIn * 0.82);
  const mint = "#34d399";

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
            <Bar frame={f} state={state} dwell={dwell} />
          </div>
          {chips}
        </div>
      </div>

      {/* Screen-space type */}
      <Label f={f} at={6} out={TD - 4} top={700} left={140}>// live desktop ticker</Label>
      <Caption f={f} at={12} out={TD + 40} top={740} left={136} size={110}>The moment it happens,</Caption>
      <Caption f={f} at={TD + 2} out={TO_STOCKS - 6} top={860} left={136} size={110} color={mint}>you already know.</Caption>

      <Caption f={f} at={TO_STOCKS + 4} out={TO_NEWS - 4} top={780} left={136} size={120}>Markets.</Caption>
      <Caption f={f} at={TO_NEWS + 4} out={PULL_OUT + 20} top={780} left={136} size={120}>Headlines.</Caption>

      <Caption f={f} at={PULL_OUT + 30} out={HOP - 4} top={470} left={0} align="center" size={96}>One bar above your work.</Caption>
      <Label f={f} at={PULL_OUT + 38} out={HOP - 4} top={580} left={0} align="center">64 px · every monitor · always on top</Label>

      <Caption f={f} at={HOP + 10} out={PUSH_IN + 10} top={470} left={0} align="center" size={96}>Top or bottom.</Caption>

      <Caption f={f} at={PUSH_IN + 10} out={TO_GITHUB} top={120} left={136} size={100}>Pick widgets.</Caption>
      <Caption f={f} at={TO_GITHUB + 6} out={THEMES_AT + 10} top={120} left={136} size={100} color={mint}>Watch the bar change.</Caption>

      <Caption f={f} at={THEMES_AT + 10} out={END - 6} top={120} left={136} size={100}>20 palettes.</Caption>
      <Label f={f} at={THEMES_AT + 16} out={END - 6} top={240} left={140}>{theme.replace("-dark", "").replace("-", " ")} · dark &amp; light</Label>

      {/* End card */}
      {f >= END && (
        <div style={{ position: "absolute", inset: 0, opacity: endIn }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 300, display: "flex", justifyContent: "center", alignItems: "center", gap: 26, transform: `scale(${0.9 + 0.1 * r(f, END, END + 30)})` }}>
            <Img src={staticFile("logo.svg")} style={{ width: 128, height: 128 }} />
            <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 140, letterSpacing: "-0.04em", color: "#e2e2ec", lineHeight: 1 }}>
              scrollr<span style={{ color: mint }}>.</span>
            </span>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 500, textAlign: "center", fontFamily: SANS, fontWeight: 500, fontSize: 40, color: "#e2e2ec", opacity: r(f, END + 18, END + 40), transform: `translateY(${(1 - r(f, END + 18, END + 40)) * 16}px)` }}>
            Free. Open source. <span style={{ color: "#9292a4" }}>macOS · Windows · Linux</span>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 600, textAlign: "center", opacity: r(f, END + 34, END + 56), transform: `translateY(${(1 - r(f, END + 34, END + 56)) * 16}px)` }}>
            <span style={{ display: "inline-block", background: mint, color: "#141420", fontFamily: SANS, fontWeight: 800, fontSize: 34, padding: "20px 44px", borderRadius: 8 }}>Download Scrollr ↓</span>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 740, textAlign: "center", fontFamily: MONO, fontSize: 30, letterSpacing: "0.22em", color: mint, opacity: r(f, END + 46, END + 66) }}>MYSCROLLR.COM</div>
        </div>
      )}
    </AbsoluteFill>
  );
}
