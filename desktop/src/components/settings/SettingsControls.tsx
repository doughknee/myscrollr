import { clsx } from "clsx";
import { motion } from "motion/react";
import Tooltip from "../Tooltip";

// ── Section heading ─────────────────────────────────────────────
// Open layout: just a label + thin divider. No bordered card.
// Optional `action` slot renders a small action affordance to the
// right of the title (e.g. "All / None" bulk toggles on display
// preferences).

interface SectionProps {
  title: string;
  children: React.ReactNode;
  /** Optional action element rendered top-right of the section title. */
  action?: React.ReactNode;
  /** Card sections are used by the compact flat Settings page. */
  variant?: "open" | "card";
  /**
   * Entrance-stagger position. When set, the section fades up on mount
   * with the same timing as the Support hub / widget pages
   * (0.25s, 0.04 + index * 0.04 delay), so Settings / Ticker / Account
   * match the rest of the app when switching destinations (v1.1.1).
   */
  index?: number;
}

export function Section({ title, children, action, variant = "open", index }: SectionProps) {
  const entrance =
    index === undefined
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.25,
            delay: 0.04 + index * 0.04,
            ease: [0.22, 0.61, 0.36, 1] as const,
          },
        };

  if (variant === "card") {
    return (
      <motion.section
        {...entrance}
        className="rounded-xl border border-edge/35 bg-base-150/35 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <h3 className="text-ui-section font-mono">
            {title}
          </h3>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        <div className="px-1 pb-2">{children}</div>
      </motion.section>
    );
  }

  return (
    <motion.div
      {...entrance}
      className="mb-6 pb-5 border-b border-edge/30 last:border-b-0 last:mb-0 last:pb-0"
    >
      <div className="flex items-center justify-between mb-3 px-3">
        <h3 className="text-ui-section font-mono">
          {title}
        </h3>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="space-y-0.5">{children}</div>
    </motion.div>
  );
}

function SettingLabel({ label, description }: { label: string; description?: string }) {
  const className = clsx(
    "text-ui-muted leading-tight group-hover:text-fg",
    description && "cursor-help",
  );

  if (!description) {
    return <span className={className}>{label}</span>;
  }

  return (
    <Tooltip content={description} side="top">
      <span className={className}>{label}</span>
    </Tooltip>
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
      className="flex items-center justify-between w-full px-3 py-2 rounded-lg hover:bg-base-250/45 transition-colors cursor-pointer group"
    >
      <div className="flex flex-col gap-0.5 text-left group-hover:text-fg">
        <SettingLabel label={label} description={description} />
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
    <div className="flex items-center justify-between px-3 py-2 rounded-lg">
      <div className="flex flex-col gap-0.5">
        <SettingLabel label={label} description={description} />
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
              "px-2.5 py-1 text-ui-chip font-medium rounded-md transition-all duration-150 active:scale-95 cursor-pointer leading-none",
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

// ── Select row ──────────────────────────────────────────────────
// A labeled dropdown for picking one of many string options. Used by
// the Appearance panel for the 10-entry theme family selector, where a
// segmented control would overflow the row.

interface SelectRowProps<T extends string> {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function SelectRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: SelectRowProps<T>) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg">
      <div className="flex flex-col gap-0.5">
        <SettingLabel label={label} description={description} />
      </div>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="shrink-0 ml-4 px-2.5 py-1 text-ui-chip font-medium rounded-md bg-base-200 border border-edge/40 text-fg focus:outline-none focus:border-accent/60 transition-colors cursor-pointer appearance-none pr-7 bg-no-repeat bg-right"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M3 4.5l3 3 3-3' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
          backgroundPosition: "right 6px center",
          backgroundSize: "12px",
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
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
    <div className="flex items-center justify-between px-3 py-2 rounded-lg">
      <div className="flex flex-col gap-0.5">
        <SettingLabel label={label} description={description} />
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
        <span className="text-ui-chip w-12 text-right tabular-nums font-medium">
          {displayValue ?? value}
        </span>
      </div>
    </div>
  );
}

// ── Display row (read-only) ─────────────────────────────────────

interface DisplayRowProps {
  label: string;
  /**
   * Plain string or arbitrary node. Strings are wrapped in a `<span>`
   * so existing rows keep the same chrome; nodes render inline so
   * callers can pass a chip/pill/etc. without bespoke row markup.
   */
  value: string | React.ReactNode;
  valueClass?: string;
}

export function DisplayRow({ label, value, valueClass }: DisplayRowProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg">
      <span className="text-ui-meta">{label}</span>
      {typeof value === "string" ? (
        <span className={valueClass ?? "text-ui-muted"}>{value}</span>
      ) : (
        value
      )}
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
      className="text-ui-chip font-medium px-3 py-1.5 rounded-lg text-fg-3 hover:text-fg-2 hover:bg-base-250/50 transition-colors cursor-pointer"
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
    <div className="flex items-center justify-between px-3 py-2 rounded-lg">
      <div className="flex flex-col gap-0.5">
        <SettingLabel label={label} description={description} />
      </div>
      <button
        onClick={onClick}
        className={clsx(
          "text-ui-chip font-medium px-2.5 py-1 rounded-md transition-colors cursor-pointer",
          actionClass ??
            "bg-base-250 text-fg-3 hover:text-fg-2 hover:bg-base-300",
        )}
      >
        {action}
      </button>
    </div>
  );
}
