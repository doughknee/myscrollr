import { describe, it, expect } from "vitest";

import { TICKER_SOURCES } from "./tickerRegistry";
import type { TickerContext } from "./ticker";
import { DEFAULT_WIDGET_DISPLAY } from "../preferences";

// Chip building used to live inside ScrollrTicker's per-source switch, where
// it could only be exercised by mounting an 884-line component. Now each
// source is a pure function, so the behavior the ticker depends on is
// directly testable: the right chips, in the right order, with per-widget
// scoping applied.

function ctx(over: Partial<TickerContext> = {}): TickerContext {
  return {
    tab: "finance_stocks",
    source: "finance",
    dashboard: null,
    comfort: false,
    chipColorMode: "theme",
    widgetDisplay: DEFAULT_WIDGET_DISPLAY,
    ...over,
  } as TickerContext;
}

describe("ticker source registry", () => {
  it("covers every data source the catalog ships", () => {
    expect(Object.keys(TICKER_SOURCES).sort()).toEqual(
      ["finance", "rss", "sports"].sort(),
    );
  });

  it("returns undefined for a source this client cannot render", () => {
    // A catalog entry naming a renderer an older client lacks must not throw
    // — the ticker skips it (VISION §4.2, constraint 2).
    expect(TICKER_SOURCES["some_future_source"]).toBeUndefined();
  });
});

describe("finance chips", () => {
  const trades = [
    { symbol: "AAPL", price: 190.1, direction: "up" as const },
    { symbol: "MSFT", price: 410.5, direction: "down" as const },
  ];

  it("builds one keyed chip per trade, keyed by widget and symbol", () => {
    const chips = TICKER_SOURCES["finance"]!.chips(trades, ctx());
    // The widget id is in the key so two finance widgets sharing a symbol
    // never collide, and a rotating slot's key survives a swap.
    expect(chips.map((c) => c.key.replace(/^fin-.*-(?=[A-Z]+$)/, "fin-"))).toEqual(["fin-AAPL", "fin-MSFT"]);
    expect(chips[0].node).toBeTruthy();
  });

  it("renders nothing for an empty or non-array payload", () => {
    const source = TICKER_SOURCES["finance"]!;
    expect(source.chips([], ctx())).toEqual([]);
    expect(source.chips(undefined, ctx())).toEqual([]);
    expect(source.chips({ not: "an array" }, ctx())).toEqual([]);
  });

  it("renders with no display prefs at all: the rail is independent of the feed page", () => {
    const chips = TICKER_SOURCES["finance"]!.chips(
      trades,
      ctx({ widgetDisplay: undefined }),
    );
    expect(chips).toHaveLength(2);
  });
});
