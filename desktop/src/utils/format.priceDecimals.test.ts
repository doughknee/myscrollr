import { describe, expect, it } from "vitest";
import {
  formatPrice,
  formatPriceBare,
  formatPriceChange,
  priceDecimals, formatChange } from "./format";

describe("priceDecimals", () => {
  it("uses cents at and above a dollar", () => {
    expect(priceDecimals(243.9)).toBe(2);
    expect(priceDecimals(1)).toBe(2);
  });

  it("goes to eight decimals in meme-coin territory", () => {
    // PEPE/USD trades near $0.0000034. Six decimals renders that as
    // "0.000003"; eight renders it exactly, and matches the scale of the
    // numeric(20,8) columns behind it so the display cannot claim precision
    // the database did not keep.
    expect(priceDecimals(0.00000341)).toBe(8);
    expect(formatPriceBare(0.00000341)).toBe("0.00000341");
    expect(formatPriceBare(0.00000516)).toBe("0.00000516");
  });

  it("adds digits below a dollar, where cents erase the whole day", () => {
    // 1INCH/USD trades near $0.09. At two decimals its real low and high
    // both print as "0.09" and the rail shows a range that reads as none.
    expect(priceDecimals(0.09)).toBe(4);
    expect(priceDecimals(0.0001)).toBe(6);
  });

  it("is sign-agnostic", () => {
    expect(priceDecimals(-0.09)).toBe(4);
  });
});

describe("formatPriceBare", () => {
  it("never prints a currency glyph", () => {
    expect(formatPriceBare(325.53)).toBe("325.53");
  });

  it("keeps a sub-dollar low and high distinguishable", () => {
    expect(formatPriceBare(0.0885)).not.toBe(formatPriceBare(0.0912));
  });

  it("passes non-numeric input through rather than printing NaN", () => {
    expect(formatPriceBare("n/a")).toBe("n/a");
  });
});

describe("formatPrice", () => {
  it("keeps cents for equities", () => {
    expect(formatPrice(325.53)).toBe("$325.53");
  });

  it("does not round a sub-dollar asset up past its own day high", () => {
    // ADA traded 0.1920-0.1993 and closed at 0.1977. Rounded to "$0.20" the
    // price sits ABOVE its own high, and the chip's range marker clamps to
    // the end of the track — the rail claims "at the high of the day" for an
    // asset sitting mid-range.
    expect(formatPrice(0.1977)).toBe("$0.1977");
  });
});

describe("formatPriceChange", () => {
  it("keeps cents for equities", () => {
    expect(formatPriceChange(1.16)).toBe("+$1.16");
    expect(formatPriceChange(-0.77)).toBe("-$0.77");
  });

  it("does not flatten a real sub-dollar move to a penny", () => {
    // -0.0025 on a $0.13 coin is a ~1.8% day. "-$0.00" says nothing.
    expect(formatPriceChange(-0.0025)).toBe("-$0.0025");
  });
});

describe("formatChange beside a direction marker", () => {
  // The marker is a user preference (tickerDirectionMarker). formatChange
  // signs its own output, so the "sign" marker rendered a SECOND one:
  // "++0.89%" going up, "−-0.55%" going down. TradeChip now strips the
  // number's sign in that mode only -- "arrow" deliberately keeps both.
  it("signs its own output", () => {
    expect(formatChange(0.89)).toBe("+0.89%");
    expect(formatChange(-0.55)).toBe("-0.55%");
    // Flat counts as up and still carries a "+".
    expect(formatChange(0)).toBe("+0.00%");
  });

  it("leaves a sign the marker can strip, in either direction", () => {
    const strip = (s: string) => s.replace(/^[+−-]/, "");
    expect(strip(formatChange(0.89))).toBe("0.89%");
    expect(strip(formatChange(-0.55))).toBe("0.55%");
    expect(strip(formatChange(0))).toBe("0.00%");
  });
});
