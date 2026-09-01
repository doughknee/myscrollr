/**
 * Score choreography — how a number changing becomes a moment.
 *
 * WHY THIS REPLACED A SMOOTH COUNT-UP. Fantasy points do not ramp. A
 * catch is +1.4 and a touchdown is +6.6, both delivered whole, and the
 * gap between them is the part that hurts. Gliding a score from 149.9
 * to 157.9 over a second reads as a dashboard refreshing; landing it in
 * two discrete hits reads as two things happening on a field. The
 * second is what the video is selling.
 *
 * THE SHAPE OF ONE HIT, which is where the excitement actually lives:
 *
 *   anticipation  the chip eases DOWN slightly before the number moves.
 *                 Eight frames of dip is invisible if you look for it
 *                 and unmistakable if you don't — it is the flinch
 *                 before a punch, and without it the impact reads as a
 *                 glitch rather than a blow.
 *   impact        five frames up, overshooting. The number counts in
 *                 that window, fast enough to feel struck, slow enough
 *                 that the eye catches the digits moving.
 *   settle        thirty frames back to rest, decelerating.
 *
 * Everything here is a pure function of the frame. Nothing holds state
 * between renders, because Remotion may render frame 200 before frame 3
 * and any accumulator would be wrong in both.
 */
import { Easing, interpolate } from "remotion";

export type ScoreEventKind = "catch" | "fg" | "td" | "big";

export type ScoreEvent = {
  /** Frame the play lands on. */
  at: number;
  /** Points it adds. Negative works — fumbles happen. */
  points: number;
  /**
   * Flavour. Drives how hard the chip reacts and what a ScorePop
   * labels itself; it never changes the arithmetic.
   */
  kind?: ScoreEventKind;
};

/** Frames. Tuned as a set — changing one alone breaks the feel. */
const ANTICIPATION = 8;
const IMPACT = 5;
const SETTLE = 30;
/** How long the number takes to travel to its new value. */
const COUNT = 16;

/** How hard each kind hits, as a multiplier on the impact envelope. */
const WEIGHT: Record<ScoreEventKind, number> = {
  catch: 0.55,
  fg: 0.75,
  td: 1,
  big: 1.15,
};

/**
 * The score at a given frame: the base plus every play that has landed,
 * with the most recent one still counting in.
 *
 * A sharper ease-out than the gentle cubic used elsewhere — `poly(4)`
 * rather than `quart`, which Remotion's Easing does not expose by name.
 * The number should arrive almost immediately and then creep the last
 * tenth, which is what makes a total feel like it is settling rather
 * than sliding.
 */
export function scoreAt(
  frame: number,
  base: number,
  events: readonly ScoreEvent[],
): number {
  let value = base;
  for (const e of sorted(events)) {
    if (frame >= e.at + COUNT) {
      value += e.points;
    } else if (frame > e.at) {
      value += interpolate(frame, [e.at, e.at + COUNT], [0, e.points], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.poly(4)),
      });
    }
  }
  return value;
}

/**
 * The reaction envelope, roughly -0.3 to 1.
 *
 * Negative during anticipation, peaking on impact, decaying to zero.
 * Callers map it onto whatever they want to move — scale, glow, a
 * flash — so the whole chip reacts on one clock instead of three
 * separately-tuned ones drifting apart.
 *
 * Returns the STRONGEST live envelope rather than a sum, so two plays
 * close together read as two hits instead of one enormous one.
 */
export function impact(
  frame: number,
  events: readonly ScoreEvent[],
): number {
  let strongest = 0;
  for (const e of events) {
    const f = frame - e.at;
    if (f < -ANTICIPATION || f > SETTLE) continue;
    const weight = WEIGHT[e.kind ?? "td"];

    const v =
      f < 0
        ? // Anticipation: ease down into the hit.
          interpolate(f, [-ANTICIPATION, 0], [0, -0.3], {
            easing: Easing.in(Easing.quad),
          })
        : f <= IMPACT
          ? // Impact: from the bottom of the dip to the peak.
            interpolate(f, [0, IMPACT], [-0.3, 1], {
              easing: Easing.out(Easing.quad),
            })
          : // Settle: back to rest.
            interpolate(f, [IMPACT, SETTLE], [1, 0], {
              easing: Easing.out(Easing.cubic),
            });

    const scaled = v * weight;
    if (Math.abs(scaled) > Math.abs(strongest)) strongest = scaled;
  }
  return strongest;
}

/**
 * The frame the user's score crosses the opponent's, or null if it
 * never does.
 *
 * Found by scanning rather than solved, because the crossing can happen
 * mid-count inside an event and the easing makes that analytically
 * annoying for no benefit — a few hundred evaluations of a pure
 * function costs nothing and cannot disagree with what is rendered.
 *
 * This is the single most valuable frame in the whole video. Everything
 * before it is tension and everything after is relief, and a promo that
 * doesn't mark it is wasting the only real story it has.
 */
export function leadChangeFrame(
  base: number,
  events: readonly ScoreEvent[],
  opponent: number,
  duration: number,
): number | null {
  if (base > opponent) return null; // already ahead; there's no crossing
  for (let f = 0; f <= duration; f++) {
    if (scoreAt(f, base, events) > opponent) return f;
  }
  return null;
}

/**
 * A decaying flare from the lead change, 0..1.
 *
 * Longer and softer than the per-play impact: the play is a punch and
 * this is the aftermath. They overlap by design, so the crossing hit
 * lands harder than the hits either side of it without needing its own
 * special case anywhere else.
 */
export function leadFlare(frame: number, crossing: number | null): number {
  if (crossing === null || frame < crossing) return 0;
  return interpolate(frame, [crossing, crossing + 52], [1, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

/**
 * When everything has stopped moving.
 *
 * The comps promise a frozen tail so an editor can trim from the end at
 * any point. With a sequence of plays that promise can no longer be a
 * fixed frame 90 — it has to be derived, or a late play would silently
 * break the guarantee the README makes.
 */
export function settledAt(events: readonly ScoreEvent[]): number {
  const last = events.reduce((n, e) => Math.max(n, e.at), 0);
  return last + Math.max(SETTLE, COUNT) + 52; // + the lead flare's tail
}

function sorted(events: readonly ScoreEvent[]): ScoreEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

/** Label for a ScorePop driven by the same event list. */
export function kindLabel(kind: ScoreEventKind | undefined): string {
  switch (kind) {
    case "catch":
      return "RECEPTION";
    case "fg":
      return "FIELD GOAL";
    case "big":
      return "BIG PLAY";
    default:
      return "TOUCHDOWN";
  }
}
