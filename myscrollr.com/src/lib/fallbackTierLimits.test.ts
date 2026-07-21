import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FALLBACK_LIMITS } from './fallbackTierLimits'

// Cross-language drift guard. api/internal/widgets/tier_limits.json is the shared
// snapshot of DefaultTierLimits (api/internal/widgets/tier_limits.go); a Go test
// pins the Go map to it and a desktop test pins desktop/src/tierLimits.ts
// to it. This test closes the loop for the marketing site's first-paint
// fallback. If it fails, a limit changed somewhere without updating all
// four copies in the same PR.
//
// Read at RUNTIME, not via a static import: the website's Docker image
// build copies only myscrollr.com/, so `tsc --noEmit` inside the image
// cannot resolve a module path into api/ — a static import fails the
// production build (2026-07-02 deploy failure). Vitest always runs from
// a full repo checkout (frontend-tests.yml), where the file exists.
const snapshot = JSON.parse(
  readFileSync(
    new URL('../../../api/internal/widgets/tier_limits.json', import.meta.url),
    'utf-8',
  ),
) as unknown

describe('FALLBACK_LIMITS sync with api/internal/widgets/tier_limits.json', () => {
  it('matches the shared backend snapshot exactly', () => {
    expect(FALLBACK_LIMITS).toEqual(snapshot)
  })
})
