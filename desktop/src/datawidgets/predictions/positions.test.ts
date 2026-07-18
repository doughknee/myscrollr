import { describe, it, expect } from "vitest";
import {
  formatUsdCents,
  formatSignedUsdCents,
  sidePriceCents,
  computePositionPnl,
  computePortfolioSummary,
  buildPriceMap,
  lookupYesPrice,
  sortPositionsByValue,
} from "./positions";
import type { KalshiPosition, KalshiPortfolio } from "./kalshi";
import type { Prediction } from "../../types";

function pos(overrides: Partial<KalshiPosition> = {}): KalshiPosition {
  return {
    ticker: "MKT",
    position: 10,
    side: "yes",
    count: 10,
    exposure_cents: 500,
    realized_pnl_cents: 0,
    total_traded_cents: 500,
    fees_paid_cents: 0,
    resting_orders_count: 0,
    ...overrides,
  };
}

function pred(ticker: string, yes_price: number): Prediction {
  return {
    id: `kalshi:${ticker}`,
    source: "kalshi",
    ticker,
    title: ticker,
    yes_price,
  };
}

describe("money formatting", () => {
  it("formats cents as USD", () => {
    expect(formatUsdCents(1234)).toBe("$12.34");
    expect(formatUsdCents(0)).toBe("$0.00");
    expect(formatUsdCents(-500)).toBe("-$5.00");
    expect(formatUsdCents(123456)).toBe("$1,234.56");
  });

  it("formats signed deltas", () => {
    expect(formatSignedUsdCents(120)).toBe("+$1.20");
    expect(formatSignedUsdCents(-50)).toBe("-$0.50");
    expect(formatSignedUsdCents(0)).toBe("$0.00");
  });
});

describe("sidePriceCents", () => {
  it("returns yes price for yes, complement for no", () => {
    expect(sidePriceCents("yes", 62)).toBe(62);
    expect(sidePriceCents("no", 62)).toBe(38);
  });
});

describe("computePositionPnl", () => {
  it("marks a YES position to market", () => {
    const pnl = computePositionPnl(pos({ side: "yes", count: 10, exposure_cents: 500 }), 62);
    expect(pnl).not.toBeNull();
    expect(pnl!.currentPriceCents).toBe(62);
    expect(pnl!.marketValueCents).toBe(620);
    expect(pnl!.unrealizedPnlCents).toBe(120); // 620 - 500
    expect(pnl!.totalPnlCents).toBe(120);
  });

  it("marks a NO position using the complement price", () => {
    // 10 NO contracts, paid 400¢ (avg 40¢ for NO). YES at 62 → NO at 38.
    const pnl = computePositionPnl(
      pos({ side: "no", position: -10, count: 10, exposure_cents: 400 }),
      62,
    );
    expect(pnl!.currentPriceCents).toBe(38);
    expect(pnl!.marketValueCents).toBe(380);
    expect(pnl!.unrealizedPnlCents).toBe(-20); // 380 - 400
  });

  it("adds realized P&L into the total", () => {
    const pnl = computePositionPnl(
      pos({ side: "yes", count: 10, exposure_cents: 500, realized_pnl_cents: 75 }),
      62,
    );
    expect(pnl!.unrealizedPnlCents).toBe(120);
    expect(pnl!.totalPnlCents).toBe(195);
  });

  it("returns null without a live price or for flat positions", () => {
    expect(computePositionPnl(pos(), undefined)).toBeNull();
    expect(computePositionPnl(pos({ side: "flat", position: 0, count: 0 }), 50)).toBeNull();
  });
});

describe("price map", () => {
  it("keys by both bare ticker and namespaced id", () => {
    const map = buildPriceMap([pred("ABC", 55)]);
    expect(lookupYesPrice(map, "ABC")).toBe(55);
    expect(lookupYesPrice(map, "kalshi:ABC")).toBe(55);
    expect(lookupYesPrice(map, "missing")).toBeUndefined();
  });
});

describe("computePortfolioSummary", () => {
  const portfolio: KalshiPortfolio = {
    balance_cents: 10000,
    positions: [
      pos({ ticker: "A", side: "yes", count: 10, exposure_cents: 500 }),
      pos({ ticker: "B", side: "no", position: -5, count: 5, exposure_cents: 200 }),
      pos({ ticker: "C", side: "yes", count: 4, exposure_cents: 300 }), // no live price
    ],
    fills: [],
    resting_orders: [],
  };

  it("aggregates value and unrealized P&L, falling back to cost basis", () => {
    const prices = buildPriceMap([pred("A", 62), pred("B", 62)]);
    const s = computePortfolioSummary(portfolio, prices);
    // A: 10*62=620 (PnL +120). B NO: 5*38=190 (PnL -10). C: no price → cost 300.
    expect(s.positionsValueCents).toBe(620 + 190 + 300);
    expect(s.unrealizedPnlCents).toBe(120 - 10); // C excluded from PnL
    expect(s.marked).toBe(2);
    expect(s.openPositions).toBe(3);
    expect(s.totalValueCents).toBe(10000 + 620 + 190 + 300);
  });

  it("ignores flat positions", () => {
    const flatPortfolio: KalshiPortfolio = {
      balance_cents: 0,
      positions: [pos({ side: "flat", position: 0, count: 0 })],
      fills: [],
      resting_orders: [],
    };
    const s = computePortfolioSummary(flatPortfolio, new Map());
    expect(s.openPositions).toBe(0);
    expect(s.positionsValueCents).toBe(0);
  });
});

describe("sortPositionsByValue", () => {
  it("orders by descending mark-to-market value and drops flats", () => {
    const positions = [
      pos({ ticker: "small", side: "yes", count: 1, exposure_cents: 50 }),
      pos({ ticker: "big", side: "yes", count: 100, exposure_cents: 5000 }),
      pos({ ticker: "flat", side: "flat", position: 0, count: 0 }),
    ];
    const prices = buildPriceMap([pred("small", 50), pred("big", 50)]);
    const sorted = sortPositionsByValue(positions, prices);
    expect(sorted.map((p) => p.ticker)).toEqual(["big", "small"]);
  });
});
