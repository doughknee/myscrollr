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
  canonicalOrder,
  isUtilityWidget,
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
    const order = canonicalOrder();
    expect(order.indexOf("finance_stocks")).toBeLessThan(order.indexOf("clock"));
    expect(order).toContain("predictions");
  });
});

describe("refreshCatalog", () => {
  it("keeps the snapshot when the server is unreachable", async () => {
    const before = catalogVersion();
    const changed = await refreshCatalog(() =>
      Promise.reject(new Error("offline")),
    );
    expect(changed).toBe("failed");
    expect(catalogVersion()).toBe(before);
    expect(catalogWidgets().length).toBeGreaterThan(0);
  });

  it("ignores an empty catalog rather than blanking the ticker", async () => {
    const before = catalogVersion();
    const changed = await refreshCatalog(async () => ({
      version: "empty",
      widgets: [],
    }));
    expect(changed).toBe("failed");
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

          source: "sports",
          category: "sports",
          color: "#123456",
          required_tier: "free",
          order: 0,
        },
      ],
    };

    const changed = await refreshCatalog(async () => next);
    expect(changed).toBe("updated");
    expect(notified).toHaveBeenCalledTimes(1);

    // A server-side rename reaches the UI with no client release.
    expect(catalogItemById("sports_nfl")!.name).toBe("Renamed NFL");
    // …and a widget the server dropped is gone.
    expect(catalogItemById("predictions")).toBeUndefined();

    // Re-fetching the same version is a no-op, so no needless re-render.
    const again = await refreshCatalog(async () => next);
    expect(again).toBe("unchanged");
    expect(notified).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});

// The whole point of a server-authoritative catalog: add a widget server-side
// and it appears with no client release. That did not work. `CANONICAL_ORDER`
// was a module-load const built from the bundled snapshot, so a refresh could
// never extend it — and the sidebar builds nav by iterating that list and
// silently skipping ids it does not contain, so a server-added widget was
// invisible in navigation even once the Library knew about it.
describe("a widget the bundled snapshot has never seen", () => {
  it("appears in the catalog, the order, and the sidebar's lookup", async () => {
    const result = await refreshCatalog(async () => ({
      version: "with-a-new-league",
      widgets: [
        {
          id: "sports_nfl",
          name: "NFL",
          description: "already shipped",
          source: "sports",
          category: "sports",
          color: "#013369",
          required_tier: "free",
          order: 0,
        },
        {
          // Not in catalog.snapshot.json. Reuses the sports renderer, which
          // is what makes it a server-only addition in the first place.
          id: "sports_cfl",
          name: "CFL",
          description: "added server-side, after this client shipped",
          source: "sports",
          category: "sports",
          color: "#a6192e",
          required_tier: "free",
          order: 1,
        },
      ],
    }));
    expect(result).toBe("updated");

    expect(getCatalogItems().map((i) => i.id)).toContain("sports_cfl");

    // The sidebar's exact mechanism, without rendering it: iterate the order,
    // resolve each id. Both steps have to work or the widget has no nav entry.
    const order = canonicalOrder();
    expect(order).toContain("sports_cfl");
    expect(catalogItemById("sports_cfl")).toBeDefined();
    expect(catalogItemById("sports_cfl")!.name).toBe("CFL");

    // Locally-registered utilities the server does not list still survive.
    expect(order).toContain("clock");
  });
});

// isUtilityWidget is the single answer to "does this widget have a server row?"
// It routes widget pages, the add/remove flows and the shell's route parsing,
// and it had no test at all until it already had four callers.
describe("isUtilityWidget", () => {
  it("distinguishes utilities from data widgets in the catalog", async () => {
    await refreshCatalog(async () => ({
      version: "utility-cases",
      widgets: [
        {
          id: "sports_nfl", name: "NFL", description: "d", source: "sports",
          category: "sports", color: "#013369", required_tier: "free", order: 0,
        },
        {
          id: "clock", name: "Clock", description: "d",
          category: "utility", color: "#6366f1", required_tier: "free", order: 1,
        },
      ],
    }));

    expect(isUtilityWidget("clock")).toBe(true);
    expect(isUtilityWidget("sports_nfl")).toBe(false);
  });

  it("still recognises a utility the catalog has never heard of", async () => {
    // The catalog is server-owned and refreshes at runtime, so it may legally
    // omit a widget this build registers locally — canonicalOrder() appends
    // exactly those. Requiring a catalog hit sent them down the data-widget
    // path, where the page renders an "add this widget" empty state instead of
    // the widget. Falls back to the local renderer registry.
    await refreshCatalog(async () => ({
      version: "catalog-without-clock",
      widgets: [
        {
          id: "sports_nfl", name: "NFL", description: "d", source: "sports",
          category: "sports", color: "#013369", required_tier: "free", order: 0,
        },
      ],
    }));

    expect(catalogItemById("clock")).toBeUndefined();
    expect(isUtilityWidget("clock")).toBe(true);
  });

  it("does not claim ids nothing knows about", () => {
    expect(isUtilityWidget("not_a_real_widget")).toBe(false);
    expect(isUtilityWidget("")).toBe(false);
  });
});
