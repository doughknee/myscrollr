/**
 * tips tests — verify the showTipOnce contract that gates first-run
 * discovery hints. The contract:
 *
 *   - Calling with an already-shown id is a no-op (returns false).
 *   - First call marks the id as shown synchronously BEFORE the toast
 *     renders so a re-entrant call from the same render cycle (e.g.
 *     React StrictMode double-invoke) only fires the toast once.
 *   - resetTipsShown clears the list.
 *
 * We don't assert on the actual sonner toast rendering here — sonner
 * is mocked out so the tests stay headless. The visible UX is covered
 * manually during QA.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { showTipOnce, resetTipsShown, TIP_IDS } from "./tips";
import type { AppPreferences } from "../preferences";

vi.mock("sonner", () => ({
  toast: {
    message: vi.fn(),
  },
}));

import { toast } from "sonner";

function makePrefs(tipsShown: string[] = []): AppPreferences {
  return {
    tipsShown,
  } as unknown as AppPreferences;
}

beforeEach(() => {
  vi.mocked(toast.message).mockClear();
});

describe("showTipOnce", () => {
  it("fires the toast and marks the tip shown when called fresh", () => {
    const prefs = makePrefs([]);
    const onPrefsChange = vi.fn();
    const fired = showTipOnce(
      TIP_IDS.TICKER_RIGHT_CLICK,
      prefs,
      onPrefsChange,
      { title: "Hello" },
    );
    expect(fired).toBe(true);
    expect(toast.message).toHaveBeenCalledTimes(1);
    expect(onPrefsChange).toHaveBeenCalledTimes(1);
    const [updated] = onPrefsChange.mock.calls[0];
    expect(updated.tipsShown).toContain(TIP_IDS.TICKER_RIGHT_CLICK);
  });

  it("is a no-op when the tip is already in tipsShown", () => {
    const prefs = makePrefs([TIP_IDS.TICKER_RIGHT_CLICK]);
    const onPrefsChange = vi.fn();
    const fired = showTipOnce(
      TIP_IDS.TICKER_RIGHT_CLICK,
      prefs,
      onPrefsChange,
      { title: "Hello" },
    );
    expect(fired).toBe(false);
    expect(toast.message).not.toHaveBeenCalled();
    expect(onPrefsChange).not.toHaveBeenCalled();
  });

  it("preserves other already-shown tip ids when adding a new one", () => {
    const prefs = makePrefs(["other-tip"]);
    const onPrefsChange = vi.fn();
    showTipOnce(
      TIP_IDS.TRAY_STILL_RUNNING,
      prefs,
      onPrefsChange,
      { title: "Tray" },
    );
    const [updated] = onPrefsChange.mock.calls[0];
    expect(updated.tipsShown).toEqual([
      "other-tip",
      TIP_IDS.TRAY_STILL_RUNNING,
    ]);
  });

  it("threads the action button through to sonner when provided", () => {
    const prefs = makePrefs([]);
    const onPrefsChange = vi.fn();
    const onAction = vi.fn();
    showTipOnce(TIP_IDS.TICKER_RIGHT_CLICK, prefs, onPrefsChange, {
      title: "Hello",
      actionLabel: "Show me",
      onAction,
    });
    const [, opts] = vi.mocked(toast.message).mock.calls[0];
    expect((opts as { action?: { label: string } }).action?.label).toBe(
      "Show me",
    );
  });

  it("uses the default 6s duration when none provided", () => {
    const prefs = makePrefs([]);
    showTipOnce(
      TIP_IDS.TICKER_RIGHT_CLICK,
      prefs,
      vi.fn(),
      { title: "Hello" },
    );
    const [, opts] = vi.mocked(toast.message).mock.calls[0];
    expect((opts as { duration?: number }).duration).toBe(6_000);
  });

  it("respects an explicit duration override", () => {
    const prefs = makePrefs([]);
    showTipOnce(
      TIP_IDS.TICKER_RIGHT_CLICK,
      prefs,
      vi.fn(),
      { title: "Hello", duration: 10_000 },
    );
    const [, opts] = vi.mocked(toast.message).mock.calls[0];
    expect((opts as { duration?: number }).duration).toBe(10_000);
  });
});

describe("resetTipsShown", () => {
  it("clears the array via onPrefsChange", () => {
    const prefs = makePrefs([
      TIP_IDS.TICKER_RIGHT_CLICK,
      TIP_IDS.TRAY_STILL_RUNNING,
    ]);
    const onPrefsChange = vi.fn();
    resetTipsShown(prefs, onPrefsChange);
    expect(onPrefsChange).toHaveBeenCalledTimes(1);
    const [updated] = onPrefsChange.mock.calls[0];
    expect(updated.tipsShown).toEqual([]);
  });
});
