/**
 * Time Controls (v1.1.3) — preset chips + steppers for per-widget day
 * windows. Two flavors sharing internals:
 *   - DayRangeControl (sports): games from N days back to N days ahead
 *   - ArticleAgeControl (news): articles from the last N days (0 = all)
 *
 * Presets cover the 90% case; "Custom" reveals steppers. A value that
 * matches no preset renders as Custom with the steppers open.
 */
import { useState } from "react";
import clsx from "clsx";
import { Minus, Plus } from "lucide-react";

// ── Shared primitives ───────────────────────────────────────────

function PresetChips({
  options,
  activeKey,
  disabled,
  onPick,
}: {
  options: { key: string; label: string }[];
  activeKey: string;
  disabled?: boolean;
  onPick: (key: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 self-start rounded-lg border border-edge/40 bg-base-150/40 p-0.5"
      role="group"
    >
      {options.map((o) => (
        <button
          key={o.key}
          disabled={disabled}
          onClick={() => onPick(o.key)}
          aria-pressed={activeKey === o.key}
          className={clsx(
            "rounded-md px-2.5 py-1 text-ui-chip font-medium transition-colors disabled:opacity-50",
            // Accent-tinted active state — bg-surface on bg-base-150 is
            // near-invisible in the dark themes (#141420 vs #171726).
            activeKey === o.key
              ? "bg-accent/15 font-semibold text-accent"
              : "text-fg-4 hover:text-fg-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  disabled,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** Value display, e.g. (n) => `${n}d`. Defaults to String. */
  format?: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ui-meta text-fg-3">{label}</span>
      <div className="flex items-center gap-1">
        <button
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - 1))}
          aria-label={`Decrease ${label}`}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-edge/40 text-fg-3 transition-colors hover:bg-base-200 hover:text-fg-1 disabled:opacity-40"
        >
          <Minus size={12} />
        </button>
        <span className="min-w-[3.5rem] text-center text-ui-meta font-semibold tabular-nums text-fg-1">
          {(format ?? String)(value)}
        </span>
        <button
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + 1))}
          aria-label={`Increase ${label}`}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-edge/40 text-fg-3 transition-colors hover:bg-base-200 hover:text-fg-1 disabled:opacity-40"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Sports: two-sided day range ─────────────────────────────────

const RANGE_PRESETS = [
  { key: "today", label: "Today", back: 0, ahead: 0 },
  { key: "week", label: "This week", back: 1, ahead: 7 },
  { key: "max", label: "Everything", back: 7, ahead: 7 },
] as const;

export function DayRangeControl({
  daysBack,
  daysAhead,
  max,
  disabled,
  onChange,
}: {
  daysBack: number;
  daysAhead: number;
  /** Server retention horizon — steppers clamp here. */
  max: number;
  disabled?: boolean;
  onChange: (next: { daysBack: number; daysAhead: number }) => void;
}) {
  const matched = RANGE_PRESETS.find(
    (p) => p.back === daysBack && p.ahead === daysAhead,
  );
  const [customOpen, setCustomOpen] = useState(!matched);
  const activeKey = customOpen ? "custom" : (matched?.key ?? "custom");

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <PresetChips
        options={[...RANGE_PRESETS, { key: "custom", label: "Custom" }]}
        activeKey={activeKey}
        disabled={disabled}
        onPick={(key) => {
          if (key === "custom") {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          const p = RANGE_PRESETS.find((x) => x.key === key);
          if (p) onChange({ daysBack: p.back, daysAhead: p.ahead });
        }}
      />
      {activeKey === "custom" && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-edge/30 bg-base-150/30 px-3 py-2">
          <Stepper
            label="Days back"
            value={daysBack}
            min={0}
            max={max}
            disabled={disabled}
            format={(n) => (n === 0 ? "Off" : `${n}d`)}
            onChange={(n) => onChange({ daysBack: n, daysAhead })}
          />
          <Stepper
            label="Days ahead"
            value={daysAhead}
            min={0}
            max={max}
            disabled={disabled}
            format={(n) => (n === 0 ? "Off" : `${n}d`)}
            onChange={(n) => onChange({ daysBack, daysAhead: n })}
          />
        </div>
      )}
      <p className="text-ui-chip leading-relaxed text-fg-4">
        Live games always show. Scores stay for up to {max} days.
      </p>
    </div>
  );
}

// ── News: one-sided article age ─────────────────────────────────

const AGE_PRESETS = [
  { key: "today", label: "Today", days: 1 },
  { key: "3d", label: "3 days", days: 3 },
  { key: "week", label: "Week", days: 7 },
  { key: "all", label: "All", days: 0 },
] as const;

export const ARTICLE_AGE_MAX_DAYS = 30;

export function ArticleAgeControl({
  maxAgeDays,
  disabled,
  onChange,
}: {
  /** 0 = no age filter (every article the server sends). */
  maxAgeDays: number;
  disabled?: boolean;
  onChange: (days: number) => void;
}) {
  const matched = AGE_PRESETS.find((p) => p.days === maxAgeDays);
  const [customOpen, setCustomOpen] = useState(!matched);
  const activeKey = customOpen ? "custom" : (matched?.key ?? "custom");

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <PresetChips
        options={[...AGE_PRESETS, { key: "custom", label: "Custom" }]}
        activeKey={activeKey}
        disabled={disabled}
        onPick={(key) => {
          if (key === "custom") {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          const p = AGE_PRESETS.find((x) => x.key === key);
          if (p) onChange(p.days);
        }}
      />
      {activeKey === "custom" && (
        <div className="rounded-lg border border-edge/30 bg-base-150/30 px-3 py-2">
          <Stepper
            label="Last N days"
            value={maxAgeDays === 0 ? 1 : maxAgeDays}
            min={1}
            max={ARTICLE_AGE_MAX_DAYS}
            disabled={disabled}
            format={(n) => `${n}d`}
            onChange={onChange}
          />
        </div>
      )}
      <p className="text-ui-chip leading-relaxed text-fg-4">
        Articles older than the window are hidden everywhere. "All" shows
        everything your feeds provide.
      </p>
    </div>
  );
}
