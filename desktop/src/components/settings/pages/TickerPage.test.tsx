import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TickerPage from "./TickerPage";
import { loadPrefs } from "../../../preferences";
import type { AppPreferences, ScrollMode } from "../../../preferences";

vi.mock("../../WindowControls", () => ({ IS_WINDOWS: false }));
vi.mock("../MonitorMap", () => ({
  IdentifyButton: () => null,
  MonitorsRows: () => null,
}));

afterEach(cleanup);

const DEFAULT_PREFS = loadPrefs();

function rowsFor(scrollMode: ScrollMode, prefs: AppPreferences = DEFAULT_PREFS) {
  const { container } = render(
    <TickerPage
      prefs={{ ...prefs, ticker: { ...prefs.ticker, scrollMode } }}
      onPrefsChange={vi.fn()}
    />,
  );
  return [...container.querySelectorAll("[data-row]")].map((r) => r.getAttribute("data-row"));
}

const radios = (group: string) =>
  [...screen.getByRole("radiogroup", { name: group }).querySelectorAll("[role=radio]")].map((r) => r.textContent);

describe("Settings > Ticker rows per scroll mode (SCROLLR-281)", () => {
  it("Pages hides Speed and On hover", () => {
    const rows = rowsFor("pages");
    for (const hidden of ["speed", "onHover"]) expect(rows).not.toContain(hidden);
    expect(rows).toContain("scrollMode");
  });

  it("Continuous shows Speed and On hover (all three options)", () => {
    const rows = rowsFor("continuous");
    for (const shown of ["speed", "onHover"]) expect(rows).toContain(shown);
    expect(radios("On hover")).toEqual(["Keep moving", "Slow down", "Pause"]);
  });

  /** SCROLLR-281: no colour or ordering settings in either mode. */
  it("never shows Colors or Item order", () => {
    for (const mode of ["pages", "continuous"] as const) {
      const rows = rowsFor(mode);
      expect(rows).not.toContain("chipColors");
      expect(rows).not.toContain("itemOrder");
      cleanup();
    }
  });
});
