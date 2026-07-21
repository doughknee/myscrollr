import { describe, expect, it } from "vitest";
import {
  formatTickerStatus,
  getEffectiveDataWidgetTickerRow,
  getEffectiveWidgetTickerStatus,
} from "./tickerStatus";
import type { AppPreferences } from "../preferences";

function makePrefs(
  rows: { sources: string[] }[],
  widgetsOnTicker: string[] = [],
  pinnedWidgets: AppPreferences["widgets"]["pinnedWidgets"] = {},
): AppPreferences {
  return {
    appearance: { tickerLayout: { rows } },
    widgets: {
      widgetsOnTicker,
      pinnedWidgets,
    },
  } as unknown as AppPreferences;
}

describe("formatTickerStatus", () => {
  it("labels an assigned single-row source as on ticker", () => {
    expect(formatTickerStatus(0, 1)).toBe("On ticker");
  });

  it("labels an assigned multi-row source by row number", () => {
    expect(formatTickerStatus(1, 3)).toBe("Row 2");
  });

  it("labels unassigned sources as not on ticker", () => {
    expect(formatTickerStatus(null, 2)).toBe("Not on ticker");
  });
});

describe("getEffectiveDataWidgetTickerRow", () => {
  it("returns null for disabled widgets even when the legacy fallback would be row 0", () => {
    const prefs = makePrefs([{ sources: ["finance"] }]);

    expect(
      getEffectiveDataWidgetTickerRow(prefs, {
        widget_type: "sports",
        enabled: false,
        ticker_enabled: true,
      }),
    ).toBeNull();
  });

  it("returns null for enabled widgets excluded from explicit rows", () => {
    const prefs = makePrefs([{ sources: ["finance"] }]);

    expect(
      getEffectiveDataWidgetTickerRow(prefs, {
        widget_type: "sports",
        enabled: true,
        ticker_enabled: true,
      }),
    ).toBeNull();
  });

  it("uses the first empty row for ticker-enabled widgets when a row shows all sources", () => {
    const prefs = makePrefs([{ sources: ["finance"] }, { sources: [] }]);

    expect(
      getEffectiveDataWidgetTickerRow(prefs, {
        widget_type: "sports",
        enabled: true,
        ticker_enabled: true,
      }),
    ).toBe(1);
  });
});

describe("getEffectiveWidgetTickerStatus", () => {
  it("labels pinned widgets by their pin row", () => {
    const prefs = makePrefs(
      [{ sources: ["finance"] }, { sources: [] }],
      ["timer"],
      { timer: { side: "right", row: 1 } },
    );

    expect(getEffectiveWidgetTickerStatus(prefs, "timer")).toEqual({
      kind: "pinned",
      row: 1,
    });
  });

  it("returns off for pinned widgets filtered out of their pinned row", () => {
    const prefs = makePrefs(
      [{ sources: ["finance"] }],
      ["timer"],
      { timer: { side: "right", row: 0 } },
    );

    expect(getEffectiveWidgetTickerStatus(prefs, "timer")).toEqual({
      kind: "off",
      row: null,
    });
  });

  it("returns null for widgets excluded from explicit rows", () => {
    const prefs = makePrefs([{ sources: ["finance"] }], ["timer"]);

    expect(getEffectiveWidgetTickerStatus(prefs, "timer")).toEqual({
      kind: "off",
      row: null,
    });
  });
});
