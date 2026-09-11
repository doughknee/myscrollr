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
  record: vi.fn<(categories: string[], signal: AbortSignal) => Promise<unknown>>(async () => ({})),
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
  mocks.record.mockReset();
  mocks.record.mockResolvedValue({});
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

  it("keeps the same-day send and retry budget across disqualification", () => {
    const sent = { ...initialQualification("2026-09-10", 0), sent: true, attempts: 1 };
    expect(advanceQualification(sent, { nowMs: 1_000, utcDay: "2026-09-10", eligible: false })).toMatchObject({
      sent: true,
      attempts: 1,
      elapsedMs: 0,
    });

    const failed = { ...initialQualification("2026-09-10", 0), attempts: 2 };
    expect(advanceQualification(failed, { nowMs: 1_000, utcDay: "2026-09-10", eligible: false })).toMatchObject({
      sent: false,
      attempts: 2,
      elapsedMs: 0,
    });
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

  it("does not resume a pending visibility check after cleanup", async () => {
    vi.useFakeTimers();
    let resolveVisible!: (visible: boolean) => void;
    mocks.isVisible.mockReturnValue(new Promise((resolve) => { resolveVisible = resolve; }));
    const { unmount } = renderHook(() =>
      useProductActivity({ authenticated: true, optedIn: true, widgetIds: ["sports_nfl"], resolveCategory: () => "sports", production: true }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(31_000));
    unmount();
    await act(async () => resolveVisible(true));
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("keeps checking eligibility and aborts a pending report", async () => {
    vi.useFakeTimers();
    let aborted = false;
    mocks.record.mockImplementation((_categories: string[], signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));
    renderHook(() =>
      useProductActivity({ authenticated: true, optedIn: true, widgetIds: ["sports_nfl"], resolveCategory: () => "sports", production: true }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(31_000));
    mocks.isVisible.mockResolvedValue(false);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(aborted).toBe(true);
  });

  it("aborts a pending report at UTC rollover", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T23:59:20Z"));
    let aborted = false;
    mocks.record.mockImplementation((_categories: string[], signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));
    renderHook(() =>
      useProductActivity({ authenticated: true, optedIn: true, widgetIds: ["sports_nfl"], resolveCategory: () => "sports", production: true }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(31_000));
    vi.setSystemTime(new Date("2026-09-11T00:00:00Z"));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(aborted).toBe(true);
  });

  it("aborts a pending report after a suspend-sized gap", async () => {
    vi.useFakeTimers();
    let abortSeen = false;
    let resolveVisible!: (visible: boolean) => void;
    mocks.record.mockImplementation((_categories: string[], signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        abortSeen = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));
    renderHook(() =>
      useProductActivity({ authenticated: true, optedIn: true, widgetIds: ["sports_nfl"], resolveCategory: () => "sports", production: true }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(31_000));
    mocks.isVisible.mockReturnValue(new Promise((resolve) => { resolveVisible = resolve; }));
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    await act(async () => resolveVisible(true));
    expect(abortSeen).toBe(true);
  });
});
