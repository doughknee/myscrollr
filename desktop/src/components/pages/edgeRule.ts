/**
 * The edge's one width rule (SCROLLR-284). No React, no DOM.
 *
 * The fixed edge (utilities, then pins) never takes more than 40% of the bar.
 * That one rule replaces the old count cap: it is measured on the NARROWEST
 * ticker window, so a pin that fits there fits everywhere.
 *
 *  - PIN-TIME: a pin that would push the edge past the budget is refused
 *    (`pinRefusal`), with one line naming what fills it. `fitsEdge` is the
 *    one test both the refusal and `togglePin` use.
 *  - RESIZE-TIME: when a screen shrinks and the pins no longer fit, the NEWEST
 *    pins step back onto their pages (`stepBack`). They stay in prefs and
 *    return when there is room again.
 *
 * A pin's width is its family's edge column, fixed for its life: games take
 * `gameMinCol`, quotes `QUOTE_MIN_COL`, a headline the narrow one-line
 * `NEWS_PIN_W`. A pinned utility is already on the edge and adds nothing.
 */
import type { WidgetPin } from "../../preferences";
import { MAX_PINS } from "../../preferences";
import { catalogItemById, sourceForWidget } from "../../marketplace";
import { teamShortName } from "../../utils/teamShortName";
import { gameMinCol } from "./cells/GameCell";
import { ELECTION_MIN_COL } from "./cells/ElectionCell";
import { NEWS_PIN_W } from "./cells/NewsCell";
import { QUOTE_MIN_COL } from "./cells/QuoteCell";
import { BAND_W, DISPLAY_HEADER_H } from "./pagePlan";
import { FILL_CONTROLS_W } from "../../lib/tickerDisplay";

/** Compact Fill utility slots still hold the clock's full reserved value. */
export const GRID_UTILITY_W = 140;

/** The most of the bar the edge may take. */
export const EDGE_SHARE = 0.4;
/** The edge's own left border. */
export const EDGE_BORDER = 1;

/** What the ticker windows report: the narrowest bar, and the utilities' strip on it. */
export interface EdgeRoom {
  /** Narrowest bar width across every ticker window, in CSS px. */
  bar: number;
  /** Widest utilities strip (clocks, weather, ...; the pins are not in it), in CSS px. */
  util: number;
  /** Fill grid budgets its header directly; docked/strip retain the 40% rule. */
  budget?: number;
  region?: "header";
  activeTabs?: readonly string[];
}

/** Pins with an edge-cell renderer; eligibility does not depend on live data. */
export function eligibleEdgePins(pins: readonly WidgetPin[], activeTabs: readonly string[]) {
  return pins.filter(p => activeTabs.includes(p.widget) &&
    ["sports", "finance", "rss", "elections"].includes(sourceForWidget(p.widget) ?? ""));
}

/** Fixed-height header: reserve utilities first, then reclaim spare pin width for them. */
export function gridHeaderPlan(width: number, utilityCount: number, activeTabs: readonly string[] = [], pins: readonly WidgetPin[] = []) {
  const scale = DISPLAY_HEADER_H / 64;
  const available = Math.max(0, width / scale - BAND_W - FILL_CONTROLS_W);
  const slots = Math.min(utilityCount, Math.max(1, Math.floor(available / 3 / GRID_UTILITY_W)));
  const room: EdgeRoom = { bar: width, util: 0, budget: Math.max(0, available - slots * GRID_UTILITY_W - (slots ? EDGE_BORDER : 0)), region: "header", activeTabs };
  // Admission keeps the minimum utility reservation. Once pins are placed,
  // utilities reclaim unusable pin space without making the next pin harder to add.
  const placed = stepBack(eligibleEdgePins(pins, activeTabs), room);
  const spare = Math.max(0, available - (placed.length ? used(placed, room) : 0) - (slots ? EDGE_BORDER : 0));
  const utilitiesWidth = utilityCount === 0 ? 0 : placed.length === 0
    ? spare : Math.min(utilityCount, Math.max(slots, Math.floor(spare / GRID_UTILITY_W))) * GRID_UTILITY_W;
  return { scale, utilitiesWidth, room };
}

export function edgeBudget(bar: number): number {
  return Math.floor(bar * EDGE_SHARE);
}

const leagueOf = (widget: string) => (widget.split("_")[1] ?? "").toUpperCase();

/** The edge column a pin of this widget takes. */
export function pinWidth(widget: string): number {
  const source = sourceForWidget(widget);
  if (source === "sports") return gameMinCol(leagueOf(widget));
  if (source === "finance") return QUOTE_MIN_COL;
  if (source === "rss") return NEWS_PIN_W;
  if (source === "elections") return ELECTION_MIN_COL;
  return 0;
}

const used = (pins: readonly WidgetPin[], room: EdgeRoom) =>
  EDGE_BORDER + room.util + (room.activeTabs ? eligibleEdgePins(pins, room.activeTabs) : pins).reduce((w, p) => w + pinWidth(p.widget), 0);

export function fitsEdge(pins: readonly WidgetPin[], room: EdgeRoom): boolean {
  return used(pins, room) <= (room.budget ?? edgeBudget(room.bar));
}

/** The oldest pins that fit: the rest step back onto their pages. */
export function stepBack(pins: readonly WidgetPin[], room: EdgeRoom): WidgetPin[] {
  let n = pins.length;
  while (n > 0 && !fitsEdge(pins.slice(0, n), room)) n--;
  return pins.slice(0, n);
}

/** What `togglePin` asks: the pins after the change, may they all stay? Undefined = no width known, the count cap stands. */
export function edgeCanHold(room: EdgeRoom | null): ((pins: readonly WidgetPin[]) => boolean) | undefined {
  return room ? (pins) => fitsEdge(pins, room) : undefined;
}

function labelOf(p: WidgetPin): string {
  const source = sourceForWidget(p.widget);
  if (source === "sports") return teamShortName(leagueOf(p.widget), p.subject);
  if (source === "finance") return p.subject;
  return catalogItemById(p.widget)?.name ?? p.subject;
}

/**
 * Why `add` cannot be pinned now, in one line, or null when it can.
 * `pins` is what is pinned already; an unpin is never refused.
 */
export function pinRefusal(
  pins: readonly WidgetPin[],
  add: { widget: string; subject: string; label: string },
  room: EdgeRoom | null,
): string | null {
  if (pins.some((p) => p.widget === add.widget && p.subject === add.subject)) return null;
  // No ticker is reporting a width (the continuous ticker, or none running):
  // the old count cap stands.
  if (!room) {
    return pins.length >= MAX_PINS ? `The ticker already holds ${MAX_PINS} pins — unpin one to pin ${add.label}` : null;
  }
  const next = [...pins, { widget: add.widget, subject: add.subject, side: "right" as const }];
  if (fitsEdge(next, room)) return null;
  if (room.region === "header") {
    const fix = [...pins].reverse().find((p) => fitsEdge(next.filter((n) => n !== p), room));
    if (fix) return `Header pin area is full — unpin ${labelOf(fix)} first`;
    if (!fitsEdge([next[next.length - 1]], room)) return `Not enough header space for ${add.label} at this reading size`;
    return "Header pin area is full — unpin some items first";
  }
  const tail = "No room on the edge at this screen size";
  // Name the newest pin whose removal makes room; else the newest; else the clocks.
  const fix = [...pins].reverse().find((p) => fitsEdge(next.filter((n) => n !== p), room)) ?? pins[pins.length - 1];
  return fix ? `${tail} — unpin ${labelOf(fix)} first` : `${tail} — its clocks and weather fill it`;
}
