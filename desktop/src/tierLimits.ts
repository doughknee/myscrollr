import type { SubscriptionTier } from "./auth";

// =====================================================================
// Tier Limits
//
// SOURCE OF TRUTH: api/core/tier_limits.go (DefaultTierLimits)
//
// Channel config panels and the onboarding wizard read these synchronously
// during render, so we keep a hardcoded mirror of the backend values here
// rather than fetching them asynchronously from GET /tier-limits. Drift
// between this file and the Go source becomes a billing-trust problem.
//
// If you change a number here, you MUST also update:
//   - api/core/tier_limits.go        (the Go map)
//   - api/core/tier_limits.json      (shared sync snapshot — the test in
//     tierLimits.test.ts pins this file to it, so CI catches drift)
//   - api/core/tier_limits_test.go   (the assertion)
//   - myscrollr.com/src/lib/fallbackTierLimits.ts (the FALLBACK_LIMITS
//     constant, for first-paint before the runtime fetch resolves)
//
// Infinity here corresponds to `null` on the wire (null round-trips
// through JSON; Infinity does not).
//
// WIDGET/SLOT REDESIGN (2026-06-30): `maxWidgets` is the new primary
// lever — how many widgets a tier runs at once. The per-feature caps
// (symbols/feeds/leagues/…) and the ticker-row caps are retained during
// the transition and retired as their UI consumers migrate to the widget
// catalog. `maxTickerRows`/`maxTickerCustomization` are now free for all
// tiers in the product model; the values below are kept only so existing
// consumers compile until the ticker UI is reworked.
// =====================================================================

interface ChannelLimits {
  /** Max widgets a tier can run at once — the slot model. Infinity = unlimited. */
  maxWidgets: number;
  symbols: number;
  feeds: number;
  customFeeds: number;
  leagues: number;
  fantasy: number;
  /** Max simultaneous ticker rows this tier can configure (1..3). */
  maxTickerRows: number;
  /** Can configure per-row scroll mode/direction/speed/mix overrides. */
  maxTickerCustomization: boolean;
}

export const TIER_LIMITS: Record<SubscriptionTier, ChannelLimits> = {
  free: {
    maxWidgets: 3,
    symbols: 5,
    feeds: 1,
    customFeeds: 0,
    leagues: 1,
    fantasy: 0,
    maxTickerRows: 1,
    maxTickerCustomization: false,
  },
  uplink: {
    maxWidgets: 6,
    symbols: 25,
    feeds: 25,
    customFeeds: 1,
    leagues: 8,
    fantasy: 1,
    maxTickerRows: 2,
    maxTickerCustomization: false,
  },
  uplink_pro: {
    maxWidgets: 12,
    symbols: 75,
    feeds: 100,
    customFeeds: 3,
    leagues: 20,
    fantasy: 3,
    maxTickerRows: 3,
    maxTickerCustomization: false,
  },
  uplink_ultimate: {
    maxWidgets: Infinity,
    symbols: Infinity,
    feeds: Infinity,
    customFeeds: 10,
    leagues: Infinity,
    fantasy: 10,
    maxTickerRows: 3,
    maxTickerCustomization: true,
  },
  super_user: {
    maxWidgets: Infinity,
    symbols: Infinity,
    feeds: Infinity,
    customFeeds: Infinity,
    leagues: Infinity,
    fantasy: Infinity,
    maxTickerRows: 3,
    maxTickerCustomization: true,
  },
};

// Numeric-only keys (excludes the boolean `maxTickerCustomization` field so
// downstream `getLimit` / `isUnlimited` / `maxItemsForBrowser` keep their
// simple `number` signatures). Exported so callers can constrain their own
// helpers: e.g. `const LIMIT_ROWS: { key: NumericLimitKey }[] = [...]`.
export type NumericLimitKey = {
  [K in keyof ChannelLimits]: ChannelLimits[K] extends number ? K : never;
}[keyof ChannelLimits];

type LimitKey = NumericLimitKey;

/**
 * Max widgets the tier can run at once (the slot model). Infinity means
 * unlimited. This is the lever the Catalog reads to decide when to show a
 * widget as locked / "upgrade for more".
 */
export function getMaxWidgets(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].maxWidgets;
}

/** Max ticker rows for the tier (1..3). */
export function getMaxTickerRows(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].maxTickerRows;
}

/** Whether the tier may configure per-row scroll prefs. */
export function canCustomizeTickerRows(tier: SubscriptionTier): boolean {
  return TIER_LIMITS[tier].maxTickerCustomization;
}

/** Get the numeric limit for a tier + channel feature. */
export function getLimit(tier: SubscriptionTier, key: LimitKey): number {
  return TIER_LIMITS[tier][key];
}

/** True when the tier has no cap (Infinity) for the given feature. */
export function isUnlimited(tier: SubscriptionTier, key: LimitKey): boolean {
  return TIER_LIMITS[tier][key] === Infinity;
}

/**
 * Returns `maxItems` for SetupBrowser: a finite number or undefined (unlimited).
 * Passing undefined means SetupBrowser won't enforce any cap.
 */
export function maxItemsForBrowser(
  tier: SubscriptionTier,
  key: LimitKey
): number | undefined {
  const limit = TIER_LIMITS[tier][key];
  return limit === Infinity ? undefined : limit;
}
