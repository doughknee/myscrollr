import { describe, it, expect } from "vitest";
import snapshot from "../../api/internal/widgets/tier_limits.json";
import {
  TIER_LIMITS,
  getLimit,
  isUnlimited,
  getMaxWidgets,
  getMaxTickerRows,
  canCustomizeTickerRows,
} from "./tierLimits";
import type { SubscriptionTier } from "./auth";

// ── getMaxWidgets ───────────────────────────────────────────────

describe("getMaxWidgets", () => {
  it.each<[SubscriptionTier, number]>([
    ["free", 3],
    ["uplink", 6],
    ["uplink_pro", 12],
    ["uplink_ultimate", Infinity],
    ["super_user", Infinity],
  ])("returns %s = %d", (tier, expected) => {
    expect(getMaxWidgets(tier)).toBe(expected);
  });
});

// ── getLimit ────────────────────────────────────────────────────

const DEPTH_KEYS = ["symbols", "feeds", "customFeeds", "leagues", "fantasy"] as const;
const ALL_TIERS: SubscriptionTier[] = [
  "free",
  "uplink",
  "uplink_pro",
  "uplink_ultimate",
  "super_user",
];

describe("getLimit", () => {
  // Per-feature depth caps were retired 2026-07-02 — unlimited on every tier.
  it("returns Infinity for every depth cap on every tier", () => {
    for (const tier of ALL_TIERS) {
      for (const key of DEPTH_KEYS) {
        expect(getLimit(tier, key)).toBe(Infinity);
      }
    }
  });

  it("still returns finite, tiered ticker-row limits", () => {
    expect(getLimit("free", "maxTickerRows")).toBe(1);
    expect(getLimit("uplink", "maxTickerRows")).toBe(2);
    expect(getLimit("uplink_pro", "maxTickerRows")).toBe(3);
  });
});

// ── isUnlimited ─────────────────────────────────────────────────

describe("isUnlimited", () => {
  it("returns true for every retired depth cap on every tier", () => {
    for (const tier of ALL_TIERS) {
      for (const key of DEPTH_KEYS) {
        expect(isUnlimited(tier, key)).toBe(true);
      }
    }
  });

  it("returns false for the finite ticker-row limits", () => {
    expect(isUnlimited("free", "maxTickerRows")).toBe(false);
    expect(isUnlimited("uplink_pro", "maxTickerRows")).toBe(false);
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

  // Cross-language drift guard. api/internal/widgets/tier_limits.json is the shared
  // snapshot of the backend's DefaultTierLimits (api/internal/widgets/tier_limits.go);
  // a Go test pins the Go map to it and a myscrollr.com test pins the
  // pricing page's FALLBACK_LIMITS to it. This test closes the loop for
  // the desktop mirror. Infinity here corresponds to null on the wire.
  it("matches the shared snapshot api/internal/widgets/tier_limits.json exactly", () => {
    const toWire = (n: number) => (n === Infinity ? null : n);
    const wire = Object.fromEntries(
      Object.entries(TIER_LIMITS).map(([tier, l]) => [
        tier,
        {
          max_widgets: toWire(l.maxWidgets),
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
    const keys = ["maxWidgets", "symbols", "feeds", "customFeeds", "leagues", "fantasy", "maxTickerRows"] as const;
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
