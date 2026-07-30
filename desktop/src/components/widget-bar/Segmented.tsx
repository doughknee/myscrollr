/**
 * Contained segmented control (ex-predictions ViewSwitcher) — the bar's
 * top-level view switch. Deliberately a different shape from the open
 * BarPills so the two control levels (which VIEW vs which FILTER within
 * a view) never read as one row of identical chips.
 */
import { useId } from "react";
import { clsx } from "clsx";
import { LayoutGroup, motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { controlTransition } from "../../lib/motion";

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
  const layoutGroupId = useId();

  return (
    <LayoutGroup id={layoutGroupId}>
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
              // py-0.5 (not py-1): with the wrapper's p-0.5 + border this
              // lands on the same outer height as the SelectMenu/filter
              // triggers, so bars read as one rule regardless of contents.
              "relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-ui-meta font-medium cursor-pointer",
              // Accent-tinted active state — bg-surface on bg-base-150 is
              // near-invisible in the dark themes (same v1.1.3 lesson as
              // the catalog sort pills).
              active
                ? "font-semibold text-accent"
                : "text-fg-3 hover:text-fg-2",
              )}
            >
              {active && (
                <motion.span
                  layoutId="active-segment"
                  transition={controlTransition}
                  className="absolute inset-0 rounded-md bg-accent/15"
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1.5">
                {Icon && <Icon size={13} />}
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
