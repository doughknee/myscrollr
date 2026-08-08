/**
 * The hero cut. One continuous camera move, no cuts.
 *
 * A desktop with work on it and the Scrollr bar at the screen edge. The
 * camera pushes into one chip, your matchup turns over on a tenth of a
 * point, and it pulls back out to the same desk where the bar is still
 * sitting, having done that without being asked.
 *
 * THE PRODUCT IS THE HERO, and an earlier cut got that exactly backwards.
 * It zoomed to 2.6x, which renders the chip's 13px body text at 34px in a
 * 2560px frame — 8.5px once a feed scales the video to a quarter. Scrollr
 * was literally illegible, while a 232px promo scoreboard that exists
 * nowhere in the app was the biggest thing on screen. The film sold a
 * graphic. Now the camera goes to 4.2x (body text ~55px, ~14px at feed
 * scale), the scoreboard is gone, and what replaces it is two lines of
 * type: what this IS, and what is at stake.
 *
 * Built for muted autoplay on Reddit, Facebook and Twitter. So the frame
 * is already moving at frame 0, the hit lands at 1.55s rather than making
 * a scroller wait three seconds for it, every claim is burned in, and the
 * head and tail are matched so the loop is a step rather than a cliff.
 *
 * The CHIPS are the real components. The rail layout and the desk are the
 * promo's — see src/data/dashboard.ts and src/scene/Desktop.tsx.
 */
import {
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import FantasyStatChip from "../../../desktop/src/components/chips/FantasyStatChip";
import { DEFAULT_WIDGET_DISPLAY } from "../../../desktop/src/preferences";
import type { LeagueResponse } from "../../../desktop/src/datawidgets/fantasy/types";
import {
  POOL_AHEAD,
  POOL_BEHIND,
  RAIL_LEFT,
  RAIL_RIGHT_TAIL,
  collegePool,
} from "../data/dashboard";
import { CLOSING_SCORE, OPENING_SCORE, sundayMoney } from "../data/sundayMoney";
import { useMotionClock } from "../motionClock";
import { Desktop, REAL_TICKER_BOTTOM } from "../scene/Desktop";

/** Seconds. The whole cut's timing, in one place. */
const T = {
  /** Camera settled tight on the chip. */
  tight: 1.05,
  /**
   * The play lands.
   *
   * Was 1.55s, which left the "Losing by 0.1" state on screen for about
   * a quarter of a second — you physically could not finish reading the
   * line before it became its own opposite. The whole shot depends on
   * having read the deficit BEFORE it flips, so the deficit now holds
   * for a little over a second, and so does the payoff.
   */
  hit: 2.2,
  /** Camera starts back out; the rail assembles. */
  rail: 3.2,
  /** Back to the desk. */
  wide: 4.7,
  /** A SECOND league takes the lead, on the rail. */
  second: 5.5,
  /** Wordmark. */
  end: 7.3,
};

/**
 * 4.2, not 2.6. This single number decides whether the product is visible
 * at all once a feed scales the video down — see the file header.
 */
const MAX_ZOOM = 4.2;

/**
 * The bar sits at the TOP, because that is where it is in the recording.
 * The composition covers the recording's own ticker strip with its own
 * bar of real chips so the score can be driven; everything below is the
 * untouched photograph.
 */
const BAR_Y = 46;
/**
 * Horizontal focus. Not 1280: the sibling leagues either side are
 * different widths, so centring the row leaves the hero chip a little
 * left of frame centre.
 */
const FOCUS_X = 1252;

const UI =
  '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif';

/**
 * The app's accent, NOT --color-up. Green-up is the "your score rose"
 * token; spending it on the brand burns the one signal the chip uses.
 */
const ACCENT = "#34d399";

const CHIP_GAP = 8;

/**
 * Win probability is OFF in the promo, and that's a correctness fix
 * rather than a taste one. At 151.6 vs 151.7 the chip computes a GREEN
 * 72% — so the frame said "Losing by 0.1" in red while the product
 * underneath it said you were winning, and the hit moved that number by
 * nothing at all. Two contradictory claims in one frame is worse than one
 * fewer stat.
 */
const PROMO_PREFS = {
  ...DEFAULT_WIDGET_DISPLAY.fantasy,
  winProbability: "off" as const,
};

export function Beat1Hook() {
  useMotionClock();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const f = (s: number) => Math.round(s * fps);

  // Leaves slow, arrives fast: ~12% of the travel is done by 0.15s, so
  // the frame is visibly moving by frame 9 rather than sitting still for
  // a second while a feed scrolls past it.
  const pushIn = interpolate(frame, [0, f(T.tight)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.1, 1),
  });
  const pullOut = interpolate(frame, [f(T.rail), f(T.wide)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.3, 0, 0.15, 1),
  });
  const tightness = pushIn * (1 - pullOut);

  // A creep across the hold. Camera velocity reaching exactly zero reads
  // as a stalled video in a feed, so the tight section never fully stops.
  const creep = interpolate(frame, [f(T.tight), f(T.rail)], [0, 0.11], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const end = interpolate(frame, [f(T.end), f(T.end + 0.55)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  /**
   * The camera is interpolated between two KNOWN-CORRECT framings rather
   * than by tracking a moving focus point.
   *
   * Focus-point tracking is what a camera normally wants, and it broke
   * the moment the bar moved to the top edge: zoom grows faster than the
   * focus can travel, so a third of a second in the translate had already
   * pushed the top of the screen — the bar, the subject — off frame
   * entirely. Interpolating the transform itself is guaranteed correct at
   * both ends and reads as a push that also pans, which is fine.
   *
   * Wide: the whole screenshot fills the frame. Tight: the hero chip at
   * frame centre-x, the bar sitting at 30% height with the type below.
   */
  const camZoom =
    interpolate(tightness, [0, 1], [1, MAX_ZOOM]) + tightness * creep;
  const camX = interpolate(tightness, [0, 1], [0, 1280 - FOCUS_X * MAX_ZOOM]);
  const camY = interpolate(tightness, [0, 1], [0, 432 - BAR_Y * MAX_ZOOM]);
  /*
    NO push-back on the endcard. It used to scale the world to 0.92 and
    slide it down, which zooms out PAST the edges of the screenshot — the
    desk is exactly 2560x1440, so anything under 1.0 reveals empty frame
    around it and stretches the bar off the photograph. The card dims the
    world instead; nothing moves.
  */
  const camera = `translate(${camX.toFixed(1)}px, ${camY.toFixed(1)}px) scale(${camZoom.toFixed(4)})`;

  /**
   * RACK FOCUS, not a cross-fade to black. The desk used to fade to
   * opacity 0 for a third of the runtime, which is the exact failure this
   * film exists to fix — a bar floating in a void says nothing about
   * running on your screen. Blurring and dimming keeps the screen present
   * behind the type the whole way through, and the return is keyed to
   * FRAME rather than tightness so the world resolves a beat after the
   * camera stops, giving the pull-back a payoff rather than just an end.
   */
  const deskSharp =
    frame < f(T.rail)
      ? 1 - tightness
      : interpolate(frame, [f(T.wide - 0.55), f(T.wide + 0.1)], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const deskFilter = `blur(${(15 * (1 - deskSharp)).toFixed(2)}px) brightness(${(
    0.34 +
    0.66 * deskSharp
  ).toFixed(3)}) saturate(${(0.7 + 0.3 * deskSharp).toFixed(3)})`;

  const landed = frame >= f(T.hit);
  const userPoints = landed ? CLOSING_SCORE : OPENING_SCORE;
  const sinceHit = frame - f(T.hit);

  /**
   * The hit, staged over ten frames rather than flipped by one boolean.
   * Changing everything at once on a single frame reads as a render
   * glitch; a short cascade reads as an event. Attack first, then settle.
   */
  const hitScale = !landed
    ? 1
    : sinceHit <= 3
      ? interpolate(sinceHit, [0, 3], [1, 1.14], {
          easing: Easing.out(Easing.cubic),
        })
      : interpolate(sinceHit, [3, 16], [1.14, 1], {
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
  const glow = landed
    ? interpolate(sinceHit, [0, 3, 6, f(0.5)], [0, 1, 0.5, 0], {
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.quad),
      })
    : 0;
  const stakeRise = landed
    ? interpolate(sinceHit, [6, 6 + f(0.18)], [10, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      })
    : 0;
  const ringOn = landed && sinceHit >= 8;

  const stakeOpacity = interpolate(
    frame,
    [f(0.85), f(1.15), f(T.rail), f(T.rail + 0.35)],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );

  // Ramps in rather than snapping from 0 to full speed in one frame, and
  // 130px/s carries a whole chip width across the shot so chips actually
  // enter and leave frame — otherwise it's one object sliding, not a
  // ticker running.
  const driftRamp = interpolate(frame, [f(T.wide), f(T.wide + 0.4)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const scrollPx =
    frame > f(T.wide) ? driftRamp * ((frame - f(T.wide)) / fps) * 130 : 0;

  const poolAhead = frame >= f(T.second);
  const poolPulse = poolAhead
    ? interpolate(frame - f(T.second), [0, 15], [1, 0], {
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.quad),
      })
    : 0;

  // Head and tail ramps. Reddit and Facebook loop by default, so the seam
  // is seen on every repeat view.
  const loopIn = interpolate(frame, [0, 7], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const loopOut = interpolate(
    frame,
    [durationInFrames - 8, durationInFrames - 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  // Floors rather than fading to near-black: the bar has to stay visibly
  // alive behind the endcard, because "it keeps running" is the claim.
  const worldDim = 1 - end * 0.45 + loopOut * 0.25;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#05070a",
        overflow: "hidden",
        opacity: loopIn,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 2560,
          height: 1440,
          transformOrigin: "0 0",
          transform: camera,
          filter: `brightness(${worldDim.toFixed(3)})`,
        }}
      >
        <div style={{ position: "absolute", inset: 0, filter: deskFilter }}>
          <Desktop />
        </div>

        {/* The BAR: a full-width substrate pinned to the screen edge.
            Without it the chips read as graphics hovering over a desktop
            rather than a piece of UI attached to it. It does NOT blur —
            it's the subject. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: REAL_TICKER_BOTTOM,
            /*
              LIGHT, matching the recording. This was an opaque near-black
              slab, which put a heavy dark band across the top of an
              otherwise pale desktop and looked nothing like the ticker in
              the screenshot underneath it — the app was in light theme.
              Still fully opaque, because the recording has its own frozen
              ticker in exactly this strip and any translucency lets it
              show through the driven one.
            */
            background: "#f7f7fb",
            borderBottom: "1px solid rgba(16,20,40,0.10)",
          }}
        />

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
            {/* Doubled either side so the row is wider than the frame plus
                the drift, and chips clip at both edges instead of the whole
                rail sliding as one object. Equal counts keep FOCUS_X true. */}
            {[...RAIL_LEFT, ...RAIL_LEFT].map((l, i) => (
              <Chip key={`l${i}`} league={l} />
            ))}

            <div style={{ position: "relative" }}>
              <Chip league={sundayMoney(userPoints)} />
              {ringOn && <FlashRing progress={glow} />}
            </div>

            {/* The second event: another league takes the lead 3s later,
                in the real chip, with the real red-to-green swap. Quieter
                than the hero hit so it reads as ambient rather than as a
                second climax. */}
            <div
              style={{
                borderRadius: 9,
                boxShadow:
                  poolPulse > 0
                    ? `0 0 0 1px rgba(52,211,153,${(0.5 * poolPulse).toFixed(3)}), 0 0 24px rgba(52,211,153,${(0.35 * poolPulse).toFixed(3)})`
                    : undefined,
              }}
            >
              <Chip
                league={collegePool(poolAhead ? POOL_AHEAD : POOL_BEHIND)}
              />
            </div>

            {[...RAIL_RIGHT_TAIL, ...RAIL_LEFT].map((l, i) => (
              <Chip key={`r${i}`} league={l} />
            ))}
          </div>
        </div>

        {/* End masks, so the rail runs off frame rather than stopping. */}
        <Mask side="left" />
        <Mask side="right" />
      </div>

      {/* The type. Two lines: what this IS, and what's at stake. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 330,
          gap: 30,
          opacity: stakeOpacity,
          pointerEvents: "none",
          fontFamily: UI,
          textAlign: "center",
        }}
      >
        {/* The film never said what Scrollr was until the endcard, by
            which point most of a feed has already scrolled past. */}
        <div
          style={{
            fontSize: 68,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            textShadow: "0 4px 40px rgba(0,0,0,0.9)",
          }}
        >
          A live ticker for your fantasy leagues
        </div>
        <div
          style={{
            fontSize: 132,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: landed
              ? sinceHit < 2
                ? "#ffffff"
                : "var(--color-up, #22c55e)"
              : "var(--color-down, #ef4444)",
            transform: `translateY(${stakeRise.toFixed(2)}px) scale(${hitScale.toFixed(4)})`,
            textShadow:
              glow > 0
                ? `0 0 ${(90 * glow).toFixed(0)}px rgba(52,211,153,${(0.75 * glow).toFixed(3)})`
                : "0 4px 40px rgba(0,0,0,0.9)",
          }}
        >
          {landed ? "Ahead by 0.1" : "Losing by 0.1"}
        </div>
      </div>

      {/* Owned up front, not buried at the end. Hiding it reads as legal
          cover; stating it reads as confidence — and r/fantasyfootball is
          exactly the audience that checks. */}
      <div
        style={{
          position: "absolute",
          // BOTTOM-left: the bar occupies the top edge now, and the mark
          // was landing straight on the chips.
          bottom: 26,
          left: 30,
          // On its own pill. The desk is a light screenshot, so pale text
          // vanished into the app window behind it; the camera also moves
          // over both light and dark areas, so it needs to carry its own
          // contrast rather than rely on what's underneath.
          padding: "8px 18px",
          borderRadius: 999,
          background: "rgba(10,13,20,0.55)",
          fontFamily: UI,
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "0.02em",
          color: "rgba(255,255,255,0.72)",
        }}
      >
        Sample data — not a live game
      </div>

      {end > 0 && <Endcard progress={end} f={f} frame={frame} />}
    </div>
  );
}

function Mask({ side }: { side: "left" | "right" }) {
  return (
    <div
      style={{
        position: "absolute",
        [side]: 0,
        top: 0,
        width: 150,
        height: REAL_TICKER_BOTTOM,
        background: `linear-gradient(${side === "left" ? 90 : 270}deg, #f7f7fb 0%, rgba(247,247,251,0) 100%)`,
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * Wrapped in `#app-shell[data-theme="scrollr-light"]`, because that is the
 * theme the recording was made in — dark chips on a light desktop read as
 * a different product, and the white chip outlines that came with them
 * were the giveaway.
 *
 * `#app-shell` and NOT `#desktop-shell`: both carry the palette, but
 * desktop-shell also carries real layout (height: 100vh, its own
 * background, width: 100% !important on its last child) which wrecks a
 * video frame. app-shell carries only the palette and the app's
 * animation-stilling rule, and stilling CSS animation inside a promo is
 * no loss — it makes the render marginally more deterministic.
 */
function Chip({ league }: { league: LeagueResponse }) {
  return (
    <div id="app-shell" data-theme="scrollr-light" style={{ display: "flex" }}>
      <FantasyStatChip league={league} prefs={PROMO_PREFS} comfort />
    </div>
  );
}

function FlashRing({ progress }: { progress: number }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: -3,
        border: `1px solid ${ACCENT}`,
        borderRadius: 9,
        transform: `scale(${1 + progress * 0.04})`,
        opacity: progress * 0.7,
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * The ask. Muted autoplay means every word is on screen, and a feed
 * viewer gives it about a second.
 *
 * Everything is sized against a legibility FLOOR: a feed scales this to
 * roughly a quarter, so anything meaningful has to clear ~64px to survive
 * at 16px. The previous card had a 46px tagline and a 22px disclosure —
 * 11px and 5px respectively, which is decoration, not communication. It
 * also named no category, no platform and no price.
 */
function Endcard({
  progress,
  f,
  frame,
}: {
  progress: number;
  f: (s: number) => number;
  frame: number;
}) {
  // Staggered, so the card assembles rather than appearing.
  const at = (delay: number) =>
    interpolate(frame, [f(T.end + delay), f(T.end + delay + 0.35)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
  const a = at(0);
  const b = at(0.1);
  const c = at(0.22);
  const rise = (v: number) => `translateY(${(28 * (1 - v)).toFixed(1)}px)`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        paddingBottom: 150,
        opacity: progress,
        fontFamily: UI,
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      {/*
        A scrim, because the world deliberately does NOT fade to black
        behind this card — the bar has to stay visibly running, which is
        the product's whole claim. Without it the tagline lands on a
        spreadsheet grid and neither wins.
      */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(1500px 900px at 50% 46%, rgba(5,7,12,0.94) 0%, rgba(5,7,12,0.82) 45%, rgba(5,7,12,0) 78%)",
        }}
      />
      <div
        style={{
          position: "relative",
          fontSize: 168,
          fontWeight: 800,
          letterSpacing: "-0.045em",
          color: "#ffffff",
          opacity: a,
          transform: rise(a),
        }}
      >
        Scrollr
      </div>
      <div
        style={{
          position: "relative",
          fontSize: 72,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          color: "rgba(255,255,255,0.82)",
          opacity: b,
          transform: rise(b),
        }}
      >
        The moment it happens, you already know.
      </div>
      <div
        style={{
          position: "relative",
          fontSize: 44,
          fontWeight: 500,
          color: "#9292a4",
          opacity: b,
          transform: rise(b),
        }}
      >
        Live fantasy ticker · Windows &amp; macOS · Free
      </div>
      <div
        style={{
          position: "relative",
          marginTop: 20,
          padding: "18px 46px",
          borderRadius: 999,
          background: "rgba(52,211,153,0.10)",
          border: "1px solid rgba(52,211,153,0.45)",
          fontSize: 60,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color: ACCENT,
          opacity: c,
          transform: rise(c),
        }}
      >
        myscrollr.com
      </div>
    </div>
  );
}
