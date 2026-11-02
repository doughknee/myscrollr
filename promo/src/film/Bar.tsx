/**
 * The bar as the film draws it: the app's own cells (GameCell, QuoteCell,
 * NewsCell, RepoCell) in the page layout pagePlan.ts prescribes, under a
 * band and an edge clock that mirror PagedBar's and EdgeZone's markup.
 *
 * PagedBar itself is not mounted here: it owns a page clock, Tauri events
 * and Motion springs, none of which advance when Remotion steps frames.
 * Everything that moves in this bar is a pure function of `frame`.
 */
import type { ReactNode } from "react";
import { Easing, interpolate } from "remotion";
import GameCell from "../../../desktop/src/components/pages/cells/GameCell";
import NewsCell from "../../../desktop/src/components/pages/cells/NewsCell";
import QuoteCell from "../../../desktop/src/components/pages/cells/QuoteCell";
import RepoCell from "../../../desktop/src/components/pages/cells/RepoCell";
import { Rule, accentFor, accentStyle, inkFor, mix } from "../../../desktop/src/components/pages/cells/parts";
import { BAND_W, edgeBar } from "../../../desktop/src/components/pages/pagePlan";
import { BBC, FAVOURITE, GITHUB, NOW, STOCKS, WIDGETS, nflAt, type FilmWidget } from "./data";

export const BAR_W = 1920;
export const BAR_H = 64;
const EDGE_W = 118;
const CONTENT_W = BAR_W - BAND_W - EDGE_W;
/** The app's swipe is 0.6s; at 30fps that is 18 frames. */
export const SWIPE = 18;
const WIPE = 11;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** A price tick on the stocks page: at this frame, column `cell` moves up or down. */
export interface Tick { at: number; cell: number; up: boolean }

export interface BarState {
  /** Index into WIDGETS now on screen. */
  widget: number;
  /** Frame the current widget swiped in at. */
  since: number;
  /** The previous widget, for the swipe and the wipe. */
  prev: number | null;
  /** The Bears have scored. */
  scored: boolean;
  /** Frame of the score, for the flash. */
  scoredAt: number;
  dark: boolean;
}

function chipColor(kind: "live" | "open" | "fresh" | "needs", dark: boolean): string {
  if (kind === "fresh" || kind === "needs") return "var(--accent-ink)";
  const token = kind === "live" ? "var(--color-live)" : "var(--color-up)";
  return `color-mix(in srgb, ${token} 85%, ${dark ? "white" : "black"})`;
}

/** PagedBar's Band, frame-driven: the label wipes up on a widget change, the edge bar only recolours. */
function Band({ w, frame, since, prev, dark, fill, burst = 0, pulse = 0, flash = 0, arm = 0, roll = WIPE }: { w: FilmWidget; frame: number; since: number; prev: FilmWidget | null; dark: boolean; fill: number; burst?: number; pulse?: number; flash?: number; arm?: number; roll?: number }) {
  const bar = edgeBar(WIDGETS.length);
  const t = Math.min(1, (frame - since) / roll);
  const face = (x: FilmWidget, y: number, key: string) => {
    const c = x.chip;
    const hue = c ? chipColor(c.kind, dark) : "";
    return (
      <div
        key={key}
        className="absolute inset-0 flex flex-col justify-center gap-2 pl-3.5 pr-2.5"
        style={{ ...accentStyle(accentFor(x.hex, dark), inkFor(x.hex, dark)), background: mix(dark ? 16 : 12), borderRight: `1px solid ${mix(40)}`, transform: `translateY(${y}%)` }}
      >
        <div className="flex h-[26px] min-w-0 items-center gap-2.5">
          <span className="min-w-0 truncate font-sans text-[20px] font-extrabold leading-none tracking-[0.04em]" style={{ color: "var(--accent-ink)" }}>
            {x.code}
          </span>
          {c && (
            <span className="flex shrink-0 items-center gap-[5px]">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: hue, boxShadow: `0 0 0 ${3 + 3 * burst + 1.5 * pulse}px color-mix(in srgb, ${hue} ${Math.round((c.kind === "fresh" || c.kind === "needs" ? 25 : 22) + 40 * burst + 20 * pulse)}%, transparent)`, transform: `scale(${1 + 0.16 * burst + 0.05 * pulse})` }} />
              {c.count !== undefined && (
                <span className="font-mono text-[11px] font-semibold leading-none tabular-nums" style={{ color: hue }}>
                  {c.count}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex h-[5px] shrink-0 items-stretch gap-[3px]">
          {Array.from({ length: x.pages }, (_, i) => (
            <span key={i} className="block min-w-[3px] flex-1 basis-0 overflow-hidden rounded-[3px]" style={{ background: mix(30) }}>
              {i === 0 && (
                <span
                  className="block h-full rounded-[3px]"
                  style={{
                    width: `${fill * 100}%`,
                    // Arming: over the last frames of the dwell the fill turns to the ink and glows.
                    background: arm > 0 ? `color-mix(in srgb, var(--accent-ink) ${Math.round(arm * 100)}%, ${mix(75)})` : mix(75),
                    boxShadow: arm > 0 ? `0 0 ${Math.round(8 * arm)}px color-mix(in srgb, var(--accent-ink) ${Math.round(70 * arm)}%, transparent)` : undefined,
                  }}
                />
              )}
            </span>
          ))}
        </div>
      </div>
    );
  };
  const e = EASE(t);
  return (
    <div className="relative shrink-0 overflow-hidden" style={{ width: BAND_W }}>
      {prev && t < 1 && face(prev, -100 * e, "prev")}
      {face(w, prev ? 100 * (1 - e) : 0, "cur")}
      {flash > 0 && <span aria-hidden className="pointer-events-none absolute inset-0 z-20" style={{ background: "var(--accent-ink)", opacity: 0.45 * flash }} />}
      <div className="absolute inset-y-0 left-0 z-10 flex w-1 flex-col" style={{ gap: bar.gap }}>
        {WIDGETS.map((x) => {
          const on = x.tab === w.tab;
          const a = accentFor(x.hex, dark);
          return <span key={x.tab} className="block min-h-0" style={{ flexGrow: on ? bar.activeGrow : 1, flexBasis: 0, background: on ? inkFor(x.hex, dark) : `color-mix(in srgb, ${a} 32%, transparent)` }} />;
        })}
      </div>
    </div>
  );
}

/**
 * Equal columns. After a widget change the columns settle one after another
 * (two frames apart) so the new page reads left to right instead of
 * arriving as one block.
 */
function Columns({ children, settle = 1 }: { children: ReactNode[]; settle?: number }) {
  return (
    <div className="grid h-full min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${children.length}, minmax(0, 1fr))` }}>
      {children.map((c, i) => {
        const k = Math.min(1, Math.max(0, settle * (children.length + 1) - i));
        const e = EASE(k);
        return (
          <div key={i} className="relative min-w-0" style={{ opacity: e, transform: `translateX(${(1 - e) * 10}px)` }}>
            {i > 0 && <Rule />}
            {c}
          </div>
        );
      })}
    </div>
  );
}

/** One page of a widget, laid out as the app lays it: equal columns at this bar's content width. */
function Page({ w, frame, scored, scoredAt, dark, ticks, settle = 1 }: { w: FilmWidget; frame: number; scored: boolean; scoredAt: number; dark: boolean; ticks: Tick[]; settle?: number }) {
  switch (w.kind) {
    case "sports": {
      const games = nflAt(scored);
      const colW = CONTENT_W / games.length;
      // The app's own score flash is a green wash. Here it is the film's one
      // event: a hard hit that decays over a second.
      const flash = scored ? interpolate(frame - scoredAt, [0, 2, 10, 36], [0, 0.6, 0.3, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
      return (
        <Columns settle={settle}>
          {games.map((g, i) => (
            <div key={g.id} className="relative h-full">
              <GameCell game={g} width={colW} mine={g.home_team_name === FAVOURITE || g.away_team_name === FAVOURITE} now={NOW} />
              {i === 0 && flash > 0 && <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "var(--color-up)", opacity: flash }} />}
            </div>
          ))}
        </Columns>
      );
    }
    case "finance":
      // Each tick moves one quote and flashes its cell in the app's up/down colour.
      return (
        <Columns settle={settle}>
          {STOCKS.map((t, i) => {
            const mine = ticks.filter((k) => k.cell === i && frame >= k.at);
            let trade = t;
            for (const k of mine) {
              const price = Number(trade.price) * (k.up ? 1.0007 : 0.9993);
              const prev = Number(t.previous_close);
              trade = { ...trade, price, price_change: price - prev, percentage_change: ((price - prev) / prev) * 100, sparkline: [...(trade.sparkline ?? []).slice(1), price] };
            }
            const last = mine[mine.length - 1];
            const flash = last ? interpolate(frame - last.at, [0, 1, 12], [0, 0.35, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
            return (
              <div key={t.symbol} className="relative h-full">
                <QuoteCell trade={trade} />
                {flash > 0 && <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: last?.up ? "var(--color-up)" : "var(--color-down)", opacity: flash }} />}
              </div>
            );
          })}
        </Columns>
      );
    case "news":
      return (
        <Columns settle={settle}>
          {BBC.map((r) => (
            <NewsCell key={r.id} item={r} width={CONTENT_W / BBC.length} now={NOW} />
          ))}
        </Columns>
      );
    case "github":
      return (
        <Columns settle={settle}>
          {GITHUB.map((c) => (
            <RepoCell key={c.id} chip={c} dark={dark} />
          ))}
        </Columns>
      );
  }
}

/** EdgeZone's clock slot, pinned to the fixture's capture time. */
function Edge({ time, date }: { time: string; date: string }) {
  return (
    <div className="relative ml-auto flex h-full shrink-0 border-l border-edge" style={{ width: EDGE_W }}>
      <span className="flex h-full min-w-0 flex-col justify-center gap-[4px] px-3 text-left font-mono">
        <span className="truncate whitespace-nowrap text-[9.5px] font-bold uppercase leading-none tracking-[0.08em] text-fg-3">Local</span>
        <span className="min-w-0 truncate text-[16px] font-bold leading-none tabular-nums text-fg">{time}</span>
        <span className="w-0 min-w-full truncate whitespace-nowrap text-[9.5px] leading-none text-fg-3">{date}</span>
      </span>
    </div>
  );
}

export function Bar({ frame, state, fill, arm = 0, pulse = 0, ticks = [], bandFlash = 0, roll = WIPE }: {
  frame: number;
  /** Frames the roll takes; the film paces it. */
  roll?: number;
  state: BarState;
  /** The lit pill's fill, 0..1: the widget's dwell, full on the swap frame. */
  fill: number;
  /** 0..1 over the last frames before the swap: the pill arms. */
  arm?: number;
  /** The kick, 0..1: the LIVE dot's ring breathes with it. */
  pulse?: number;
  ticks?: Tick[];
  /** A wash over the band, 0..1: a chip landing on it. */
  bandFlash?: number;
}) {
  const w = WIDGETS[state.widget];
  const prev = state.prev === null ? null : WIDGETS[state.prev];
  // A widget change is ONE motion: the page rolls up with the band, on the
  // band's own wipe timing, then the columns settle. Nothing moves sideways.
  const t = Math.min(1, (frame - state.since) / roll);
  const e = EASE(t);
  // The columns settle over 14 frames once the roll has mostly landed.
  const settle = prev ? Math.min(1, Math.max(0, (frame - state.since - roll / 3) / (roll + 2))) : 1;
  // One beat of the incoming widget's colour across the whole bar on the hit.
  const change = prev ? interpolate(frame - state.since, [0, 1, 4, 14], [0, 0.55, 0.3, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  // The band's dot bursts on the score and on every swap.
  const swapBurst = prev ? interpolate(frame - state.since, [0, 3, 26], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const scoreBurst = state.scored ? interpolate(frame - state.scoredAt, [0, 3, 30], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const page = (x: FilmWidget, dy: number, key: string, k: number) => (
    <div key={key} className="absolute inset-0 flex" style={{ transform: `translateY(${dy}%)`, ...accentStyle(accentFor(x.hex, state.dark), inkFor(x.hex, state.dark)) }}>
      <Page w={x} frame={frame} scored={state.scored} scoredAt={state.scoredAt} dark={state.dark} ticks={ticks} settle={k} />
    </div>
  );
  return (
    <div className="flex items-stretch overflow-hidden bg-base-150" style={{ width: BAR_W, height: BAR_H, borderBottom: "1px solid color-mix(in srgb, var(--color-edge) 50%, transparent)" }}>
      <Band w={w} frame={frame} since={state.since} prev={prev} dark={state.dark} fill={fill} arm={arm} pulse={pulse} flash={bandFlash} burst={Math.max(swapBurst, scoreBurst)} roll={roll} />
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {prev && t < 1 && page(prev, -100 * e, "prev", 1)}
        {page(w, prev ? 100 * (1 - e) : 0, "cur", settle)}
        {change > 0 && <span aria-hidden className="pointer-events-none absolute inset-0 z-20" style={{ background: accentFor(w.hex, state.dark), opacity: change }} />}
      </div>
      <Edge time="1:40 PM" date="Sun, Oct 4" />
    </div>
  );
}
