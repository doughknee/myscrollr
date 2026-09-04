/**
 * The four cell utilities: clock, timer, weather, sysmon.
 *
 * Rebuilt on the chip language the data families took in v1.5.0 — a
 * content-sized grid with a named tab where the league tab goes, item
 * cells divided by hairlines, and detailed adding exactly one row
 * without moving anything above it. A clock chip and a game chip are
 * now the same shape.
 *
 * What each widget puts in that second row is NOT the same, and that is
 * the design rather than an inconsistency: it is whatever you would
 * otherwise open the app to find.
 *
 *   clock    the date and offset  — a zone can be on a different DAY,
 *                                   which compact cannot say at all
 *   timer    a draining bar       — the shape of the remaining time
 *   weather  today's range        — is 61° warm for here, or not
 *   sysmon   a real trend         — 82°C climbing reads differently
 *                                   from 82°C steady
 *
 * Weather is the one that also changed above the fold: its compact row
 * is label, icon and temperature only. The range bar used to sit beside
 * the temperature and made the widest cell on the rail out of the chip
 * with the least to say.
 *
 * Uptime and GitHub are not here — they render one chip per item, since
 * a single failing monitor has to be findable without reading. See
 * CappedChip.
 */
import { clsx } from "clsx";
import { Pin, PinOff } from "lucide-react";
import Tooltip from "../Tooltip";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipShellClasses } from "./chipColors";
import { Sparkline } from "./Sparkline";
import { recordMetric } from "./metricHistory";
import type {
  ClockChipData,
  SysmonChipData,
  WeatherChipData,
} from "../../types";

// ── Shared shell ────────────────────────────────────────────────

/** Rows, matching every other chip on the rail. */
const ROWS = {
  comfort: "grid-rows-[30px_20px]",
  compact: "grid-rows-[28px]",
} as const;

/**
 * The cap, in px. Utilities are the one family that can genuinely run
 * long — six timezones, four metrics — and past this the rail stops
 * being a rail. Same number the game and headline chips use.
 */
const CHIP_MAX_PX = 640;

function UtilityShell({
  type,
  tab,
  comfort,
  colorMode = "widget",
  pinned,
  onTogglePin,
  onClick,
  cols,
  extra,
  title,
  children,
}: {
  type: "clock" | "timer" | "weather" | "sysmon";
  /** The word in the tab: CLOCK, TIMER, WEATHER, SYSMON. */
  tab: string;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick?: () => void;
  /** Grid template for the item cells, tab column excluded. */
  cols: string;
  extra?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const c = getChipColors(colorMode, type);
  const PinIcon = pinned ? PinOff : Pin;
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ gridTemplateColumns: `max-content ${cols}` }}
      className={clsx(
        chipShellClasses(c, "font-mono whitespace-nowrap"),
        "grid max-w-[640px]",
        comfort ? ROWS.comfort : ROWS.compact,
        extra,
      )}
    >
      {onTogglePin && (
        <Tooltip content={pinned ? "Unpin widget" : "Pin widget"}>
          <span
            role="button"
            tabIndex={0}
            aria-label={pinned ? "Unpin widget" : "Pin widget"}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onTogglePin();
              }
            }}
            className={clsx(
              "absolute -right-1 -top-1 z-10 rounded-full border p-0.5 transition-opacity",
              "border-edge/50 bg-surface",
              pinned
                ? "opacity-80"
                : "opacity-0 focus:opacity-80 group-hover:opacity-80",
            )}
          >
            <PinIcon size={10} className={c.textDim} />
          </span>
        </Tooltip>
      )}
      {/* The tab: the widget's name, painted, spanning both rows. */}
      <span
        className={clsx(
          "col-start-1 row-span-full flex items-center border-r border-edge/40 px-[9px]",
          "text-[10px] font-bold tracking-[0.08em]",
          c.text,
        )}
      >
        {tab}
      </span>
      {children}
    </button>
  );
}

/** One item's top-row cell. Column is 1-based over the item cells. */
function Cell({
  col,
  first,
  dim,
  children,
}: {
  col: number;
  first: boolean;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{ gridColumn: col + 1 }}
      className={clsx(
        "row-start-1 flex min-w-0 items-center gap-1.5 px-2.5",
        !first && "border-l border-edge/40",
        dim && "opacity-55",
      )}
    >
      {children}
    </span>
  );
}

/** One item's detail-row cell. `bleed` drops the padding so a graphic
 *  can run the full width of the cell, divider to divider. */
function Meta({
  col,
  first,
  bleed,
  children,
}: {
  col: number;
  first: boolean;
  bleed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{ gridColumn: col + 1 }}
      className={clsx(
        "row-start-2 flex min-w-0 items-center",
        bleed ? "px-0" : "gap-1 px-2.5 text-[10px] leading-none text-fg-4",
        !first && "border-l border-edge/40",
      )}
    >
      {children}
    </span>
  );
}

const LABEL = "shrink-0 text-[10px] uppercase tracking-[0.06em] opacity-80";
const VALUE = "font-semibold tabular-nums text-[14px] leading-none";

/** Every item cell is max-content: the chip is sized by what it holds. */
function colsFor(n: number): string {
  return Array(n).fill("max-content").join(" ");
}

interface ChipProps<T> {
  items: T[];
  comfort?: boolean;
  colorMode?: ChipColorMode;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick?: () => void;
}

// ── Clock — the date is the detail ──────────────────────────────

export function ClockChip({
  items,
  comfort,
  colorMode,
  pinned,
  onTogglePin,
  onClick,
}: ChipProps<ClockChipData>) {
  const c = getChipColors(colorMode ?? "widget", "clock");
  if (items.length === 0) return null;

  return (
    <UtilityShell
      type="clock"
      tab="CLOCK"
      cols={colsFor(items.length)}
      comfort={comfort}
      colorMode={colorMode}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
    >
      {items.map((item, i) => (
        <Cell key={item.id} col={i + 1} first={i === 0} dim={item.night}>
          <span className={clsx(LABEL, c.textDim)}>{item.label}</span>
          <span className={clsx(VALUE, c.text)}>{item.value}</span>
          {/* A moon says "middle of the night there" faster than dimming. */}
          {item.night && (
            <span aria-label="night" className="text-[11px] leading-none">
              ☾
            </span>
          )}
        </Cell>
      ))}
      {comfort &&
        items.map((item, i) => (
          <Meta key={item.id} col={i + 1} first={i === 0}>
            <span className="truncate">
              {[item.detail, item.offset].filter(Boolean).join(" · ")}
            </span>
          </Meta>
        ))}
    </UtilityShell>
  );
}

// ── Timer — the bar drains ──────────────────────────────────────

/** Under a minute the timer stops being ambient and starts being urgent. */
const TIMER_URGENT_SEC = 60;

function isUrgent(item: ClockChipData): boolean {
  return (
    !item.paused &&
    item.remainingSec != null &&
    item.remainingSec <= TIMER_URGENT_SEC
  );
}

export function TimerChip({
  items,
  comfort,
  colorMode,
  pinned,
  onTogglePin,
  onClick,
}: ChipProps<ClockChipData>) {
  const c = getChipColors(colorMode ?? "widget", "timer");
  if (items.length === 0) return null;

  const anyUrgent = items.some(isUrgent);

  return (
    <UtilityShell
      type="timer"
      tab="TIMER"
      cols={colsFor(items.length)}
      comfort={comfort}
      colorMode={colorMode}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
      // The last minute borrows the live palette — the same red the rest
      // of the app uses for "happening now".
      extra={anyUrgent ? "border-live/40" : undefined}
    >
      {items.map((item, i) => (
        <Cell key={item.id} col={i + 1} first={i === 0} dim={item.paused}>
          <span className={clsx(LABEL, c.textDim)}>{item.label}</span>
          <span
            className={clsx(VALUE, isUrgent(item) ? "text-live" : c.text)}
          >
            {item.value}
          </span>
          {/* Paused does NOT pulse — motion would imply it still counts. */}
          {item.paused && (
            <span aria-label="paused" className="text-[11px] leading-none">
              ‖
            </span>
          )}
        </Cell>
      ))}
      {comfort &&
        items.map((item, i) => {
          const { remainingSec: rem, totalSec: total } = item;
          const drawable = rem != null && total != null && total > 0;
          return (
            <Meta key={item.id} col={i + 1} first={i === 0} bleed={drawable}>
              {drawable ? (
                <span className="h-[3px] w-full bg-fg-3/15">
                  <span
                    className={clsx(
                      "block h-full",
                      isUrgent(item) ? "bg-live" : "bg-widget-timer",
                    )}
                    style={{ width: `${Math.min(1, rem / total) * 100}%` }}
                  />
                </span>
              ) : (
                // A stopwatch counts UP with no target, so it has no
                // fraction to draw. Say what it is instead of inventing
                // a finish line.
                <span className="truncate px-2.5">{item.detail}</span>
              )}
            </Meta>
          );
        })}
    </UtilityShell>
  );
}

// ── Weather — the range moved down ──────────────────────────────

/** Hot enough to tint: an absolute ceiling, or within 2° of today's high. */
function isHot(item: WeatherChipData): boolean {
  if (item.tempValue == null) return false;
  if (item.tempValue >= 95) return true;
  return item.high != null && item.tempValue >= item.high - 2;
}

export function WeatherChip({
  items,
  comfort,
  colorMode,
  pinned,
  onTogglePin,
  onClick,
}: ChipProps<WeatherChipData>) {
  const c = getChipColors(colorMode ?? "widget", "weather");
  if (items.length === 0) return null;
  const anyAlert = items.some((i) => i.alert);

  return (
    <UtilityShell
      type="weather"
      tab="WEATHER"
      cols={colsFor(items.length)}
      comfort={comfort}
      colorMode={colorMode}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
      extra={anyAlert ? "border-warning/45" : undefined}
    >
      {items.map((item, i) => (
        <Cell key={item.id} col={i + 1} first={i === 0} dim={item.night}>
          <span className={clsx(LABEL, c.textDim)}>{item.label}</span>
          <span aria-hidden className="text-[13px] leading-none">
            {item.icon}
          </span>
          <span className={clsx(VALUE, isHot(item) ? "text-warning" : c.text)}>
            {item.temp}
          </span>
        </Cell>
      ))}
      {comfort &&
        items.map((item, i) => (
          <Meta key={item.id} col={i + 1} first={i === 0}>
            {/* An alert outranks a range: it takes the cell rather than
                sitting beside it, and stays under ITS city so you can
                see which one it belongs to. */}
            {item.alert ? (
              <span className="truncate font-bold uppercase tracking-wider text-warning">
                {item.alert}
              </span>
            ) : (
              <RangeBar item={item} />
            )}
          </Meta>
        ))}
    </UtilityShell>
  );
}

/**
 * Today's low → high with a dot at now. Answers "is this warm for
 * today", which a bare temperature cannot — 61° means different things
 * in different places and seasons.
 */
function RangeBar({ item }: { item: WeatherChipData }) {
  const { tempValue, high, low } = item;
  if (tempValue == null || high == null || low == null || high <= low) {
    return <span className="truncate">{item.detail}</span>;
  }
  const pct = Math.min(1, Math.max(0, (tempValue - low) / (high - low)));

  return (
    <>
      <span className="shrink-0 tabular-nums text-fg-4">
        {Math.round(low)}
      </span>
      <span
        className="relative h-[3px] min-w-[26px] flex-1 rounded-full"
        style={{
          // Cool → warm, so position carries meaning before either end
          // is read.
          background:
            "linear-gradient(to right, color-mix(in srgb, var(--color-widget-weather) 50%, transparent), color-mix(in srgb, var(--color-warning) 60%, transparent))",
        }}
      >
        <span
          className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg"
          style={{ left: `${pct * 100}%` }}
        />
      </span>
      <span className="shrink-0 tabular-nums text-fg-4">
        {Math.round(high)}
      </span>
    </>
  );
}

// ── Sysmon — the trend fills the cell ───────────────────────────

export function SysmonChip({
  items,
  comfort,
  colorMode,
  pinned,
  onTogglePin,
  onClick,
}: ChipProps<SysmonChipData>) {
  const c = getChipColors(colorMode ?? "widget", "sysmon");
  const anyHot = items.some((i) => i.hot);

  // Recorded on every render, comfort or not: the buffer has to be
  // filling while the user is in compact, or switching density would
  // show an empty graph. Hooks run before the early return below.
  const series = items.map((item) =>
    item.percent != null ? recordMetric(item.id, item.percent) : [],
  );
  if (items.length === 0) return null;

  return (
    <UtilityShell
      type="sysmon"
      tab="SYSMON"
      cols={colsFor(items.length)}
      comfort={comfort}
      colorMode={colorMode}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
      extra={anyHot ? "border-error/30" : undefined}
    >
      {items.map((item, i) => (
        <Cell key={item.id} col={i + 1} first={i === 0}>
          <span className={clsx(LABEL, c.textDim)}>{item.label}</span>
          <Gauge percent={item.percent} hot={item.hot} />
          {/* 5ch reserved: values flip digit counts ("5%" -> "100%",
              "47W" -> "450W") and a growing chip reflows the whole rail. */}
          <span
            className={clsx(
              VALUE,
              "inline-block min-w-[5ch] text-right",
              item.hot ? "text-error" : c.text,
            )}
          >
            {item.value}
          </span>
        </Cell>
      ))}
      {comfort &&
        items.map((item, i) => {
          const points = series[i];
          const drawable = points.length >= 2;
          return (
            <Meta key={item.id} col={i + 1} first={i === 0} bleed={drawable}>
              {drawable ? (
                <Sparkline
                  points={points}
                  height={18}
                  className={item.hot ? "text-error" : "text-widget-sysmon"}
                />
              ) : (
                // Under two readings there is no line to draw. Say what
                // the number is instead — a single dot would imply a
                // trend that does not exist.
                <span className="truncate px-2.5">{item.detail}</span>
              )}
            </Meta>
          );
        })}
    </UtilityShell>
  );
}

/** Vertical fill, 4×13px. Fixed width — see the note on the value cell. */
function Gauge({ percent, hot }: { percent?: number; hot?: boolean }) {
  // No reading means no gauge, but the space is still reserved so the
  // chip doesn't resize when one arrives.
  const pct =
    percent == null ? null : Math.min(100, Math.max(0, percent)) / 100;

  return (
    <span
      className="relative inline-block h-[13px] w-1 shrink-0 rounded-[1px] bg-fg-3/12"
      aria-hidden
    >
      {pct != null && (
        <span
          className={clsx(
            "absolute inset-x-0 bottom-0 rounded-[1px]",
            hot ? "bg-error" : "bg-widget-sysmon",
          )}
          style={{ height: `${pct * 100}%` }}
        />
      )}
    </span>
  );
}

export { CHIP_MAX_PX as UTILITY_CHIP_MAX_PX };
