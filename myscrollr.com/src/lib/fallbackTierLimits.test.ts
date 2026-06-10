import { describe, expect, it } from 'vitest'
import snapshot from '../../../api/core/tier_limits.json'
import { FALLBACK_LIMITS } from './fallbackTierLimits'

// Cross-language drift guard. api/core/tier_limits.json is the shared
// snapshot of DefaultTierLimits (api/core/tier_limits.go); a Go test
// pins the Go map to it and a desktop test pins desktop/src/tierLimits.ts
// to it. This test closes the loop for the marketing site's first-paint
// fallback. If it fails, a limit changed somewhere without updating all
// four copies in the same PR.
describe('FALLBACK_LIMITS sync with api/core/tier_limits.json', () => {
  it('matches the shared backend snapshot exactly', () => {
    expect(FALLBACK_LIMITS).toEqual(snapshot)
  })
})
