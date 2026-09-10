import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceQualification,
  categoriesForTicker,
  initialQualification,
  useProductActivity,
} from "./useProductActivity";

const mocks = vi.hoisted(() => ({
  isPrimary: vi.fn(() => true),
  isVisible: vi.fn(async () => true),
  record: vi.fn(async () => ({})),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isVisible: mocks.isVisible }),
}));
vi.mock("../lib/windowRole", () => ({ isPrimaryTicker: mocks.isPrimary }));
vi.mock("../api/client", () => ({ recordProductActivity: mocks.record }));

afterEach(() => {
  vi.useRealTimers();
  mocks.isPrimary.mockReturnValue(true);
  mocks.isVisible.mockResolvedValue(true);
  mocks.record.mockClear();
});

describe("product activity qualification", () => {
  it("requires 30 continuous eligible seconds and reports once per UTC day", () => {
    let state = initialQualification("2026-09-10", 0);
    for (let nowMs = 1_000; nowMs <= 30_000; nowMs += 1_000) {
      state = advanceQualification(state, { nowMs, utcDay: "2026-09-10", eligible: true });
    }
    expect(state.ready).toBe(true);
    state = { ...state, sent: true, ready: false };
    expect(advanceQualification(state, { nowMs: 31_000, utcDay: "2026-09-10", eligible: true }).ready).toBe(false);
  });

  it("resets on hidden, paused, suspend-sized gaps and UTC rollover", () => {
    let state = initialQualification("2026-09-10", 0);
    state = advanceQualification(state, { nowMs: 15_000, utcDay: "2026-09-10", eligible: true });
    state = advanceQualification(state, { nowMs: 16_000, utcDay: "2026-09-10", eligible: false });
    expect(state.elapsedMs).toBe(0);
    state = advanceQualification(state, { nowMs: 18_000, utcDay: "2026-09-10", eligible: true });
    state = advanceQualification(state, { nowMs: 25_000, utcDay: "2026-09-10", eligible: true });
    expect(state.elapsedMs).toBe(0);
    state = advanceQualification(state, { nowMs: 26_000, utcDay: "2026-09-11", eligible: true });
    expect(state.day).toBe("2026-09-11");
    expect(state.elapsedMs).toBe(0);
  });

  it("maps enabled ticker widgets to fixed coarse families", () => {
    expect(
      categoriesForTicker(
        ["sports_nfl", "stocks", "news_bbc", "clock", "sports_mlb"],
        (id) =>
          ({
            sports_nfl: "sports",
            stocks: "finance",
            news_bbc: "rss",
            clock: "utility",
            sports_mlb: "sports",
          })[id],
      ),
    ).toEqual(["sports", "markets", "news", "utilities"]);
  });

  it("reports only from the primary, natively visible ticker", async () => {
    vi.useFakeTimers();
    const resolve = () => "sports";
    renderHook(() =>
      useProductActivity({ authenticated: true, optedIn: true, widgetIds: ["sports_nfl"], resolveCategory: resolve, production: true }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(31_000));
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith(["sports"], expect.any(AbortSignal));
  });

  it("does not count secondary monitors or native-hidden windows", async () => {
    vi.useFakeTimers();
    mocks.isPrimary.mockReturnValue(false);
    const resolve = () => "sports";
    const first = renderHook(() =>
      useProductActivity({ authenticated: true, optedIn: true, widgetIds: ["sports_nfl"], resolveCategory: resolve, production: true }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(31_000));
    expect(mocks.record).not.toHaveBeenCalled();
    first.unmount();

    mocks.isPrimary.mockReturnValue(true);
    mocks.isVisible.mockResolvedValue(false);
    renderHook(() =>
      useProductActivity({ authenticated: true, optedIn: true, widgetIds: ["sports_nfl"], resolveCategory: resolve, production: true }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(31_000));
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
