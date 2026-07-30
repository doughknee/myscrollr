/**
 * Finance — Home preview. Biggest movers first, which is the "what changed"
 * glance the Home feed is for.
 */
import clsx from "clsx";
import { HOME_PREVIEW_MAX, HomeEmptyRow } from "../home";
import type { HomeRowsProps, Trade } from "../../types";

export function FinanceHomeRows({ data, onConfigure }: HomeRowsProps) {
  const trades = data as Trade[];
  const empty = (
    <HomeEmptyRow
      message="No stocks configured yet"
      openLabel="Finance"
      onConfigure={onConfigure}
    />
  );
  if (trades.length === 0) return empty;

  const sorted = [...trades]
    .sort(
      (a, b) =>
        Math.abs(Number(b.percentage_change ?? 0)) -
        Math.abs(Number(a.percentage_change ?? 0)),
    )
    .slice(0, HOME_PREVIEW_MAX);

  if (sorted.length === 0) return empty;

  return (
    <>
      {sorted.map((t) => {
        const pct = Number(t.percentage_change ?? 0);
        const isUp = pct >= 0;
        return (
          <div key={t.symbol} className="flex items-center px-4 py-2.5 gap-4">
            <span className="text-xs font-mono font-semibold text-fg w-20 truncate">
              {t.symbol}
            </span>
            <span className="text-xs text-fg-2 tabular-nums">
              $
              {Number(t.price).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span
              className={clsx(
                "text-xs font-medium tabular-nums ml-auto",
                isUp ? "text-green-400" : "text-red-400",
              )}
            >
              {isUp ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
            </span>
          </div>
        );
      })}
    </>
  );
}
