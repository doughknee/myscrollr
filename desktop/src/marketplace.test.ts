import { describe, it, expect, vi } from "vitest";

import {
  catalogVersion,
  catalogWidgets,
  getCatalogItems,
  catalogItemById,
  sourceForWidget,
  assetClassForWidget,
  addConfigForWidget,
  refreshCatalog,
  subscribeCatalog,
  CANONICAL_ORDER,
} from "./marketplace";
import type { CatalogPayload } from "./types";

// The catalog is server-owned, but the client must render before (and
// without) a successful fetch. These cover that seam: the bundled snapshot
// is a usable catalog on its own, and a refresh either improves on it or
// changes nothing.

describe("bundled snapshot", () => {
  it("is a usable catalog offline", () => {
    expect(catalogVersion()).toMatch(/^[0-9a-f]+$/);
    expect(catalogWidgets().length).toBeGreaterThan(0);
  });

  it("resolves widgets to their renderer source, not a user-facing group", () => {
    expect(sourceForWidget("sports_nfl")).toBe("sports");
    expect(sourceForWidget("news_bbc")).toBe("rss");
    expect(sourceForWidget("predictions")).toBe("predictions");
    // Utilities have no data source.
    expect(sourceForWidget("clock")).toBeUndefined();
    expect(sourceForWidget("nope_not_real")).toBeUndefined();
  });

  it("carries the config that gets POSTed on add", () => {
    expect(addConfigForWidget("sports_nfl")).toEqual({ leagues: ["NFL"] });
    expect(assetClassForWidget("finance_stocks")).toBe("stock");
    expect(assetClassForWidget("finance_crypto")).toBe("crypto");
    expect(assetClassForWidget("sports_nfl")).toBeUndefined();
  });

  it("builds catalog items with server identity and a client renderer", () => {
    const items = getCatalogItems();
    expect(items.length).toBeGreaterThan(0);

    const kalshi = catalogItemById("predictions");
    expect(kalshi).toBeDefined();
    // Identity comes from the server…
    expect(kalshi!.name).toBe("Kalshi");
    expect(kalshi!.hex).toBe("#1fc9a0");
    expect(kalshi!.category).toBe("predictions");
    // …the renderer comes from the client.
    expect(kalshi!.icon).toBeDefined();
  });

  it("orders by the server's declaration order", () => {
    expect(CANONICAL_ORDER.indexOf("finance_stocks")).toBeLessThan(
      CANONICAL_ORDER.indexOf("clock"),
    );
    expect(CANONICAL_ORDER).toContain("predictions");
  });
});

describe("refreshCatalog", () => {
  it("keeps the snapshot when the server is unreachable", async () => {
    const before = catalogVersion();
    const changed = await refreshCatalog(() =>
      Promise.reject(new Error("offline")),
    );
    expect(changed).toBe(false);
    expect(catalogVersion()).toBe(before);
    expect(catalogWidgets().length).toBeGreaterThan(0);
  });

  it("ignores an empty catalog rather than blanking the ticker", async () => {
    const before = catalogVersion();
    const changed = await refreshCatalog(async () => ({
      version: "empty",
      widgets: [],
    }));
    expect(changed).toBe(false);
    expect(catalogVersion()).toBe(before);
  });

  it("swaps in a newer catalog and notifies subscribers", async () => {
    const notified = vi.fn();
    const unsubscribe = subscribeCatalog(notified);

    const next: CatalogPayload = {
      version: "test-version",
      widgets: [
        {
          id: "sports_nfl",
          name: "Renamed NFL",
          description: "from the server",
          kind: "data",
          source: "sports",
          category: "sports",
          color: "#123456",
          required_tier: "free",
          order: 0,
        },
      ],
    };

    const changed = await refreshCatalog(async () => next);
    expect(changed).toBe(true);
    expect(notified).toHaveBeenCalledTimes(1);

    // A server-side rename reaches the UI with no client release.
    expect(catalogItemById("sports_nfl")!.name).toBe("Renamed NFL");
    // …and a widget the server dropped is gone.
    expect(catalogItemById("predictions")).toBeUndefined();

    // Re-fetching the same version is a no-op, so no needless re-render.
    const again = await refreshCatalog(async () => next);
    expect(again).toBe(false);
    expect(notified).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
