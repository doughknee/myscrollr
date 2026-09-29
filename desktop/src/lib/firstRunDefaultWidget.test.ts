/**
 * firstRunDefaultWidget tests — the once-only rule and the
 * untouched-account rule from SCROLLR-246:
 *
 *   - A fresh, zero-widget, flag-false account is offered the default.
 *   - An account with any existing widget is left alone, regardless of
 *     the flag (the "untouched account" rule).
 *   - An account whose flag is already true is left alone even at zero
 *     widgets — this is what makes removing the default stick: it never
 *     comes back just because the widget count dropped to zero again.
 *   - `applyDefaultWidget` sets the flag before creating the widget, and
 *     never calls create if the flag write fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  shouldOfferDefaultWidget,
  applyDefaultWidget,
  useFirstRunDefaultWidget,
  DEFAULT_WIDGET_RETRY_MS,
  FIRST_RUN_DEFAULT_WIDGET,
} from "./firstRunDefaultWidget";
import type { DashboardResponse } from "../types";

vi.mock("../api/client", () => ({
  dataWidgetsApi: { create: vi.fn() },
  updatePreferences: vi.fn(),
}));
vi.mock("./windowRole", () => ({ ownsSharedConnection: vi.fn(async () => true) }));
vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

import { dataWidgetsApi, updatePreferences } from "../api/client";
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

describe("applyDefaultWidget", () => {
  beforeEach(() => {
    vi.mocked(updatePreferences).mockReset();
    vi.mocked(dataWidgetsApi.create).mockReset();
  });

  it("sets the once-flag before creating the widget", async () => {
    const order: string[] = [];
    vi.mocked(updatePreferences).mockImplementation(async () => {
      order.push("flag");
      return {} as never;
    });
    vi.mocked(dataWidgetsApi.create).mockImplementation(async () => {
      order.push("create");
      return {} as never;
    });

    await applyDefaultWidget();

    expect(order).toEqual(["flag", "create"]);
    expect(updatePreferences).toHaveBeenCalledWith({
      default_widgets_applied: true,
    });
    expect(dataWidgetsApi.create).toHaveBeenCalledWith(
      FIRST_RUN_DEFAULT_WIDGET,
      {},
    );
  });

  it("never creates the widget when the flag write fails", async () => {
    vi.mocked(updatePreferences).mockRejectedValue(new Error("network"));

    await expect(applyDefaultWidget()).rejects.toThrow("network");
    expect(dataWidgetsApi.create).not.toHaveBeenCalled();
  });
});

describe("useFirstRunDefaultWidget", () => {
  const fresh = dashboardWith([], false);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(updatePreferences).mockReset();
    vi.mocked(dataWidgetsApi.create).mockReset();
    vi.mocked(ownsSharedConnection).mockResolvedValue(true);
  });
  afterEach(() => vi.useRealTimers());

  const mount = (onApplied = vi.fn()) =>
    renderHook(() => useFirstRunDefaultWidget(true, fresh, onApplied));

  it("suppresses the CTA while applying, then calls onApplied once on success", async () => {
    vi.mocked(updatePreferences).mockResolvedValue({} as never);
    vi.mocked(dataWidgetsApi.create).mockResolvedValue({} as never);
    const onApplied = vi.fn();
    const { result } = mount(onApplied);
    expect(result.current).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(dataWidgetsApi.create).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("stops suppressing the CTA when the flag write rejects, retries once after 30 s, never loops", async () => {
    vi.mocked(updatePreferences).mockRejectedValue(new Error("network"));
    const onApplied = vi.fn();
    const { result } = mount(onApplied);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(false); // CTA is back
    expect(updatePreferences).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_WIDGET_RETRY_MS);
    });
    expect(updatePreferences).toHaveBeenCalledTimes(2); // the one retry
    expect(result.current).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * DEFAULT_WIDGET_RETRY_MS);
    });
    expect(updatePreferences).toHaveBeenCalledTimes(2); // no loop
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("a retry that succeeds calls onApplied", async () => {
    vi.mocked(updatePreferences)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({} as never);
    vi.mocked(dataWidgetsApi.create).mockResolvedValue({} as never);
    const onApplied = vi.fn();
    mount(onApplied);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_WIDGET_RETRY_MS);
    });
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a window that does not own the shared connection", async () => {
    vi.mocked(ownsSharedConnection).mockResolvedValue(false);
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_WIDGET_RETRY_MS);
    });
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result.current).toBe(true); // still awaiting the owner's result
  });
});
