import { describe, expect, it } from "vitest";
import { resolveInitialEntry } from "./routeCompat";

describe("resolveInitialEntry", () => {
  it("defaults to home with nothing persisted", () => {
    expect(resolveInitialEntry(null)).toBe("/");
  });

  it("passes current routes through untouched", () => {
    expect(resolveInitialEntry("/feed")).toBe("/feed");
    expect(resolveInitialEntry("/channel/finance_stocks")).toBe(
      "/channel/finance_stocks",
    );
  });

  it("collapses persisted tab routes from pre-teardown builds", () => {
    expect(resolveInitialEntry("/channel/finance/configuration")).toBe(
      "/channel/finance",
    );
    expect(resolveInitialEntry("/channel/sports_nfl/feed")).toBe(
      "/channel/sports_nfl",
    );
    expect(resolveInitialEntry("/widget/clock/configuration")).toBe(
      "/widget/clock",
    );
    expect(resolveInitialEntry("/widget/uptime/feed")).toBe("/widget/uptime");
  });

  it("leaves the widget info route alone", () => {
    expect(resolveInitialEntry("/widget/clock/info")).toBe("/widget/clock/info");
  });

  it("still applies the legacy exact-match redirects", () => {
    expect(resolveInitialEntry("/settings/general")).toBe("/settings");
    expect(resolveInitialEntry("/settings/ticker")).toBe("/ticker");
  });
});
