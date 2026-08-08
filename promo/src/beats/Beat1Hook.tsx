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
import FollowedPlayerChip from "../../../desktop/src/components/chips/FollowedPlayerChip";
import { RAIL_LEFT, RAIL_PLAYERS, RAIL_RIGHT_TAIL } from "../data/dashboard";
import {
  ACHANE_AFTER,
  ACHANE_BEFORE,
  CLOSING_SCORE,
  OPENING_SCORE,
  sundayMoney,
} from "../data/sundayMoney";
import { badBeats } from "../data/badBeats";
import { useMotionClock } from "../motionClock";
import { Desktop, REAL_TICKER_BOTTOM } from "../scene/Desktop";

/** Seconds. The whole cut's timing, in one place. */
const T = {
  /**
   * How long the wide shot holds before the camera starts moving.
   *
   * There used to be none — the push began on frame 0, because a feed
   * needs something moving immediately. The rail now drifts from frame 0
   * regardless, so the motion requirement is met without the camera, and
   * the opening can breathe long enough to read the desk.
   */
  linger: 0.8,
  /** Camera settled tight on the chip. */
  tight: 2.1,
  /**
   * The play lands.
   *
   * Was 1.55s, which left the deficit on screen for about a quarter of a
   * second — you physically could not finish reading the line before it
   * became its own opposite. The whole shot depends on having read the
   * deficit BEFORE it flips, so it now holds ~1.15s, and the payoff
   * holds ~1.4s after it: there is a lot happening on that frame (a
   * score, a colour, a chip lifting) and it needs to be watchable.
   */
  hit: 3.1,
  /** Back to the desk. */
  wide: 5.9,
  /**
   * The camera eases back to a TWO-CHIP framing right after the hit, so
   * the consequence is visible in the same shot as the cause. Tight
   * enough to read one chip, wide enough to hold both.
   */
  reveal: 3.55,
  /** Camera starts back out properly; the rail assembles. */
  rail: 4.6,
  /** Cross-dissolve to the Matchup view. */
  showA: 6.9,
  /** Cross-dissolve to the Roster view. */
  showB: 8.2,
  /** Wordmark. */
  end: 9.6,
};

/** Zoom, as a fraction of MAX_ZOOM, at which both chips fit the frame. */
const TWO_CHIP = 0.34;

/**
 * 3.0 rather than 4.2 because CHIP_SCALE now does part of the work: the
 * chips render 1.4x, so the same on-screen size needs less camera.
 */
const MAX_ZOOM = 3.0;

/**
 * The bar sits at the TOP, because that is where it is in the recording.
 * The composition covers the recording's own ticker strip with its own
 * bar of real chips so the score can be driven; everything below is the
 * untouched photograph.
 */
const BAR_Y = 38;

/**
 * The recording was made with the app at 130% display size, so its ticker
 * chips are ~70px tall sitting 3px below the screen edge. Rendered at 1.0
 * they came out 50px tall sitting at 10, which left a band of empty bar
 * under them that the real one doesn't have. Measured off the frame, not
 * chosen.
 */
const CHIP_SCALE = 1.4;
/**
 * Horizontal focus, in scene coordinates, at the moment of the HIT.
 *
 * Nowhere near frame centre: the rail is a row of real chips of wildly
 * different widths, so centring the ROW puts the hero well off centre.
 * It also accounts for CHIP_SCALE and for how far the rail has drifted
 * by T.hit — the hero is centred on the frame the score changes, and
 * drifts through centre either side of it.
 *
 * Measured from a tight render. Re-derive it whenever the rail's
 * composition, CHIP_SCALE or the drift speed changes — inserting the Bad
 * Beats chip alone moved it 290px, because the row is centre-justified
 * so widening it shifts everything left by half the addition.
 */
const FOCUS_X = 459;

const UI =
  '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif';

/**
 * The app's accent, NOT --color-up. Green-up is the "your score rose"
 * token; spending it on the brand burns the one signal the chip uses.
 */
const ACCENT = "#34d399";

const CHIP_GAP = 8;

/**
 * Every word the film says, and when. Hard cuts — no fades.
 *
 * The stake used to be asserted in type ("Losing by 1.8" / "Ahead by
 * 0.1"). It isn't any more: two real chips changing colour in opposite
 * directions, with signed deltas over them, say it better than a label
 * can, and they say it using the product.
 */
const CAPTIONS: readonly { from: number; to: number; text: string }[] = [
  { from: 0.3, to: 1.7, text: "This bar sits there all day." },
  { from: 2.1, to: 3.1, text: "One player. Two of your leagues." },
  { from: 3.6, to: 4.5, text: "He's on the other guy's team." },
];

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
  const pushIn = interpolate(frame, [f(T.linger), f(T.tight)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.1, 1),
  });
  const pullOut = interpolate(frame, [f(T.rail), f(T.wide)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.3, 0, 0.15, 1),
  });
  /*
    Between the push and the pull there is now a THIRD move: a fast ease
    back to TWO_CHIP the instant the score lands, so the viewer sees the
    other league turn red in the same shot rather than being told about
    it later. Cause and consequence in one frame is the entire idea.
  */
  const reveal = interpolate(frame, [f(T.hit), f(T.reveal)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const tightness = pushIn * (1 - reveal * (1 - TWO_CHIP)) * (1 - pullOut);

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
   * The rail drifts from frame ZERO and never stops — including while
   * the camera is tight on one chip, which is the whole point: a ticker
   * that only moves when you are looking at the whole bar is a slideshow.
   * It also means something is moving in frame 1 without the camera
   * having to, which is what lets the opening hold.
   *
   * 30px/s is the app's own default speed, and it is also the fastest
   * this can go without the rail running out: the row is ~3400px against
   * a 2560 frame, so a faster drift opens a gap at the trailing edge.
   */
  const scrollPx = (frame / fps) * 30;

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
  /*
    A FIXED tight focus, not one that tracks the drift.
    
    Tracking was tried and it reverses direction: the compensation has to
    unwind as the camera pulls back out, so the rail visibly changed
    course mid-shot. A fixed focus keeps everything travelling one way
    for the whole film — the hero simply drifts through frame centre,
    arriving there on the frame the score changes.
  */
  /*
    THREE framings, not two. A single focus point cannot centre one chip
    at full zoom and centre the PAIR at the reveal — they are different
    subjects. Keyed on tightness rather than time, so it stays correct
    whichever direction the camera happens to be travelling.
      0          the whole screenshot
      TWO_CHIP   both chips, the hero and its mirror
      1          the hero chip alone
  */
  const camX = interpolate(
    tightness,
    [0, TWO_CHIP, 1],
    [0, 20, 1280 - FOCUS_X * MAX_ZOOM],
  );
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
  // Both leagues read the SAME player's points. One of them is glad.
  const achanePoints = landed ? ACHANE_AFTER : ACHANE_BEFORE;
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
  // Cuts in two frames after the hit, holds, then leaves before the
  // camera does.
  const deltaShow = landed
    ? interpolate(
        sinceHit,
        [2, 6, f(1.15), f(1.35)],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 0;

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



  /*
    The back half. After the pull-back the film used to hold one wide
    shot for two and a half seconds, which showed the bar and nothing
    else the product does. These dissolve the desk between three views
    pulled from the same recording — Overview, Matchup, Roster — so the
    app demonstrates itself while the bar carries on above it.
  */
  const showA = interpolate(frame, [f(T.showA), f(T.showA + 0.45)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const showB = interpolate(frame, [f(T.showB), f(T.showB + 0.45)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

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
        }}
      >
        {/*
          The dim is on the DESK, not on the camera wrapper, so the bar
          above keeps its own brightness through the endcard. Every
          product film in this category fades to a wordmark on a dead
          screen; this one leaves the rail running, which is the only
          moment in the film where the always-on claim is demonstrated
          rather than asserted.
        */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            filter: `${deskFilter} brightness(${worldDim.toFixed(3)})`,
          }}
        >
          <Desktop />
          <div style={{ position: "absolute", inset: 0, opacity: showA }}>
            <Desktop file="view-matchup.png" />
          </div>
          <div style={{ position: "absolute", inset: 0, opacity: showB }}>
            <Desktop file="view-roster.png" />
          </div>
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
              // translate THEN scale: CSS applies right-to-left, so the
              // drift stays in scene pixels regardless of CHIP_SCALE.
              transform: `translateX(${-scrollPx}px) scale(${CHIP_SCALE})`,
            }}
          >
            {/* Doubled either side so the row is wider than the frame plus
                the drift, and chips clip at both edges instead of the whole
                rail sliding as one object. Equal counts keep FOCUS_X true. */}
            {[...RAIL_LEFT, ...RAIL_RIGHT_TAIL].map((l, i) => (
              <Chip key={`l${i}`} league={l} />
            ))}

            {/*
              THE PAIR. These two chips sit side by side because they are
              the film's whole argument: the same player's points land in
              both, and they disagree about it. FantasyStatChip derives
              its own tone from myPts vs oppPts, so the green and the red
              are the shipped component's, not a graphic laid over it.
            */}
            <div
              style={{
                position: "relative",
                zIndex: 2,
                transform: `scale(${hitScale.toFixed(4)})`,
                filter:
                  glow > 0
                    ? `drop-shadow(0 ${(10 * glow).toFixed(1)}px ${(26 * glow).toFixed(0)}px rgba(16,185,129,${(0.55 * glow).toFixed(3)}))`
                    : undefined,
              }}
            >
              <Chip league={sundayMoney(userPoints)} />
              {ringOn && <FlashRing progress={glow} tone={ACCENT} />}
              <Delta value="+1.9" tone={ACCENT} show={deltaShow} />
            </div>

            <div
              style={{
                position: "relative",
                zIndex: 2,
                transform: `scale(${hitScale.toFixed(4)})`,
                filter:
                  glow > 0
                    ? `drop-shadow(0 ${(10 * glow).toFixed(1)}px ${(26 * glow).toFixed(0)}px rgba(239,68,68,${(0.5 * glow).toFixed(3)}))`
                    : undefined,
              }}
            >
              <Chip league={badBeats(achanePoints)} />
              {ringOn && <FlashRing progress={glow} tone="#ef4444" />}
              <Delta value="−1.9" tone="#ef4444" show={deltaShow} />
            </div>

            {RAIL_PLAYERS.map((key) => (
              <PlayerChip key={key} playerKey={key} points={userPoints} />
            ))}
            {[...RAIL_LEFT, ...RAIL_RIGHT_TAIL].map((l, i) => (
              <Chip key={`r${i}`} league={l} />
            ))}
          </div>
        </div>

        {/* End masks, so the rail runs off frame rather than stopping. */}
        <Mask side="left" />
        <Mask side="right" />
      </div>

      {/*
        CAPTIONS, not supers.

        The old line was 68px, weight 700, uppercase, 0.06em tracked,
        centred, and cross-faded. That exact combination is what reads as
        "advert" at half a second, before a single word is parsed — it is
        the SHAPE, not the sentence. These are left-aligned to the same
        96px margin as the disclosure, sentence case, and they hard-cut
        in and out on a single frame. Same information, caption grammar.

        Outside the camera transform on purpose: the desk racks to a 15px
        blur during the push and the caption stays razor sharp through it.
      */}
      {CAPTIONS.map((c) =>
        frame >= f(c.from) && frame < f(c.to) ? (
          <div
            key={c.text}
            style={{
              position: "absolute",
              left: 96,
              bottom: 196,
              maxWidth: 1560,
              fontFamily: UI,
              fontSize: 84,
              fontWeight: 700,
              letterSpacing: "-0.028em",
              lineHeight: 1.12,
              color: "#ffffff",
              textShadow: "0 4px 44px rgba(0,0,0,0.9), 0 2px 10px rgba(0,0,0,0.75)",
              pointerEvents: "none",
            }}
          >
            {c.text}
          </div>
        ) : null,
      )}

      {/* Owned up front, not buried at the end. Hiding it reads as legal
          cover; stating it reads as confidence — and r/fantasyfootball is
          exactly the audience that checks. */}
      <div
        style={{
          position: "absolute",
          // BOTTOM-left: the bar occupies the top edge now, and the mark
          // was landing straight on the chips.
          bottom: 26,
          left: 96,
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

function PlayerChip({
  playerKey,
  points,
}: {
  playerKey: string;
  points: number;
}) {
  return (
    <div id="app-shell" data-theme="scrollr-light" style={{ display: "flex" }}>
      <FollowedPlayerChip
        playerKey={playerKey}
        leagues={[sundayMoney(points)]}
        comfort
      />
    </div>
  );
}

/**
 * The signed delta, in the chip's own colour.
 *
 * Sign AND colour, not colour alone: at quarter feed scale a red word
 * becoming a green word is a handful of pixels changing hue, and it is
 * nothing at all to a colour-blind viewer. A leading + or − carries
 * direction, magnitude and outcome in one glyph.
 */
function Delta({
  value,
  tone,
  show,
}: {
  value: string;
  tone: string;
  show: number;
}) {
  if (show <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        // BELOW the chips. The bar lives at the top of the screen, so a
        // delta above it renders off-frame entirely.
        top: "calc(100% + 30px)",
        textAlign: "center",
        fontFamily: UI,
        fontSize: 96,
        fontWeight: 800,
        letterSpacing: "-0.03em",
        fontVariantNumeric: "tabular-nums",
        color: tone,
        opacity: show,
        textShadow: "0 4px 30px rgba(0,0,0,0.85)",
        pointerEvents: "none",
      }}
    >
      {value}
    </div>
  );
}

function FlashRing({ progress, tone }: { progress: number; tone: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: -3,
        border: `1px solid ${tone}`,
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
          // Starts BELOW the bar, so the rail stays lit and drifting.
          top: 96,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            "radial-gradient(1500px 900px at 50% 42%, rgba(5,7,12,0.94) 0%, rgba(5,7,12,0.82) 45%, rgba(5,7,12,0) 78%)",
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
        You&apos;ll know before the group chat.
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
        Live fantasy ticker · Unlimited leagues · Windows &amp; macOS · Free
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
