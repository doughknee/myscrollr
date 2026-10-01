/**
 * firstRunDefaultWidget tests — the once-only rule, the untouched-account rule
 * (SCROLLR-246) and the starter sequence (SCROLLR-283):
 *
 *   - A fresh, zero-widget, flag-false account is offered the starter.
 *   - An account with any existing widget is left alone, regardless of
 *     the flag (the "untouched account" rule).
 *   - An account whose flag is already true is left alone even at zero
 *     widgets — this is what makes removing the starter stick: it never
 *     comes back just because the widget count dropped to zero again.
 *   - The starter is ONE server call (`applyStarter`); the Clock is turned on
 *     by the caller only after it succeeds, and never when the server had
 *     nothing to do. A failure brings the CTA back with exactly one retry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  shouldOfferDefaultWidget,
  applyStarterWidgets,
  withStarterClock,
  useFirstRunDefaultWidget,
  DEFAULT_WIDGET_RETRY_MS,
} from "./firstRunDefaultWidget";
import { loadPrefs } from "../preferences";
import type { DashboardResponse } from "../types";

vi.mock("../api/client", () => ({
  dataWidgetsApi: { applyStarter: vi.fn() },
}));
vi.mock("./windowRole", () => ({ ownsSharedConnection: vi.fn(async () => true) }));
vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

import { dataWidgetsApi } from "../api/client";
import { ownsSharedConnection } from "./windowRole";

function dashboardWith(
  widgets: DashboardResponse["widgets"],
  defaultWidgetsApplied: boolean,
): Pick<DashboardResponse, "widgets" | "preferences"> {
  return {
    widgets,
    preferences: {
      feed_mode: "comfort",
      feed_position: "bottom",
      feed_behavior: "overlay",
      feed_enabled: true,
      enabled_sites: [],
      disabled_sites: [],
      default_widgets_applied: defaultWidgetsApplied,
      updated_at: new Date().toISOString(),
    },
  };
}

describe("shouldOfferDefaultWidget", () => {
  it("is false when signed out, even for a fresh-looking dashboard", () => {
    expect(shouldOfferDefaultWidget(false, dashboardWith([], false))).toBe(false);
  });

  it("is false with no dashboard yet (nothing to decide from)", () => {
    expect(shouldOfferDefaultWidget(true, undefined)).toBe(false);
  });

  it("is true for a fresh, zero-widget, flag-false account", () => {
    expect(shouldOfferDefaultWidget(true, dashboardWith([], false))).toBe(true);
  });

  it("is false once the flag is true, even at zero widgets — removal stays removed", () => {
    expect(shouldOfferDefaultWidget(true, dashboardWith([], true))).toBe(false);
  });

  it("is false for an account with any existing widget, flag false or not (untouched account)", () => {
    const oneWidget = [
      {
        id: 1,
        widget_type: "finance_stocks",
        enabled: true,
        ticker_enabled: true,
        config: {},
        created_at: "",
        updated_at: "",
      },
    ] satisfies DashboardResponse["widgets"];
    expect(shouldOfferDefaultWidget(true, dashboardWith(oneWidget, false))).toBe(false);
    expect(shouldOfferDefaultWidget(true, dashboardWith(oneWidget, true))).toBe(false);
  });
});

describe("applyStarterWidgets", () => {
  // Braces: a beforeEach that returns the mock makes vitest call it as teardown.
  beforeEach(() => {
    vi.mocked(dataWidgetsApi.applyStarter).mockReset();
  });

  it("is one server call and reports whether the server applied the set", async () => {
    vi.mocked(dataWidgetsApi.applyStarter).mockResolvedValue({ applied: true, widgets: [] });
    expect(await applyStarterWidgets()).toBe(true);
    vi.mocked(dataWidgetsApi.applyStarter).mockResolvedValue({ applied: false, widgets: [] });
    expect(await applyStarterWidgets()).toBe(false);
    expect(dataWidgetsApi.applyStarter).toHaveBeenCalledTimes(2);
  });

  it("rejects when the server call fails (nothing else was attempted)", async () => {
    vi.mocked(dataWidgetsApi.applyStarter).mockRejectedValue(new Error("network"));
    await expect(applyStarterWidgets()).rejects.toThrow("network");
  });
});

describe("withStarterClock", () => {
  it("turns the clock on and onto the ticker when it is off", () => {
    const base = loadPrefs();
    const off = {
      ...base,
      widgets: { ...base.widgets, enabledWidgets: ["timer"], widgetsOnTicker: ["timer"] },
    };
    const next = withStarterClock(off);
    expect(next.widgets.enabledWidgets).toEqual(["timer", "clock"]);
    expect(next.widgets.widgetsOnTicker).toEqual(["timer", "clock"]);
  });

  it("returns the same object when the clock is already on (no write)", () => {
    const base = loadPrefs();
    const on = {
      ...base,
      widgets: { ...base.widgets, enabledWidgets: ["clock"], widgetsOnTicker: ["clock"] },
    };
    expect(withStarterClock(on)).toBe(on);
  });
});

describe("useFirstRunDefaultWidget", () => {
  const fresh = dashboardWith([], false);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(dataWidgetsApi.applyStarter).mockReset();
    vi.mocked(ownsSharedConnection).mockResolvedValue(true);
  });
  afterEach(() => vi.useRealTimers());

  const mount = (onApplied = vi.fn()) =>
    renderHook(() => useFirstRunDefaultWidget(true, fresh, onApplied));

  it("suppresses the CTA while applying, then calls onApplied(true) once on success", async () => {
    vi.mocked(dataWidgetsApi.applyStarter).mockResolvedValue({ applied: true, widgets: [] });
    const onApplied = vi.fn();
    const { result } = mount(onApplied);
    expect(result.current).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(dataWidgetsApi.applyStarter).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith(true);
  });

  it("passes applied=false through so the caller never enables the clock for a no-op", async () => {
    vi.mocked(dataWidgetsApi.applyStarter).mockResolvedValue({ applied: false, widgets: [] });
    const onApplied = vi.fn();
    mount(onApplied);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onApplied).toHaveBeenCalledWith(false);
  });

  it("on failure: CTA is back, onApplied never runs (no clock), one retry after 30 s, never loops", async () => {
    vi.mocked(dataWidgetsApi.applyStarter).mockRejectedValue(new Error("network"));
    const onApplied = vi.fn();
    const { result } = mount(onApplied);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(false); // CTA is back
    expect(dataWidgetsApi.applyStarter).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_WIDGET_RETRY_MS);
    });
    expect(dataWidgetsApi.applyStarter).toHaveBeenCalledTimes(2); // the one retry
    expect(result.current).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * DEFAULT_WIDGET_RETRY_MS);
    });
    expect(dataWidgetsApi.applyStarter).toHaveBeenCalledTimes(2); // no loop
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("a retry that succeeds calls onApplied(true)", async () => {
    vi.mocked(dataWidgetsApi.applyStarter)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ applied: true, widgets: [] });
    const onApplied = vi.fn();
    mount(onApplied);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_WIDGET_RETRY_MS);
    });
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith(true);
  });

  it("does nothing in a window that does not own the shared connection", async () => {
    vi.mocked(ownsSharedConnection).mockResolvedValue(false);
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_WIDGET_RETRY_MS);
    });
    expect(dataWidgetsApi.applyStarter).not.toHaveBeenCalled();
    expect(result.current).toBe(true); // still awaiting the owner's result
  });
});
