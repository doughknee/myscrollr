/**
 * Scrollr — Hero Loop. 10.000s, 600 frames, seamless, muted.
 *
 * Runs above the fold with no controls and no sound, repeating forever.
 * Its only job is to stop the scroll and land three ideas: there's a bar
 * on my desktop, it's showing my real leagues, it moves by itself.
 *
 * TWO RULES HOLD THE WHOLE THING UP.
 *
 * The rail never stops. It is the only continuous object in the film —
 * every beat is a camera move AROUND it, never a scene change past it.
 * That single decision is what keeps this from reading as a slideshow.
 *
 * It never cuts to black. The desk dims and blurs but stays visible
 * through the entire push, so the viewer never loses track of the fact
 * that they are looking at a screen. Earlier cuts faded the desk out
 * completely and the film stopped being about a desktop app.
 *
 * The CHIPS are the real shipped components rendered over a still from
 * the founder's own screen recording. The rail's motion is the only
 * fabricated thing, and it is driven frame-accurately from src/rail.ts.
 */
import {
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import FantasyStatChip from "../../../desktop/src/components/chips/FantasyStatChip";
import FollowedPlayerChip from "../../../desktop/src/components/chips/FollowedPlayerChip";
import { DEFAULT_WIDGET_DISPLAY } from "../../../desktop/src/preferences";
import type { LeagueResponse } from "../../../desktop/src/datawidgets/fantasy/types";
import {
  RAIL_PLAYERS,
  RAIL_RIGHT_TAIL,
  WORK_AFTER,
  WORK_BEFORE,
  workLeague,
} from "../data/dashboard";
import {
  CLOSING_SCORE,
  OPENING_SCORE,
  OPPONENT_SCORE,
  sundayMoney,
} from "../data/sundayMoney";
import { useMotionClock } from "../motionClock";
import { railProgress } from "../rail";
import { Desktop, REAL_TICKER_BOTTOM } from "../scene/Desktop";

/** Beat boundaries, in frames. The spec's shot list, verbatim. */
const B = {
  push: 42,
  pushDim: 54,
  tight: 114,
  typeIn: 126,
  hit: 174,
  flashOut: 176,
  pullBack: 248,
  dimLift: 264,
  wide: 318,
  everyLeague: 392,
  tick: 410,
  endcard: 480,
  seam: 588,
};

/**
 * 3.1x, NOT the spec's 6.2.
 *
 * A comfort chip is ~780 scene px wide once CHIP_SCALE is applied. At
 * 6.2 that renders 4,836px into a 2,560 frame, so roughly half the chip
 * is off-screen — and the half that goes is the right half, which is
 * where the score lives. The beat's entire subject was outside the frame.
 * 3.1 is the largest zoom that still holds the whole chip, and it puts
 * the 13px body type at ~56px, ~14px at quarter scale.
 */
const MAX_ZOOM = 3.1;

const BAR_Y = 38;

/**
 * The recording was made with the app at 130% display size, so its ticker
 * chips are ~70px tall sitting 3px below the screen edge. Rendered at 1.0
 * they came out 50px tall at y=10, leaving a band of empty bar the real
 * one doesn't have. Measured off the frame, not chosen.
 */
const CHIP_SCALE = 1.4;

/**
 * Tile width in PRE-scale units. The strip is rendered twice and the
 * curve advances it by exactly one tile across 600 frames, so frame 600
 * is pixel-identical to frame 0 with no seam maths at all.
 *
 * Fixed by construction rather than measured: the row is `space-between`
 * inside a fixed width, so the chips keep their natural sizes and the
 * GAPS absorb the slack.
 *
 * WHY NOT THE SPEC'S "one frame width, ~300px per chip". A real comfort
 * chip is ~560px before CHIP_SCALE and ~780 after — nearly triple the
 * spec's assumption — so eight of them is a ~6,200px tile, not 2,560.
 * Four chips at 2,100 pre-scale is 2,940 scene px, giving ~294px/s
 * rather than the spec's 240-260. Hitting that band exactly would mean
 * three chips and a visibly sparse bar; this is the closest the real
 * component sizes allow.
 */
const TILE_WIDTH = 2100;

/**
 * Where the hero chip sits inside the tile, in scene px.
 *
 * Measured from a render, and it has to be: the tile is real product
 * chips of wildly different widths laid out by flexbox, so there is no
 * expression for this. Re-derive it whenever the tile's composition
 * changes — the camera focuses here, and nothing will tell you it's wrong
 * except the shot being off-centre.
 *
 * It also constrains the tile ORDER. The hero has to sit late enough that
 * after drifting through the push it is still over the middle of the
 * desk; with it second, the camera followed it past the screenshot's left
 * edge and half the frame went black.
 */
const HERO_X = 1230;

const UI = '"Barlow Condensed", ui-sans-serif, system-ui, sans-serif';

/** Tokens. */
const LOSS = "#FF3B5C";
const WIN = "#3EE0A4";
const FLASH = "rgba(140, 255, 208, 0.35)";

/**
 * Win probability is off in the film, and that is a correctness fix
 * rather than a taste one. At 149.9 vs 151.7 the chip computes a GREEN
 * 65% — so the frame would say "Losing by 1.8" in red while the product
 * underneath it said you were winning.
 */
const PROMO_PREFS = {
  ...DEFAULT_WIDGET_DISPLAY.fantasy,
  winProbability: "off" as const,
};

export function Beat1Hook() {
  useMotionClock();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const p = railProgress(frame);
  const railX = -p * TILE_WIDTH;

  // ── Camera ───────────────────────────────────────────────────────
  // Decelerates hard, so it settles rather than arrives.
  const EASE = Easing.bezier(0.33, 0, 0.15, 1);
  const zoomT =
    frame < B.pullBack
      ? interpolate(frame, [B.push, B.tight], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE,
        })
      : interpolate(frame, [B.pullBack, B.wide], [1, 0], {
          extrapolateRight: "clamp",
          easing: EASE,
        });
  const zoom = interpolate(zoomT, [0, 1], [1, MAX_ZOOM]);

  /*
    The camera tracks the hero chip's CURRENT position, not a fixed point,
    because the rail is still drifting underneath it. The drift curve is
    near-flat through the tight beats precisely so this tracking has
    almost nothing to do there — a camera chasing a fast subject at 6.2x
    is unwatchable.
  */
  /*
    CHIP_SCALE matters here. The rail's transform is `scale() translateX()`
    and CSS applies right-to-left, so the drift happens in PRE-scale units
    and everything the camera reasons about has to be multiplied up. It is
    self-consistent for the loop either way, but the camera aims in scene
    px and silently missed the chip by ~1,600px before this.
  */
  const heroSceneX = CHIP_SCALE * (HERO_X + railX);
  const camX = interpolate(zoomT, [0, 1], [0, 1280 - heroSceneX * MAX_ZOOM]);
  /*
    The bar has to stay HUGGING the frame top, not sit a third of the way
    down. It lives at the screen's top edge, so there is no desk above it
    to show — aiming it lower just exposes the composition's own black
    background. 110 is the largest target that keeps camY negative.
  */
  const camY = interpolate(zoomT, [0, 1], [0, 110 - BAR_Y * MAX_ZOOM]);

  // ── Desk treatment ───────────────────────────────────────────────
  // Starts twelve frames AFTER the camera and lifts six frames after it
  // stops, so the two moves read as separate events.
  const pushDim =
    frame < B.pullBack
      ? interpolate(frame, [B.pushDim, B.tight], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        })
      : interpolate(frame, [B.dimLift, B.wide], [1, 0], {
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });

  const endT = interpolate(frame, [B.endcard, B.endcard + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  /*
    The loop seam. Frame 599 is an endcard over an 8%-dim desk and frame 0
    is a full-brightness desk, so without this the repeat is a hard flash.
    Everything ramps back across the last twelve frames — including the
    endcard TYPE, which the spec's checklist omits but which is far more
    visible than the desk state it does list.
  */
  // Ends on the LAST RENDERED frame, not on durationInFrames. Frame 600
  // never exists, so ramping to it left ~8% of the endcard still up on
  // 599 and the loop popped it off.
  const seam = interpolate(frame, [B.seam, durationInFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const endMix = endT * (1 - seam);

  const blur = 14 * pushDim + 22 * endMix;
  const brightness = (1 - 0.55 * pushDim) * (1 - 0.92 * endMix);

  // ── The hit ──────────────────────────────────────────────────────
  const landed = frame >= B.hit;
  const userPoints = landed ? CLOSING_SCORE : OPENING_SCORE;
  // Derived, never typed. This was once the literal string "Losing by
  // 0.1" and silently became false when the opening score changed.
  const margin = Math.abs(Math.round((userPoints - OPPONENT_SCORE) * 10) / 10);

  // Gated on `landed`, not just clamped. extrapolateLeft holds the value
  // at 1 BEFORE the range, so a bare interpolate left the chip tinted
  // green from frame 0 — the flash was on for the whole film except the
  // two frames it was meant to be.
  const flash = landed
    ? interpolate(frame, [B.hit, B.flashOut], [1, 0], {
        extrapolateRight: "clamp",
      })
    : 0;
  const heroLift = landed
    ? interpolate(frame, [B.hit, B.hit + 8], [1.04, 1], {
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      })
    : 1;

  // Beat 08: a DIFFERENT chip moves, camera locked. The only shot that
  // proves the bar is live rather than a decorated screenshot.
  const ticked = frame >= B.tick;
  const tickFlash = ticked
    ? interpolate(frame, [B.tick, B.tick + 10], [1, 0], {
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.quad),
      })
    : 0;

  const stake = band(frame, B.typeIn - 8, B.pullBack + 10);
  const everyLeague = band(frame, B.wide, B.everyLeague);

  const tile = (
    <Tile
      userPoints={userPoints}
      workPoints={ticked ? WORK_AFTER : WORK_BEFORE}
      heroLift={heroLift}
      heroFlash={flash}
      workFlash={tickFlash}
    />
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#05070a",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 2560,
          height: 1440,
          transformOrigin: "0 0",
          transform: `translate(${camX.toFixed(1)}px, ${camY.toFixed(1)}px) scale(${zoom.toFixed(4)})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            filter: `blur(${blur.toFixed(2)}px) brightness(${brightness.toFixed(3)})`,
          }}
        >
          <Desktop />
        </div>

        {/* The bar. Opaque, because the screenshot has its own frozen
            ticker in exactly this strip and any translucency lets it show
            through the driven one. It does NOT dim with the desk. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: REAL_TICKER_BOTTOM,
            background: "#f7f7fb",
            borderBottom: "1px solid rgba(16,20,40,0.10)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: BAR_Y,
              left: 0,
              display: "flex",
              width: "max-content",
              transform: `translateY(-50%) scale(${CHIP_SCALE}) translateX(${railX.toFixed(2)}px)`,
              transformOrigin: "left center",
            }}
          >
            {/* Rendered TWICE. The curve advances exactly one tile across
                the composition, so the second copy lands precisely where
                the first began and the loop needs no seam correction. */}
            {tile}
            {tile}
          </div>
        </div>
      </div>

      <Stake show={stake} landed={landed} margin={margin} />
      <Super show={everyLeague} text="Every league. One bar." />
      {endMix > 0 && <Endcard progress={endMix} frame={frame} />}

      {/* Owned up front, not buried in the endcard. */}
      <div
        style={{
          position: "absolute",
          bottom: 26,
          left: 40,
          padding: "7px 16px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.30)",
          fontFamily: UI,
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "0.01em",
          color: "rgba(255,255,255,0.60)",
        }}
      >
        Sample data — not a live game
      </div>
    </div>
  );
}

/** Fade up, hold, fade out. Ramps are 8 frames, paired with a 6px rise. */
function band(frame: number, start: number, end: number): number {
  return interpolate(frame, [start, start + 8, end - 8, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function Tile({
  userPoints,
  workPoints,
  heroLift,
  heroFlash,
  workFlash,
}: {
  userPoints: number;
  workPoints: number;
  heroLift: number;
  heroFlash: number;
  workFlash: number;
}) {
  return (
    <div
      style={{
        // Fixed width with space-between: the chips keep their real sizes
        // and the GAPS take the slack, which is what makes TILE_WIDTH
        // exact without measuring anything.
        width: TILE_WIDTH,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}
    >
      {RAIL_RIGHT_TAIL.map((l) => (
        <Chip key={l.league_key} league={l} />
      ))}
      <PlayerChip playerKey={RAIL_PLAYERS[2]} points={userPoints} />
      <Chip league={sundayMoney(userPoints)} lift={heroLift} flash={heroFlash} />
      <Chip league={workLeague(workPoints)} flash={workFlash} />
    </div>
  );
}

function Chip({
  league,
  lift = 1,
  flash = 0,
}: {
  league: LeagueResponse;
  lift?: number;
  flash?: number;
}) {
  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        transform: lift === 1 ? undefined : `scale(${lift.toFixed(4)})`,
        filter: lift === 1 ? undefined : "drop-shadow(0 6px 18px rgba(0,0,0,0.35))",
      }}
    >
      {/* Light theme, because that is the theme the recording was made
          in. Dark chips on a light desktop read as a different product. */}
      <div id="app-shell" data-theme="scrollr-light" style={{ display: "flex" }}>
        <FantasyStatChip league={league} prefs={PROMO_PREFS} comfort />
      </div>
      {flash > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 8,
            background: FLASH,
            opacity: flash,
            pointerEvents: "none",
          }}
        />
      )}
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
    <div
      id="app-shell"
      data-theme="scrollr-light"
      style={{ display: "flex", flexShrink: 0 }}
    >
      <FollowedPlayerChip
        playerKey={playerKey}
        leagues={[sundayMoney(points)]}
        comfort
      />
    </div>
  );
}

/**
 * The stake. One line, and no tagline above it.
 *
 * There used to be a grey "A live ticker for your fantasy leagues" here.
 * It came out: the chip's own vernacular does the credibility work, and
 * any product-voice line in this position competes with the strongest
 * copy in the film for the same half second.
 */
function Stake({
  show,
  landed,
  margin,
}: {
  show: number;
  landed: boolean;
  margin: number;
}) {
  if (show <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        paddingBottom: 300,
        opacity: show,
        transform: `translateY(${(6 * (1 - show)).toFixed(1)}px)`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: UI,
          fontSize: 132,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: landed ? WIN : LOSS,
          textShadow: "0 4px 44px rgba(0,0,0,0.85)",
        }}
      >
        {landed ? "Ahead by " : "Losing by "}
        {margin.toFixed(1)}
      </div>
    </div>
  );
}

function Super({ show, text }: { show: number; text: string }) {
  if (show <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        paddingBottom: 260,
        opacity: show,
        transform: `translateY(${(6 * (1 - show)).toFixed(1)}px)`,
        pointerEvents: "none",
        fontFamily: UI,
        fontSize: 84,
        fontWeight: 600,
        letterSpacing: "-0.015em",
        color: "#ffffff",
        textShadow: "0 4px 44px rgba(0,0,0,0.85)",
      }}
    >
      {text}
    </div>
  );
}

/**
 * The endcard. Staggered five frames apart so it assembles rather than
 * appearing, over a desk at 8% with the rail still lit and drifting above
 * it — the one moment the always-on claim is demonstrated rather than
 * asserted.
 */
function Endcard({ progress, frame }: { progress: number; frame: number }) {
  const at = (i: number) =>
    interpolate(frame, [B.endcard + i * 5, B.endcard + i * 5 + 8], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) * progress;
  const rise = (v: number) => `translateY(${(6 * (1 - v)).toFixed(1)}px)`;

  const rows = [
    { size: 168, weight: 700, color: "#ffffff", text: "Scrollr", gap: 22 },
    {
      size: 64,
      weight: 500,
      color: "rgba(255,255,255,0.86)",
      text: "The moment it happens, you already know.",
      gap: 16,
    },
    {
      size: 40,
      weight: 500,
      color: "rgba(255,255,255,0.52)",
      // Qualification, not clutter. Scrollr is Yahoo-only today, and an
      // ESPN player who installs and finds nothing costs more than one
      // who never clicked.
      text: "Yahoo leagues · Windows & macOS · Free",
      gap: 30,
    },
  ];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: UI,
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      {rows.map((r, i) => (
        <div
          key={r.text}
          style={{
            marginBottom: r.gap,
            fontSize: r.size,
            fontWeight: r.weight,
            letterSpacing: r.size > 100 ? "-0.03em" : "-0.01em",
            color: r.color,
            opacity: at(i),
            transform: rise(at(i)),
          }}
        >
          {r.text}
        </div>
      ))}
      <div
        style={{
          padding: "16px 40px",
          borderRadius: 999,
          background: "rgba(62,224,164,0.12)",
          border: "1px solid rgba(62,224,164,0.45)",
          fontSize: 52,
          fontWeight: 600,
          color: WIN,
          opacity: at(3),
          transform: rise(at(3)),
        }}
      >
        myscrollr.com
      </div>
    </div>
  );
}
