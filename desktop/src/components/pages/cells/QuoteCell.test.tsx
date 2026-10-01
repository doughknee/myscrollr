import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import QuoteCell, { changeText, rangeText, CHANGE_CH } from "./QuoteCell";
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
    expect(changeText(0)).toBe("0.00%");
    expect(changeText(-0.001)).toBe("0.00%");
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

  it("price first: symbol over the price (the largest type) over the change, on the left; the day on the right", () => {
    const { container } = render(<QuoteCell trade={trade()} />);
    const price = container.querySelector('[data-part="price"]')!;
    expect(price.classList.contains("text-[20px]")).toBe(true);
    const left = price.parentElement!;
    expect(left.contains(container.querySelector('[data-part="change"]'))).toBe(true);
    expect(left.contains(container.querySelector('[data-part="spark"]'))).toBe(false);
    const right = container.querySelector('[data-part="spark"]')!.parentElement!;
    expect(right.contains(container.querySelector('[data-part="range"]'))).toBe(true);
  });

  it("symbol, price and change share one left edge; the price zone is as wide as the price, the line 12px after it", () => {
    const button = render(<QuoteCell trade={trade()} fill />).container.querySelector("button")!;
    expect(button.className).toContain("grid-cols-[max-content_minmax(0,1fr)]");
    expect(button.className).toContain("gap-x-3");
    const left = button.querySelector('[data-part="price"]')!.parentElement!;
    expect(left.className).toContain("items-start");
    for (const p of ["symbol", "price", "change"]) expect(button.querySelector(`[data-part="${p}"]`)!.className).not.toContain("text-right");
    // The fill's "+" hangs outside the symbol's box, so the symbol starts where everyone's does.
    expect(button.querySelector('[aria-label="popular"]')!.className).toContain("right-full");
  });

  it("flat is neutral: no arrow, no up colour", () => {
    const { container } = render(<QuoteCell trade={trade({ percentage_change: 0 })} />);
    const c = container.querySelector('[data-part="change"]')!;
    expect(c.textContent).toBe("0.00%");
    expect(c.classList.contains("text-fg-3")).toBe(true);
  });

  it("a popular fill carries a + before its symbol; the user's own does not", () => {
    expect(render(<QuoteCell trade={trade()} fill />).container.querySelector('[aria-label="popular"]')!.textContent).toBe("+");
    expect(render(<QuoteCell trade={trade()} />).container.querySelector('[aria-label="popular"]')).toBeNull();
  });

  it("the day's range: low and high, whole units from 1,000 so an end stays within seven characters", () => {
    const { getByText } = render(<QuoteCell trade={trade()} />);
    expect(getByText("253.39")).toBeTruthy();
    expect(getByText("257.63")).toBeTruthy();
    expect(rangeText(79002.24)).toBe("79,002");
    expect(rangeText(0.0904)).toBe("0.0904");
  });

  it("no range: the track stays, the labels and marker do not guess", () => {
    const { container } = render(<QuoteCell trade={trade({ day_low: 0, day_high: 0 })} />);
    expect(container.querySelector('[data-part="range"]')!.textContent).toBe("");
    expect(container.querySelector('[data-part="range-rail"]')!.querySelector(".invisible")).toBeTruthy();
  });

  it("width-stable: the price is tabular (a tick changes digits, not width); the change holds its reservation", () => {
    const parts = (t: Trade) => {
      const { container } = render(<QuoteCell trade={t} />);
      return [(container.querySelector('[data-part="change"]') as HTMLElement).style.minWidth, container.querySelector('[data-part="price"]')!.className];
    };
    const a = parts(trade({ price: 253.69, percentage_change: 0.89 }));
    const b = parts(trade({ price: 249.1, percentage_change: -12.4, day_low: 0, day_high: 0 }));
    expect(b).toEqual(a);
    expect(a[0]).toBe(`${CHANGE_CH}ch`);
    expect(a[1]).toContain("tabular-nums");
    // The widest change fits its reservation.
    expect(changeText(-12.4).length).toBeLessThanOrEqual(CHANGE_CH);
  });
});
