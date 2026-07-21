import type { SubscriptionTier } from "./auth";

// =====================================================================
// Tier Limits
//
// SOURCE OF TRUTH: api/internal/widgets/tier_limits.go (DefaultTierLimits)
//
// DataWidgetRow config panels and the onboarding wizard read these synchronously
// during render, so we keep a hardcoded mirror of the backend values here
// rather than fetching them asynchronously from GET /tier-limits. Drift
// between this file and the Go source becomes a billing-trust problem.
//
// If you change a number here, you MUST also update:
//   - api/internal/widgets/tier_limits.go        (the Go map)
//   - api/internal/widgets/tier_limits.json      (shared sync snapshot — the test in
//     tierLimits.test.ts pins this file to it, so CI catches drift)
//   - api/internal/widgets/tier_limits_test.go   (the assertion)
//   - myscrollr.com/src/lib/fallbackTierLimits.ts (the FALLBACK_LIMITS
//     constant, for first-paint before the runtime fetch resolves)
//
// Infinity here corresponds to `null` on the wire (null round-trips
// through JSON; Infinity does not).
//
// WIDGET/SLOT REDESIGN (2026-06-30): `maxWidgets` is the ONLY monetization
// lever — how many widgets a tier runs at once. The per-feature depth caps
// (symbols/feeds/customFeeds/leagues/fantasy) were RETIRED on 2026-07-02:
// every tier now has unlimited depth inside a widget ("track a hundred stocks
// in one Stocks widget"), so they're all Infinity. The fields remain only for
// wire/type compatibility. Provider-quota protection moves to rate limiting,
// not per-user caps. `maxTickerRows`/`maxTickerCustomization` are free in the
// product model; kept only so existing consumers compile until the ticker UI
// is reworked.
// =====================================================================

interface DataWidgetLimits {
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

// Per-feature depth caps are all Infinity (retired) — `maxWidgets` is the only
// gating lever. Only maxWidgets + the ticker-row fields still vary by tier.
const UNLIMITED_DEPTH = {
  symbols: Infinity,
  feeds: Infinity,
  customFeeds: Infinity,
  leagues: Infinity,
  fantasy: Infinity,
} as const;

export const TIER_LIMITS: Record<SubscriptionTier, DataWidgetLimits> = {
  free: {
    maxWidgets: 3,
    ...UNLIMITED_DEPTH,
    maxTickerRows: 1,
    maxTickerCustomization: false,
  },
  uplink: {
    maxWidgets: 6,
    ...UNLIMITED_DEPTH,
    maxTickerRows: 2,
    maxTickerCustomization: false,
  },
  uplink_pro: {
    maxWidgets: 12,
    ...UNLIMITED_DEPTH,
    maxTickerRows: 3,
    maxTickerCustomization: false,
  },
  uplink_ultimate: {
    maxWidgets: Infinity,
    ...UNLIMITED_DEPTH,
    maxTickerRows: 3,
    maxTickerCustomization: true,
  },
  super_user: {
    maxWidgets: Infinity,
    ...UNLIMITED_DEPTH,
    maxTickerRows: 3,
    maxTickerCustomization: true,
  },
};

// Numeric-only keys (excludes the boolean `maxTickerCustomization` field so
// downstream `getLimit` / `isUnlimited` keep their
// simple `number` signatures). Exported so callers can constrain their own
// helpers: e.g. `const LIMIT_ROWS: { key: NumericLimitKey }[] = [...]`.
export type NumericLimitKey = {
  [K in keyof DataWidgetLimits]: DataWidgetLimits[K] extends number ? K : never;
}[keyof DataWidgetLimits];

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

/** Get the numeric limit for a tier + widget feature. */
export function getLimit(tier: SubscriptionTier, key: LimitKey): number {
  return TIER_LIMITS[tier][key];
}

/** True when the tier has no cap (Infinity) for the given feature. */
export function isUnlimited(tier: SubscriptionTier, key: LimitKey): boolean {
  return TIER_LIMITS[tier][key] === Infinity;
}

