/**
 * Pure portfolio math + formatting for the "My Positions" panel.
 *
 * Kept free of React and Tauri so the P&L logic is unit-tested in isolation.
 * Money is integer cents end-to-end (the predictions data contract); a Kalshi
 * contract pays out $1 (100¢) if it resolves in your favor, so a "price" in
 * cents doubles as both the implied probability and the per-contract value.
 */
import type { KalshiPosition, KalshiPortfolio } from "./kalshi";
import type { Prediction } from "../../types";

// ── Money formatting ─────────────────────────────────────────────

/** Format integer cents as USD ("$12.34", "-$5.00"). */
export function formatUsdCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.abs(cents) / 100;
  return `${sign}$${dollars.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format integer cents as a signed USD delta ("+$1.20", "-$0.50", "$0.00"). */
export function formatSignedUsdCents(cents: number): string {
  if (cents === 0) return "$0.00";
  const sign = cents > 0 ? "+" : "-";
  const dollars = Math.abs(cents) / 100;
  return `${sign}$${dollars.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ── Live price lookup ────────────────────────────────────────────

/**
 * Build a `ticker → yes_price (cents)` map from the live predictions feed, so
 * positions can be marked-to-market against the same prices the widget
 * already streams. Predictions ids are `kalshi:<ticker>`; we key by both the
 * bare ticker and the namespaced id for robust lookup.
 */
export function buildPriceMap(predictions: Prediction[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of predictions) {
    if (typeof p.yes_price === "number") {
      map.set(p.ticker, p.yes_price);
      map.set(p.id, p.yes_price);
    }
  }
  return map;
}

/** Look up the live YES price (cents) for a position's market, if known. */
export function lookupYesPrice(
  prices: Map<string, number>,
  ticker: string,
): number | undefined {
  return prices.get(ticker) ?? prices.get(`kalshi:${ticker}`);
}

/** Per-contract value of the held side at a given YES price. */
export function sidePriceCents(
  side: KalshiPosition["side"],
  yesPriceCents: number,
): number {
  return side === "no" ? 100 - yesPriceCents : yesPriceCents;
}

// ── P&L ──────────────────────────────────────────────────────────

export interface PositionPnl {
  /** Live per-contract price of the held side, in cents. */
  currentPriceCents: number;
  /** Mark-to-market value of the whole position, in cents. */
  marketValueCents: number;
  /** Cost basis (what was paid to acquire), in cents. */
  costBasisCents: number;
  /** Mark-to-market minus cost basis, in cents. */
  unrealizedPnlCents: number;
  /** Unrealized + already-realized P&L, in cents. */
  totalPnlCents: number;
}

/**
 * Compute mark-to-market P&L for one position given the live YES price.
 * Returns `null` for flat positions or when no live price is available (the
 * UI then shows cost basis without a P&L figure rather than a wrong one).
 */
export function computePositionPnl(
  pos: KalshiPosition,
  yesPriceCents: number | undefined,
): PositionPnl | null {
  if (pos.side === "flat" || pos.count === 0) return null;
  if (yesPriceCents == null || !Number.isFinite(yesPriceCents)) return null;

  const currentPriceCents = sidePriceCents(pos.side, yesPriceCents);
  const marketValueCents = pos.count * currentPriceCents;
  const costBasisCents = pos.exposure_cents;
  const unrealizedPnlCents = marketValueCents - costBasisCents;
  const totalPnlCents = unrealizedPnlCents + pos.realized_pnl_cents;

  return {
    currentPriceCents,
    marketValueCents,
    costBasisCents,
    unrealizedPnlCents,
    totalPnlCents,
  };
}

export interface PortfolioSummary {
  balanceCents: number;
  /** Mark-to-market value of all open positions, in cents. */
  positionsValueCents: number;
  /** balance + positions value — total account value, in cents. */
  totalValueCents: number;
  /** Summed unrealized P&L across positions that have a live price, in cents. */
  unrealizedPnlCents: number;
  /** How many open positions could be marked to market (had a live price). */
  marked: number;
  /** Total number of open positions. */
  openPositions: number;
}

/**
 * Aggregate a portfolio into the headline numbers shown at the top of the
 * panel. Positions without a live price contribute their cost basis to value
 * (so total value stays sensible) but are excluded from the unrealized-P&L sum.
 */
export function computePortfolioSummary(
  portfolio: KalshiPortfolio,
  prices: Map<string, number>,
): PortfolioSummary {
  let positionsValueCents = 0;
  let unrealizedPnlCents = 0;
  let marked = 0;

  for (const pos of portfolio.positions) {
    if (pos.side === "flat" || pos.count === 0) continue;
    const yes = lookupYesPrice(prices, pos.ticker);
    const pnl = computePositionPnl(pos, yes);
    if (pnl) {
      positionsValueCents += pnl.marketValueCents;
      unrealizedPnlCents += pnl.unrealizedPnlCents;
      marked += 1;
    } else {
      // No live price — fall back to cost basis so the total isn't understated.
      positionsValueCents += pos.exposure_cents;
    }
  }

  const openPositions = portfolio.positions.filter(
    (p) => p.side !== "flat" && p.count !== 0,
  ).length;

  return {
    balanceCents: portfolio.balance_cents,
    positionsValueCents,
    totalValueCents: portfolio.balance_cents + positionsValueCents,
    unrealizedPnlCents,
    marked,
    openPositions,
  };
}

/** Sort open positions by descending mark-to-market value (biggest first). */
export function sortPositionsByValue(
  positions: KalshiPosition[],
  prices: Map<string, number>,
): KalshiPosition[] {
  const value = (pos: KalshiPosition): number => {
    const pnl = computePositionPnl(pos, lookupYesPrice(prices, pos.ticker));
    return pnl ? pnl.marketValueCents : pos.exposure_cents;
  };
  return [...positions]
    .filter((p) => p.side !== "flat" && p.count !== 0)
    .sort((a, b) => value(b) - value(a) || a.ticker.localeCompare(b.ticker));
}
