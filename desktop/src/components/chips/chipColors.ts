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

// ── Channel + widget → color mapping ────────────────────────────

const CHANNEL_MAP: Record<string, ChipColors> = {
  finance: PRIMARY,
  sports: SECONDARY,
  rss: INFO,
  fantasy: PURPLE,
  clock: WIDGET_CLOCK,
  timer: WIDGET_TIMER,
  weather: WIDGET_WEATHER,
  sysmon: WIDGET_SYSMON,
  uptime: WIDGET_UPTIME,
  github: WIDGET_GITHUB,
};

// ── Resolver ────────────────────────────────────────────────────

export function getChipColors(mode: ChipColorMode, channel: string): ChipColors {
  if (mode === "accent") return PRIMARY;
  if (mode === "muted") return MUTED;
  return CHANNEL_MAP[channel] ?? PURPLE;
}

// ── Shared chip base classes ────────────────────────────────────
// Common className construction used by all ticker chip components.

export function chipBaseClasses(
  comfort: boolean | undefined,
  colors: ChipColors,
  extra?: string,
): string {
  return clsx(
    "ticker-chip group",
    "px-3 rounded-sm border",
    "transition-colors cursor-pointer",
    colors.bg,
    colors.border,
    colors.hoverBorder,
    comfort
      ? "flex flex-col items-start py-1.5 gap-0.5"
      : "flex items-center gap-2 py-1 text-ui-body",
    extra,
  );
}
