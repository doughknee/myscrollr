import { describe, it, expect } from "vitest";

import { isMountable } from "./routePaths";

/**
 * The persisted `scrollr:lastRoute` can predate a route rename, so a saved
 * path must be checked before it is restored — otherwise the app opens on a
 * route that no longer exists.
 *
 * This replaced routeCompat.ts and three redirect shims (VISION §7.10),
 * which mapped specific dead paths by hand. These cases include the paths
 * those shims covered, to show the replacement is strictly broader.
 */
const ROUTE_IDS = [
  "/",
  "/account",
  "/catalog",
  "/customize",
  "/feed",
  "/updates",
  "/status",
  "/support",
  "/widget/$id",
  "/widget/$id/info",
];

describe("isMountable", () => {
  it("accepts live static routes", () => {
    for (const path of ["/", "/catalog", "/customize", "/account"]) {
      expect(isMountable(path, ROUTE_IDS), path).toBe(true);
    }
  });

  it("accepts a dynamic path against its template", () => {
    expect(isMountable("/widget/sports_nfl", ROUTE_IDS)).toBe(true);
    expect(isMountable("/widget/news_bbc/info", ROUTE_IDS)).toBe(true);
  });

  it("rejects the routes the deleted shims used to redirect", () => {
    // /channel/$type, /ticker, /settings — and the nested settings paths
    // routeCompat's ROUTE_REDIRECTS table handled.
    for (const dead of [
      "/channel/sports_nfl",
      "/ticker",
      "/settings",
      "/settings/general",
      "/settings/ticker",
      "/settings/account",
    ]) {
      expect(isMountable(dead, ROUTE_IDS), dead).toBe(false);
    }
  });

  it("rejects dead paths nobody enumerated", () => {
    // The point of matching against the route tree: paths the old
    // hand-kept table never knew about are rejected too.
    for (const dead of [
      "/widget/sports_nfl/configuration",
      "/widget/sports_nfl/feed",
      "/some/route/from/the/future",
      "/catalogue",
    ]) {
      expect(isMountable(dead, ROUTE_IDS), dead).toBe(false);
    }
  });

  it("does not match a shorter or longer path against a template", () => {
    expect(isMountable("/widget", ROUTE_IDS)).toBe(false);
    expect(isMountable("/widget/sports_nfl/info/extra", ROUTE_IDS)).toBe(false);
  });
});
