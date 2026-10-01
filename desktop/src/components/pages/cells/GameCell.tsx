import { memo } from "react";
import { clsx } from "clsx";
import type { Game, TeamStanding } from "../../../types";
import { isLive, isFinal, isPre, isCloseGame } from "../../../utils/gameHelpers";
import { teamShortName } from "../../../utils/teamShortName";
import { reservationFor, recordText, ordinal } from "../../../utils/sportsChipLayout";
import { useScoreFlash } from "../../../hooks/useScoreFlash";
import { barTime } from "../../../datawidgets/ticker";
import { Crest } from "./parts";

/** A column at least this wide lays the game out as one scoreboard line. */
export const WIDE_GAME_PX = 430;
/**
 * The clock box: a FIXED width, 7ch of its 12px face plus the 9px the live
 * dot sits in. Its widest lines are "12:00P" and a same-day countdown
 * "in 9h59" (ten hours or more out says "TODAY"). Never a min-width that
 * includes padding: that grew with "12:00P" and moved every name left of it
 * (e2e/ticker/cells.spec.ts).
 */
export const STATUS_WIDTH = "calc(7ch + 9px)";
/** The same box between the scores of a wide cell: padded both sides, so the text centres. */
export const STATUS_WIDE = "calc(7ch + 18px)";

/**
 * The cell's three type sizes (SCROLLR-296: at most three, none under 12px):
 * the names, the scores, and everything else (the clock, the "@", records).
 */
const NAME_PX = { stacked: 14.5, wide: 15 };
/** What a Plus Jakarta Sans semibold name costs per character, generously (measured 0.47-0.66em). */
const NAME_EM = 0.62;

const US_PRO = new Set(["NFL", "MLB", "NBA", "NHL", "MLS", "WNBA"]);

/**
 * Narrowest column a game cell takes, for pagePlan's `columnsFor(…, minCol)`.
 * Measured in the gallery: at SCROLLR-296's type everything but the name
 * costs 146px (gutters of 16 and 12, the "@" hung in the left one; the
 * crest, an 18px score, the 12px clock), so 212 leaves a 14.5px nickname
 * 66px: "Patriots", "Cardinals", "Chargers" whole; "Seahawks",
 * "Commanders", "Buccaneers" lose a letter or two at the narrowest bars.
 * Leagues that show a city or college name get 244. Widening these costs a
 * column at 1920 and pushes the busiest lap past 60 s (pages.spec), so the
 * bigger type is paid for with tighter gutters instead.
 */
export function gameMinCol(league: string): number {
  return US_PRO.has(league) ? 212 : 244;
}
const TWO_WORD = new Set([
  "Red Sox", "White Sox", "Blue Jays", "Trail Blazers", "Maple Leafs", "Golden Knights", "Blue Jackets", "Red Wings",
]);

/**
 * The name a game cell has room for. A narrow US-pro cell shows the
 * nickname ("Jets", "Red Sox"); a roomy one, or any league where the city IS
 * the identity (soccer, college), shows the chip's short name.
 */
export function cellName(league: string, name: string, roomy: boolean): string {
  if (roomy || !US_PRO.has(league)) return teamShortName(league, name);
  const words = name.trim().split(/\s+/);
  const two = words.slice(-2).join(" ");
  return TWO_WORD.has(two) ? two : words[words.length - 1];
}

/**
 * The px a name has in a column of `width`: everything else in the layout
 * is fixed, so this is arithmetic, not a measurement (a measurement would
 * re-render the name after the page is up). `scoreCh` is the league's score
 * reservation.
 */
export function nameRoom(width: number, scoreCh: number): number {
  if (width >= WIDE_GAME_PX) {
    // gutters 28, four 12px gaps, the 68px clock, two 22px scores; then per
    // side the crest and its gap (and, at home, the "@").
    return (width - 28 - 48 - 68.4 - 2 * scoreCh * 13.2) / 2 - 45;
  }
  return width - 28 - 22 - 5 - 5 - scoreCh * 10.8 - 5 - 59.4;
}

let ctx: CanvasRenderingContext2D | null | undefined;

/**
 * Whether `name` sets whole in `room` px at `px`: measured off-screen with a
 * canvas at the bold weight (the widest a name is drawn), so the decision is
 * made once, before paint, and never re-renders a name on a page that is up.
 * The ticker mounts after its fonts load. Without a canvas (jsdom), a
 * generous per-character estimate.
 */
export function nameFits(name: string, room: number, px: number): boolean {
  if (ctx === undefined) {
    const real = typeof document !== "undefined" && !/jsdom/i.test(navigator.userAgent);
    ctx = real ? document.createElement("canvas").getContext("2d") : null;
  }
  if (!ctx) return name.length * px * NAME_EM <= room;
  ctx.font = `700 ${px}px "Plus Jakarta Sans", system-ui, sans-serif`;
  return ctx.measureText(name).width <= room;
}

/**
 * The clock box's two lines: live "Q4" over "2:14" (baseball "7th" over
 * "INN"), "FINAL", "PPD", today's kick-off over its countdown, a later
 * day's weekday over its time. Times are the bar's one format (`barTime`).
 */
export function statusLines(g: Game, now: number = Date.now()): [string, string] {
  if (isLive(g)) {
    const inning = /^IN(\d+)$/.exec(g.status_short ?? "");
    if (inning) return [ordinal(Number(inning[1])), "INN"];
    return [g.status_short || "LIVE", g.timer ?? ""];
  }
  if (isFinal(g)) return ["FINAL", ""];
  if (g.state === "postponed") return ["PPD", ""];
  const t = new Date(g.start_time);
  const diff = t.getTime() - now;
  const time = barTime(t.getTime());
  if (diff < 86_400_000 && t.toDateString() === new Date(now).toDateString()) {
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return [time, diff <= 0 ? "SOON" : h >= 10 ? "TODAY" : h ? `in ${h}h${String(m).padStart(2, "0")}` : `in ${m}m`];
  }
  return [t.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase(), time];
}

interface GameCellProps {
  game: Game;
  /** The column's width in px. Decides the layout and the name, never the reverse. */
  width: number;
  /** One of the user's favourite teams is playing: a 2px accent line on top. */
  mine?: boolean;
  /** Clock for the countdown; tests and the dev gallery pin it. */
  now?: number;
  onClick?: () => void;
}

/**
 * One game in a page column (SCROLLR-296, Brandon's notes on SCROLLR-268).
 *
 * No shell: the column IS the cell. Two layouts, picked by column width
 * alone: stacked (away over home, crest, name and score per row) and, from
 * 430px, one scoreboard line with the clock between the scores and the
 * records under the names.
 *
 * The game's clock belongs to the game: stacked, it sits left-aligned right
 * after the scores with no rule between them, while the gutters and the
 * page's column rule separate one game from the next. The home team carries
 * the "@" (away at home), so no stadium line is needed to say where it is
 * played. A result reads as clearly as a fixture: only the loser steps down.
 * A close game is marked on itself (a 2px line along its foot), not by
 * tinting the field: four close games out of five made the fifth look lit.
 *
 * Nothing moves when a value changes (CHIP_SPEC §4): each score holds the
 * league's reserved characters even before kick-off, the clock box holds
 * STATUS_WIDTH, and the live dot and both marks are always mounted. Names
 * sit in a minmax(0,1fr) track, so they truncate rather than push.
 */
const GameCell = memo(function GameCell({ game: g, width, mine = false, now, onClick }: GameCellProps) {
  const flash = useScoreFlash(g.away_team_score, g.home_team_score, g.id);
  const r = reservationFor(g.league);
  const live = isLive(g);
  const close = live && isCloseGame(g);
  const pre = isPre(g);
  const away = Number(g.away_team_score);
  const home = Number(g.home_team_score);
  const scored = !pre && g.away_team_score !== "" && g.home_team_score !== "" && Number.isFinite(away) && Number.isFinite(home);
  const awayLeads = !scored || away >= home;
  const homeLeads = !scored || home >= away;
  const [top, bottom] = statusLines(g, now);
  const wide = width >= WIDE_GAME_PX;
  const scoreN = Math.max(2, r.score);
  const scoreCh = `${scoreN}ch`;
  const room = nameRoom(width, scoreN);
  const px = wide ? NAME_PX.wide : NAME_PX.stacked;

  const score = (side: "away" | "home", v: number | string, leads: boolean) => (
    <span
      data-part={`${side}-score`}
      className={clsx(
        "text-right font-mono leading-none tabular-nums",
        wide ? "text-[22px]" : "text-[18px]",
        leads ? "font-bold text-fg" : "font-medium text-fg-3",
      )}
      style={{ minWidth: scoreCh }}
    >
      {scored ? String(v) : ""}
    </span>
  );
  const name = (side: "away" | "home", n: string, leads: boolean, end?: boolean) => {
    const text = cellName(g.league, n, nameFits(teamShortName(g.league, n), room, px));
    const size = wide ? "text-[15px]" : "text-[14.5px]";
    // A hidden bold copy holds the name's widest weight, so a game going
    // final (a weight change) never resizes the name or anything centred on it.
    return (
      <span data-part={`${side}-name`} className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] font-sans leading-[20px]" title={n}>
        <span
          className={clsx(
            "min-w-0 truncate",
            size,
            end ? "text-right" : "text-left",
            pre ? "font-semibold text-fg" : leads ? "font-bold text-fg" : "font-medium text-fg-3",
          )}
        >
          {text}
        </span>
        <span aria-hidden className={clsx("invisible h-0 overflow-hidden whitespace-nowrap font-bold", size)}>{text}</span>
      </span>
    );
  };
  const rec = (s: TeamStanding | undefined) => (s ? recordText(s, r) : "");
  // "Away at home": the one mark that says which side is at home.
  const at = <span aria-label="at" className="font-mono text-[12px] font-semibold leading-none text-fg-3">@</span>;
  // The game's clock. Stacked: right after the scores, left-aligned so it
  // sits with them; wide: between the scores, centred.
  const status = (
    <span
      data-part="status"
      className={clsx(
        "relative flex shrink-0 flex-col justify-center gap-[5px] whitespace-nowrap pl-[9px] font-mono text-[12px] leading-none",
        wide ? "items-center pr-[9px]" : "items-start",
      )}
      style={{ width: wide ? STATUS_WIDE : STATUS_WIDTH }}
    >
      <span className={clsx("relative font-bold tracking-[0.02em]", live ? "text-live" : isFinal(g) ? "text-fg-3" : "text-fg-2")}>
        {/* Always mounted, in the box's own 9px so it takes no room from the text. */}
        <span
          data-part="live-dot"
          className={clsx("absolute right-full top-1/2 mr-1 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-live", !live && "invisible")}
        />
        {top}
      </span>
      <span className={clsx("tabular-nums", live ? "text-fg-2" : "text-fg-3")}>{bottom || " "}</span>
    </span>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={String(g.id)}
      data-live={live ? "" : undefined}
      data-mine={mine ? "" : undefined}
      data-close={close ? "" : undefined}
      className="relative flex h-full w-full min-w-0 items-center gap-[5px] pl-4 pr-3 text-left transition-colors duration-700"
      style={{ background: flash ? "color-mix(in srgb, var(--color-live) 18%, transparent)" : undefined }}
    >
      {/* Both always mounted; transparent unless it is your team / a close game. */}
      <span
        aria-hidden
        data-part="mine"
        className="absolute left-0 right-0 top-0 h-[2px]"
        style={{ background: mine ? "var(--accent)" : "transparent" }}
      />
      <span
        aria-hidden
        data-part="close"
        className="absolute bottom-0 left-4 right-3 h-[2px] rounded-full"
        style={{ background: close ? "var(--accent)" : "transparent" }}
      />
      {wide ? (
        // One scoreboard line, the clock between the scores where a
        // scoreboard keeps it: it cannot be read as the next game's.
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,max-content)_auto_auto_auto_minmax(0,max-content)] items-center justify-center gap-x-3">
          <span className="flex min-w-0 items-center justify-end gap-2.5">
            <span className="flex min-w-0 flex-col items-end gap-[3px]">
              {name("away", g.away_team_name, awayLeads, true)}
              <span className="max-w-full truncate font-mono text-[12px] leading-none text-fg-3 tabular-nums">{rec(g.away_standing)}</span>
            </span>
            <Crest src={g.away_team_logo} alt={g.away_team_name} size="lg" />
          </span>
          {score("away", g.away_team_score, awayLeads)}
          {status}
          {score("home", g.home_team_score, homeLeads)}
          <span className="flex min-w-0 items-center gap-1.5">
            {at}
            <Crest src={g.home_team_logo} alt={g.home_team_name} size="lg" />
            <span className="ml-1 flex min-w-0 flex-col gap-[3px]">
              {name("home", g.home_team_name, homeLeads)}
              <span className="truncate font-mono text-[12px] leading-none text-fg-3 tabular-nums">{rec(g.home_standing)}</span>
            </span>
          </span>
        </span>
      ) : (
        <>
          <span className="grid min-w-0 flex-1 grid-cols-[22px_minmax(0,1fr)_auto] grid-rows-[22px_22px] items-center gap-x-[5px] gap-y-[4px]">
            <Crest src={g.away_team_logo} alt={g.away_team_name} size="lg" />
            {name("away", g.away_team_name, awayLeads)}
            {score("away", g.away_team_score, awayLeads)}
            {/* The "@" hangs in the gutter before the home crest, so it costs the name nothing. */}
            <span className="relative flex">
              <span className="absolute right-full top-1/2 mr-[3px] -translate-y-1/2 leading-none">{at}</span>
              <Crest src={g.home_team_logo} alt={g.home_team_name} size="lg" />
            </span>
            {name("home", g.home_team_name, homeLeads)}
            {score("home", g.home_team_score, homeLeads)}
          </span>
          {status}
        </>
      )}
    </button>
  );
});

export default GameCell;
