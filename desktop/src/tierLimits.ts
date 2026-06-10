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
// =====================================================================

interface ChannelLimits {
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
    symbols: 5,
    feeds: 1,
    customFeeds: 0,
    leagues: 1,
    fantasy: 0,
    maxTickerRows: 1,
    maxTickerCustomization: false,
  },
  uplink: {
    symbols: 25,
    feeds: 25,
    customFeeds: 1,
    leagues: 8,
    fantasy: 1,
    maxTickerRows: 2,
    maxTickerCustomization: false,
  },
  uplink_pro: {
    symbols: 75,
    feeds: 100,
    customFeeds: 3,
    leagues: 20,
    fantasy: 3,
    maxTickerRows: 3,
    maxTickerCustomization: false,
  },
  uplink_ultimate: {
    symbols: Infinity,
    feeds: Infinity,
    customFeeds: 10,
    leagues: Infinity,
    fantasy: 10,
    maxTickerRows: 3,
    maxTickerCustomization: true,
  },
  super_user: {
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
