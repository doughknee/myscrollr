/**
 * One answer to "is it on the ticker", and the two pure flips behind the
 * shared toggle. The disagreement this replaces: a disabled data widget
 * read as "on" in the ticker menu and "off" in the sidebar.
 */
import { describe, it, expect } from "vitest";
import { isOnTicker, tickerKindOf, withDataMembership, withUtilityToggled } from "./tickerMembership";
import { resetAll } from "../preferences";

const BASE = resetAll();
const prefs = (onTicker: string[]) => ({
  ...BASE,
  widgets: { ...BASE.widgets, widgetsOnTicker: onTicker },
});

describe("isOnTicker", () => {
  it("reads a data widget from its row, gated by enabled", () => {
    const rows = [
      { widget_type: "sports_mlb", enabled: true, ticker_enabled: true },
      { widget_type: "sports_nfl", enabled: true, ticker_enabled: false },
      { widget_type: "news_bbc", enabled: false, ticker_enabled: true },
      { widget_type: "finance_stocks", enabled: true },
    ];
    const p = prefs([]);
    expect(isOnTicker(p, rows, "sports_mlb")).toBe(true);
    expect(isOnTicker(p, rows, "sports_nfl")).toBe(false);
    // Disabled beats ticker_enabled -- this is the case the two menus disagreed on.
    expect(isOnTicker(p, rows, "news_bbc")).toBe(false);
    // An old row with no flag counts as on.
    expect(isOnTicker(p, rows, "finance_stocks")).toBe(true);
  });

  it("reads a utility from prefs, and never from a row", () => {
    expect(isOnTicker(prefs(["clock"]), [], "clock")).toBe(true);
    expect(isOnTicker(prefs([]), [], "clock")).toBe(false);
  });

  it("classifies by whether a row exists", () => {
    const rows = [{ widget_type: "sports_mlb" }];
    expect(tickerKindOf("sports_mlb", rows)).toBe("data");
    expect(tickerKindOf("clock", rows)).toBe("utility");
  });
});

describe("withUtilityToggled", () => {
  it("adds when absent, removes when present, and leaves the rest alone", () => {
    const a = withUtilityToggled(prefs(["clock"]), "weather");
    expect(a.widgets.widgetsOnTicker).toEqual(["clock", "weather"]);
    const b = withUtilityToggled(a, "clock");
    expect(b.widgets.widgetsOnTicker).toEqual(["weather"]);
  });
});

describe("withDataMembership", () => {
  const rows = [
    { widget_type: "sports_mlb", enabled: false, ticker_enabled: false },
    { widget_type: "news_bbc", enabled: true, ticker_enabled: true },
  ];
  it("turning on also enables the widget", () => {
    const out = withDataMembership(rows, "sports_mlb", true);
    expect(out[0]).toEqual({ widget_type: "sports_mlb", enabled: true, ticker_enabled: true });
    expect(out[1]).toBe(rows[1]);
  });
  it("turning off leaves enabled as it was", () => {
    const out = withDataMembership(rows, "news_bbc", false);
    expect(out[1]).toEqual({ widget_type: "news_bbc", enabled: true, ticker_enabled: false });
  });
});
