/**
 * Finance — Home preview. Biggest movers first, which is the "what changed"
 * glance the Home feed is for.
 */
import clsx from "clsx";
import { HOME_PREVIEW_MAX, HomeEmptyRow } from "../home";
import type { HomeRowsProps, Trade, HomeHighlight } from "../../types";

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

/**
 * Happening now — the biggest absolute mover.
 *
 * Same ordering the rows below already use, so the hero and the list
 * agree about what mattered. Absolute, not signed: a 4% drop is as much
 * news as a 4% climb, and showing only winners would be a kind of lie.
 */
export function financeHighlight(data: unknown[]): HomeHighlight | null {
  const trades = data as Trade[];
  if (trades.length === 0) return null;

  const top = [...trades].sort(
    (a, b) =>
      Math.abs(Number(b.percentage_change ?? 0)) -
      Math.abs(Number(a.percentage_change ?? 0)),
  )[0];
  if (!top?.symbol) return null;

  const pct = Number(top.percentage_change ?? 0);
  if (!Number.isFinite(pct) || pct === 0) return null;

  const price = Number(top.price);
  return {
    headline: `${top.symbol} ${pct > 0 ? "+" : ""}${pct.toFixed(1)}% today`,
    sub: Number.isFinite(price)
      ? `${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · top mover in your watchlist`
      : "top mover in your watchlist",
  };
}
