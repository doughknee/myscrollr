import { clsx } from "clsx";
import type { ChipColorMode } from "../../preferences";

// ── Color class sets ────────────────────────────────────────────
// Each set maps to the Tailwind classes a chip uses for bg, border,
// hover, and text at various opacities.

export interface ChipColors {
  bg: string;
  border: string;
  hoverBorder: string;
  text: string;
  textDim: string;
  textFaint: string;
}

const PRIMARY: ChipColors = {
  bg: "bg-primary/[0.06]",
  border: "border-primary/25",
  hoverBorder: "hover:border-primary/40",
  text: "text-primary",
  textDim: "text-primary/70",
  textFaint: "text-primary/55",
};

const SECONDARY: ChipColors = {
  bg: "bg-secondary/[0.06]",
  border: "border-secondary/25",
  hoverBorder: "hover:border-secondary/40",
  text: "text-secondary",
  textDim: "text-secondary/70",
  textFaint: "text-secondary/55",
};

const INFO: ChipColors = {
  bg: "bg-info/[0.06]",
  border: "border-info/25",
  hoverBorder: "hover:border-info/40",
  text: "text-info",
  textDim: "text-info/70",
  textFaint: "text-info/55",
};

const PURPLE: ChipColors = {
  bg: "bg-accent-purple/[0.06]",
  border: "border-accent-purple/25",
  hoverBorder: "hover:border-accent-purple/40",
  text: "text-accent-purple",
  textDim: "text-accent-purple/70",
  textFaint: "text-accent-purple/55",
};

const MUTED: ChipColors = {
  bg: "bg-fg-3/[0.04]",
  border: "border-edge",
  hoverBorder: "hover:border-fg-3/30",
  text: "text-fg-2",
  textDim: "text-fg-3",
  textFaint: "text-fg-3",
};

const PREDICTIONS: ChipColors = {
  bg: "bg-predictions/[0.06]",
  border: "border-predictions/25",
  hoverBorder: "hover:border-predictions/40",
  text: "text-predictions",
  textDim: "text-predictions/70",
  textFaint: "text-predictions/55",
};

// ── Widget color palettes ───────────────────────────────────────

const WIDGET_CLOCK: ChipColors = {
  bg: "bg-widget-clock/[0.06]",
  border: "border-widget-clock/25",
  hoverBorder: "hover:border-widget-clock/40",
  text: "text-widget-clock",
  textDim: "text-widget-clock/70",
  textFaint: "text-widget-clock/55",
};

const WIDGET_TIMER: ChipColors = {
  bg: "bg-widget-timer/[0.06]",
  border: "border-widget-timer/25",
  hoverBorder: "hover:border-widget-timer/40",
  text: "text-widget-timer",
  textDim: "text-widget-timer/70",
  textFaint: "text-widget-timer/55",
};

const WIDGET_WEATHER: ChipColors = {
  bg: "bg-widget-weather/[0.06]",
  border: "border-widget-weather/25",
  hoverBorder: "hover:border-widget-weather/40",
  text: "text-widget-weather",
  textDim: "text-widget-weather/70",
  textFaint: "text-widget-weather/55",
};

const WIDGET_SYSMON: ChipColors = {
  bg: "bg-widget-sysmon/[0.06]",
  border: "border-widget-sysmon/25",
  hoverBorder: "hover:border-widget-sysmon/40",
  text: "text-widget-sysmon",
  textDim: "text-widget-sysmon/70",
  textFaint: "text-widget-sysmon/55",
};

const WIDGET_UPTIME: ChipColors = {
  bg: "bg-widget-uptime/[0.06]",
  border: "border-widget-uptime/25",
  hoverBorder: "hover:border-widget-uptime/40",
  text: "text-widget-uptime",
  textDim: "text-widget-uptime/70",
  textFaint: "text-widget-uptime/55",
};

const WIDGET_GITHUB: ChipColors = {
  bg: "bg-widget-github/[0.06]",
  border: "border-widget-github/25",
  hoverBorder: "hover:border-widget-github/40",
  text: "text-widget-github",
  textDim: "text-widget-github/70",
  textFaint: "text-widget-github/55",
};

// ── Widget id → color mapping (data + utility alike) ────────────

const WIDGET_MAP: Record<string, ChipColors> = {
  finance: PRIMARY,
  sports: SECONDARY,
  rss: INFO,
  fantasy: PURPLE,
  // Predictions brand teal (#1fc9a0, v1.1.5) — its own static token so the
  // ticker chip matches the catalog card and the widget accent everywhere.
  predictions: PREDICTIONS,
  clock: WIDGET_CLOCK,
  timer: WIDGET_TIMER,
  weather: WIDGET_WEATHER,
  sysmon: WIDGET_SYSMON,
  uptime: WIDGET_UPTIME,
  github: WIDGET_GITHUB,
};

// ── Resolver ────────────────────────────────────────────────────

export function getChipColors(mode: ChipColorMode, widget: string): ChipColors {
  if (mode === "accent") return PRIMARY;
  if (mode === "muted") return MUTED;
  return WIDGET_MAP[widget] ?? PURPLE;
}

// ── Stable numeric width ────────────────────────────────────────

/**
 * Reserve a fixed width for a number that changes while on screen.
 *
 * A score going 8.3 -> 14.9 gains a character, which widens its chip,
 * which shifts every chip after it on the rail. The number is the one
 * thing on a ticker guaranteed to change, so it is also the one thing
 * that must not resize.
 *
 * `ch` is exact here rather than approximate: chips render in
 * `font-mono` with `tabular-nums`, so one `ch` is one digit and the
 * reservation is the real rendered width.
 *
 * Right-aligned, because a number that grows leftward from a fixed
 * decimal point reads as counting, while one that grows rightward reads
 * as drifting.
 */
export function stableNum(chars: number): React.CSSProperties {
  return {
    display: "inline-block",
    minWidth: `${chars}ch`,
    textAlign: "right",
  };
}

/**
 * Digits to reserve, by what the number is.
 *
 * Sized to the realistic ceiling rather than the theoretical one — a
 * team that breaks 1000 points has bigger problems than a reflow, and
 * padding every score for a case that never happens leaves a visible
 * gap on every chip that does.
 */
export const NUM_WIDTH = {
  /** Team score: "151.8", up to "999.9". */
  teamScore: 5,
  /** One player's points: "14.9", up to "99.9". Negative D/ST fits too. */
  playerPoints: 4,
  /** Win probability: "65%" up to "100%". */
  percent: 4,
} as const;

// ── Shared chip base classes ────────────────────────────────────
// Common className construction used by all ticker chip components.

/**
 * The part of a chip every chip shares -- colours, border, hover, the
 * overflow/positioning contract -- and nothing about its size or layout.
 *
 * chipBaseClasses adds the fixed 264px box and a flex layout on top. The
 * sports chip is content-sized and lays itself out as a grid, so it takes
 * only this and owns the rest; it still hovers, clips and colours like
 * every other chip on the rail.
 */
export function chipShellClasses(colors: ChipColors, extra?: string): string {
  return clsx(
    "ticker-chip group",
    "rounded-sm border",
    "transition-colors cursor-pointer",
    "relative overflow-hidden",
    "shrink-0",
    colors.bg,
    colors.border,
    colors.hoverBorder,
    extra,
  );
}

export function chipBaseClasses(
  comfort: boolean | undefined,
  colors: ChipColors,
  extra?: string,
  // Comfort chips stack their two rows by default. A chip whose comfort
  // layout is columns side by side (the game chip: two scoreboard rows beside
  // a status column) passes "row" — appending a flex-direction class to
  // `extra` would not reliably win, since Tailwind utilities resolve by
  // stylesheet order rather than by position in the class string.
  comfortDirection: "col" | "row" = "col",
): string {
  return clsx(
    "ticker-chip group",
    "px-3 rounded-sm border",
    "transition-colors cursor-pointer",
    // `relative overflow-hidden` so a <ChipSpine> child can pin itself
    // to the bottom edge without escaping the rounded corners. Harmless
    // for chips that don't use one.
    "relative overflow-hidden",
    // Chips never compress on the rail — a squeezed chip is unreadable
    // and the marquee has infinite horizontal room anyway.
    "shrink-0",
    // One size per mode, for every chip type.
    //
    // Chips used to be content-sized, so a four-letter symbol produced a
    // narrower chip than a headline and the rail looked ragged. Each chip's
    // flexible element (the sparkline on a trade chip, the headline on an
    // RSS one) absorbs the difference instead, which is what the fixed box
    // needs in order to hold varying content without clipping.
    //
    // Height is fixed for comfort only: compact chips are single-row and
    // already share a height.
    "w-[264px]",
    colors.bg,
    colors.border,
    colors.hoverBorder,
    comfort
      ? comfortDirection === "row"
        ? "flex h-[52px] items-stretch py-1.5"
        : "flex h-[52px] flex-col items-start justify-between py-1.5"
      : "flex items-center gap-2 py-1 text-ui-body",
    extra,
  );
}
