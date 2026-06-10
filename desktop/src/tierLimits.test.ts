import { describe, it, expect } from "vitest";
import snapshot from "../../api/core/tier_limits.json";
import {
  TIER_LIMITS,
  getLimit,
  isUnlimited,
  getMaxTickerRows,
  canCustomizeTickerRows,
  maxItemsForBrowser,
} from "./tierLimits";
import type { SubscriptionTier } from "./auth";

// ── getLimit ────────────────────────────────────────────────────

describe("getLimit", () => {
  it("returns the correct numeric limit for free tier", () => {
    expect(getLimit("free", "symbols")).toBe(5);
    expect(getLimit("free", "feeds")).toBe(1);
    expect(getLimit("free", "customFeeds")).toBe(0);
    expect(getLimit("free", "leagues")).toBe(1);
    expect(getLimit("free", "fantasy")).toBe(0);
    expect(getLimit("free", "maxTickerRows")).toBe(1);
  });

  it("returns the correct numeric limit for uplink tier", () => {
    expect(getLimit("uplink", "symbols")).toBe(25);
    expect(getLimit("uplink", "feeds")).toBe(25);
    expect(getLimit("uplink", "customFeeds")).toBe(1);
    expect(getLimit("uplink", "leagues")).toBe(8);
    expect(getLimit("uplink", "fantasy")).toBe(1);
    expect(getLimit("uplink", "maxTickerRows")).toBe(2);
  });

  it("returns the correct numeric limit for uplink_pro tier", () => {
    expect(getLimit("uplink_pro", "symbols")).toBe(75);
    expect(getLimit("uplink_pro", "feeds")).toBe(100);
    expect(getLimit("uplink_pro", "customFeeds")).toBe(3);
    expect(getLimit("uplink_pro", "leagues")).toBe(20);
    expect(getLimit("uplink_pro", "fantasy")).toBe(3);
    expect(getLimit("uplink_pro", "maxTickerRows")).toBe(3);
  });

  it("returns Infinity for unlimited ultimate fields", () => {
    expect(getLimit("uplink_ultimate", "symbols")).toBe(Infinity);
    expect(getLimit("uplink_ultimate", "feeds")).toBe(Infinity);
    expect(getLimit("uplink_ultimate", "leagues")).toBe(Infinity);
  });

  it("returns Infinity for super_user across every numeric key", () => {
    expect(getLimit("super_user", "symbols")).toBe(Infinity);
    expect(getLimit("super_user", "feeds")).toBe(Infinity);
    expect(getLimit("super_user", "customFeeds")).toBe(Infinity);
    expect(getLimit("super_user", "leagues")).toBe(Infinity);
    expect(getLimit("super_user", "fantasy")).toBe(Infinity);
  });
});

// ── isUnlimited ─────────────────────────────────────────────────

describe("isUnlimited", () => {
  it("returns false for free tier symbols", () => {
    expect(isUnlimited("free", "symbols")).toBe(false);
  });

  it("returns false for uplink and uplink_pro tiers", () => {
    expect(isUnlimited("uplink", "symbols")).toBe(false);
    expect(isUnlimited("uplink_pro", "symbols")).toBe(false);
  });

  it("returns true for uplink_ultimate symbols", () => {
    expect(isUnlimited("uplink_ultimate", "symbols")).toBe(true);
  });

  it("returns false for uplink_ultimate customFeeds (finite 10)", () => {
    expect(isUnlimited("uplink_ultimate", "customFeeds")).toBe(false);
  });

  it("returns true for super_user across all numeric fields", () => {
    expect(isUnlimited("super_user", "symbols")).toBe(true);
    expect(isUnlimited("super_user", "feeds")).toBe(true);
    expect(isUnlimited("super_user", "customFeeds")).toBe(true);
    expect(isUnlimited("super_user", "leagues")).toBe(true);
    expect(isUnlimited("super_user", "fantasy")).toBe(true);
  });
});

// ── getMaxTickerRows ────────────────────────────────────────────

describe("getMaxTickerRows", () => {
  it.each<[SubscriptionTier, number]>([
    ["free", 1],
    ["uplink", 2],
    ["uplink_pro", 3],
    ["uplink_ultimate", 3],
    ["super_user", 3],
  ])("returns %s = %d", (tier, expected) => {
    expect(getMaxTickerRows(tier)).toBe(expected);
  });
});

// ── canCustomizeTickerRows ──────────────────────────────────────

describe("canCustomizeTickerRows", () => {
  it("returns false for free, uplink, and uplink_pro", () => {
    expect(canCustomizeTickerRows("free")).toBe(false);
    expect(canCustomizeTickerRows("uplink")).toBe(false);
    expect(canCustomizeTickerRows("uplink_pro")).toBe(false);
  });

  it("returns true only for uplink_ultimate and super_user", () => {
    expect(canCustomizeTickerRows("uplink_ultimate")).toBe(true);
    expect(canCustomizeTickerRows("super_user")).toBe(true);
  });
});

// ── maxItemsForBrowser ──────────────────────────────────────────

describe("maxItemsForBrowser", () => {
  it("returns the finite number when the limit is finite", () => {
    expect(maxItemsForBrowser("free", "symbols")).toBe(5);
    expect(maxItemsForBrowser("uplink", "feeds")).toBe(25);
    expect(maxItemsForBrowser("uplink_pro", "customFeeds")).toBe(3);
  });

  it("returns undefined when the limit is Infinity (ultimate)", () => {
    expect(maxItemsForBrowser("uplink_ultimate", "symbols")).toBeUndefined();
    expect(maxItemsForBrowser("uplink_ultimate", "leagues")).toBeUndefined();
  });

  it("returns undefined for super_user across all numeric fields", () => {
    expect(maxItemsForBrowser("super_user", "symbols")).toBeUndefined();
    expect(maxItemsForBrowser("super_user", "customFeeds")).toBeUndefined();
    expect(maxItemsForBrowser("super_user", "fantasy")).toBeUndefined();
  });

  it("returns the finite ultimate customFeeds limit (10)", () => {
    expect(maxItemsForBrowser("uplink_ultimate", "customFeeds")).toBe(10);
  });
});

// ── TIER_LIMITS sanity ─────────────────────────────────────────

describe("TIER_LIMITS table", () => {
  it("covers every known subscription tier", () => {
    const tiers: SubscriptionTier[] = [
      "free",
      "uplink",
      "uplink_pro",
      "uplink_ultimate",
      "super_user",
    ];
    for (const tier of tiers) {
      expect(TIER_LIMITS[tier]).toBeDefined();
    }
  });

  // Cross-language drift guard. api/core/tier_limits.json is the shared
  // snapshot of the backend's DefaultTierLimits (api/core/tier_limits.go);
  // a Go test pins the Go map to it and a myscrollr.com test pins the
  // pricing page's FALLBACK_LIMITS to it. This test closes the loop for
  // the desktop mirror. Infinity here corresponds to null on the wire.
  it("matches the shared snapshot api/core/tier_limits.json exactly", () => {
    const toWire = (n: number) => (n === Infinity ? null : n);
    const wire = Object.fromEntries(
      Object.entries(TIER_LIMITS).map(([tier, l]) => [
        tier,
        {
          symbols: toWire(l.symbols),
          feeds: toWire(l.feeds),
          custom_feeds: toWire(l.customFeeds),
          leagues: toWire(l.leagues),
          fantasy: toWire(l.fantasy),
          max_ticker_rows: l.maxTickerRows,
          max_ticker_customization: l.maxTickerCustomization,
        },
      ])
    );
    expect(wire).toEqual(snapshot.tiers);
  });

  it("super_user matches or exceeds every other tier on every numeric key", () => {
    const keys = ["symbols", "feeds", "customFeeds", "leagues", "fantasy", "maxTickerRows"] as const;
    const tiers: SubscriptionTier[] = ["free", "uplink", "uplink_pro", "uplink_ultimate"];
    for (const key of keys) {
      const superVal = TIER_LIMITS.super_user[key];
      for (const tier of tiers) {
        const tierVal = TIER_LIMITS[tier][key];
        expect(superVal >= tierVal).toBe(true);
      }
    }
  });
});
