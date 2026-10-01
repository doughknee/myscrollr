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
 *  - The label names the widget in its colour and wipes upward only when
 *    the widget changes. The line under it fills over the page's dwell.
 *  - An ACTIVE pointer holds the page (and the line): over the bar and
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
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, animate, motion, type AnimationPlaybackControls } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DashboardResponse, Game, RssItem, Trade, WidgetTickerData } from "../../types";
import type { WidgetPin } from "../../preferences";
import { financeMarketOptions } from "../../api/queries";
import { sourceForWidget } from "../../marketplace";
import { isPrimaryTicker } from "../../lib/windowRole";
import { useEdgeMeasures, useEdgeRoom, usePublishEdge } from "../../lib/edgeMeasure";
import { useTauriListener } from "../../hooks/useTauriListener";
import { chipUrlForFinance, chipUrlForRss, chipUrlForSports } from "../../utils/chipUrl";
import { LABEL_W, columnsFor, contentWidth, freezePage, pageItems, refreshPage, type FrozenPage } from "./pagePlan";
import {
  ALSO_TAB,
  buildPageWidgets,
  followPage,
  labelFact,
  newNav,
  nextTurn,
  planAll,
  type AlsoItem,
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
/** The label's upward wipe when the widget changes. */
const LABEL_S = 0.45;
/** Reduced motion: a crossfade instead of either. */
const FADE_S = 0.4;
const EASE = [0.32, 0.72, 0, 1] as const;

/** Leader → every window: the page now up, and whether it is held. */
const TURN_EVENT = "pages:turn";
/** Follower → leader: the mouse entered or left my bar. */
const HOVER_EVENT = "pages:hover";
/** Follower → leader: I just started; tell me the page now up. */
const HELLO_EVENT = "pages:hello";

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
}

/** The page as it was frozen at swipe-in. */
interface Shown {
  seq: number;
  visit: number;
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

/** How long this page has left: a 2px line that fills, and stops while the page is held. */
function DwellLine({ seq, dwell, held, accent }: { seq: number; dwell: number; held: boolean; accent: string }) {
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
  return (
    <span
      ref={ref}
      aria-hidden
      data-dwell=""
      className="absolute bottom-0 left-0 z-10 h-[2px] w-full origin-left"
      style={{ ...accentStyle(accent), background: "var(--accent)", transform: "scaleX(0)" }}
    />
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
      return <QuoteCell trade={t} onClick={() => onChipClick?.("finance", t.symbol, chipUrlForFinance(t))} />;
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
  const quoteCols = columnsFor(contentWidth(width), QUOTE_MIN_COL);
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
        visit: turn.visit,
        widget: w,
        page: freezePage(items, keyOf),
        index,
        count: plan.pages.length,
        colW: contentWidth(planWidth, planEdge) / (short ? plan.cols : items.length),
        short,
        cols: plan.cols,
        total: plan.pages.reduce((n, p) => n + p.length, 0),
        avail: plan.avail,
      };
    }
  }
  const cur = shown.current;
  // Values move in; keys, order and width do not. An item that left the
  // pool keeps its last value until the page leaves.
  const live = cur ? widgets.find((x) => x.tab === cur.widget.tab) : undefined;
  if (cur && live) cur.page = refreshPage(cur.page, [...live.items, ...live.fill], keyOf);
  const fact = cur ? labelFact(live ?? cur.widget, plans.get(cur.widget.tab)) : "";

  const accent = accentFor(cur?.widget.hex, dark);
  const ink = inkFor(cur?.widget.hex, dark);
  const items = cur ? pageItems(cur.page) : [];
  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: FADE_S, ease: "linear" as const } };
  const swipe = { initial: { x: "100%" }, animate: { x: "0%" }, exit: { x: "-100%" }, transition: { duration: SWIPE_S, ease: EASE } };
  const wipe = { initial: { y: "100%" }, animate: { y: "0%" }, exit: { y: "-100%" }, transition: { duration: LABEL_S, ease: EASE } };

  // A clock or a pin on the edge is something to show: the bar stays.
  if (empty && widgets.length === 0 && edge.utilities.length + edge.pins.length === 0) return <>{empty}</>;

  return (
    <div
      ref={setBar}
      data-pages=""
      data-motion-style={reduced ? "fade" : "swipe"}
      className="ticker-container relative flex h-16 w-full shrink-0 items-stretch overflow-hidden border-b border-edge/50 bg-base-150"
      onMouseEnter={hover.move}
      onMouseMove={hover.move}
      onMouseLeave={hover.leave}
    >
      {cur && (
        <>
          {/* The label: the widget's name in its colour. Pages of the same
              widget keep it; a new widget wipes it upward. */}
          <div className="relative shrink-0 overflow-hidden" style={{ width: LABEL_W }}>
            <AnimatePresence initial={false}>
              <motion.div
                key={cur.widget.tab}
                data-label={cur.widget.tab}
                className="absolute inset-0 flex flex-col justify-center gap-[3px] pl-3.5 pr-2"
                style={{ ...accentStyle(accent, ink), background: mix(dark ? 16 : 12), borderRight: `1px solid ${mix(40)}` }}
                {...(reduced ? fade : wipe)}
              >
                <span
                  className={
                    cur.widget.code.length > 6
                      ? "truncate font-sans text-[15px] font-extrabold leading-none tracking-[0.04em]"
                      : "truncate font-sans text-[19px] font-extrabold leading-none tracking-[0.04em]"
                  }
                  style={{ color: "var(--accent-ink)" }}
                >
                  {cur.widget.code}
                </span>
                {/* fg-2, not fg-3: it sits on the label's tint, which costs contrast (SCROLLR-287). */}
                <span className="flex items-center justify-between gap-[3px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-2">
                  <span data-fact="" className="truncate">{fact}</span>
                  {/* Where this page sits in the widget, "2/6": there is more, and it comes round (SCROLLR-293). */}
                  {cur.count > 1 && (
                    <span data-pos="" className="shrink-0 tabular-nums tracking-normal" style={{ color: "var(--accent-ink)" }} aria-label={`page ${cur.index + 1} of ${cur.count}`}>
                      {cur.index + 1}/{cur.count}
                    </span>
                  )}
                </span>
              </motion.div>
            </AnimatePresence>
            {turn && <DwellLine seq={turn.seq} dwell={turn.dwell} held={held} accent={accent} />}
          </div>

          {/* The page: equal columns, full width, swiped in whole. */}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <AnimatePresence initial={false}>
              <motion.div
                key={cur.seq}
                data-page={`${cur.widget.tab}:${cur.index + 1}/${cur.count}`}
                data-visit={cur.visit}
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
