/**
 * SlotMeter — the widget-slot budget, shared by the Catalog header and
 * the Account page so the two surfaces can't drift (v1.1.2).
 *
 * Slots in use = ENABLED widgets + enabled local widgets — the server
 * gate counts `WHERE enabled = true`, and the downgrade prune disables
 * (never deletes) over-cap rows, so counting disabled rows here would
 * claim slots the server would happily accept.
 */
import { useMemo } from "react";
import clsx from "clsx";
import { useShell, useShellData } from "../shell-context";
import { getMaxWidgets } from "../tierLimits";

export interface SlotUsage {
  used: number;
  max: number;
  finite: boolean;
  atCapacity: boolean;
}

/** Pure slot math — exported for tests. */
export function computeSlotUsage(
  enabledDataWidgetCount: number,
  enabledWidgetCount: number,
  max: number,
): SlotUsage {
  const used = enabledDataWidgetCount + enabledWidgetCount;
  return {
    used,
    max,
    finite: Number.isFinite(max),
    atCapacity: used >= max,
  };
}

export function useSlotUsage(): SlotUsage {
  const { prefs, tier } = useShell();
  const { widgets } = useShellData();
  return useMemo(
    () =>
      computeSlotUsage(
        widgets.filter((ch) => ch.enabled).length,
        prefs.widgets.enabledWidgets.length,
        getMaxWidgets(tier),
      ),
    [widgets, prefs.widgets.enabledWidgets.length, tier],
  );
}

/** Human one-liner under the headline. Same voice on every surface. */
export function slotSubline(usage: SlotUsage): string {
  if (!usage.finite) return "Unlimited slots on your plan — add away.";
  if (usage.atCapacity)
    return "Remove a widget to free a slot, or upgrade for more.";
  if (usage.used === 0) return "Fresh start — pick your first widget.";
  const open = usage.max - usage.used;
  return `${open} open slot${open === 1 ? "" : "s"} — room for more.`;
}

export function slotHeadline(usage: SlotUsage): string {
  if (!usage.finite)
    return `${usage.used} widget${usage.used === 1 ? "" : "s"} added`;
  if (usage.atCapacity) return `All ${usage.max} widget slots in use`;
  return `${usage.used} of ${usage.max} widget slots used`;
}

/** One pill per slot, filled as used. Renders nothing on unlimited plans. */
export function SlotPills({
  usage,
  className,
}: {
  usage: SlotUsage;
  className?: string;
}) {
  if (!usage.finite) return null;
  return (
    <span className={clsx("flex items-center gap-1", className)} aria-hidden>
      {Array.from({ length: usage.max }, (_, i) => (
        <span
          key={i}
          className={clsx(
            "h-1.5 w-4 rounded-full ",
            i < usage.used
              ? usage.atCapacity
                ? "bg-warn"
                : "bg-accent"
              : "bg-edge/60",
          )}
        />
      ))}
    </span>
  );
}
