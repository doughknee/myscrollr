/**
 * The settings control kit.
 *
 * Anatomy (2026-07 redesign): a group is an optional mono uppercase
 * label above a card; the card is a hairline-separated list of rows; a
 * row is label + description on the left and exactly one control on the
 * right. Only real click targets take a hover tint — a row that merely
 * *contains* a control is a plain container, so the whole strip no
 * longer lights up when you are only reaching for the toggle.
 *
 * NOTE ON BLAST RADIUS: this file is not settings-only. `Section`,
 * `DisplayRow` and `ActionRow` are also imported by three fantasy
 * widget screens (LeaguePicker, ConnectedView, ImportProgress), so the
 * restyle lands there too. That is deliberate — one kit, one look — but
 * it means changes here need a look at the fantasy screens as well.
 */
import { useId } from "react";
import { clsx } from "clsx";
import { LayoutGroup, motion } from "motion/react";
import { SelectMenu } from "../widget-bar/SelectMenu";
import { controlTransition } from "../../lib/motion";

// ── Shared surfaces ─────────────────────────────────────────────

/**
 * The card fill. `surface-raised` is a token added for this redesign
 * because none of the existing ones mean "one step above the panel":
 * measured across all 20 palettes, base-150 sits *below* surface in 15
 * of them, and in every light palette `surface` is already the lightest
 * tone in the ramp. It is defined per-palette in style.css so the card
 * reads as elevated in both polarities.
 */
export const CARD_SURFACE =
  "rounded-xl border border-edge/55 bg-surface-raised shadow-soft-sm";

/** Hairline between rows in a card. */
const ROW_DIVIDER = "border-t border-fg/7";

/** Row box. Padding is 12px/16px per the redesign. */
const ROW_BASE = "flex items-center justify-between gap-4 px-4 py-3";

// ── Group + card ────────────────────────────────────────────────

interface SettingsGroupProps {
  /** Mono uppercase label above the card. Omit for an unlabelled card. */
  label?: string;
  /** Renders the label and its rule in the error color (Danger zone). */
  tone?: "default" | "danger";
  /** Optional element pinned to the right of the label row. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingsGroup({
  label,
  tone = "default",
  action,
  children,
}: SettingsGroupProps) {
  return (
    <section className="mt-5 first:mt-0">
      {(label || action) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          {label ? (
            // h2, not h3: these sit directly under the page's h1, and
            // skipping a level breaks heading navigation.
            <h2
              className={clsx(
                "text-ui-section font-mono",
                tone === "danger" ? "text-error" : "text-fg-4",
              )}
            >
              {label}
            </h2>
          ) : (
            <span />
          )}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div
        className={clsx(
          "overflow-hidden",
          tone === "danger"
            ? "rounded-xl border border-error/25 bg-error/3"
            : CARD_SURFACE,
        )}
      >
        {children}
      </div>
    </section>
  );
}

// ── Section (legacy) ────────────────────────────────────────────
// Kept for the fantasy widget screens, which render a titled card. The
// settings surface itself uses SettingsGroup.

interface SectionProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  variant?: "open" | "card";
}

export function Section({ title, children, action, variant = "open" }: SectionProps) {
  if (variant === "card") {
    return (
      <section className={clsx(CARD_SURFACE, "overflow-hidden")}>
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <h3 className="text-ui-section font-mono text-fg-4">{title}</h3>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        <div className="pb-1">{children}</div>
      </section>
    );
  }

  return (
    <div className="mb-6 pb-5 border-b border-edge/30 last:border-b-0 last:mb-0 last:pb-0">
      {/* px-4, matching the row box — rows moved from px-3 to px-4 with
          the redesign, and a px-3 title left them visibly indented from
          their own heading on the fantasy screens that use this variant. */}
      <div className="flex items-center justify-between mb-3 px-4">
        <h3 className="text-ui-section font-mono">{title}</h3>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

// ── Label + description ─────────────────────────────────────────
//
// Descriptions are visible sublines rather than tooltips. They used to
// be hover-only, which made the page unscannable and put load-bearing
// copy — "Windows only", "Local preferences stay intact" — permanently
// out of reach of keyboard users: the tooltip's trigger was a
// non-focusable <span> nested inside the row's button, so Tab focus
// landed on the button and the tooltip never opened.

interface SettingLabelProps {
  label: string;
  description?: string;
  /** Small uppercase chip after the label, e.g. platform caveats. */
  badge?: string;
}

function SettingLabel({ label, description, badge }: SettingLabelProps) {
  return (
    <>
      <span className="text-ui-body font-medium leading-tight text-fg">
        {label}
        {badge && <Badge>{badge}</Badge>}
      </span>
      {description && (
        <span className="text-ui-meta leading-snug text-fg-4 text-balance">
          {description}
        </span>
      )}
    </>
  );
}

/**
 * Caveat chip. 11px, not the spec's 10px: style.css deliberately floors
 * arbitrary 9/10px utilities at 11px inside the shells ("Reserve 10px
 * and below for decorative marks only, not content"), so a 10px badge
 * would silently render at 11px anyway.
 */
export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 align-[1px] rounded bg-base-250/50 px-1.5 py-px font-mono text-ui-chip font-semibold uppercase tracking-wide text-fg-4">
      {children}
    </span>
  );
}

/** Left half of a row: the text column. */
function RowText(props: SettingLabelProps) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 pr-2">
      <SettingLabel {...props} />
    </div>
  );
}

// ── Buttons ─────────────────────────────────────────────────────

type ButtonTone = "ghost" | "accent" | "error";

const BUTTON_TONES: Record<ButtonTone, string> = {
  // Quiet actions are bordered ghosts rather than filled chips.
  ghost:
    "border border-edge/80 bg-transparent text-fg-3 font-medium hover:text-fg hover:border-edge",
  accent: "bg-accent/12 text-accent font-semibold hover:bg-accent/20",
  error: "bg-error/10 text-error font-semibold hover:bg-error/20",
};

interface SettingsButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  /** Visually muted + non-interactive, without removing it from the a11y tree. */
  muted?: boolean;
  className?: string;
  type?: "button" | "submit";
}

export function SettingsButton({
  children,
  onClick,
  tone = "ghost",
  muted = false,
  className,
  type = "button",
}: SettingsButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={clsx(
        "shrink-0 cursor-pointer rounded-[7px] px-3 py-[5px] text-ui-chip leading-none",
        BUTTON_TONES[tone],
        muted && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Toggle row ──────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  description?: string;
  badge?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleRow({
  label,
  description,
  badge,
  checked,
  onChange,
}: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        ROW_BASE,
        "group w-full cursor-pointer text-left hover:bg-surface-hover/40",
      )}
    >
      <RowText label={label} description={description} badge={badge} />
      <span
        className={clsx(
          "relative h-5 w-[34px] shrink-0 rounded-[10px]",
          checked ? "bg-accent" : "bg-base-350",
        )}
      >
        <motion.span
          animate={{ transform: checked ? "translateX(14px)" : "translateX(0px)" }}
          transition={controlTransition}
          className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)]"
        />
      </span>
    </button>
  );
}

// ── Segmented row ───────────────────────────────────────────────

interface SegmentedRowProps<T extends string> {
  label: string;
  description?: string;
  badge?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function SegmentedRow<T extends string>({
  label,
  description,
  badge,
  value,
  options,
  onChange,
}: SegmentedRowProps<T>) {
  // Per-instance id: the sliding pill is shared only among the options
  // of THIS row. A shared id would let it fly between unrelated rows.
  const layoutGroupId = useId();

  return (
    <div className={ROW_BASE}>
      <RowText label={label} description={description} badge={badge} />
      <LayoutGroup id={layoutGroupId}>
        <div
          role="radiogroup"
          aria-label={label}
          className="inline-flex shrink-0 items-center gap-px rounded-lg bg-base-250/50 p-0.5"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={value === opt.value}
              onClick={() => onChange(opt.value)}
              className={clsx(
                "relative cursor-pointer rounded-md px-3 py-[5px] text-ui-chip leading-none",
                value === opt.value
                  ? "font-semibold text-fg"
                  : "font-medium text-fg-3 hover:text-fg-2",
              )}
            >
              {value === opt.value && (
                // The fill alone does not carry the selected state. In a
                // light palette the drop shadow draws the pill's edge, but
                // shadow-soft-sm is black at 25% — on a dark background it
                // is invisible, leaving the pill and its container within
                // ~1.05 contrast (measured worst case: solarized-dark at
                // 1.005, i.e. literally the same color). The hairline is
                // keyed to `fg`, which is the one token guaranteed to
                // contrast with the surface in every palette, so it reads
                // as an edge in both polarities rather than needing a
                // per-theme value.
                <motion.span
                  layoutId="active-option"
                  transition={controlTransition}
                  className="absolute inset-0 rounded-md bg-surface-raised shadow-soft-sm ring-1 ring-inset ring-fg/20"
                />
              )}
              <span className="relative z-10">{opt.label}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}

// ── Select row ──────────────────────────────────────────────────

interface SelectRowProps<T extends string> {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Rendered left of the trigger label, e.g. the theme palette dots. */
  preview?: React.ReactNode;
}

export function SelectRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  preview,
}: SelectRowProps<T>) {
  return (
    <div className={ROW_BASE}>
      <RowText label={label} description={description} />
      <div className="flex shrink-0 items-center gap-2">
        {preview}
        <SelectMenu
          value={value}
          options={options}
          onChange={onChange}
          ariaLabel={label}
        />
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

const THUMB_PX = 14;
const TRACK_PX = 140;

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
  const ratio = max === min ? 0 : (value - min) / (max - min);
  const pct = ratio * 100;
  // Inset the thumb so it stays inside the track instead of overhanging
  // by half its width at both ends (the prototype's `calc(pct - 7px)`
  // hangs 7px off each edge).
  const thumbLeft = ratio * (TRACK_PX - THUMB_PX);

  return (
    <div className={ROW_BASE}>
      <RowText label={label} description={description} />
      <div className="flex shrink-0 items-center gap-2.5">
        {/* The real <input type=range> is transparent and stretched over
            the track, so it takes focus but shows none of the browser's
            default ring. Without this the slider is the one control here
            a keyboard user cannot see they have landed on. */}
        <div
          className="relative flex h-5 items-center rounded-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface-raised"
          style={{ width: TRACK_PX }}
        >
          <div className="absolute inset-x-0 h-1 rounded-full bg-base-300" />
          <div
            className="absolute left-0 h-1 rounded-full bg-accent"
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
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
          <div
            className="pointer-events-none absolute rounded-full border border-base-350/80 bg-white shadow-[0_1px_3px_rgb(0_0_0/0.15)]"
            style={{ left: thumbLeft, width: THUMB_PX, height: THUMB_PX }}
          />
        </div>
        <span className="min-w-9 text-right font-mono text-ui-chip tabular-nums text-fg-2">
          {displayValue ?? value}
        </span>
      </div>
    </div>
  );
}

// ── Display row (read-only) ─────────────────────────────────────

interface DisplayRowProps {
  label: string;
  value: string | React.ReactNode;
  valueClass?: string;
}

export function DisplayRow({ label, value, valueClass }: DisplayRowProps) {
  return (
    <div className={ROW_BASE}>
      <span className="text-ui-body font-medium text-fg">{label}</span>
      {typeof value === "string" ? (
        <span className={valueClass ?? "text-ui-meta text-fg-4"}>{value}</span>
      ) : (
        value
      )}
    </div>
  );
}

// ── Action row (button on the right) ────────────────────────────

interface ActionRowProps {
  label: string;
  description?: string;
  badge?: string;
  action: string;
  /**
   * Use `tone`, not a raw class string. A className override used to be
   * allowed here; once the default became a bordered ghost, an override
   * like `bg-error/10` collided with the ghost's own `bg-transparent`
   * and which one won came down to stylesheet order.
   */
  tone?: ButtonTone;
  muted?: boolean;
  onClick: () => void;
}

export function ActionRow({
  label,
  description,
  badge,
  action,
  tone = "ghost",
  muted = false,
  onClick,
}: ActionRowProps) {
  return (
    <div className={ROW_BASE}>
      <RowText label={label} description={description} badge={badge} />
      <SettingsButton tone={tone} muted={muted} onClick={onClick}>
        {action}
      </SettingsButton>
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
  return <SettingsButton onClick={onClick}>{label}</SettingsButton>;
}

// ── Row list helper ─────────────────────────────────────────────
//
// Wraps each child after the first in a hairline divider, so callers can
// list rows without threading separator props through every one. Rows
// that conditionally render (Direction, Hover speed, Time per page) drop
// out cleanly because `false`/`null` children are filtered first.

export function RowList({ children }: { children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children.flat() : [children];
  const visible = rows.filter(Boolean) as React.ReactElement<{ id?: string }>[];
  return (
    <>
      {visible.map((row, i) => (
        // Keyed by the row's own id where it has one, not by position.
        // Conditional rows (Direction, Time per page, Hover speed) shift
        // every index below them as they appear and disappear, so an
        // index key hands one setting's mounted instance to a different
        // setting — the sliding pill and any transient state ride along
        // to a row that never asked for them.
        <div
          key={row?.props?.id ?? `row-${i}`}
          className={i > 0 ? ROW_DIVIDER : undefined}
        >
          {row}
        </div>
      ))}
    </>
  );
}
