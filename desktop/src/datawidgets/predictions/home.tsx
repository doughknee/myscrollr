/**
 * Predictions — Home preview. Top movers, matching the finance treatment.
 *
 * No group chips: a prediction widget is a single market set, so there is
 * nothing to slice it by. Omitting `homeGroups` hides the chip row.
 */
import clsx from "clsx";
import { HOME_PREVIEW_MAX, HomeEmptyRow } from "../home";
import { isDisplayable, priceDelta } from "./view";
import ProbabilityPill from "./ProbabilityPill";
import type { HomeRowsProps, Prediction } from "../../types";

export function PredictionsHomeRows({ data, onConfigure }: HomeRowsProps) {
  const live = (data as Prediction[]).filter(isDisplayable);
  if (live.length === 0) {
    return (
      <HomeEmptyRow
        message="No markets tracked yet"
        openLabel="Predictions"
        onConfigure={onConfigure}
      />
    );
  }

  const sorted = [...live]
    .sort((a, b) => Math.abs(priceDelta(b)) - Math.abs(priceDelta(a)))
    .slice(0, HOME_PREVIEW_MAX);

  return (
    <>
      {sorted.map((p) => {
        const delta = priceDelta(p);
        const isUp = delta > 0;
        return (
          <div key={p.id} className="flex items-center px-4 py-2.5 gap-4">
            <span className="text-ui-meta text-fg-2 truncate flex-1">
              {p.event_title || p.title}
            </span>
            {/* Fixed delta slot + fixed-width pill — the widget's own column
                treatment, so Home previews match the feed. */}
            <span
              className={clsx(
                "text-xs font-medium tabular-nums w-10 text-right",
                isUp ? "text-green-400" : "text-red-400",
              )}
            >
              {delta !== 0 ? `${isUp ? "▲" : "▼"} ${Math.abs(delta)}` : ""}
            </span>
            <ProbabilityPill pct={p.yes_price} delta={delta} size="sm" />
          </div>
        );
      })}
    </>
  );
}
