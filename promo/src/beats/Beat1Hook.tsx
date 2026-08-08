/**
 * The hero cut. One continuous camera move, no cuts.
 *
 * A desktop with work on it and the Scrollr bar at the screen edge. The
 * camera pushes into one chip until the rest of the world is gone, your
 * matchup turns over on a tenth of a point, and the camera pulls back
 * out to the same desk — where the bar is still sitting, having done
 * that without being asked. Then the wordmark.
 *
 * THE DESKTOP IS THE PITCH. Earlier cuts had the bar floating in black,
 * and a viewer finished them without learning that Scrollr runs on your
 * screen while you work, which is the entire product. Everything before
 * the pull-back is setup for the moment the desk comes back.
 *
 * Built for muted autoplay in a feed — Reddit, Facebook, Twitter. So
 * something moves in frame one (the camera is already creeping before
 * anything else happens), every claim is burned in rather than spoken,
 * and it ends roughly where it began so a loop doesn't jar.
 *
 * The CHIPS are the real components. The rail layout and the desk are
 * the promo's — see src/data/dashboard.ts.
 */
import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import FantasyStatChip from "../../../desktop/src/components/chips/FantasyStatChip";
import { DEFAULT_WIDGET_DISPLAY } from "../../../desktop/src/preferences";
import type { LeagueResponse } from "../../../desktop/src/datawidgets/fantasy/types";
import { RAIL_LEFT, RAIL_RIGHT } from "../data/dashboard";
import {
  CLOSING_SCORE,
  OPENING_SCORE,
  OPPONENT_SCORE,
  sundayMoney,
} from "../data/sundayMoney";
import { useMotionClock } from "../motionClock";
import { Desktop } from "../scene/Desktop";

/** Seconds. The whole cut's timing, in one place. */
const T = {
  /** Fully tight on the chip. The push runs from frame 0 to here. */
  tight: 2.4,
  /** The play lands. */
  hit: 3.1,
  /** Camera starts back out; the rail assembles. */
  rail: 4.0,
  /** Back to the desk. */
  wide: 5.8,
  /** Bar drifts — the product simply in use. */
  drift: 6.6,
  /** Wordmark. */
  end: 8.4,
};

/** How far in the camera goes. Matches the earlier hero framing. */
const MAX_ZOOM = 2.6;

/** Where the bar sits in the 2560x1440 scene. */
const BAR_Y = 1372;
/**
 * Horizontal focus. Not 1280: the sibling leagues either side are
 * different widths, so centring the ROW leaves the hero chip a little
 * left of frame centre. Tuned against a tight frame.
 */
const FOCUS_X = 1252;

const MONO = "var(--font-mono, ui-monospace, monospace)";
const GLOW = "rgba(34, 197, 94, 0.55)";
const CHIP_GAP = 8;
const SCROLL_PX_PER_SEC = 90;

export function Beat1Hook() {
  useMotionClock();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = (s: number) => Math.round(s * fps);

  /**
   * ONE value drives the whole camera, and everything else keys off it
   * rather than off time. That's what keeps the move reversible: the
   * desk fades out on the way in and back in on the way out, with no
   * second set of timings to keep in sync.
   */
  // Two eased moves rather than one linear ramp. Linear meant the frame
  // was already 22% zoomed a third of a second in, so the establishing
  // shot — the whole point of opening on a desk — never existed. Ease-in
  // holds the wide shot, then accelerates.
  const pushIn = interpolate(frame, [0, f(T.tight)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const pullOut = interpolate(frame, [f(T.rail), f(T.wide)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const tightness = pushIn * (1 - pullOut);

  const zoom = interpolate(tightness, [0, 1], [1, MAX_ZOOM]);
  // Focus travels from frame centre to the chip, so the wide shot frames
  // the whole desk instead of being centred on a bar at its bottom edge.
  // Tight focus deliberately lands ABOVE the bar's true centre, which
  // pushes the chip into the lower third of frame. Dead-centre left the
  // scoreboard clipping the chip's top edge and the bottom third empty.
  const focusY = interpolate(tightness, [0, 1], [720, BAR_Y - 55]);
  const camera = `translate(${1280 - FOCUS_X * zoom}px, ${
    720 - focusY * zoom
  }px) scale(${zoom})`;

  const desktopOpacity = interpolate(tightness, [0.2, 0.62], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const boardOpacity = interpolate(tightness, [0.68, 0.96], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const siblingOpacity = interpolate(tightness, [0.45, 0.8], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const landed = frame >= f(T.hit);
  const userPoints = landed ? CLOSING_SCORE : OPENING_SCORE;
  const ahead = landed;
  const margin = Math.abs(round1(userPoints - OPPONENT_SCORE));

  // The hit. The score SWAPS on one frame and a flash peaks on that same
  // frame, so the eye never resolves the old digits. AnimateNumber was
  // tried here: it rolls every changing digit column through every glyph
  // between, which at this size is a stack of overlapping numerals.
  const hit = spring({
    frame: frame - f(T.hit),
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * 0.4),
  });
  const hitScale = landed ? interpolate(hit, [0, 1], [1.22, 1]) : 1;
  const flash = landed
    ? interpolate(
        frame - f(T.hit),
        [0, 4, Math.round(fps * 0.45)],
        [1, 0.55, 0],
        { extrapolateRight: "clamp" },
      )
    : 0;

  const scrollPx =
    frame > f(T.drift) ? ((frame - f(T.drift)) / fps) * SCROLL_PX_PER_SEC : 0;

  const end = interpolate(frame, [f(T.end), f(T.end + 0.7)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#05070a",
        overflow: "hidden",
      }}
    >
      {/*
        Desk and bar move under ONE transform — they have to be the same
        object or the pull-back is a cut rather than a move. The
        scoreboard is a promo graphic and sits outside the camera, which
        is why it stays square to frame while everything else scales.
      */}
      <div
        style={{
          position: "absolute",
          width: 2560,
          height: 1440,
          transformOrigin: "0 0",
          transform: camera,
          filter: end > 0 ? `brightness(${1 - end * 0.75})` : undefined,
        }}
      >
        <div style={{ opacity: desktopOpacity }}>
          <Desktop />
        </div>

        <div
          style={{
            position: "absolute",
            top: BAR_Y,
            left: 0,
            width: 2560,
            display: "flex",
            justifyContent: "center",
            transform: "translateY(-50%)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: CHIP_GAP,
              width: "max-content",
              transform: `translateX(${-scrollPx}px)`,
            }}
          >
            {RAIL_LEFT.map((l) => (
              <div key={l.league_key} style={{ opacity: siblingOpacity }}>
                <Chip league={l} />
              </div>
            ))}

            <div style={{ position: "relative" }}>
              <Chip league={sundayMoney(userPoints)} />
              {ahead && <FlashRing progress={hit} />}
            </div>

            {RAIL_RIGHT.map((l) => (
              <div key={l.league_key} style={{ opacity: siblingOpacity }}>
                <Chip league={l} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The scoreboard graphic: only while the camera is tight. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          // TOP-anchored, not centred. The camera puts the chip at frame
          // centre, so a centred board lands directly on top of it — the
          // score and the chip were overlapping in the same 200px.
          justifyContent: "flex-start",
          gap: 52,
          paddingTop: 96,
          opacity: boardOpacity,
          pointerEvents: "none",
        }}
      >
        <Context />
        <Scoreboard
          points={userPoints}
          ahead={ahead}
          hitScale={hitScale}
          flash={flash}
        />
        <State ahead={ahead} margin={margin} />
      </div>

      {end > 0 && <Endcard progress={end} />}
    </div>
  );
}

function Chip({ league }: { league: LeagueResponse }) {
  return (
    <FantasyStatChip
      league={league}
      prefs={DEFAULT_WIDGET_DISPLAY.fantasy}
      comfort
      // NOT rollScore. At ticker size a digit roller is unreadable
      // mid-transition. Right for the app, noise here.
    />
  );
}

function Context() {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 36,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        gap: 22,
      }}
    >
      <span style={{ color: "var(--color-live, #ef4444)" }}>● Live</span>
      <span>The Sunday Money League · Week 12</span>
    </div>
  );
}

function Scoreboard({
  points,
  ahead,
  hitScale,
  flash,
}: {
  points: number;
  ahead: boolean;
  hitScale: number;
  flash: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 110 }}>
      <Side
        team="Brunch Money"
        you
        points={points}
        color={ahead ? "var(--color-up)" : "var(--color-down)"}
        hitScale={hitScale}
        flash={flash}
      />
      <div
        style={{
          alignSelf: "flex-end",
          width: 2,
          height: 215,
          background: "#2b3441",
        }}
      />
      <Side team="Fourth and Long" points={OPPONENT_SCORE} color="#9ca3af" />
    </div>
  );
}

function Side({
  team,
  points,
  color,
  you = false,
  hitScale = 1,
  flash = 0,
}: {
  team: string;
  points: number;
  color: string;
  you?: boolean;
  hitScale?: number;
  flash?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 34,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: you ? "#e5e7eb" : "#6b7280",
          whiteSpace: "nowrap",
        }}
      >
        {team}
        {you && <span style={{ color: "#6b7280" }}> (you)</span>}
      </div>
      {/* Fixed width so the centred row can't shift when digits change. */}
      <div
        style={{
          position: "relative",
          width: 640,
          display: "flex",
          justifyContent: "center",
        }}
      >
        {flash > 0 && (
          <div
            style={{
              position: "absolute",
              inset: "-8% -6%",
              borderRadius: 32,
              background: `radial-gradient(ellipse at center, ${GLOW} 0%, transparent 70%)`,
              opacity: flash,
            }}
          />
        )}
        <span
          style={{
            position: "relative",
            fontSize: 215,
            lineHeight: 1,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            fontFamily: MONO,
            color,
            transform: `scale(${hitScale})`,
            display: "inline-block",
          }}
        >
          {points.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function State({ ahead, margin }: { ahead: boolean; margin: number }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 50,
        fontWeight: 600,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        color: ahead ? "var(--color-up)" : "var(--color-down)",
      }}
    >
      {ahead ? "▲ Ahead by " : "▼ Trailing by "}
      {margin.toFixed(1)}
    </div>
  );
}

function FlashRing({ progress }: { progress: number }) {
  const scale = interpolate(progress, [0, 1], [1, 1.05]);
  const opacity = interpolate(progress, [0, 0.25, 1], [0, 0.55, 0]);
  return (
    <div
      style={{
        position: "absolute",
        inset: -3,
        border: "1px solid var(--color-up)",
        borderRadius: 7,
        transform: `scale(${scale})`,
        opacity,
      }}
    />
  );
}

/**
 * The ask. Muted autoplay means every word has to be on screen, and a
 * feed viewer gives this about a second — so it's one line, one name and
 * one destination, nothing else.
 *
 * The "demo data" mark is not optional politeness. The stat lines in
 * these fixtures are invented, and r/fantasyfootball is precisely the
 * audience that will spot an implausible Achane line. Saying so costs a
 * line of 24px type and stops the post becoming about that instead of
 * about the product.
 */
function Endcard({ progress }: { progress: number }) {
  const rise = interpolate(progress, [0, 1], [24, 0]);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        opacity: progress,
        transform: `translateY(${rise}px)`,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 132,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: "#f3f4f6",
        }}
      >
        Scrollr
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 44,
          letterSpacing: "0.06em",
          color: "#9ca3af",
          textAlign: "center",
        }}
      >
        Your leagues on your screen. Without checking.
      </div>
      <div
        style={{
          marginTop: 18,
          fontFamily: MONO,
          fontSize: 38,
          letterSpacing: "0.14em",
          color: "var(--color-up)",
        }}
      >
        myscrollr.com
      </div>
      <div
        style={{
          position: "absolute",
          // Clears the bar, which is still visible under the dim.
          bottom: 122,
          fontFamily: MONO,
          fontSize: 24,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#4b5563",
        }}
      >
        Demo data
      </div>
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
