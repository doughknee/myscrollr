/**
 * The pages bar (SCROLLR-272, design SCROLLR-268): one widget at a time,
 * laid straight onto the bar in equal columns, then a swipe to the next.
 * The default `scrollMode: "pages"` (Settings › Ticker, SCROLLR-274; the
 * ticker shim's `?pages=1` sets it).
 *
 * The rules this file keeps:
 *  - A page on screen is FROZEN (pagePlan's freezePage): which items, in
 *    what order, at what column width, is fixed at swipe-in. Data updates
 *    change values in place; a resize, a re-rank or a new item reaches the
 *    layout on the next page. Nothing in a page moves while it is up.
 *  - The band (SCROLLR-303) names the widget in its colour, marks what is
 *    happening now (the chip) and shows this widget's pages as pills; the lit
 *    pill fills over the page's dwell. It wipes only when the widget changes
 *    (up for next, down for back); the edge bar beside it only fades.
 *  - An ACTIVE pointer holds the page (and the fill): over the bar and
 *    entering or moving within the last 5 s (activeHover.ts, SCROLLR-291). A
 *    pointer that rests 5 s releases it; moving again grabs it back. Reduced motion (the OS setting,
 *    read directly: main.tsx pins Motion's own flag off for the marquee)
 *    turns the swipe and the wipe into crossfades.
 *  - One clock for every ticker window. App renders once per window
 *    (AGENTS.md), so the primary ticker (`isPrimaryTicker`) runs the page
 *    clock and broadcasts each turn; the others follow it and report their
 *    hover back, so every monitor shows the same widget and swipes on the
 *    same beat. A window of a different width maps the leader's page onto
 *    its own pages (`followPage`).
 *  - The fixed edge zone (EdgeZone, SCROLLR-273) sits on the right: clocks,
 *    weather and the other utilities, then pins. Its slots step on the
 *    turn's seq, so they change only while a page swipes. Its measured
 *    width is frozen into each page with the bar's.
 *  - Manual paging (SCROLLR-298, SCROLLR-303): the wheel, ‹ › on the hover
 *    keypad and ←/→ turn this widget's page; Shift+wheel, ˄ ˅ and ↑/↓ change
 *    the widget; a pill shows its page and an edge-bar segment its widget
 *    (`stepTurn`). A move is a turn like any other: the same swipe, frozen at
 *    swipe-in, a fresh dwell, and the hold stays. A follower sends its move to
 *    the leader (`pages:step`), which turns every window. Page controls off
 *    (Settings › Ticker, or the bar's right-click menu) hides the keypad only:
 *    the band's width and everything else stay.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, animate, motion, type AnimationPlaybackControls } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, type LucideIcon } from "lucide-react";
import type { DashboardResponse, Game, RssItem, Trade, WidgetTickerData } from "../../types";
import type { WidgetPin } from "../../preferences";
import { financeMarketOptions } from "../../api/queries";
import { sourceForWidget } from "../../marketplace";
import { isPrimaryTicker } from "../../lib/windowRole";
import { useEdgeMeasures, useEdgeRoom, usePublishEdge } from "../../lib/edgeMeasure";
import { useTauriListener } from "../../hooks/useTauriListener";
import { chipUrlForFinance, chipUrlForRss, chipUrlForSports } from "../../utils/chipUrl";
import { BAND_W, PILLS_MAX, columnsFor, contentWidth, edgeBar, freezePage, pageItems, refreshPage, trackMarker, type FrozenPage } from "./pagePlan";
import {
  ALSO_TAB,
  buildPageWidgets,
  chip,
  followPage,
  newNav,
  nextTurn,
  planAll,
  stepTurn,
  type AlsoItem,
  type Move,
  type PageItem,
  type PageWidget,
  type Turn,
} from "./widgetPages";
import GameCell from "./cells/GameCell";
import NewsCell from "./cells/NewsCell";
import QuoteCell, { QUOTE_MIN_COL } from "./cells/QuoteCell";
import AlsoCell from "./cells/AlsoCell";
import { Rule, accentFor, accentStyle, inkFor, mix } from "./cells/parts";
import EdgeZone, { buildEdge, edgeTabs } from "./EdgeZone";
import { stepBack } from "./edgeRule";
import { useActiveHover } from "./activeHover";

/** The swipe (canvas "Motion"): 0.6 s on a soft ease. */
export const SWIPE_S = 0.6;
/** The band's wipe when the widget changes. */
const BAND_S = 0.45;
/** Reduced motion: a crossfade instead of either. */
const FADE_S = 0.4;
const EASE = [0.32, 0.72, 0, 1] as const;

/** Leader → every window: the page now up, and whether it is held. */
const TURN_EVENT = "pages:turn";
/** Follower → leader: the mouse entered or left my bar. */
const HOVER_EVENT = "pages:hover";
/** Follower → leader: I just started; tell me the page now up. */
const HELLO_EVENT = "pages:hello";
/** Follower → leader: a manual move (`Move`: a page, a widget, a pill or a segment; SCROLLR-298, SCROLLR-301, SCROLLR-303). */
const STEP_EVENT = "pages:step";
/**
 * A wheel gesture is one step: a wheel event steps only after this long without
 * one, so a flick or a trackpad's glide is one page and notches turned one at a
 * time are a page each.
 */
const WHEEL_QUIET_MS = 200;

type TurnMsg = Turn & { held: boolean };

interface Props {
  dashboard: DashboardResponse | null;
  activeTabs: string[];
  /** Clock, weather and the other utilities, for the edge zone. */
  widgetData?: WidgetTickerData;
  /** Pinned subjects: on the edge, off the pages. */
  pins?: WidgetPin[];
  onChipClick?: (widgetType: string, itemId: string | number, url?: string) => void;
  /** Widgets with a page up this lap, for the presence check-in (the Also page does not count). */
  onDisplayedWidgetsChange?: (widgetIds: string[]) => void;
  /** Drawn instead of the bar when no widget has a page (the empty-state CTAs). */
  empty?: ReactNode;
  /** The band's hover keypad (`prefs.ticker.pageControls`, SCROLLR-301, SCROLLR-303). Off: nothing appears on hover; the band's width is the same. */
  pageControls?: boolean;
}

/** The page as it was frozen at swipe-in. */
interface Shown {
  seq: number;
  widget: PageWidget;
  page: FrozenPage<PageItem>;
  index: number;
  count: number;
  colW: number;
  /** Columns a full page has at this width, the widget's items over all its pages, and what it could have shown (the browser checks read all three). */
  cols: number;
  total: number;
  avail: number;
  /** Fewer items than columns even after filling: cells keep a full page's column width, left-aligned, instead of stretching (SCROLLR-292). */
  short: boolean;
  /** Arrived by a manual step back: swiped in left to right (SCROLLR-300). */
  back: boolean;
}

const NO_PINS: WidgetPin[] = [];

const keyOf = (i: PageItem) => i.key;

function useOsReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** How long this page has left: the lit pill (or the 25+ track's marker) fills in the ink, and stops while the page is held. */
function DwellFill({ seq, dwell, held }: { seq: number; dwell: number; held: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ctl = useRef<AnimationPlaybackControls | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = animate(ref.current, { scaleX: [0, 1] }, { duration: dwell, ease: "linear" });
    ctl.current = c;
    return () => c.stop();
  }, [seq, dwell]);
  useEffect(() => {
    const c = ctl.current;
    if (!c) return;
    if (held) c.pause();
    else if (c.time < dwell) c.play();
  }, [held, seq, dwell]);
  return <span ref={ref} aria-hidden className="block h-full w-full origin-left" style={{ background: "var(--accent-ink)", transform: "scaleX(0)" }} />;
}

/** One 18x22 key on the keypad: a 13px chevron in the ink, a 10% white wash on hover. */
function Key({ icon: Icon, label, onClick, onPeek, ...data }: { icon: LucideIcon; label: string; onClick: () => void; onPeek?: (on: boolean) => void } & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={onPeek && (() => onPeek(true))}
      onMouseLeave={onPeek && (() => onPeek(false))}
      className="flex h-[22px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] transition-colors duration-[120ms] hover:bg-white/10"
      style={{ color: "var(--accent-ink)" }}
      {...data}
    >
      <Icon size={13} strokeWidth={2.5} aria-hidden />
    </button>
  );
}

/**
 * The chip's colours: the palette's own live (red) and up (green), moved 15%
 * toward white on dark and black on light so the count clears 4.5:1 on the
 * band's tint in every palette (the tokens are tuned for the bare bar,
 * SCROLLR-287). On scrollr-dark that is #ff6271 and #43ce77, the canvas's
 * #ff6b6b and #5fd38d; the canvas hexes themselves read 3.8:1 on gruvbox-dark.
 */
function chipColor(kind: "live" | "open" | "fresh", dark: boolean): string {
  if (kind === "fresh") return "var(--accent-ink)";
  const token = kind === "live" ? "var(--color-live)" : "var(--color-up)";
  return `color-mix(in srgb, ${token} 85%, ${dark ? "white" : "black"})`;
}

/**
 * The band at the bar's left end (SCROLLR-303): BAND_W wide, fixed. The edge
 * bar (one segment per widget, the active one solid; a click jumps there), the
 * widget's name, the chip when something is happening now, and one pill per
 * page of this widget (one track past PILLS_MAX). Nothing to read at rest but
 * the name and a chip's count. The keypad ‹ ˄ ˅ › takes no width at rest and
 * shows on hover; ˄ ˅ peek at the segment they would go to.
 */
function Band({ cur, live, widgets, turn, held, dark, keypad, reduced, onMove, wipe, fade }: {
  cur: Shown;
  live: PageWidget;
  widgets: PageWidget[];
  turn: Turn | null;
  held: boolean;
  dark: boolean;
  keypad: boolean;
  reduced: boolean;
  onMove: (m: Move) => void;
  wipe: object;
  fade: object;
}) {
  const [peek, setPeek] = useState<-1 | 0 | 1>(0);
  const n = widgets.length;
  const at = widgets.findIndex((w) => w.tab === cur.widget.tab);
  const peekTab = peek && at >= 0 ? widgets[(at + peek + n) % n].tab : null;
  const bar = edgeBar(n);
  const c = chip(live);
  const hue = c ? chipColor(c.kind, dark) : "";
  const pageKeys = cur.count >= 2;
  const widgetKeys = n >= 2;
  const showKeypad = keypad && (pageKeys || widgetKeys);
  const accent = accentFor(cur.widget.hex, dark);
  const ink = inkFor(cur.widget.hex, dark);
  const fill = turn && <DwellFill seq={turn.seq} dwell={turn.dwell} held={held} />;
  const mark = trackMarker(cur.index, cur.count);
  const peekOn = (dir: -1 | 1) => (on: boolean) => setPeek(on ? dir : 0);
  return (
    <div data-band={cur.widget.tab} className="relative shrink-0 overflow-hidden" style={{ width: BAND_W }}>
      <AnimatePresence initial={false} custom={cur.back}>
        <motion.div
          key={cur.widget.tab}
          custom={cur.back}
          data-label={cur.widget.tab}
          className="absolute inset-0 flex flex-col justify-center gap-2 pl-3.5 pr-2.5"
          style={{ ...accentStyle(accent, ink), background: mix(dark ? 16 : 12), borderRight: `1px solid ${mix(40)}` }}
          {...(reduced ? fade : wipe)}
        >
          <div className="flex h-[26px] min-w-0 items-center gap-2.5">
            <span
              data-name=""
              className={
                showKeypad && cur.widget.code.length > 5
                  ? "min-w-0 truncate font-sans text-[20px] font-extrabold leading-none tracking-[0.04em] group-hover/bar:text-[15px] group-has-[[data-keypad]_:focus-visible]/bar:text-[15px]"
                  : "min-w-0 truncate font-sans text-[20px] font-extrabold leading-none tracking-[0.04em]"
              }
              style={{ color: "var(--accent-ink)" }}
            >
              {cur.widget.code}
            </span>
            {c && (
              <span
                data-chip=""
                data-kind={c.kind}
                data-part="chip"
                className={showKeypad ? "flex shrink-0 items-center gap-[5px] group-hover/bar:hidden group-has-[[data-keypad]_:focus-visible]/bar:hidden" : "flex shrink-0 items-center gap-[5px]"}
              >
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: hue, boxShadow: `0 0 0 3px color-mix(in srgb, ${hue} ${c.kind === "fresh" ? 25 : 22}%, transparent)` }} />
                {c.count !== undefined && (
                  <span className="font-mono text-[11px] font-semibold leading-none tabular-nums" style={{ color: hue }}>
                    {c.count}
                  </span>
                )}
              </span>
            )}
            {showKeypad && (
              <span
                data-keypad=""
                className="ml-auto flex h-[26px] w-0 shrink-0 items-center overflow-hidden rounded-[7px] p-0 opacity-0 transition-opacity duration-150 group-hover/bar:w-auto group-hover/bar:px-[2px] group-hover/bar:opacity-100 has-[:focus-visible]:w-auto has-[:focus-visible]:px-[2px] has-[:focus-visible]:opacity-100"
                style={{ background: mix(14) }}
              >
                {pageKeys && <Key icon={ChevronLeft} label="Previous page" data-step="prev" onClick={() => onMove({ dir: -1 })} />}
                {widgetKeys && <Key icon={ChevronUp} label="Previous widget" data-jump="prev" onClick={() => onMove({ dir: -1, whole: true })} onPeek={peekOn(-1)} />}
                {widgetKeys && <Key icon={ChevronDown} label="Next widget" data-jump="next" onClick={() => onMove({ dir: 1, whole: true })} onPeek={peekOn(1)} />}
                {pageKeys && <Key icon={ChevronRight} label="Next page" data-step="next" onClick={() => onMove({ dir: 1 })} />}
              </span>
            )}
          </div>
          {cur.count > PILLS_MAX ? (
            <div data-track={`${cur.index + 1}/${cur.count}`} className="flex h-[10px] shrink-0 items-center gap-2">
              <div className="relative h-[5px] min-w-0 flex-1 overflow-hidden rounded-[3px] group-hover/bar:brightness-125" style={{ background: mix(30) }}>
                <span data-lit="" className="absolute inset-y-0 overflow-hidden rounded-[3px]" style={{ left: `${mark.left * 100}%`, width: `${mark.width * 100}%`, background: mix(40) }}>
                  {fill}
                </span>
              </div>
              <span className="shrink-0 whitespace-nowrap font-mono text-[9px] font-semibold leading-none tabular-nums" style={{ color: "var(--accent-ink)" }}>
                {cur.index + 1}/{cur.count}
              </span>
            </div>
          ) : (
            <div className="flex h-[5px] shrink-0 items-stretch gap-[3px]">
              {Array.from({ length: cur.count }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  data-pill={i}
                  data-lit={i === cur.index ? "" : undefined}
                  aria-label={`Page ${i + 1} of ${cur.count}`}
                  onClick={() => onMove({ page: i, of: cur.count })}
                  className="block min-w-[3px] flex-1 basis-0 cursor-pointer overflow-hidden rounded-[3px] p-0 group-hover/bar:brightness-125"
                  style={{ background: mix(i > cur.index ? 60 : 30) }}
                >
                  {i === cur.index && fill}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {/* The edge bar: outside the wipe, so it never moves; the hand-over only fades. */}
      <div aria-label="Widgets" className="absolute inset-y-0 left-0 z-10 flex w-1 flex-col" style={{ gap: bar.gap }}>
        {widgets.map((w) => {
          const on = w.tab === cur.widget.tab;
          const a = accentFor(w.hex, dark);
          return (
            <button
              key={w.tab}
              type="button"
              data-seg={w.tab}
              data-active={on ? "" : undefined}
              aria-label={`Show ${w.code}`}
              onClick={() => onMove({ tab: w.tab })}
              className="block min-h-0 cursor-pointer p-0"
              style={{
                flexGrow: on ? bar.activeGrow : 1,
                flexBasis: 0,
                background: on ? inkFor(w.hex, dark) : `color-mix(in srgb, ${a} ${w.tab === peekTab ? 72 : 32}%, transparent)`,
                transition: "background-color .35s",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Light or dark, live. `useTheme` writes `<family>-<light|dark>` to `<html data-theme>` on
 * every pref change and every OS flip under Color mode "system" (the attribute the chips'
 * CSS reads), so this follows it. `data-mode` is pre-paint only and goes stale.
 */
const themeIsDark = () => !document.documentElement.getAttribute("data-theme")?.endsWith("-light");
function watchTheme(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

function Cell({ widget, item, colW, dark, onChipClick }: {
  widget: PageWidget;
  item: PageItem;
  colW: number;
  dark: boolean;
  onChipClick?: Props["onChipClick"];
}) {
  switch (widget.kind) {
    case "sports": {
      const g = item.data as Game;
      return <GameCell game={g} width={colW} mine={item.mine} onClick={() => onChipClick?.("sports", g.id, chipUrlForSports(g))} />;
    }
    case "news": {
      const r = item.data as RssItem;
      return <NewsCell item={r} width={colW} onClick={() => onChipClick?.("rss", r.id, chipUrlForRss(r))} />;
    }
    case "finance": {
      const t = item.data as Trade;
      return <QuoteCell trade={t} fill={item.fill} onClick={() => onChipClick?.("finance", t.symbol, chipUrlForFinance(t))} />;
    }
    case "also": {
      const a = item.data as AlsoItem;
      return <AlsoCell code={a.code} text={a.text} hex={a.hex} dark={dark} onClick={() => onChipClick?.(a.tab, a.tab)} />;
    }
  }
}

export default function PagedBar({
  dashboard,
  activeTabs,
  widgetData,
  pins = NO_PINS,
  onChipClick,
  onDisplayedWidgetsChange,
  empty,
  pageControls = true,
}: Props) {
  const leader = useMemo(() => isPrimaryTicker(), []);
  const label = useMemo(() => getCurrentWindow().label, []);
  const reduced = useOsReducedMotion();
  const dark = useSyncExternalStore(watchTheme, themeIsDark, () => true);

  // The edge takes at most 40% of the narrowest ticker's bar (SCROLLR-284):
  // every window publishes its bar and utilities strip, and the newest pins
  // that no longer fit step back onto their pages (they stay in prefs).
  const [utilW, setUtilW] = useState(0);
  useEdgeMeasures();
  const room = useEdgeRoom();
  const onEdge = useMemo(() => (room ? stepBack(pins, room) : pins), [pins, room]);

  // Live width for the NEXT page; the page on screen keeps the width it froze with.
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);

  // The whole market's quotes, only while a watchlist is shorter than a page
  // (its empty columns fill with popular symbols, SCROLLR-292).
  const quoteCols = columnsFor(contentWidth(width, 0), QUOTE_MIN_COL);
  const shortWatchlist = activeTabs.some((tab) => {
    if (sourceForWidget(tab) !== "finance") return false;
    const symbols = (dashboard?.widgets?.find((w) => w.widget_type === tab)?.config as { symbols?: unknown } | undefined)?.symbols;
    return !Array.isArray(symbols) || symbols.length < quoteCols;
  });
  const { data: market, isPending: marketPending } = useQuery({ ...financeMarketOptions(), enabled: shortWatchlist && !!dashboard });
  // The first page waits for the market (or its failure) so a one-symbol
  // watchlist never opens as one quote across the bar.
  const awaitingMarket = shortWatchlist && !!dashboard && marketPending;

  const widgets = useMemo(
    () => buildPageWidgets(dashboard, activeTabs, Date.now(), onEdge, shortWatchlist ? market : undefined),
    [dashboard, activeTabs, onEdge, market, shortWatchlist],
  );
  const edge = useMemo(() => buildEdge(widgetData, onEdge, dashboard, activeTabs), [widgetData, onEdge, dashboard, activeTabs]);
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  usePublishEdge(label, width, utilW);
  useEffect(() => {
    if (!bar) return;
    const read = () => {
      widthRef.current = bar.clientWidth;
      setWidth(bar.clientWidth);
    };
    const ro = new ResizeObserver(read);
    ro.observe(bar);
    read();
    return () => ro.disconnect();
  }, [bar]);

  // The edge zone's width, read when a page is planned (not via a
  // ResizeObserver: that fires after the effect that plans the first page,
  // which would then be planned against an edge with no pins yet).
  const edgeEl = useRef<HTMLDivElement>(null);
  const edgeW = () => edgeEl.current?.offsetWidth ?? 0;

  const [turn, setTurn] = useState<Turn | null>(null);
  const turnRef = useRef<Turn | null>(null);
  const [planWidth, setPlanWidth] = useState(0);
  const [planEdge, setPlanEdge] = useState(0);
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const nav = useRef(newNav());
  const localHover = useRef(false);
  const remoteHover = useRef(new Set<string>());

  const show = useCallback((t: Turn | null) => {
    turnRef.current = t;
    setPlanWidth(widthRef.current);
    setPlanEdge(edgeW());
    setTurn(t);
  }, []);

  const broadcast = useCallback(() => {
    const t = turnRef.current;
    if (t) emit(TURN_EVENT, { ...t, held: heldRef.current } satisfies TurnMsg).catch(() => {});
  }, []);

  // ── Leader: the page clock ──────────────────────────────────────
  const advance = useCallback(() => {
    const ws = widgetsRef.current;
    show(nextTurn(turnRef.current, ws, planAll(ws, widthRef.current, edgeW()), nav.current));
    broadcast();
  }, [show, broadcast]);

  /** A manual move on the leader: a new turn, so the clock below restarts the page's dwell. */
  const stepHere = useCallback((move: Move) => {
    const ws = widgetsRef.current;
    const t = stepTurn(turnRef.current, move, ws, planAll(ws, widthRef.current, edgeW()), nav.current);
    if (!t) return;
    show(t);
    broadcast();
  }, [show, broadcast]);

  useEffect(() => {
    // The ref, not the state: StrictMode runs this twice before the first
    // turn renders, and the second run must not skip page one.
    if (leader && !turnRef.current && widgets.length > 0 && width > 0 && !awaitingMarket) advance();
  }, [leader, turn, widgets.length, width, awaitingMarket, advance]);

  // The clock restarts only on a new turn, never on a data update, and
  // stands still while the page is held.
  useEffect(() => {
    if (!leader || !turn) return;
    let left = turn.dwell * 1000;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      if (!heldRef.current) left -= now - last;
      last = now;
      if (left > 0) return;
      window.clearInterval(id);
      advance();
    }, 100);
    return () => window.clearInterval(id);
  }, [leader, turn, advance]);

  const updateHold = useCallback(() => {
    const h = localHover.current || remoteHover.current.size > 0;
    if (h === heldRef.current) return;
    heldRef.current = h;
    setHeld(h);
    broadcast();
  }, [broadcast]);

  useTauriListener<{ label: string; on: boolean }>(HOVER_EVENT, (e) => {
    if (!leader || e.payload.label === label) return;
    if (e.payload.on) remoteHover.current.add(e.payload.label);
    else remoteHover.current.delete(e.payload.label);
    updateHold();
  });
  useTauriListener(HELLO_EVENT, () => {
    if (leader) broadcast();
  });
  useTauriListener<Move>(STEP_EVENT, (e) => {
    if (leader) stepHere(e.payload);
  });

  // ── Followers: take the leader's turns ─────────────────────────
  useTauriListener<TurnMsg>(TURN_EVENT, (e) => {
    if (leader) return;
    const { held: h, ...t } = e.payload;
    if (turnRef.current?.seq !== t.seq || turnRef.current.tab !== t.tab) show(t);
    heldRef.current = h;
    setHeld(h);
  });
  useEffect(() => {
    if (leader) return;
    // After the listeners above have registered.
    const id = window.setTimeout(() => emit(HELLO_EVENT, { label }).catch(() => {}), 300);
    return () => window.clearTimeout(id);
  }, [leader, label]);

  // Each window times its own pointer and reports only the transitions, so the
  // leader holds while ANY window's pointer is active and releases on the last idle.
  const hover = useActiveHover((on) => {
    if (leader) {
      localHover.current = on;
      updateHold();
    } else {
      emit(HOVER_EVENT, { label, on }).catch(() => {});
    }
  });

  // ── Manual paging (SCROLLR-298) ─────────────────────────────────
  const step = useCallback((move: Move) => {
    if (leader) stepHere(move);
    else emit(STEP_EVENT, move).catch(() => {});
  }, [leader, stepHere]);
  const stepRef = useRef(step);
  stepRef.current = step;
  const lastWheel = useRef(-Infinity);
  useEffect(() => {
    if (!bar) return;
    // Native and not passive (React's onWheel is): preventDefault keeps a
    // horizontal trackpad swipe from turning into the webview's back gesture.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      hover.move(); // paging is activity: the hold stays while you page
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const now = performance.now();
      const fresh = now - lastWheel.current >= WHEEL_QUIET_MS;
      lastWheel.current = now;
      // Shift jumps a whole widget (SCROLLR-301). Chromium hands a Shift+wheel over as deltaX, which the line above already reads.
      if (fresh && d !== 0) stepRef.current({ dir: d > 0 ? 1 : -1, whole: e.shiftKey });
    };
    bar.addEventListener("wheel", onWheel, { passive: false });
    return () => bar.removeEventListener("wheel", onWheel);
  }, [bar, hover]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // ←/→ turn this widget's page; ↓/↑ change the widget (SCROLLR-301, SCROLLR-303).
      if (e.key === "ArrowRight") stepRef.current({ dir: 1 });
      else if (e.key === "ArrowLeft") stepRef.current({ dir: -1 });
      else if (e.key === "ArrowDown") stepRef.current({ dir: 1, whole: true });
      else if (e.key === "ArrowUp") stepRef.current({ dir: -1, whole: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Presence: widgets that have pages ───────────────────────────
  const displayedKey = [...new Set([...widgets.filter((w) => w.tab !== ALSO_TAB).map((w) => w.tab), ...edgeTabs(edge)])].sort().join("\0");
  useEffect(() => {
    onDisplayedWidgetsChange?.(displayedKey === "" ? [] : displayedKey.split("\0"));
  }, [displayedKey, onDisplayedWidgetsChange]);

  // ── The frozen page ─────────────────────────────────────────────
  const plans = useMemo(() => planAll(widgets, planWidth, planEdge), [widgets, planWidth, planEdge]);
  const shown = useRef<Shown | null>(null);
  if (turn && shown.current?.seq !== turn.seq) {
    const w = widgets.find((x) => x.tab === turn.tab);
    const plan = plans.get(turn.tab);
    if (w && plan && plan.pages.length > 0) {
      const index = followPage(turn, plan.pages.length);
      const items = plan.pages[index];
      // Truly short (one page, fewer items than columns, nothing left to
      // fill with): a full page's column width, not one item across the bar.
      const short = plan.pages.length === 1 && items.length < plan.cols;
      shown.current = {
        seq: turn.seq,
        widget: w,
        page: freezePage(items, keyOf),
        index,
        count: plan.pages.length,
        colW: contentWidth(planWidth, planEdge) / (short ? plan.cols : items.length),
        short,
        cols: plan.cols,
        total: plan.pages.reduce((n, p) => n + p.length, 0),
        avail: plan.avail,
        back: turn.back === true,
      };
    }
  }
  const cur = shown.current;
  // Values move in; keys, order and width do not. An item that left the
  // pool keeps its last value until the page leaves.
  const live = cur ? widgets.find((x) => x.tab === cur.widget.tab) : undefined;
  if (cur && live) cur.page = refreshPage(cur.page, [...live.items, ...live.fill], keyOf);

  const accent = accentFor(cur?.widget.hex, dark);
  const ink = inkFor(cur?.widget.hex, dark);
  const items = cur ? pageItems(cur.page) : [];
  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: FADE_S, ease: "linear" as const } };
  // Right to left, except a manual step back, which slides the other way (SCROLLR-300).
  // `custom` on AnimatePresence reaches the page that is leaving, so it exits the same way.
  const swipe = {
    variants: {
      in: (back: boolean) => ({ x: back ? "-100%" : "100%" }),
      up: { x: "0%" },
      out: (back: boolean) => ({ x: back ? "100%" : "-100%" }),
    },
    initial: "in",
    animate: "up",
    exit: "out",
    transition: { duration: SWIPE_S, ease: EASE },
  };
  // Upward, except a move back, which wipes down (SCROLLR-301): the band reads `custom` like the page does.
  const wipe = {
    variants: {
      in: (back: boolean) => ({ y: back ? "-100%" : "100%" }),
      up: { y: "0%" },
      out: (back: boolean) => ({ y: back ? "100%" : "-100%" }),
    },
    initial: "in",
    animate: "up",
    exit: "out",
    transition: { duration: BAND_S, ease: EASE },
  };

  // A clock or a pin on the edge is something to show: the bar stays.
  if (empty && widgets.length === 0 && edge.utilities.length + edge.pins.length === 0) return <>{empty}</>;

  return (
    <div
      ref={setBar}
      data-pages=""
      data-motion-style={reduced ? "fade" : "swipe"}
      className="ticker-container group/bar relative flex h-16 w-full shrink-0 items-stretch overflow-hidden border-b border-edge/50 bg-base-150"
      onMouseEnter={hover.move}
      onMouseMove={hover.move}
      onMouseLeave={hover.leave}
    >
      {cur && (
        <>
          <Band cur={cur} live={live ?? cur.widget} widgets={widgets} turn={turn} held={held} dark={dark} keypad={pageControls} reduced={reduced} onMove={step} wipe={wipe} fade={fade} />

          {/* The page: equal columns, full width, swiped in whole. */}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <AnimatePresence initial={false} custom={cur.back}>
              <motion.div
                key={cur.seq}
                custom={cur.back}
                data-back={cur.back ? "" : undefined}
                data-page={`${cur.widget.tab}:${cur.index + 1}/${cur.count}`}
                data-visit={cur.seq}
                data-short={cur.short ? "" : undefined}
                data-cols={cur.cols}
                data-total={cur.total}
                data-avail={cur.avail}
                className="absolute inset-0 grid"
                style={{
                  ...accentStyle(accent, ink),
                  gridTemplateColumns: cur.short
                    ? `repeat(${items.length}, ${cur.colW}px)`
                    : `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))`,
                }}
                {...(reduced ? fade : swipe)}
              >
                {items.map((item, i) => (
                  <div key={item.key} className="relative min-w-0" data-widget={cur.widget.tab} data-pin-subject={item.pin} data-fill={item.fill ? "" : undefined}>
                    {i > 0 && <Rule />}
                    <Cell widget={cur.widget} item={item} colW={cur.colW} dark={dark} onChipClick={onChipClick} />
                  </div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      )}
      {/* The fixed edge: outside the page block, so it shows with no page at all. */}
      <EdgeZone edge={edge} tick={turn?.seq ?? 0} reduced={reduced} dark={dark} edgeRef={edgeEl} onUtilWidth={setUtilW} onChipClick={onChipClick} />
    </div>
  );
}
