/**
 * These cases used to be about which ROW a source landed on — the
 * ticker supported two or three, with per-row source assignment and a
 * fallback row that showed everything. That layer is gone, so what's
 * left to pin down is narrower but still worth guarding: a disabled
 * widget is never on the ticker regardless of its ticker flag, and a
 * pin only counts when the widget is on the ticker in the first place.
 */
import { describe, expect, it } from "vitest";
import {
  formatEffectiveWidgetTickerStatus,
  formatTickerStatus,
  isDataWidgetOnTicker,
  getEffectiveWidgetTickerStatus,
} from "./tickerStatus";
import type { AppPreferences } from "../preferences";

function makePrefs(
  widgetsOnTicker: string[] = [],
  pinnedWidgets: AppPreferences["widgets"]["pinnedWidgets"] = {},
): AppPreferences {
  return {
    widgets: { widgetsOnTicker, pinnedWidgets },
  } as unknown as AppPreferences;
}

describe("formatTickerStatus", () => {
  it("distinguishes on from off", () => {
    expect(formatTickerStatus(true)).toBe("On ticker");
    expect(formatTickerStatus(false)).toBe("Not on ticker");
  });
});

describe("isDataWidgetOnTicker", () => {
  it("is false for a disabled widget even when its ticker flag is set", () => {
    expect(
      isDataWidgetOnTicker(makePrefs(), {
        widget_type: "sports",
        enabled: false,
        ticker_enabled: true,
      }),
    ).toBe(false);
  });

  it("is false for an enabled widget with the ticker flag off", () => {
    expect(
      isDataWidgetOnTicker(makePrefs(), {
        widget_type: "sports",
        enabled: true,
        ticker_enabled: false,
      }),
    ).toBe(false);
  });

  it("is true for an enabled, ticker-enabled widget", () => {
    expect(
      isDataWidgetOnTicker(makePrefs(), {
        widget_type: "sports",
        enabled: true,
        ticker_enabled: true,
      }),
    ).toBe(true);
  });
});

describe("getEffectiveWidgetTickerStatus", () => {
  it("reports a widget that is on the ticker as scrolling", () => {
    expect(getEffectiveWidgetTickerStatus(makePrefs(["timer"]), "timer")).toEqual(
      { kind: "scrolling" },
    );
  });

  it("reports a pinned widget as pinned", () => {
    const prefs = makePrefs(["timer"], { timer: { side: "right" } });
    expect(getEffectiveWidgetTickerStatus(prefs, "timer")).toEqual({
      kind: "pinned",
    });
  });

  /** A stale pin must not resurrect a widget the user took off. */
  it("reports off for a pinned widget that is not on the ticker", () => {
    const prefs = makePrefs([], { timer: { side: "right" } });
    expect(getEffectiveWidgetTickerStatus(prefs, "timer")).toEqual({
      kind: "off",
    });
  });

  it("reports off for a widget that is not on the ticker", () => {
    expect(getEffectiveWidgetTickerStatus(makePrefs(), "timer")).toEqual({
      kind: "off",
    });
  });
});

describe("formatEffectiveWidgetTickerStatus", () => {
  it("labels each kind", () => {
    expect(formatEffectiveWidgetTickerStatus({ kind: "pinned" })).toBe("Pinned");
    expect(formatEffectiveWidgetTickerStatus({ kind: "scrolling" })).toBe(
      "On ticker",
    );
    expect(formatEffectiveWidgetTickerStatus({ kind: "off" })).toBe(
      "Not on ticker",
    );
  });
});
