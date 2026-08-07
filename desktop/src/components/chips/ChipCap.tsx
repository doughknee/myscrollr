/**
 * ChipCap — the status block that opens a capped chip.
 *
 * Uptime and GitHub share one grammar deliberately: both answer "is
 * this thing OK right now", and reading them as one family is the point
 * of the design. So they share this component rather than each growing
 * their own lookalike.
 *
 * Anatomy (from the handoff): zero left padding on the chip, cap block
 * at 16% background with a 30% right border, status word or glyph in
 * mono. The cap carries the binary state so the rest of the chip is
 * free to carry the interesting part — an outage duration, a failed
 * step name — instead of restating a colour.
 *
 * Motion: an alerting cap pulses, gated on `data-motion` because
 * `#app-shell` stills every animation. Same markup therefore pulses in
 * the ticker window and sits still in the app, and reduced motion
 * disables it in both. Colour alone still distinguishes every state, so
 * nothing is conveyed by movement only.
 */
import { clsx } from "clsx";

export type CapTone = "up" | "down" | "info" | "warning" | "neutral";

/**
 * 16% bg / 30% border-right, per the spec. Written out rather than
 * built by interpolation because Tailwind only sees literal class
 * names — a computed `bg-${tone}/[0.16]` compiles to nothing.
 */
const CAP_TONES: Record<CapTone, { bg: string; border: string; text: string }> =
  {
    up: { bg: "bg-up/[0.16]", border: "border-up/30", text: "text-up" },
    down: { bg: "bg-down/[0.16]", border: "border-down/30", text: "text-down" },
    info: { bg: "bg-info/[0.16]", border: "border-info/30", text: "text-info" },
    warning: {
      bg: "bg-warning/[0.16]",
      border: "border-warning/30",
      text: "text-warning",
    },
    neutral: {
      bg: "bg-fg-3/[0.10]",
      border: "border-fg-3/30",
      text: "text-fg-3",
    },
  };

interface ChipCapProps {
  tone: CapTone;
  /** Status word ("UP", "MNT") or glyph ("✓", "✗"). Kept short — the
   *  cap is a fixed-width lane and long text would reflow the rail. */
  children: React.ReactNode;
  /** Pulse the cap. Reserve for states that want attention now. */
  pulse?: boolean;
  comfort?: boolean;
  /** Screen-reader text, since a glyph or an abbreviation isn't one. */
  label: string;
}

export function ChipCap({
  tone,
  children,
  pulse,
  comfort,
  label,
}: ChipCapProps) {
  const t = CAP_TONES[tone];
  return (
    <span
      // Self-stretch so the cap is full chip height in both densities
      // rather than a floating badge — it reads as a bound edge.
      className={clsx(
        "flex shrink-0 select-none items-center justify-center self-stretch border-r",
        "font-mono font-bold uppercase tracking-wider",
        comfort ? "px-2 text-[11px]" : "px-1.5 text-[10px]",
        t.bg,
        t.border,
        t.text,
      )}
      data-motion={pulse ? "cap-pulse" : undefined}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden>{children}</span>
    </span>
  );
}

/**
 * Wrapper for a chip that opens with a cap.
 *
 * The cap needs the chip's left padding gone, and `chipBaseClasses`
 * hardcodes `px-3`. Rather than parameterise the base for one case,
 * capped chips pass `pl-0` and lay their own body out — the base still
 * owns the border, radius, colour, and shrink behaviour.
 */
export function cappedChipClasses(extra?: string): string {
  return clsx("!pl-0 items-stretch overflow-hidden", extra);
}
