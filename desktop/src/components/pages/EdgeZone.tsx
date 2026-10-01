/**
 * The fixed edge zone of the pages bar (SCROLLR-273, canvas board "8c · Edge
 * with several clocks", option A "Cycle", picked by Brandon 1 Oct 2026).
 *
 * The edge sits on the RIGHT of the bar (the canvas default; every pin is
 * stored with side "right" since REL-239) and holds, in this order:
 *  - one slot per utility on the ticker (clock, timer, weather, sysmon,
 *    uptime, GitHub). A slot shows ONE zone, city or metric at a time and
 *    steps to the next on each page turn (`tick` = the turn's seq, which
 *    every ticker window shares), so it changes only while the page swipes.
 *  - one cell per pinned subject (CHIP_SPEC §8.5), drawn with the page
 *    cells at its family's minimum column width. Pinned subjects leave the
 *    pages (`buildPageWidgets(…, pins)`), so each is on the bar once.
 *
 * Width never changes while the set of zones and cities stays the same: a
 * slot stacks an invisible sizer for EVERY item it can show (label, plus
 * the value with each digit widened, `reserveOf`), so it is as wide as its
 * widest item from the first frame, whichever item is up and whatever the
 * clock reads. With no utility and no pin the zone renders nothing and
 * takes no width.
 */
import { memo, useLayoutEffect, useRef, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { clsx } from "clsx";
import type {
  ClockChipData,
  DashboardResponse,
  Game,
  GitHubChipData,
  RssItem,
  SysmonChipData,
  Trade,
  UptimeChipData,
  WeatherChipData,
  WidgetTickerData,
} from "../../types";
import type { ChipColorMode, WidgetPin } from "../../preferences";
import { scopedRows, type TickerContext } from "../../datawidgets/ticker";
import { gamesForTeam } from "../../datawidgets/sports/view";
import { catalogItemById, sourceForWidget } from "../../marketplace";
import { leagueCode } from "../../utils/gameHelpers";
import { formatTemp } from "../../utils/format";
import { teamShortName } from "../../utils/teamShortName";
import { chipUrlForFinance, chipUrlForRss, chipUrlForSports } from "../../utils/chipUrl";
import GameCell, { gameMinCol } from "./cells/GameCell";
import NewsCell, { NEWS_PIN_W } from "./cells/NewsCell";
import QuoteCell, { QUOTE_MIN_COL } from "./cells/QuoteCell";
import { Rule, accentFor, accentStyle } from "./cells/parts";

const UTILITIES = ["clock", "timer", "weather", "sysmon", "uptime", "github"] as const;
type Utility = (typeof UTILITIES)[number];

type Tone = "live" | "down" | "error" | "warning" | undefined;

/** One thing a utility slot can show. */
export interface SlotItem {
  id: string;
  label: string;
  icon?: string;
  value: string;
  /** The value at its widest: what the slot reserves (`reserveOf`). */
  reserve: string;
  detail?: string;
  tone?: Tone;
  dim?: boolean;
}

export interface EdgeUtility {
  tab: Utility;
  hex?: string;
  items: SlotItem[];
}

export interface EdgePin {
  widget: string;
  hex?: string;
  kind: "sports" | "finance" | "news";
  data: Game | Trade | RssItem;
  /** The family's minimum column: fixed for the pin's life. */
  width: number;
  /** `data-pin-subject`, so a right-click offers "Unpin". */
  pin: string;
}

export interface Edge {
  utilities: EdgeUtility[];
  pins: EdgePin[];
}

/**
 * `value` at its widest: every digit becomes 0 (one `ch` under tabular
 * mono) and the first run of digits is padded to `digits`, so "7:21 PM"
 * reserves "00:00 PM" and "61°" reserves "000°".
 */
export function reserveOf(value: string, digits: number): string {
  return value.replace(/\d+/, (m) => m.padStart(digits, "0")).replace(/\d/g, "0");
}

const GH_GLYPH: Record<GitHubChipData["status"], string> = { success: "✓", failure: "✗", in_progress: "●", unavailable: "○" };

function slotOf(tab: Utility, raw: unknown): SlotItem {
  switch (tab) {
    case "clock": {
      const c = raw as ClockChipData;
      return { id: c.id, label: c.label, value: c.value, reserve: reserveOf(c.value, 2), detail: c.detail, dim: c.night };
    }
    case "timer": {
      const c = raw as ClockChipData;
      const urgent = !c.paused && c.remainingSec !== undefined && c.remainingSec <= 60;
      return { id: c.id, label: c.label, value: c.value, reserve: reserveOf(c.value, 3), detail: c.endsAt ? `ends ${c.endsAt}` : c.detail, dim: c.paused, tone: urgent ? "live" : undefined };
    }
    case "weather": {
      const w = raw as WeatherChipData;
      // low/high arrive in the provider's Celsius; `temp` is already in the
      // user's unit, and its suffix says which.
      const unit = w.temp.endsWith("F") ? "fahrenheit" : "celsius";
      const range = w.low != null && w.high != null ? `${formatTemp(w.low, unit)} / ${formatTemp(w.high, unit)}` : w.detail;
      return { id: w.id, label: w.label, icon: w.icon, value: w.temp, reserve: reserveOf(w.temp, 3), detail: w.alert ?? range, dim: w.night, tone: w.alert ? "warning" : undefined };
    }
    case "sysmon": {
      const s = raw as SysmonChipData;
      return { id: s.id, label: s.label, value: s.value, reserve: reserveOf(s.value, 3), detail: s.detail, tone: s.hot ? "error" : undefined };
    }
    case "uptime": {
      const u = raw as UptimeChipData;
      const down = u.status === "down";
      // A down monitor shows how long, not its percentage (the chip's rule).
      return { id: u.id, label: u.label, value: down ? u.outageFor ?? "DOWN" : u.uptime, reserve: "000.00%", detail: u.responseAvg ?? u.detail, tone: down ? "down" : undefined };
    }
    case "github": {
      const g = raw as GitHubChipData;
      const value = `${GH_GLYPH[g.status]} ${g.elapsed ?? ""}`.trim();
      return { id: g.id, label: g.label, value, reserve: reserveOf(value, 2), detail: g.failedStep ?? g.workflowName, tone: g.status === "failure" ? "down" : undefined };
    }
  }
}

/** What the edge holds: utilities on the ticker with data, then pins that resolve. */
export function buildEdge(
  widgetData: WidgetTickerData | undefined,
  pins: readonly WidgetPin[],
  dashboard: DashboardResponse | null,
  activeTabs: readonly string[],
): Edge {
  const utilities: EdgeUtility[] = [];
  for (const tab of UTILITIES) {
    const items = widgetData?.[tab] ?? [];
    if (activeTabs.includes(tab) && items.length) {
      utilities.push({ tab, hex: catalogItemById(tab)?.hex, items: items.map((i) => slotOf(tab, i)) });
    }
  }
  const out: EdgePin[] = [];
  for (const p of pins) {
    // A pinned utility is already on the edge; pins of widgets off the ticker do not show.
    if (!activeTabs.includes(p.widget) || (UTILITIES as readonly string[]).includes(p.widget)) continue;
    const source = sourceForWidget(p.widget);
    const raw = source ? dashboard?.data?.[source] : undefined;
    const ctx = { tab: p.widget, source, dashboard } as TickerContext;
    const hex = catalogItemById(p.widget)?.hex;
    const pin = (label: string) => JSON.stringify({ widget: p.widget, subject: p.subject, label });
    // No horizon: the pin IS the selection. Nothing to show renders nothing (§8.5).
    if (source === "sports") {
      const g = gamesForTeam(scopedRows<Game>(raw, ctx), p.subject)[0];
      if (g) out.push({ widget: p.widget, hex, kind: "sports", data: g, width: gameMinCol(leagueCode(g.league)), pin: pin(teamShortName(g.league, p.subject)) });
    } else if (source === "finance") {
      const t = scopedRows<Trade>(raw, ctx).find((r) => r.symbol === p.subject);
      if (t) out.push({ widget: p.widget, hex, kind: "finance", data: t, width: QUOTE_MIN_COL, pin: pin(t.symbol) });
    } else if (source === "rss") {
      const at = (r: RssItem) => Date.parse(r.published_at ?? r.created_at);
      const rows = scopedRows<RssItem>(raw, ctx).filter((r) => r.feed_url === p.subject);
      const n = rows.length ? rows.reduce((a, b) => (at(b) > at(a) ? b : a)) : undefined;
      if (n) out.push({ widget: p.widget, hex, kind: "news", data: n, width: NEWS_PIN_W, pin: pin(n.source_name) });
    }
  }
  return { utilities, pins: out };
}

/** The tabs the edge puts on screen, for the presence check-in. */
export function edgeTabs(edge: Edge): string[] {
  return [...edge.utilities.map((u) => u.tab), ...edge.pins.map((p) => p.widget)];
}

const EASE = [0.32, 0.72, 0, 1] as const;

function SlotFace({ it, sizer }: { it: SlotItem; sizer?: boolean }) {
  return (
    <span
      aria-hidden={sizer || undefined}
      className={clsx(
        "flex min-w-0 flex-col justify-center gap-[4px] px-3 text-left font-mono",
        sizer ? "invisible col-start-1 row-start-1 h-0 overflow-hidden" : "h-full",
        !sizer && it.dim && "opacity-70",
      )}
    >
      <span className="truncate whitespace-nowrap text-[9.5px] font-bold uppercase leading-none tracking-[0.08em] text-fg-3">
        {it.label}
        {!sizer && it.dim && it.id.startsWith("clock") ? " ☾" : ""}
      </span>
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        {it.icon && <span className="text-[12px] leading-none">{it.icon}</span>}
        <span
          className={clsx(
            "text-[16px] font-bold leading-none tabular-nums",
            it.tone === "live" ? "text-live" : it.tone === "down" ? "text-down" : it.tone === "error" ? "text-error" : it.tone === "warning" ? "text-warning" : "text-fg",
          )}
        >
          {sizer ? it.reserve : it.value}
        </span>
      </span>
      {!sizer && (
        <span className={clsx("w-0 min-w-full truncate whitespace-nowrap text-[9.5px] leading-none", it.tone === "warning" ? "font-bold uppercase text-warning" : "text-fg-4")}>
          {it.detail ?? ""}
        </span>
      )}
    </span>
  );
}

/** One utility: every item sized in, the one for this turn shown, rolled in with the swipe. */
const Slot = memo(function Slot({ u, tick, reduced, onClick }: { u: EdgeUtility; tick: number; reduced: boolean; onClick?: (id: string) => void }) {
  const it = u.items[((tick % u.items.length) + u.items.length) % u.items.length];
  const roll = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.4, ease: "linear" as const } }
    : { initial: { y: "100%" }, animate: { y: "0%" }, exit: { y: "-100%" }, transition: { duration: 0.45, ease: EASE } };
  return (
    <button type="button" onClick={() => onClick?.(it.id)} data-chip="" className="relative grid h-full max-w-[180px] shrink-0 overflow-hidden">
      {u.items.map((x) => (
        <SlotFace key={x.id} it={x} sizer />
      ))}
      <AnimatePresence initial={false}>
        <motion.span key={it.id} data-item={it.id} className="absolute inset-0" {...roll}>
          <SlotFace it={it} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
});

function PinCell({ p, onChipClick }: { p: EdgePin; onChipClick?: (widgetType: string, itemId: string | number, url?: string) => void }) {
  if (p.kind === "sports") {
    const g = p.data as Game;
    return <GameCell game={g} width={p.width} onClick={() => onChipClick?.("sports", g.id, chipUrlForSports(g))} />;
  }
  if (p.kind === "finance") {
    const t = p.data as Trade;
    return <QuoteCell trade={t} onClick={() => onChipClick?.("finance", t.symbol, chipUrlForFinance(t))} />;
  }
  const r = p.data as RssItem;
  return <NewsCell item={r} width={p.width} line onClick={() => onChipClick?.("rss", r.id, chipUrlForRss(r))} />;
}

export default function EdgeZone({ edge, tick, reduced, mode, dark, edgeRef, onUtilWidth, onChipClick }: {
  edge: Edge;
  /** The utilities' strip width (pins not in it), reported on every change; 0 when the edge is gone (SCROLLR-284). */
  onUtilWidth?: (w: number) => void;
  /** The page turn's seq: the slots step on it. */
  tick: number;
  reduced: boolean;
  mode: ChipColorMode;
  dark: boolean;
  edgeRef?: Ref<HTMLDivElement>;
  onChipClick?: (widgetType: string, itemId: string | number, url?: string) => void;
}) {
  const empty = edge.utilities.length === 0 && edge.pins.length === 0;
  const strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el || !onUtilWidth) return;
    const read = () => onUtilWidth(el.offsetWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      ro.disconnect();
      onUtilWidth(0);
    };
  }, [onUtilWidth, empty]);
  if (empty) return null;
  return (
    <div ref={edgeRef} data-edge="" className="relative ml-auto flex h-full shrink-0 border-l border-edge">
      <div ref={strip} data-edge-utils="" className="flex h-full">
        {edge.utilities.map((u, i) => (
          <div key={u.tab} className="relative flex h-full" data-widget={u.tab} style={accentStyle(accentFor(mode, u.hex, dark))}>
            {i > 0 && <Rule />}
            <Slot u={u} tick={tick} reduced={reduced} onClick={(id) => onChipClick?.(u.tab, id)} />
          </div>
        ))}
      </div>
      {edge.pins.map((p, i) => (
        <div
          key={p.pin}
          className="relative h-full shrink-0"
          data-widget={p.widget}
          data-pin-subject={p.pin}
          style={{ ...accentStyle(accentFor(mode, p.hex, dark)), width: p.width }}
        >
          {(i > 0 || edge.utilities.length > 0) && <Rule />}
          <PinCell p={p} onChipClick={onChipClick} />
          {/* The line on top marks it as yours (canvas "Pins"). */}
          <span aria-hidden data-part="pinned" className="pointer-events-none absolute left-0 right-0 top-0 h-[2px]" style={{ background: "var(--accent)" }} />
        </div>
      ))}
    </div>
  );
}
