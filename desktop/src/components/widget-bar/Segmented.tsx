/**
 * Contained segmented control (ex-predictions ViewSwitcher) — the bar's
 * top-level view switch. Deliberately a different shape from the open
 * BarPills so the two control levels (which VIEW vs which FILTER within
 * a view) never read as one row of identical chips.
 */
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-edge/30 bg-base-150/60 p-0.5"
    >
      {options.map((t) => {
        const active = value === t.value;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-ui-meta font-medium transition-colors cursor-pointer",
              active
                ? "bg-surface text-fg shadow-soft-sm"
                : "text-fg-3 hover:text-fg-2",
            )}
          >
            {Icon && <Icon size={13} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
