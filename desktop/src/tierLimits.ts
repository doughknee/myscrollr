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
// were RETIRED on 2026-07-02:
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


/**
 * Tier ranking, for "is this widget's required tier within reach?".
 *
 * Lived privately inside routes/widget.$id.info.tsx, which meant the
 * catalog and the info page could answer the same gating question
 * differently — exactly the drift that a shared slot helper already
 * exists to prevent. It belongs next to getMaxWidgets.
 */
export const TIER_ORDER: SubscriptionTier[] = [
  "free",
  "uplink",
  "uplink_pro",
  "uplink_ultimate",
  "super_user",
];

/**
 * The plan limit in the bar's own words: a slot is a page on your bar.
 * "Your bar has room for 3 pages on Free · Uplink fits 6". The next tier is
 * the first public one with a higher cap; the top tier has no limit to show.
 * `labels` is auth's TIER_LABELS, passed in so this file stays free of auth's
 * Tauri imports (it is read synchronously during render and in plain tests).
 */
export function pagesRoomLine(
  tier: SubscriptionTier,
  labels: Record<SubscriptionTier, string>,
): string {
  const max = getMaxWidgets(tier);
  if (!Number.isFinite(max)) return `Your bar has no page limit on ${labels[tier]}`;
  const next = TIER_ORDER.slice(TIER_ORDER.indexOf(tier) + 1).find(
    (t) => t !== "super_user" && getMaxWidgets(t) > max,
  );
  const upsell = next
    ? ` · ${labels[next]} fits ${Number.isFinite(getMaxWidgets(next)) ? getMaxWidgets(next) : "unlimited"}`
    : "";
  return `Your bar has room for ${max} pages on ${labels[tier]}${upsell}`;
}

export function tierMeets(
  current: SubscriptionTier,
  required: SubscriptionTier,
): boolean {
  return TIER_ORDER.indexOf(current) >= TIER_ORDER.indexOf(required);
}
