import { clsx } from "clsx";
import { motion } from "motion/react";
import type { Venue } from "../../preferences";

// ── Section heading ─────────────────────────────────────────────
// Open layout: just a label + thin divider. No bordered card.

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <div className="mb-6 pb-5 border-b border-edge/30 last:border-b-0 last:mb-0 last:pb-0">
      <h3 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-fg-4 mb-3 px-3">
        {title}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

// ── Toggle row ──────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg hover:bg-base-250/50 transition-colors cursor-pointer group"
    >
      <div className="flex flex-col gap-0.5 text-left">
        <span className="text-[12px] text-fg-2 group-hover:text-fg leading-tight">
          {label}
        </span>
        {description && (
          <span className="text-[11px] text-fg-4 leading-tight">
            {description}
          </span>
        )}
      </div>
      <div
        className={clsx(
          "relative w-8 h-[18px] rounded-full transition-colors shrink-0 ml-4",
          checked ? "bg-accent" : "bg-base-350",
        )}
      >
        {/* Thumb springs across with a slight overshoot so the toggle
            feels physical rather than mechanical. */}
        <motion.div
          animate={{ x: checked ? 14 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
          className={clsx(
            "absolute top-[3px] left-[3px] h-3 w-3 rounded-full",
            checked ? "bg-surface" : "bg-fg-3",
          )}
        />
      </div>
    </button>
  );
}

// ── Segmented row ───────────────────────────────────────────────

interface SegmentedRowProps<T extends string> {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function SegmentedRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: SegmentedRowProps<T>) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] text-fg-2 leading-tight">{label}</span>
        {description && (
          <span className="text-[11px] text-fg-4 leading-tight">
            {description}
          </span>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex items-center rounded-lg bg-base-200 p-0.5 shrink-0 ml-4"
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={clsx(
              "px-2.5 py-1 text-[11px] font-medium rounded-md transition-all duration-200 active:scale-95 cursor-pointer leading-none",
              value === opt.value
                ? "bg-base-300 text-fg shadow-sm"
                : "text-fg-3 hover:text-fg-2",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Venue row ───────────────────────────────────────────────────
// @deprecated as of 2026-04-25.
// Use `<DisplayLocationGrid>` instead — it renders the same persisted
// `Venue` enum as two checkboxes (Feed | Ticker) under a single column
// header strip, which dropped the redundant per-row "Off / Feed / Both
// / Ticker" legend. This component is kept only for backwards-compat
// with anything still importing it; new code should NOT use it.
//
// Original four-state segmented control for visibility settings that
// can be routed to the feed page, the always-on-top ticker, both, or
// hidden. See docs/superpowers/specs/2026-04-25-display-venue-toggle-design.md
// for the venue-routing rationale.

const VENUE_OPTIONS: { value: Venue; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "feed", label: "Feed" },
  { value: "both", label: "Both" },
  { value: "ticker", label: "Ticker" },
];

interface VenueRowProps {
  label: string;
  description?: string;
  value: Venue;
  onChange: (venue: Venue) => void;
}

export function VenueRow({ label, description, value, onChange }: VenueRowProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] text-fg-2 leading-tight">{label}</span>
        {description && (
          <span className="text-[11px] text-fg-4 leading-tight">
            {description}
          </span>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex items-center rounded-lg bg-base-200 p-0.5 shrink-0 ml-4"
      >
        {VENUE_OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={clsx(
                "px-2.5 py-1 text-[11px] font-medium rounded-md transition-all duration-200 cursor-pointer leading-none",
                selected && opt.value === "off"
                  ? "bg-base-300/60 text-fg-3 shadow-sm"
                  : selected
                    ? "bg-base-300 text-fg shadow-sm"
                    : "text-fg-3 hover:text-fg-2",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Slider row ──────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
  onChange: (value: number) => void;
}

export function SliderRow({
  label,
  description,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: SliderRowProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] text-fg-2 leading-tight">{label}</span>
        {description && (
          <span className="text-[11px] text-fg-4 leading-tight">
            {description}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2.5 shrink-0 ml-4">
        <div className="relative w-24 h-5 flex items-center">
          {/* Track background */}
          <div className="absolute inset-x-0 h-1 rounded-full bg-base-300" />
          {/* Filled track */}
          <div
            className="absolute left-0 h-1 rounded-full bg-accent/60"
            style={{ width: `${pct}%` }}
          />
          <input
            type="range"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
          {/* Thumb indicator */}
          <div
            className="absolute w-3 h-3 rounded-full bg-fg-2 border-2 border-surface shadow-sm pointer-events-none"
            style={{ left: `calc(${pct}% - 6px)` }}
          />
        </div>
        <span className="text-[11px] text-fg-3 w-12 text-right tabular-nums font-medium">
          {displayValue ?? value}
        </span>
      </div>
    </div>
  );
}

// ── Display row (read-only) ─────────────────────────────────────

interface DisplayRowProps {
  label: string;
  value: string;
  valueClass?: string;
}

export function DisplayRow({ label, value, valueClass }: DisplayRowProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
      <span className="text-[12px] text-fg-3">{label}</span>
      <span className={valueClass ?? "text-[12px] text-fg-2"}>{value}</span>
    </div>
  );
}

// ── Reset button ────────────────────────────────────────────────

interface ResetButtonProps {
  label?: string;
  onClick: () => void;
}

export function ResetButton({
  label = "Reset to defaults",
  onClick,
}: ResetButtonProps) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-fg-4 hover:text-fg-2 hover:bg-base-250/50 transition-colors cursor-pointer"
    >
      {label}
    </button>
  );
}

// ── Action row (button on the right) ────────────────────────────

interface ActionRowProps {
  label: string;
  description?: string;
  action: string;
  actionClass?: string;
  onClick: () => void;
}

export function ActionRow({
  label,
  description,
  action,
  actionClass,
  onClick,
}: ActionRowProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] text-fg-2 leading-tight">{label}</span>
        {description && (
          <span className="text-[11px] text-fg-4 leading-tight">
            {description}
          </span>
        )}
      </div>
      <button
        onClick={onClick}
        className={clsx(
          "text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors cursor-pointer",
          actionClass ??
            "bg-base-250 text-fg-3 hover:text-fg-2 hover:bg-base-300",
        )}
      >
        {action}
      </button>
    </div>
  );
}
