import {
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { ChevronDown, Settings2 } from "lucide-react";
import { Ticker } from "motion-plus/react";
import type {
  DashboardResponse,
  Trade,
  Game,
  RssItem,
  WidgetTickerData,
  UptimeChipData,
  GitHubChipData,
  ClockChipData,
  WeatherChipData,
  SysmonChipData,
} from "../types";
import type {
  HoverBehavior,
  MixMode,
  ChipColorMode,
  WidgetPin,
  WidgetDisplayPrefs,
} from "../preferences";
import { GitHubCappedChip, UptimeCappedChip } from "./chips/CappedChip";
import {
  ClockChip,
  SysmonChip,
  TimerChip,
  WeatherChip,
} from "./chips/UtilityChips";
import { catalogItemById, sourceForWidget } from "../marketplace";
import { useCatalog } from "../hooks/useCatalog";
import { TICKER_SOURCES } from "../datawidgets/tickerRegistry";
import StatusChip from "./chips/StatusChip";
import { rotateSlots, type RotationMemo, type TickerContext, type TickerStatus } from "../datawidgets/ticker";
import { sourceTab } from "../utils/rssText";
import EmptyBar from "./EmptyBar";
import { advanceCycles, visibleSlots } from "./tickerRotation";
import { WIDGET_ORDER } from "../widgets/registry";

// ── Types ────────────────────────────────────────────────────────

interface ScrollrTickerProps {
  dashboard: DashboardResponse | null;
  activeTabs: string[];
  /** Pre-built widget chip data (clock, weather, sysmon). */
  widgetData?: WidgetTickerData;
  /** Click handler. The optional `url` argument is set when the
   * underlying chip has an external destination (article link, game
   * page, etc.). When undefined, the consumer should fall back to
   * opening the in-app widget page. */
  onChipClick?: (
    widgetType: string,
    itemId: string | number,
    url?: string,
  ) => void;
  /** The fixed zone, in order. Each entry pins one SUBJECT (REL-239);
   *  that subject's current chip is lifted out of the scrolling tape. */
  pins?: WidgetPin[];
  /** Scroll speed in px/sec (default 40) */
  speed?: number;
  /** Gap between chips in px (default 8) */
  gap?: number;
  /** Continuous: keep / slow to 30 % / stop under the mouse.
   *  Page: keep advancing, or hold the page (slow and pause alike). */
  onHover?: HoverBehavior;
  /** How items from different widgets are ordered */
  mixMode?: MixMode;
  /** Chip color scheme */
  chipColorMode?: ChipColorMode;
  /** Per-widget display preferences (controls what data chips show) */
  widgetDisplay?: WidgetDisplayPrefs;
  /**
   * When true, this row should render the "no sources installed yet"
   * empty-shell CTA instead of returning null. Only the parent
   * (App.tsx) knows whether the user is signed-in with zero widgets
   * vs. a ticker that legitimately has nothing to show right now, so
   * the decision is hoisted up there.
   */
  showSourcelessCTA?: boolean;
  /** Click handler for the sourceless CTA (opens the catalog). */
  onAddSources?: () => void;
  /**
   * When true, this row should render the "you have widgets installed
   * but none are currently on the ticker" CTA — a row of per-widget
   * quick-link chips that open each widget (ticker toggle lives in-widget). Mutually
   * exclusive with `showSourcelessCTA`; only one fires at a time.
   * Parent (App.tsx) gates this on first row + authenticated + has
   * installed widgets + no ticker-enabled widgets + no pinned widgets.
   */
  showInstalledOffCTA?: boolean;
  /**
   * Visual metadata for each installed widget, used to render the
   * per-widget quick-link chips. Empty when `showInstalledOffCTA` is
   * false; non-empty when true. Order should match the canonical
   * widget order from the registry.
   */
  installedWidgets?: Array<{
    id: string;
    name: string;
    hex: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }>;
  /** Click handler for the per-widget quick-link chips (opens Configure). */
  onOpenWidget?: (widgetId: string) => void;
  /**
   * Fires with the sorted catalog ids that currently put a chip on this
   * screen (tape or fixed zone) whenever that set changes. Feeds the
   * desktop presence reporter (SCROLLR-210); ids only, never contents.
   */
  onDisplayedWidgetsChange?: (widgetIds: string[]) => void;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Capped widgets (uptime, GitHub) render one chip per item instead of
 * one chip per widget — see CappedChip for why. Returns null for every
 * Total over WIDGET_ORDER — every widget type has a branch, which is
 * what let ConsolidatedChip and its fallbacks go.
 *
 * Subjects (REL-239): a single-chip utility IS its own subject, so the
 * widget id is the subject. A capped widget pins per monitor / per repo,
 * so the item id is. `pinnedSubject` asks for exactly one subject's chip
 * for the fixed zone; `pinnedSubjects` removes those from the tape so
 * nothing is on the bar twice.
 */
interface WidgetChip {
  key: string;
  node: React.ReactNode;
  rotateSlot?: string;
  subject: string;
  pinLabel: string;
}

function widgetChipsFor(
  wt: keyof WidgetTickerData,
  items: WidgetTickerData[keyof WidgetTickerData],
  opts: {
    chipColorMode?: ChipColorMode;
    onChipClick?: (type: string, id: string, url?: string) => void;
    /** Subjects of this widget that live in the fixed zone. */
    pinnedSubjects?: ReadonlySet<string>;
    /** Ask for ONE subject's chip (the fixed zone) instead of the tape. */
    pinnedSubject?: string;
    cycles?: Readonly<Record<string, number>>;
    rotationMemo?: RotationMemo;
  },
): WidgetChip[] {
  const { chipColorMode, onChipClick, pinnedSubjects, pinnedSubject, cycles, rotationMemo } = opts;
  const widgetLabel = catalogItemById(wt)?.name ?? wt;

  // The four cell/gauge/spine utilities each render as ONE chip holding
  // their items, unlike the capped pair which render one chip per item.
  // That split is the design's, not an accident: three clocks are one
  // glanceable group, three failing monitors are three separate alarms.
  //
  // One chip means one subject, which is why a pinned clock looks exactly
  // as it did before REL-239 -- the widget and the subject coincide.
  if (wt === "clock" || wt === "timer" || wt === "weather" || wt === "sysmon") {
    if (pinnedSubject !== undefined && pinnedSubject !== wt) return [];
    if (pinnedSubject === undefined && pinnedSubjects?.has(wt)) return [];
    const shared = {
      colorMode: chipColorMode,
      onClick: () => onChipClick?.(wt, wt),
    };
    const node =
      wt === "clock" ? <ClockChip items={items as ClockChipData[]} {...shared} />
      : wt === "timer" ? <TimerChip items={items as ClockChipData[]} {...shared} />
      : wt === "weather" ? <WeatherChip items={items as WeatherChipData[]} {...shared} />
      : <SysmonChip items={items as SysmonChipData[]} {...shared} />;
    return [{ key: `${wt}-chip`, node, subject: wt, pinLabel: widgetLabel }];
  }

  const capped = items as Array<UptimeChipData | GitHubChipData>;
  const render = (item: UptimeChipData | GitHubChipData) => {
    const shared = {
      colorMode: chipColorMode,
      onClick: () => onChipClick?.(wt, item.id),
    };
    return wt === "uptime" ? (
      <UptimeCappedChip item={item as UptimeChipData} {...shared} />
    ) : (
      <GitHubCappedChip item={item as GitHubChipData} {...shared} />
    );
  };

  // The fixed zone wants one monitor / one repo, whatever the rotation is
  // doing. Gone from the payload -> nothing rendered.
  if (pinnedSubject !== undefined) {
    const item = capped.find((it) => it.id === pinnedSubject);
    if (!item) return [];
    return [{ key: `pin-${wt}-${item.id}`, node: render(item), subject: item.id, pinLabel: item.label }];
  }

  // One chip per monitor or repo, rotating through a fixed number of
  // slots once there are more than that -- thirty monitors is still four
  // chips, and a failing one still comes round. Fixed-width chips, so the
  // slot needs no reservation.
  const pool = pinnedSubjects?.size
    ? capped.filter((it) => !pinnedSubjects.has(it.id))
    : capped;
  const slots = rotateSlots(
    pool,
    CAPPED_WIDGET_SLOTS,
    cycles ?? {},
    wt,
    (item) => item.id,
    () => undefined,
    rotationMemo,
  );
  return slots.map(({ key, item, rotateSlot }) => ({
    key,
    node: render(item),
    rotateSlot,
    subject: item.id,
    pinLabel: item.label,
  }));
}

/** Monitors or workflow runs on the rail at once. Not a setting. */
const CAPPED_WIDGET_SLOTS = 4;

/** Round-robin interleave across buckets:
 *  bucket0[0], bucket1[0], bucket2[0], bucket0[1], bucket1[1], ... */
/**
 * The status of a source with no `status()` of its own (finance today):
 * true, if unspecific. Sports and news say why and when (§8.7).
 */
function genericStatus(tab: string): TickerStatus {
  const text = "nothing to show right now";
  return { tab: sourceTab(catalogItemById(tab)?.name ?? tab), text, reserve: text };
}

/**
 * Sorted, deduplicated `data-widget` ids of the chips a screen renders.
 * A status chip (§8.7) does not count: the widget is on the bar, but it
 * is not showing anything, which is what presence measures.
 */
export function displayedWidgetTypes(nodes: React.ReactNode[]): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    const props = (node as React.ReactElement<{ "data-widget"?: string; "data-status"?: string }> | null)?.props;
    if (props?.["data-status"] !== undefined) continue;
    const id = props?.["data-widget"];
    if (typeof id === "string" && id !== "") ids.add(id);
  }
  return [...ids].sort();
}

function weave<T>(buckets: T[][]): T[] {
  if (buckets.length === 0) return [];
  const result: T[] = [];
  const maxLen = Math.max(...buckets.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) result.push(bucket[i]);
    }
  }
  return result;
}

// ── Component ────────────────────────────────────────────────────

export default function ScrollrTicker({
  dashboard,
  activeTabs,
  widgetData,
  onChipClick,
  pins = [],
  speed = 25,
  gap = 8,
  onHover = "slow",
  mixMode = "grouped",
  chipColorMode = "widget",
  widgetDisplay,
  showSourcelessCTA = false,
  onAddSources,
  showInstalledOffCTA = false,
  installedWidgets = [],
  onOpenWidget,
  onDisplayedWidgetsChange,
}: ScrollrTickerProps) {
  // Direction left the settings 2026-09-06 (REL-204): tickers go left.
  const effectiveDirection = "left" as const;
  const effectiveSpeed: number = speed;
  const effectiveMixMode: MixMode = mixMode;

  // Build chip arrays per widget, then combine based on mixMode.
  // The chip builder resolves each tab through sourceForWidget(); without
  // subscribing, a server-added widget renders with no source and is skipped.
  const catalogVersion = useCatalog();

  // Laps completed by each rotating slot, keyed by slot. Bumped by the
  // rotation effect below when a slot has fully left the viewport; read by
  // sources through ctx.cycles to decide what the slot shows this lap.
  const [cycles, setCycles] = useState<Readonly<Record<string, number>>>({});

  // One Map for the whole rail's rotation, so a slot's item is frozen
  // across renders until its own turn (above) advances -- a dashboard
  // refetch or a reorder between advances must not change what a slot
  // shows (CHIP_DESIGN.md rule 6). Keys are namespaced per source+tab+i
  // (§8.2), so sharing one Map across every source is safe. A ref, not
  // state: mutating it must never itself trigger a re-render.
  const rotationMemoRef = useRef<RotationMemo>(new Map());

  // Pinned subjects, grouped by the widget that owns them. Every source
  // gets its own set so it can drop them from its pool before rotating --
  // filtering the POOL, not the rendered chips, is what stops a slot from
  // resolving to a pinned item and rendering a hole (§8.5).
  const pinnedByWidget = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const p of pins) {
      const set = map.get(p.widget) ?? new Set<string>();
      set.add(p.subject);
      map.set(p.widget, set);
    }
    return map;
  }, [pins]);

  const chips = useMemo(() => {
    const wrap = (
      tab: string,
      key: string,
      chip: React.ReactNode,
      rotateSlot?: string,
      subject?: string,
      pinLabel?: string,
    ) => (
      <div
        key={key}
        className="py-1"
        data-chip=""
        data-widget={tab}
        data-rotate-slot={rotateSlot}
        // What a right-click resolves the chip under the cursor to
        // (App.tsx). One attribute, because the menu needs all three
        // parts together and a chip with no pinnable subject has none.
        data-pin-subject={
          subject === undefined
            ? undefined
            : JSON.stringify({ widget: tab, subject, label: pinLabel ?? subject })
        }
      >
        {chip}
      </div>
    );

    const buckets: React.ReactNode[][] = [];

    for (const tab of activeTabs) {
      const bucket: React.ReactNode[] = [];
      const pinnedSubjects = pinnedByWidget.get(tab);

      // ── Widget tabs: consolidated chips ─────────────────────────
      // Membership comes from the widget registry, not a second list
      // maintained by hand here.
      if (WIDGET_ORDER.includes(tab)) {
        const wt = tab as keyof WidgetTickerData;
        const items = widgetData?.[wt];
        if (items?.length) {
          // Capped widgets render ONE chip per item. Packing every
          // monitor into a single pipe-separated chip made a lone
          // failure impossible to pick out of the row, which is the
          // whole point of a status cap.
          const chipsForWidget = widgetChipsFor(wt, items, {
            chipColorMode,
            onChipClick,
            pinnedSubjects,
            cycles,
            rotationMemo: rotationMemoRef.current,
          });
          chipsForWidget.forEach(({ key, node, rotateSlot, subject, pinLabel }) =>
            bucket.push(wrap(tab, key, node, rotateSlot, subject, pinLabel)),
          );
          if (bucket.length > 0) buckets.push(bucket);
        }
        continue;
      }

      // ── Data-widget tabs ────────────────────────────────────────────
      // activeTabs holds widget ids (sports_nfl, finance_stocks, news_bbc),
      // but dashboard.data is keyed by the source (sports/finance/rss), so
      // resolve widget → source for the lookup. Each source owns its own chip
      // building (datawidgets/{source}/ticker.tsx); a source this client has
      // no renderer for contributes nothing rather than falling through.
      const source = sourceForWidget(tab);
      const effectiveSource = source ?? tab;
      const rawData = dashboard?.data?.[effectiveSource];

      const tickerSource = TICKER_SOURCES[effectiveSource];
      if (!tickerSource) continue;

      const ctx: TickerContext = {
        tab,
        source: effectiveSource,
        dashboard,
        chipColorMode,
        widgetDisplay,
        cycles,
        rotationMemo: rotationMemoRef.current,
        pinnedSubjects,
        onChipClick,
      };
      for (const chip of tickerSource.chips(rawData, ctx)) {
        bucket.push(
          wrap(tab, chip.key, chip.node, chip.rotateSlot, chip.subject, chip.pinLabel),
        );
      }

      // No silent empty widgets (SCROLLR-264, CHIP_SPEC §8.7): a widget
      // with nothing on the tape and nothing in the fixed zone gets ONE
      // status chip saying why. Only once the dashboard is in -- before
      // that nothing is known -- and never a pin or a rotating slot.
      if (bucket.length === 0 && dashboard && Array.isArray(rawData)) {
        const pinShows = [...(pinnedSubjects ?? [])].some(
          (subject) => !!tickerSource.pinnedChip?.(rawData, { ...ctx, pinnedSubject: subject }),
        );
        const status = pinShows
          ? null
          : tickerSource.status
            ? tickerSource.status(rawData, ctx)
            : genericStatus(tab);
        if (status) {
          bucket.push(
            <div key={`status-${tab}`} className="py-1" data-chip="" data-widget={tab} data-status="">
              <StatusChip
                tab={status.tab}
                text={status.text}
                reserve={status.reserve}
                onClick={() => onChipClick?.(tab, tab)}
              />
            </div>,
          );
        }
      }

      // Only push a bucket that actually has chips in it.
      if (bucket.length > 0) buckets.push(bucket);
      continue;
    }

    // Combine based on mix mode. Row filtering is handled upstream now,
    // so no round-robin distribution here.
    const allItems: React.ReactNode[] =
      effectiveMixMode === "mixed" ? weave(buckets) : buckets.flat();

    return allItems;
  }, [
    dashboard,
    activeTabs,
    widgetData,
    onChipClick,
    pinnedByWidget,
    effectiveMixMode,
    chipColorMode,
    widgetDisplay,
    catalogVersion,
    cycles,
  ]);

  // ── Shared refs ─────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Slot rotation: advance a slot once it has fully left the viewport ──
  //
  // motion-plus has no loop callback, so this polls. Four reads a second
  // of a handful of rects is nothing next to the marquee's own per-frame
  // transform, and the check is skipped entirely when no slot rotates.
  const wasVisibleRef = useRef<Set<string>>(new Set());
  const hasRotatingSlots = useMemo(
    () => chips.some((c) => (c as React.ReactElement<{ "data-rotate-slot"?: string }>).props?.["data-rotate-slot"]),
    [chips],
  );
  useEffect(() => {
    if (!hasRotatingSlots) return;
    const id = window.setInterval(() => {
      const container = containerRef.current;
      if (!container) return;
      const now = visibleSlots(container);
      setCycles((prev) => advanceCycles(prev, wasVisibleRef.current, now));
      wasVisibleRef.current = now;
    }, 250);
    return () => window.clearInterval(id);
  }, [hasRotatingSlots]);

  // ── Build the fixed zone ────────────────────────────────────────
  //
  // One pin, one subject, one chip. The zone shows that subject's CURRENT
  // chip -- a pinned team's live game becomes its final becomes its next
  // fixture, in place, without the pin ever pointing at a stale row.
  //
  // Three rules make it a pin rather than a slice of the tape:
  //   1. It never scrolls and never rotates (so no `cycles`, no memo).
  //   2. It bypasses the source's horizon: the user already said "this
  //      one", so a fixture nine days out still shows.
  //   3. Nothing to show renders NOTHING. An empty space is honest; a
  //      placeholder would be a fabricated value (§1.7).

  const pinnedLeft: React.ReactNode[] = [];
  const pinnedRight: React.ReactNode[] = [];

  for (const pin of pins) {
    if (!activeTabs.includes(pin.widget)) continue;
    const target = pin.side === "left" ? pinnedLeft : pinnedRight;
    const key = `pin-${pin.widget}-${pin.subject}`;
    // Same `data-chip` / `data-pin-subject` pair the tape carries, so a
    // right-click on a pinned chip resolves to the same subject and the
    // menu reads "Unpin" without the zone needing its own control.
    const park = (node: React.ReactNode, label: string) =>
      target.push(
        <div
          key={key}
          className="flex items-center"
          data-chip=""
          data-widget={pin.widget}
          data-pin-subject={JSON.stringify({
            widget: pin.widget,
            subject: pin.subject,
            label,
          })}
        >
          {node}
        </div>,
      );

    if (WIDGET_ORDER.includes(pin.widget)) {
      const wt = pin.widget as keyof WidgetTickerData;
      const items = widgetData?.[wt];
      if (!items?.length) continue;
      for (const { node, pinLabel } of widgetChipsFor(wt, items, {
        chipColorMode,
        onChipClick,
        pinnedSubject: pin.subject,
      })) {
        park(node, pinLabel);
      }
      continue;
    }

    const source = sourceForWidget(pin.widget) ?? pin.widget;
    const tickerSource = TICKER_SOURCES[source];
    const chip = tickerSource?.pinnedChip?.(dashboard?.data?.[source], {
      tab: pin.widget,
      source,
      dashboard,
      chipColorMode,
      widgetDisplay,
      pinnedSubject: pin.subject,
      onChipClick,
    });
    if (chip) park(chip.node, chip.pinLabel ?? pin.subject);
  }

  // ── Displayed widget types (presence reporting, SCROLLR-210) ──
  // The catalog ids that actually put a chip on this screen — tape or
  // fixed zone — not what is configured or ticker-enabled. A tab whose
  // source returned nothing is not displayed. Only the widget id leaves
  // this window; never a subject, symbol, or label.
  const displayedWidgets = displayedWidgetTypes([...chips, ...pinnedLeft, ...pinnedRight]);
  const displayedKey = displayedWidgets.join("\0");
  useEffect(() => {
    onDisplayedWidgetsChange?.(displayedKey === "" ? [] : displayedKey.split("\0"));
  }, [displayedKey, onDisplayedWidgetsChange]);

  // ── Render ────────────────────────────────────────────────────
  const hasPinnedLeft = pinnedLeft.length > 0;
  const hasPinnedRight = pinnedRight.length > 0;
  const hasScrollingChips = chips.length > 0;

  // Sourceless CTA: signed-in user has zero widgets installed and zero
  // pinned widgets, so there's literally nothing to put on the ticker.
  // Instead of returning `null` (which makes the ticker invisible and
  // the user wonder what they're supposed to do next), render an empty
  // bar with a single inline CTA that opens the catalog. The decision
  // of *when* to show this is hoisted to App.tsx — see `showSourcelessCTA`.
  const isSourceless =
    !hasScrollingChips &&
    !hasPinnedLeft &&
    !hasPinnedRight &&
    showSourcelessCTA;

  // Installed-but-ticker-off CTA: signed-in user has widgets installed
  // but none are currently flagged for the ticker (every widget's
  // `ticker_enabled` is false). Show a row of per-widget quick-link
  // chips so the user can jump straight to that widget's Configure
  // tab and flip the toggle. This is the "you have stuff, you just
  // turned it off" recovery state.
  const isInstalledButTickerOff =
    !hasScrollingChips &&
    !hasPinnedLeft &&
    !hasPinnedRight &&
    showInstalledOffCTA &&
    installedWidgets.length > 0;

  const containerClass = `ticker-container h-16 flex items-center bg-base-150 border-b border-edge/50 flex-shrink-0 relative w-full overflow-hidden`;

  if (isSourceless) return <EmptyBar kind="sourceless" onAddSources={onAddSources} />;
  if (isInstalledButTickerOff) {
    return <EmptyBar kind="installedOff" installedWidgets={installedWidgets} onOpenWidget={onOpenWidget} />;
  }

  // Nothing to show at all
  if (!hasScrollingChips && !hasPinnedLeft && !hasPinnedRight) return null;
  const accentLine = (
    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent z-10" />
  );

  const pinnedZone = (side: "left" | "right", items: React.ReactNode[]) =>
    items.length > 0 ? (
      <div
        className={clsx(
          "ticker-pinned-zone flex items-center shrink-0 h-full z-10 px-2 bg-base-150",
          side === "left" ? "border-r" : "border-l",
          "border-edge/30",
        )}
        style={{ gap }}
      >
        {items}
      </div>
    ) : null;

  // ── Continuous mode: motion-plus Ticker ───────────────────────
  const velocity =
    effectiveDirection === "left" ? effectiveSpeed : -effectiveSpeed;

  return (
    <div
      ref={containerRef}
      className={containerClass}
    >
      {accentLine}
      {pinnedZone("left", pinnedLeft)}
      <div className="ticker-scroll-wrapper">
        <Ticker
          items={chips}
          velocity={velocity}
          hoverFactor={HOVER_FACTOR[onHover]}
          gap={gap}
          fade={hasPinnedLeft || hasPinnedRight ? 20 : 40}
        />
      </div>
      {pinnedZone("right", pinnedRight)}
    </div>
  );
}

// ── Helpers (module-level) ───────────────────────────────────────

/** Continuous-mode speed multiplier under the mouse; 0 stops the marquee. */
const HOVER_FACTOR: Record<HoverBehavior, number> = { keep: 1, slow: 0.3, pause: 0 };
