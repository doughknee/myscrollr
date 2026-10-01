import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TickerPage from "./TickerPage";
import { loadPrefs } from "../../../preferences";
import type { AppPreferences, HoverBehavior, ScrollMode } from "../../../preferences";

vi.mock("../../WindowControls", () => ({ IS_WINDOWS: false }));
vi.mock("../MonitorMap", () => ({
  IdentifyButton: () => null,
  MonitorsRows: () => null,
}));

afterEach(cleanup);

const DEFAULT_PREFS = loadPrefs();

function prefsFor(scrollMode: ScrollMode, onHover: HoverBehavior = DEFAULT_PREFS.ticker.onHover): AppPreferences {
  return { ...DEFAULT_PREFS, ticker: { ...DEFAULT_PREFS.ticker, scrollMode, onHover } };
}

function setup(prefs: AppPreferences) {
  const onPrefsChange = vi.fn();
  const { container } = render(<TickerPage prefs={prefs} onPrefsChange={onPrefsChange} />);
  const rows = () => [...container.querySelectorAll("[data-row]")].map((r) => r.getAttribute("data-row"));
  const radios = (group: string) =>
    [...screen.getByRole("radiogroup", { name: group }).querySelectorAll("[role=radio]")].map((r) => r.textContent);
  return { onPrefsChange, rows, radios };
}

describe("Settings > Ticker rows per scroll mode (SCROLLR-281)", () => {
  it("Pages hides Speed and Item order, and offers Hold page / Keep going", () => {
    const { rows, radios } = setup(prefsFor("pages"));
    expect(rows()).not.toContain("speed");
    expect(rows()).not.toContain("itemOrder");
    expect(rows()).toContain("onHover");
    expect(radios("On hover")).toEqual(["Hold page", "Keep going"]);
  });

  it("Continuous shows Speed and Item order, and keeps the three hover options", () => {
    const { rows, radios } = setup(prefsFor("continuous"));
    expect(rows()).toContain("speed");
    expect(rows()).toContain("itemOrder");
    expect(radios("On hover")).toEqual(["Keep moving", "Slow down", "Pause"]);
  });

  it("calls the colors row Colors in both modes", () => {
    for (const mode of ["pages", "continuous"] as const) {
      const { radios } = setup(prefsFor(mode));
      expect(radios("Colors")).toEqual(["Widget", "Theme", "Subtle"]);
      cleanup();
    }
  });

  it("shows both slow and pause as Hold page", () => {
    for (const hover of ["slow", "pause"] as const) {
      setup(prefsFor("pages", hover));
      expect(screen.getByRole("radio", { name: "Hold page" }).getAttribute("aria-checked")).toBe("true");
      cleanup();
    }
  });

  it("Keep going stores keep; Hold page from keep stores slow and leaves a stored pause alone", () => {
    const a = setup(prefsFor("pages", "slow"));
    fireEvent.click(screen.getByRole("radio", { name: "Keep going" }));
    expect(a.onPrefsChange.mock.calls[0][0].ticker.onHover).toBe("keep");
    cleanup();

    const b = setup(prefsFor("pages", "keep"));
    fireEvent.click(screen.getByRole("radio", { name: "Hold page" }));
    expect(b.onPrefsChange.mock.calls[0][0].ticker.onHover).toBe("slow");
    cleanup();

    const c = setup(prefsFor("pages", "pause"));
    fireEvent.click(screen.getByRole("radio", { name: "Hold page" }));
    expect(c.onPrefsChange.mock.calls[0][0].ticker.onHover).toBe("pause");
  });
});
