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
import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldOfferDefaultWidget, applyDefaultWidget, FIRST_RUN_DEFAULT_WIDGET } from "./firstRunDefaultWidget";
import type { DashboardResponse } from "../types";

vi.mock("../api/client", () => ({
  dataWidgetsApi: { create: vi.fn() },
  preferencesApi: { update: vi.fn() },
}));

import { dataWidgetsApi, preferencesApi } from "../api/client";

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
    vi.mocked(preferencesApi.update).mockReset();
    vi.mocked(dataWidgetsApi.create).mockReset();
  });

  it("sets the once-flag before creating the widget", async () => {
    const order: string[] = [];
    vi.mocked(preferencesApi.update).mockImplementation(async () => {
      order.push("flag");
      return {} as never;
    });
    vi.mocked(dataWidgetsApi.create).mockImplementation(async () => {
      order.push("create");
      return {} as never;
    });

    await applyDefaultWidget();

    expect(order).toEqual(["flag", "create"]);
    expect(preferencesApi.update).toHaveBeenCalledWith({
      default_widgets_applied: true,
    });
    expect(dataWidgetsApi.create).toHaveBeenCalledWith(
      FIRST_RUN_DEFAULT_WIDGET,
      {},
    );
  });

  it("never creates the widget when the flag write fails", async () => {
    vi.mocked(preferencesApi.update).mockRejectedValue(new Error("network"));

    await expect(applyDefaultWidget()).rejects.toThrow("network");
    expect(dataWidgetsApi.create).not.toHaveBeenCalled();
  });
});
