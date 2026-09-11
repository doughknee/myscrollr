import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePostHogActivity } from "./usePostHogActivity";

const { capture } = vi.hoisted(() => ({
  capture: vi.fn(() => Promise.resolve()),
}));
vi.mock("../api/client", () => ({
  recordPostHogDesktopEvent: capture,
}));
vi.mock("../lib/windowRole", () => ({ isPrimaryTicker: () => true }));

describe("usePostHogActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capture.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing without consent", () => {
    renderHook(() =>
      usePostHogActivity({
        authenticated: true,
        enabled: false,
        categories: ["sports"],
        production: true,
      }),
    );
    vi.advanceTimersByTime(10 * 60_000);
    expect(capture).not.toHaveBeenCalled();
  });

  it("reports one open, coarse features, and delayed running", () => {
    renderHook(() =>
      usePostHogActivity({
        authenticated: true,
        enabled: true,
        categories: ["sports", "sports", "news"],
        production: true,
      }),
    );
    expect(capture.mock.calls).toEqual([
      [{ event: "desktop_app_opened" }],
      [{ event: "desktop_feature_configured", feature: "sports" }],
      [{ event: "desktop_feature_configured", feature: "news" }],
    ]);
    vi.advanceTimersByTime(30_000);
    expect(capture).toHaveBeenCalledWith({ event: "desktop_app_running" });
  });
});
