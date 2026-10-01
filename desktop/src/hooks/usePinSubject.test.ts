import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("../shell-context", () => ({ useShell: vi.fn() }));

import type { AppPreferences, WidgetPin } from "../preferences";
import { recordEdge, resetEdge } from "../lib/edgeMeasure";
import { applyPinToggle } from "./usePinSubject";

const pin = (widget: string, subject: string): WidgetPin => ({ widget, subject, side: "right" });
const prefs = (pins: WidgetPin[]) => ({ widgets: { pins } }) as unknown as AppPreferences;

afterEach(() => {
  resetEdge();
  vi.clearAllMocks();
});

describe("applyPinToggle: the 40% rule's refusal", () => {
  it("at 1280 beside clocks and weather, a second game is refused with the one-line message", () => {
    recordEdge({ label: "ticker", bar: 1280, util: 193 });
    const onChange = vi.fn();
    applyPinToggle(prefs([pin("sports_nfl", "Chicago Bears")]), onChange, "sports_nfl", "New York Giants", "Giants");
    expect(onChange).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("No room on the edge at this screen size — unpin Chicago Bears first");
  });

  it("the same pin goes through on a wide enough bar, and a third is not stopped by the old count", () => {
    recordEdge({ label: "ticker", bar: 3440, util: 193 });
    const onChange = vi.fn();
    applyPinToggle(prefs([pin("news_bbc", "a"), pin("news_bbc", "b")]), onChange, "news_bbc", "c", "BBC");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("the narrowest of two monitors decides", () => {
    recordEdge({ label: "ticker", bar: 3440, util: 193 });
    recordEdge({ label: "ticker-2", bar: 1280, util: 193 });
    const onChange = vi.fn();
    applyPinToggle(prefs([pin("sports_nfl", "Chicago Bears")]), onChange, "sports_nfl", "New York Giants", "Giants");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("no ticker reporting: the count cap and its old message", () => {
    const onChange = vi.fn();
    applyPinToggle(prefs([pin("sports_nfl", "A"), pin("sports_nfl", "B")]), onChange, "sports_nfl", "C", "C");
    expect(toast.error).toHaveBeenCalledWith("The ticker already holds 2 pins — unpin one to pin C");
  });
});
