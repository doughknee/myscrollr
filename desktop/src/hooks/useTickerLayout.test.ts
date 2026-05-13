/**
 * useTickerLayout — invariant tests.
 *
 * These tests are the safety net for the central refactor (May 2026)
 * that collapsed two divergent row-pickers (Home page + Settings →
 * Ticker) into a single hook. The contract every screen relies on:
 *
 *   - rowCount mirrors the layout's actual length.
 *   - tierMaxRows is the cap from the user's tier.
 *   - canAddRow flips false the moment rowCount reaches tierMaxRows.
 *   - addRow() is a no-op when canAddRow is false (returns null,
 *     prefs unchanged).
 *   - addRow(sourceId) creates the row AND assigns the source to it,
 *     stripping it from any other row first (single-row exclusivity).
 *   - setSourceRow / removeRow funnel through the same `setTickerLayout`
 *     primitive so the empty-row fallback always holds.
 *
 * If any of these break, Home and Settings will diverge again. That's
 * the bug class this hook was written to kill, so these assertions are
 * non-negotiable.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTickerLayout } from "./useTickerLayout";
import type { AppPreferences } from "../preferences";
import type { SubscriptionTier } from "../auth";

function makePrefs(
  rows: { sources: string[] }[],
  enabledWidgets: string[] = [],
  widgetsOnTicker: string[] = [],
): AppPreferences {
  // Include the bits of `widgets` that `removeTickerRow` reads
  // (pinnedWidgets) so the helper can re-map pins on row deletion
  // without crashing. Other fields stay undefined — the cast covers
  // them since these tests only exercise the layout branch.
  return {
    appearance: {
      tickerLayout: { rows },
    },
    widgets: {
      pinnedWidgets: {},
      enabledWidgets,
      widgetsOnTicker,
    },
  } as unknown as AppPreferences;
}

function setupHook(
  initialRows: { sources: string[] }[],
  tier: SubscriptionTier = "uplink_pro",
  enabledWidgets: string[] = [],
  widgetsOnTicker: string[] = [],
) {
  // We mimic React state: the test holds the latest prefs and the
  // hook's onPrefsChange writes back into it. Subsequent renders pick
  // up the new prefs the same way the real app would.
  let prefs = makePrefs(initialRows, enabledWidgets, widgetsOnTicker);
  const onPrefsChange = vi.fn((next: AppPreferences) => {
    prefs = next;
  });

  const { result, rerender } = renderHook(() =>
    useTickerLayout(prefs, onPrefsChange, tier),
  );

  return {
    get prefs() {
      return prefs;
    },
    onPrefsChange,
    result,
    rerender: () => rerender(),
  };
}

describe("useTickerLayout — derived state", () => {
  it("rowCount mirrors the layout length", () => {
    const { result } = setupHook([{ sources: [] }, { sources: ["finance"] }]);
    expect(result.current.rowCount).toBe(2);
    expect(result.current.rows).toHaveLength(2);
  });

  it("tierMaxRows reflects the subscription tier", () => {
    expect(setupHook([{ sources: [] }], "free").result.current.tierMaxRows).toBe(1);
    expect(setupHook([{ sources: [] }], "uplink").result.current.tierMaxRows).toBe(2);
    expect(setupHook([{ sources: [] }], "uplink_pro").result.current.tierMaxRows).toBe(3);
  });

  it("canAddRow flips false at the tier cap", () => {
    expect(
      setupHook([{ sources: [] }], "free").result.current.canAddRow,
    ).toBe(false);
    expect(
      setupHook([{ sources: [] }], "uplink").result.current.canAddRow,
    ).toBe(true);
    expect(
      setupHook(
        [{ sources: [] }, { sources: [] }],
        "uplink",
      ).result.current.canAddRow,
    ).toBe(false);
    expect(
      setupHook(
        [{ sources: [] }, { sources: [] }, { sources: [] }],
        "uplink_pro",
      ).result.current.canAddRow,
    ).toBe(false);
  });

  it("canCustomize is gated on Ultimate or super_user", () => {
    expect(setupHook([{ sources: [] }], "free").result.current.canCustomize).toBe(false);
    expect(setupHook([{ sources: [] }], "uplink_pro").result.current.canCustomize).toBe(false);
    expect(setupHook([{ sources: [] }], "uplink_ultimate").result.current.canCustomize).toBe(true);
    expect(setupHook([{ sources: [] }], "super_user").result.current.canCustomize).toBe(true);
  });
});

describe("useTickerLayout — addRow", () => {
  it("appends an empty row when no source is provided", () => {
    const harness = setupHook([{ sources: ["finance"] }], "uplink");
    let returned: number | null = -1;
    act(() => {
      returned = harness.result.current.addRow();
    });
    expect(returned).toBe(1);
    expect(harness.prefs.appearance.tickerLayout.rows).toHaveLength(2);
    expect(harness.prefs.appearance.tickerLayout.rows[1].sources).toEqual([]);
    // Existing row untouched.
    expect(harness.prefs.appearance.tickerLayout.rows[0].sources).toEqual([
      "finance",
    ]);
  });

  it("seeds the new row with the source AND strips it from any other row", () => {
    const harness = setupHook(
      [{ sources: ["finance", "sports"] }],
      "uplink",
    );
    act(() => {
      harness.result.current.addRow("finance");
    });
    expect(harness.prefs.appearance.tickerLayout.rows).toHaveLength(2);
    // finance is now exclusively in row 1.
    expect(harness.prefs.appearance.tickerLayout.rows[0].sources).toEqual([
      "sports",
    ]);
    expect(harness.prefs.appearance.tickerLayout.rows[1].sources).toEqual([
      "finance",
    ]);
  });

  it("returns null and is a no-op at the tier cap", () => {
    const harness = setupHook([{ sources: [] }], "free");
    let returned: number | null = -1;
    act(() => {
      returned = harness.result.current.addRow();
    });
    expect(returned).toBeNull();
    expect(harness.prefs.appearance.tickerLayout.rows).toHaveLength(1);
    expect(harness.onPrefsChange).not.toHaveBeenCalled();
  });

  it("returns the new row's index so callers can chain assignments", () => {
    const harness = setupHook(
      [{ sources: [] }, { sources: [] }],
      "uplink_pro",
    );
    let returned: number | null = -1;
    act(() => {
      returned = harness.result.current.addRow();
    });
    expect(returned).toBe(2);
  });

  it("adds seeded enabled widgets to widgetsOnTicker", () => {
    const harness = setupHook(
      [{ sources: [] }],
      "uplink",
      ["timer"],
      [],
    );
    act(() => {
      harness.result.current.addRow("timer");
    });
    expect(harness.prefs.appearance.tickerLayout.rows[1].sources).toEqual([
      "timer",
    ]);
    expect(harness.prefs.widgets.widgetsOnTicker).toEqual(["timer"]);
  });
});

describe("useTickerLayout — setSourceRow / removeRow", () => {
  it("setSourceRow moves a source between rows exclusively", () => {
    const harness = setupHook(
      [{ sources: ["finance", "rss"] }, { sources: [] }],
      "uplink",
    );
    act(() => {
      harness.result.current.setSourceRow("finance", 1);
    });
    expect(harness.prefs.appearance.tickerLayout.rows[0].sources).toEqual([
      "rss",
    ]);
    expect(harness.prefs.appearance.tickerLayout.rows[1].sources).toEqual([
      "finance",
    ]);
  });

  it("setSourceRow with null removes the source from every row", () => {
    const harness = setupHook(
      [{ sources: ["finance"] }, { sources: ["rss"] }],
      "uplink",
    );
    act(() => {
      harness.result.current.setSourceRow("finance", null);
    });
    expect(harness.prefs.appearance.tickerLayout.rows[0].sources).toEqual([]);
    expect(harness.prefs.appearance.tickerLayout.rows[1].sources).toEqual([
      "rss",
    ]);
  });

  it("setSourceRow adds enabled widgets to widgetsOnTicker", () => {
    const harness = setupHook(
      [{ sources: [] }, { sources: [] }],
      "uplink",
      ["timer"],
      [],
    );
    act(() => {
      harness.result.current.setSourceRow("timer", 1);
    });
    expect(harness.prefs.appearance.tickerLayout.rows[1].sources).toEqual([
      "timer",
    ]);
    expect(harness.prefs.widgets.widgetsOnTicker).toEqual(["timer"]);
  });

  it("setSourceRow removes enabled widgets from widgetsOnTicker when row is null", () => {
    const harness = setupHook(
      [{ sources: ["timer"] }],
      "uplink",
      ["timer"],
      ["clock", "timer"],
    );
    act(() => {
      harness.result.current.setSourceRow("timer", null);
    });
    expect(harness.prefs.appearance.tickerLayout.rows[0].sources).toEqual([]);
    expect(harness.prefs.widgets.widgetsOnTicker).toEqual(["clock"]);
  });

  it("setSourceRow preserves channel widgetsOnTicker behavior", () => {
    const harness = setupHook(
      [{ sources: [] }, { sources: [] }],
      "uplink",
      ["timer"],
      ["timer"],
    );
    act(() => {
      harness.result.current.setSourceRow("finance", 1);
    });
    expect(harness.prefs.appearance.tickerLayout.rows[1].sources).toEqual([
      "finance",
    ]);
    expect(harness.prefs.widgets.widgetsOnTicker).toEqual(["timer"]);
  });

  it("removeRow drops a row and never collapses below 1", () => {
    const harness = setupHook(
      [{ sources: ["finance"] }, { sources: ["rss"] }],
      "uplink",
    );
    act(() => {
      harness.result.current.removeRow(1);
    });
    expect(harness.prefs.appearance.tickerLayout.rows).toHaveLength(1);
    expect(harness.prefs.appearance.tickerLayout.rows[0].sources).toEqual([
      "finance",
    ]);
  });

  it("removeRow on a single-row layout is a no-op (preserves trailing fallback)", () => {
    const harness = setupHook([{ sources: ["finance"] }], "uplink");
    act(() => {
      harness.result.current.removeRow(0);
    });
    expect(harness.prefs.appearance.tickerLayout.rows).toHaveLength(1);
  });
});

describe("useTickerLayout — Home/Settings invariant", () => {
  // The whole point of the hook: same prefs in → same shape out, no
  // matter which screen consumes it. If Home reads the hook with
  // tier=uplink_pro and Settings reads it with tier=uplink_pro, both
  // surfaces MUST see identical canAddRow / rowCount / tierMaxRows
  // values. This test wires up two simultaneous hook instances against
  // the same prefs and asserts they match.
  it("two hook instances on the same prefs derive identical state", () => {
    const prefs = makePrefs([{ sources: ["finance"] }, { sources: [] }]);
    const noop = () => {};

    const home = renderHook(() =>
      useTickerLayout(prefs, noop, "uplink_pro"),
    ).result.current;
    const settings = renderHook(() =>
      useTickerLayout(prefs, noop, "uplink_pro"),
    ).result.current;

    expect(home.rowCount).toBe(settings.rowCount);
    expect(home.tierMaxRows).toBe(settings.tierMaxRows);
    expect(home.canAddRow).toBe(settings.canAddRow);
    expect(home.canCustomize).toBe(settings.canCustomize);
    expect(home.rows).toEqual(settings.rows);
  });
});
