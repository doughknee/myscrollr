import type { TierLimitsResponse } from '@/api/client'

// FALLBACK_LIMITS mirrors api/internal/widgets/tier_limits.go DefaultTierLimits. It
// only renders during the ~20-50ms between component mount and the
// /tier-limits fetch response — after that the real API values take over.
//
// SYNC GUARD: fallbackTierLimits.test.ts asserts this constant equals
// api/internal/widgets/tier_limits.json (the cross-language snapshot also pinned by
// Go and desktop tests). If you edit a limit, update all four copies in
// the same PR: api/internal/widgets/tier_limits.go, api/internal/widgets/tier_limits.json,
// desktop/src/tierLimits.ts, and this file. Drift is billing-trust damage.
export const FALLBACK_LIMITS: TierLimitsResponse = {
  tiers: {
    free: {
      max_widgets: 3,
      symbols: null,
      feeds: null,
      custom_feeds: null,
      leagues: null,
      fantasy: null,
      max_ticker_rows: 1,
      max_ticker_customization: false,
    },
    uplink: {
      max_widgets: 6,
      symbols: null,
      feeds: null,
      custom_feeds: null,
      leagues: null,
      fantasy: null,
      max_ticker_rows: 2,
      max_ticker_customization: false,
    },
    uplink_pro: {
      max_widgets: 12,
      symbols: null,
      feeds: null,
      custom_feeds: null,
      leagues: null,
      fantasy: null,
      max_ticker_rows: 3,
      max_ticker_customization: false,
    },
    uplink_ultimate: {
      max_widgets: null,
      symbols: null,
      feeds: null,
      custom_feeds: null,
      leagues: null,
      fantasy: null,
      max_ticker_rows: 3,
      max_ticker_customization: true,
    },
    super_user: {
      max_widgets: null,
      symbols: null,
      feeds: null,
      custom_feeds: null,
      leagues: null,
      fantasy: null,
      max_ticker_rows: 3,
      max_ticker_customization: true,
    },
  },
}
