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
// (symbols/feeds/custom_feeds/leagues/fantasy) were RETIRED on 2026-07-02:
// every tier has unlimited depth inside a widget ("track a hundred stocks in
// one Stocks widget"), and the desktop mirror stopped carrying them entirely
// (REL-60) — the backend still sends the keys as `null`, which the drift test
// asserts. Provider-quota protection moves to rate limiting, not per-user
// caps.
// =====================================================================

interface DataWidgetLimits {
  /** Max widgets a tier can run at once — the slot model. Infinity = unlimited. */
  maxWidgets: number;
}

export const TIER_LIMITS: Record<SubscriptionTier, DataWidgetLimits> = {
  free: {
    maxWidgets: 3,
  },
  uplink: {
    maxWidgets: 6,
  },
  uplink_pro: {
    maxWidgets: 12,
  },
  uplink_ultimate: {
    maxWidgets: Infinity,
  },
  super_user: {
    maxWidgets: Infinity,
  },
};

/**
 * Max widgets the tier can run at once (the slot model). Infinity means
 * unlimited. This is the lever the Catalog reads to decide when to show a
 * widget as locked / "upgrade for more".
 */
export function getMaxWidgets(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].maxWidgets;
}

