import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "./useNow";

// The module-level interval is the whole point of this hook: one timer for
// every subscriber, started on the first mount and torn down on the last.
// The 0→1 resync is the subtle part — `now` is frozen while nobody is
// subscribed, so a component mounting after a quiet stretch must not render
// with a stale clock.

describe("useNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("advances once per second while mounted", () => {
    vi.setSystemTime(1_000_000);
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(1_000_000);

    // advanceTimersByTime moves the mocked wall clock too.
    act(() => void vi.advanceTimersByTime(3000));
    expect(result.current).toBe(1_003_000);
  });

  it("shares one interval across subscribers and clears it on the last unmount", () => {
    vi.setSystemTime(2_000_000);
    const a = renderHook(() => useNow());
    const b = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);

    a.unmount();
    expect(vi.getTimerCount()).toBe(1); // b still subscribed
    b.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resyncs on remount so a frozen clock never renders", () => {
    vi.setSystemTime(3_000_000);
    renderHook(() => useNow()).unmount();

    // Nobody subscribed for ten minutes — the module's `now` is stale.
    vi.setSystemTime(3_600_000);
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(3_600_000);
  });
});
