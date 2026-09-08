import { describe, it, expect, vi, beforeEach } from "vitest";

// @tauri-apps/api/window needs a Tauri webview; stub the two calls we use.
let label = "ticker";
let labels: string[] = ["ticker", "main"];

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label }),
  getAllWindows: async () => labels.map((l) => ({ label: l })),
}));

import { isTickerLabel, isPrimaryTicker, ownsSharedConnection } from "./windowRole";

beforeEach(() => {
  label = "ticker";
  labels = ["ticker", "main"];
});

describe("isTickerLabel", () => {
  it("matches what commands/window.rs calls a ticker", () => {
    expect(isTickerLabel("ticker")).toBe(true);
    expect(isTickerLabel("ticker-7")).toBe(true);
    expect(isTickerLabel("main")).toBe(false);
    expect(isTickerLabel("identify-1")).toBe(false);
  });
});

describe("ownsSharedConnection", () => {
  it("elects exactly one window across a multi-monitor set", async () => {
    labels = ["ticker", "ticker-2", "ticker-3", "main"];
    const owners: string[] = [];
    for (const l of labels) {
      label = l;
      if (await ownsSharedConnection()) owners.push(l);
    }
    expect(owners).toEqual(["ticker"]);
  });

  it("hands the connection to main only when no ticker window exists", async () => {
    labels = ["main"];
    label = "main";
    expect(await ownsSharedConnection()).toBe(true);

    // The ticker is back (its webview built, or a sync recreated it):
    // main must stand down on the next election.
    labels = ["main", "ticker"];
    expect(await ownsSharedConnection()).toBe(false);
  });

  it("keeps the ticker as owner when the main window is closed to tray", async () => {
    // startup.startInBackground: main is hidden, the bar keeps streaming.
    labels = ["ticker", "ticker-2"];
    label = "ticker";
    expect(await ownsSharedConnection()).toBe(true);
    label = "ticker-2";
    expect(await ownsSharedConnection()).toBe(false);
  });
});

describe("isPrimaryTicker", () => {
  it("is true in exactly one ticker window", () => {
    label = "ticker";
    expect(isPrimaryTicker()).toBe(true);
    label = "ticker-2";
    expect(isPrimaryTicker()).toBe(false);
    label = "main";
    expect(isPrimaryTicker()).toBe(false);
  });
});
