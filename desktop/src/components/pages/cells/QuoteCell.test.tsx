import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import QuoteCell, { changeText, CHANGE_CH, PRICE_CH } from "./QuoteCell";
import type { Trade } from "../../../types";

function trade(over: Partial<Trade> = {}): Trade {
  return {
    symbol: "AAPL", price: 253.6938, percentage_change: -0.8869,
    sparkline: [255.96, 256.67, 254.12, 253.69], day_low: 253.39, day_high: 257.63,
    ...over,
  };
}

describe("changeText", () => {
  it("arrow, absolute value, two decimals", () => {
    expect(changeText(-0.8869)).toBe("▼ 0.89%");
    expect(changeText("12.4")).toBe("▲ 12.40%");
    expect(changeText(0)).toBe("▲ 0.00%");
  });

  it("an unknown change is blank, never invented", () => {
    expect(changeText(undefined)).toBe("");
    expect(changeText("")).toBe("");
    expect(changeText("n/a")).toBe("");
  });
});

describe("QuoteCell", () => {
  it("symbol without /USD, price, change in its direction's colour", () => {
    const { getByText, container } = render(<QuoteCell trade={trade({ symbol: "BTC/USD", price: 79850.21, percentage_change: -1.74 })} />);
    expect(getByText("BTC")).toBeTruthy();
    expect(getByText("79,850.21")).toBeTruthy();
    expect(container.querySelector('[data-part="change"]')!.classList.contains("text-down")).toBe(true);
  });

  it("the day's range: low and high, and where the price sits", () => {
    const { getByText } = render(<QuoteCell trade={trade()} />);
    expect(getByText("253.39")).toBeTruthy();
    expect(getByText("257.63")).toBeTruthy();
  });

  it("no range: the track stays, the labels and marker do not guess", () => {
    const { container } = render(<QuoteCell trade={trade({ day_low: 0, day_high: 0 })} />);
    const range = container.querySelector('[data-part="range"]')!;
    expect(range.textContent).toBe("");
    expect(range.querySelector(".invisible")).toBeTruthy();
  });

  it("width-stable: a one-digit and a two-digit move, a small and a large price, reserve the same", () => {
    const parts = (t: Trade) => {
      const { container } = render(<QuoteCell trade={t} />);
      const el = (p: string) => (container.querySelector(`[data-part="${p}"]`) as HTMLElement).style.minWidth;
      return [el("change"), el("price"), el("range-low"), el("range-high")];
    };
    const small = parts(trade({ price: 9.99, percentage_change: 0.89, day_low: 9.5, day_high: 10.2 }));
    const large = parts(trade({ price: 1253.69, percentage_change: -12.4, day_low: 1201.1, day_high: 61260.55 }));
    const none = parts(trade({ day_low: 0, day_high: 0 }));
    expect(large).toEqual(small);
    expect(none).toEqual(small);
    expect(small).toEqual([`${CHANGE_CH}ch`, `${PRICE_CH}ch`, `${PRICE_CH}ch`, `${PRICE_CH}ch`]);
    // The widest change fits its reservation.
    expect(changeText(-12.4).length).toBeLessThanOrEqual(CHANGE_CH);
  });
});
