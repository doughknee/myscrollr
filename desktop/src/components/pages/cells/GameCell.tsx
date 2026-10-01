import { memo } from "react";
import { clsx } from "clsx";
import type { Game, TeamStanding } from "../../../types";
import { isLive, isFinal, isPre, isCloseGame } from "../../../utils/gameHelpers";
import { teamShortName } from "../../../utils/teamShortName";
import { reservationFor, recordText, ordinal } from "../../../utils/sportsChipLayout";
import { useScoreFlash } from "../../../hooks/useScoreFlash";
import { Crest, Rule, mix } from "./parts";

/** A column at least this wide lays the game out as one scoreboard line. */
export const WIDE_GAME_PX = 430;
/** A column at least this wide has room for the full short name. */
export const ROOMY_GAME_PX = 340;
/**
 * The clock box: a FIXED width, 8ch of its 11px face plus its 12px + 4px
 * padding. Its widest lines are "12:00P" (6ch) and a same-day countdown
 * "in 23h59" (8 characters at 10.5px). The prototype's 7.5ch was a
 * min-width that included the padding, so the box grew with "12:00P" and
 * every name and score left of it moved when the game went live -- caught
 * by e2e/ticker/cells.spec.ts.
 */
export const STATUS_WIDTH = "calc(8ch + 16px)";

const US_PRO = new Set(["NFL", "MLB", "NBA", "NHL", "MLS", "WNBA"]);

/**
 * Narrowest column a game cell takes, for pagePlan's `columnsFor(…, minCol)`.
 * Measured in the gallery: everything but the name costs 149px, so 212 fits
 * a nickname of up to ~8 letters whole; the longest US-pro nicknames
 * ("Commanders" 239, "Timberwolves" 242, "Golden Knights" 250) truncate by a
 * few letters at the narrowest bars, as on the canvas. Leagues that show a
 * city or college name get the prototype's 244.
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
 * The clock box's two lines: live "Q4" over "2:14" (baseball "7th" over
 * "INN"), "FINAL", "PPD", today's kick-off over its countdown, a later
 * day's weekday over its time.
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
  const time = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?([AP])M/i, "$1");
  if (diff < 86_400_000 && t.toDateString() === new Date(now).toDateString()) {
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return [time, diff <= 0 ? "SOON" : h ? `in ${h}h${String(m).padStart(2, "0")}` : `in ${m}m`];
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
 * One game in a page column (canvas: SCROLLR-268 "Sizes", "Quiet").
 *
 * No shell: the column IS the cell. Two layouts, picked by column width
 * alone: stacked (crest, name, score per row; records or the venue
 * beneath) and, from 430px, one scoreboard line with the scores in the
 * middle. The clock box sits on the right behind a hairline.
 *
 * Nothing moves when a value changes (CHIP_SPEC §4): each score holds the
 * league's reserved characters even before kick-off, the clock box holds
 * STATUS_WIDTH, and the live dot is always mounted. Names sit in a
 * minmax(0,1fr) track, so they truncate rather than push.
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
  const roomy = width >= ROOMY_GAME_PX;
  const scoreCh = `${Math.max(2, r.score)}ch`;

  const score = (side: "away" | "home", v: number | string, lead: boolean) => (
    <span
      data-part={`${side}-score`}
      className={clsx(
        "text-right font-mono leading-none tabular-nums",
        wide ? "text-[20px]" : "text-[15px]",
        lead ? "font-bold text-fg" : "font-medium text-fg-3",
      )}
      style={{ minWidth: scoreCh }}
    >
      {scored ? String(v) : ""}
    </span>
  );
  const name = (side: "away" | "home", n: string, lead: boolean, end?: boolean) => (
    <span
      data-part={`${side}-name`}
      className={clsx(
        "min-w-0 truncate font-sans text-[13.5px] leading-none",
        end ? "text-right" : "text-left",
        pre ? "font-semibold text-fg" : lead ? "font-bold text-fg" : "font-medium text-fg-3",
      )}
      title={n}
    >
      {cellName(g.league, n, roomy)}
    </span>
  );
  const rec = (s: TeamStanding | undefined) => (s ? recordText(s, r) : "");

  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={String(g.id)}
      className={clsx(
        "relative flex h-full w-full min-w-0 items-stretch pl-3 pr-2 text-left transition-colors duration-700",
        isFinal(g) && "opacity-80",
      )}
      style={{
        background: flash ? "color-mix(in srgb, var(--color-live) 18%, transparent)" : close ? mix(10) : undefined,
      }}
    >
      {/* Always mounted; transparent when it is not your team. */}
      <span
        aria-hidden
        data-part="mine"
        className="absolute left-0 right-0 top-0 h-[2px]"
        style={{ background: mine ? "var(--accent)" : "transparent" }}
      />
      {wide ? (
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_14px_auto_minmax(0,1fr)] items-center gap-x-2.5 pr-3">
          <span className="flex min-w-0 items-center justify-end gap-2">
            <span className="flex min-w-0 flex-col items-end gap-[4px]">
              {name("away", g.away_team_name, awayLeads, true)}
              <span className="truncate font-mono text-[11px] leading-none text-fg-4 tabular-nums">{rec(g.away_standing)}</span>
            </span>
            <Crest src={g.away_team_logo} alt={g.away_team_name} size="lg" />
          </span>
          {score("away", g.away_team_score, awayLeads)}
          <span className="text-center font-mono text-[12px] text-fg-4">{pre ? "@" : "–"}</span>
          {score("home", g.home_team_score, homeLeads)}
          <span className="flex min-w-0 items-center gap-2">
            <Crest src={g.home_team_logo} alt={g.home_team_name} size="lg" />
            <span className="flex min-w-0 flex-col gap-[4px]">
              {name("home", g.home_team_name, homeLeads)}
              <span className="truncate font-mono text-[11px] leading-none text-fg-4 tabular-nums">{rec(g.home_standing)}</span>
            </span>
          </span>
        </span>
      ) : (
        <span className="grid min-w-0 flex-1 grid-cols-[16px_minmax(0,1fr)_auto] grid-rows-[17px_17px_14px] items-center gap-x-2 py-[6px] pr-2.5">
          <Crest src={g.away_team_logo} alt={g.away_team_name} size="md" />
          {name("away", g.away_team_name, awayLeads)}
          {score("away", g.away_team_score, awayLeads)}
          <Crest src={g.home_team_logo} alt={g.home_team_name} size="md" />
          {name("home", g.home_team_name, homeLeads)}
          {score("home", g.home_team_score, homeLeads)}
          {/* Before kick-off, where; after it, the table. */}
          <span data-part="detail" className="col-span-3 truncate font-mono text-[11px] leading-none text-fg-4 tabular-nums">
            {pre && g.venue ? g.venue : [rec(g.away_standing), rec(g.home_standing)].filter(Boolean).join("  ·  ")}
          </span>
        </span>
      )}
      <span
        data-part="status"
        className="relative flex shrink-0 flex-col items-center justify-center gap-[4px] overflow-hidden whitespace-nowrap pl-3 pr-1 font-mono text-[11px] leading-none"
        style={{ width: STATUS_WIDTH }}
      >
        <Rule />
        <span
          className={clsx(
            "relative font-bold tracking-[0.04em]",
            live ? "text-live" : isFinal(g) ? "text-fg-4" : "text-fg-2",
          )}
        >
          {/* Always mounted, hung off the text's left edge so it takes no
              room and the text stays centred over the clock. */}
          <span
            data-part="live-dot"
            className={clsx("absolute right-full top-1/2 mr-1 h-[5px] w-[5px] -translate-y-1/2 rounded-full bg-live", !live && "invisible")}
          />
          {top}
        </span>
        <span className={clsx("text-[10.5px] tabular-nums", live ? "text-fg-2" : "text-fg-3")}>{bottom || " "}</span>
      </span>
    </button>
  );
});

export default GameCell;
