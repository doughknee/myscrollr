import type { TierLimitsResponse } from '@/api/client'

// FALLBACK_LIMITS mirrors api/core/tier_limits.go DefaultTierLimits. It
// only renders during the ~20-50ms between component mount and the
// /tier-limits fetch response — after that the real API values take over.
//
// SYNC GUARD: fallbackTierLimits.test.ts asserts this constant equals
// api/core/tier_limits.json (the cross-language snapshot also pinned by
// Go and desktop tests). If you edit a limit, update all four copies in
// the same PR: api/core/tier_limits.go, api/core/tier_limits.json,
// desktop/src/tierLimits.ts, and this file. Drift is billing-trust damage.
export const FALLBACK_LIMITS: TierLimitsResponse = {
  tiers: {
    free: {
      symbols: 5,
      feeds: 1,
      custom_feeds: 0,
      leagues: 1,
      fantasy: 0,
      max_ticker_rows: 1,
      max_ticker_customization: false,
    },
    uplink: {
      symbols: 25,
      feeds: 25,
      custom_feeds: 1,
      leagues: 8,
      fantasy: 1,
      max_ticker_rows: 2,
      max_ticker_customization: false,
    },
    uplink_pro: {
      symbols: 75,
      feeds: 100,
      custom_feeds: 3,
      leagues: 20,
      fantasy: 3,
      max_ticker_rows: 3,
      max_ticker_customization: false,
    },
    uplink_ultimate: {
      symbols: null,
      feeds: null,
      custom_feeds: 10,
      leagues: null,
      fantasy: 10,
      max_ticker_rows: 3,
      max_ticker_customization: true,
    },
    super_user: {
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
