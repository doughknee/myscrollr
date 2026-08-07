/**
 * The four utility chips that used to share ConsolidatedChip.
 *
 * They shared it when every one of them was "label + value, repeated".
 * The redesign gives each a different shape — clock has cells, timer has
 * a spine, weather has a range bar, sysmon has gauges — so one component
 * branching five ways would be worse than four small ones. The pieces
 * they still genuinely share (the pin affordance, the chip shell) live
 * in UtilityShell below; the pieces they don't, don't.
 *
 * Uptime and GitHub left earlier for the same reason — see CappedChip.
 */
import { clsx } from "clsx";
import { Pin, PinOff } from "lucide-react";
import Tooltip from "../Tooltip";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipBaseClasses } from "./chipColors";
import { ChipCell } from "./ChipCell";
import { ChipSpine } from "./ChipSpine";
import type {
  ClockChipData,
  SysmonChipData,
  WeatherChipData,
} from "../../types";

// ── Shared shell ────────────────────────────────────────────────

function UtilityShell({
  type,
  comfort,
  colorMode = "widget",
  pinned,
  onTogglePin,
  onClick,
  extra,
  children,
}: {
  type: "clock" | "timer" | "weather" | "sysmon";
  comfort?: boolean;
  colorMode?: ChipColorMode;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick?: () => void;
  extra?: string;
  children: React.ReactNode;
}) {
  const c = getChipColors(colorMode, type);
  const PinIcon = pinned ? PinOff : Pin;
  return (
    <button
      onClick={onClick}
      className={clsx(
        chipBaseClasses(comfort, c, "relative font-mono whitespace-nowrap"),
        // Cells own their own padding so the dividers reach the chip edge.
        "!px-0",
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
      {children}
    </button>
  );
}

interface ChipProps<T> {
  items: T[];
  comfort?: boolean;
  colorMode?: ChipColorMode;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick?: () => void;
}

// ── Clock — zone segments ───────────────────────────────────────

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
      comfort={comfort}
      colorMode={colorMode}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
    >
      <span className="flex items-stretch">
        {items.map((item, i) => (
          <ChipCell
            key={item.id}
            label={item.label}
            labelClass={c.textDim}
            dim={item.night}
            divided={i > 0}
            comfort={comfort}
            meta={item.detail ?? item.offset}
          >
            <span className={clsx("font-semibold tabular-nums", c.text)}>
              {item.value}
            </span>
            {/* A moon says "it's the middle of the night there" faster
                than any amount of dimming does. */}
            {item.night && (
              <span aria-label="night" className="text-ui-chip">
                ☾
              </span>
            )}
          </ChipCell>
        ))}
      </span>
    </UtilityShell>
  );
}

// ── Timer — depleting spine ─────────────────────────────────────

/** Under a minute the timer stops being ambient and starts being urgent. */
const TIMER_URGENT_SEC = 60;

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

  // One timer at a time is the real case; if several run, the most
  // urgent owns the chip's tone.
  const lead = items.reduce((best, item) =>
    (item.remainingSec ?? Infinity) < (best.remainingSec ?? Infinity)
      ? item
      : best,
  );
  const remaining = lead.remainingSec;
  const total = lead.totalSec;
  const urgent =
    !lead.paused && remaining != null && remaining <= TIMER_URGENT_SEC;

  return (
    <UtilityShell
      type="timer"
      comfort={comfort}
      colorMode={colorMode}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
      // The last minute borrows the live palette — the same red the rest
      // of the app uses for "happening now".
      extra={urgent ? "border-live/40" : undefined}
    >
      <span className="flex items-stretch">
        {items.map((item, i) => {
          const itemUrgent =
            !item.paused &&
            item.remainingSec != null &&
            item.remainingSec <= TIMER_URGENT_SEC;
          return (
            <ChipCell
              key={item.id}
              label={item.label}
              labelClass={c.textDim}
              // Paused reads as dim and, crucially, does NOT pulse —
              // motion would imply it's still counting.
              dim={item.paused}
              divided={i > 0}
              comfort={comfort}
              meta={
                item.totalSec != null || item.endsAt
                  ? [
                      item.totalSec != null &&
                        `of ${formatClock(item.totalSec)}`,
                      item.endsAt && `ends ${item.endsAt}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : item.detail
              }
            >
              <span
                className={clsx(
                  "font-semibold tabular-nums",
                  itemUrgent ? "text-live" : c.text,
                )}
              >
                {item.value}
              </span>
              {item.paused && (
                <span aria-label="paused" className="text-ui-chip">
                  ‖
                </span>
              )}
            </ChipCell>
          );
        })}
      </span>
      {/* Spine drains as the timer does. Absent without a total — a bar
          with nothing to measure against would be decoration. */}
      {remaining != null && total != null && total > 0 && (
        <ChipSpine
          fill={remaining / total}
          state={lead.paused ? "pre" : "live"}
          tone={urgent ? "down" : "accent"}
        />
      )}
    </UtilityShell>
  );
}

function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Weather — day range ─────────────────────────────────────────

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
      comfort={comfort}
      colorMode={colorMode}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
      extra={anyAlert ? "border-warning/45" : undefined}
    >
      <span className="flex items-stretch">
        {items.map((item, i) => (
          <ChipCell
            key={item.id}
            label={item.label}
            labelClass={c.textDim}
            dim={item.night}
            divided={i > 0}
            comfort={comfort}
            meta={item.detail}
          >
            <span aria-hidden className="text-[13px] leading-none">
              {item.icon}
            </span>
            <span
              className={clsx(
                "font-semibold tabular-nums",
                isHot(item) ? "text-warning" : c.text,
              )}
            >
              {item.temp}
            </span>
            {/* An active alert outranks a temperature range, so it takes
                the slot rather than sitting beside it. */}
            {item.alert ? (
              <span className="font-bold uppercase tracking-wider text-ui-chip text-warning">
                {item.alert}
              </span>
            ) : (
              <RangeBar item={item} comfort={comfort} />
            )}
          </ChipCell>
        ))}
      </span>
    </UtilityShell>
  );
}

/** Hot enough to tint: an absolute ceiling, or within 2° of today's high. */
function isHot(item: WeatherChipData): boolean {
  if (item.tempValue == null) return false;
  if (item.tempValue >= 95) return true;
  return item.high != null && item.tempValue >= item.high - 2;
}

/**
 * Today's low → high with a dot at now. Answers "is this warm for
 * today" — which a bare temperature can't, because 61° means different
 * things in different places and seasons.
 */
function RangeBar({
  item,
  comfort,
}: {
  item: WeatherChipData;
  comfort?: boolean;
}) {
  const { tempValue, high, low } = item;
  if (tempValue == null || high == null || low == null || high <= low) {
    return null;
  }
  const pct = Math.min(1, Math.max(0, (tempValue - low) / (high - low)));
  const width = comfort ? 48 : 36;

  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="font-mono text-[10px] text-fg-4">{Math.round(low)}</span>
      <span
        className="relative h-[3px] rounded-full"
        style={{
          width,
          // Cool → warm, so position on the bar carries meaning even
          // before you read either end.
          background:
            "linear-gradient(to right, color-mix(in srgb, var(--color-widget-weather) 50%, transparent), color-mix(in srgb, var(--color-warning) 60%, transparent))",
        }}
      >
        <span
          className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg"
          style={{ left: `${pct * 100}%` }}
        />
      </span>
      <span className="font-mono text-[10px] text-fg-4">
        {Math.round(high)}
      </span>
    </span>
  );
}

// ── Sysmon — micro gauges ───────────────────────────────────────

export function SysmonChip({
  items,
  comfort,
  colorMode,
  pinned,
  onTogglePin,
  onClick,
}: ChipProps<SysmonChipData>) {
  const c = getChipColors(colorMode ?? "widget", "sysmon");
  if (items.length === 0) return null;
  const anyHot = items.some((i) => i.hot);

  return (
    <UtilityShell
      type="sysmon"
      comfort={comfort}
      colorMode={colorMode}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
      extra={anyHot ? "border-error/30" : undefined}
    >
      <span className="flex items-stretch">
        {items.map((item, i) => (
          <ChipCell
            key={item.id}
            label={item.label}
            labelClass={c.textDim}
            divided={i > 0}
            comfort={comfort}
            meta={item.detail}
          >
            <Gauge percent={item.percent} hot={item.hot} comfort={comfort} />
            {/* 5ch reserved cell, unchanged from the old chip: values
                flip between digit counts ("5%" -> "100%", "47W" ->
                "450W") and a growing chip reflows the whole rail. The
                gauge is fixed-width for the same reason. */}
            <span
              className={clsx(
                "inline-block min-w-[5ch] text-right tabular-nums",
                item.hot ? "text-error" : c.text,
              )}
            >
              {item.value}
            </span>
          </ChipCell>
        ))}
      </span>
    </UtilityShell>
  );
}

/** Vertical fill, 4×12px (13 comfort). Fixed width — see the note above. */
function Gauge({
  percent,
  hot,
  comfort,
}: {
  percent?: number;
  hot?: boolean;
  comfort?: boolean;
}) {
  const h = comfort ? 13 : 12;
  // No reading means no gauge, but the space is still reserved so the
  // chip doesn't resize when one arrives.
  const pct =
    percent == null ? null : Math.min(100, Math.max(0, percent)) / 100;

  return (
    <span
      className="relative inline-block w-1 shrink-0 rounded-[1px] bg-fg-3/12"
      style={{ height: h }}
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
