# PostHog Privacy Integration Implementation Plan

> **For Codex:** Execute test-first. Source of truth: [SCROLLR-193](https://linear.app/relentnet/issue/SCROLLR-193/integrate-website-and-app-analytics-with-posthog-and-clear-privacy-controls). Open a reviewed PR only; do not merge, deploy, enable production capture, purchase anything, or publish a desktop release.

**Goal:** Add consent-gated, privacy-bounded PostHog analytics for the public website and desktop app while keeping existing first-party product facts authoritative.

**Architecture:** Keep the existing server-authoritative product-analytics enrollment and daily facts. Add a separate tri-state PostHog decision because the prior first-party opt-in does not authorize a new third party. The website uses the official browser SDK only after an explicit local decision; the desktop sends a fixed event vocabulary through the authenticated API so identity, consent, deduplication, recent-presence, and deletion remain server controlled. Production transport stays disabled until the documented configuration and deletion credentials exist.

**Tech Stack:** React 19, TypeScript, PostHog JS, Go 1.25/Fiber/pgx/PostgreSQL/Redis, Vitest, Go tests.

## Task 1: Lock the privacy and event contracts

**Files:**
- Create: `docs/analytics/POSTHOG.md`
- Create: `api/migrations/000021_posthog_analytics_consent.up.sql`
- Create: `api/migrations/000021_posthog_analytics_consent.down.sql`
- Test: `api/core/product_analytics_integration_test.go`

1. Write failing migration tests for `unknown`, `enabled`, and `declined`, preserving prior opt-outs and not broadening existing first-party enrollment.
2. Add the additive consent/deletion-status table and rerun the focused migration tests.
3. Document the fixed event/property allowlist, UTC definitions, excluded surfaces, retention caveats, and activation gates.

## Task 2: Add server-authoritative PostHog consent and desktop transport

**Files:**
- Modify: `api/internal/accounts/product_analytics.go`
- Modify: `api/internal/accounts/product_analytics_test.go`
- Modify: `api/core/server.go`
- Modify: `api/internal/accounts/user_deletion.go`
- Modify: `api/internal/accounts/user_deletion_test.go`
- Modify: `api/.env.example`

1. Write failing handler tests for tri-state read/write, strict bodies, deletion/account mutation races, disabled transport, fixed events/properties, and immediate opt-out blocking.
2. Add GET/PUT consent plus POST desktop-event handlers using the authenticated account only; do not accept arbitrary event names, identity, timestamps, URLs, or content properties.
3. Send only when all PostHog server settings are present. Use an HMAC pseudonymous distinct ID and deterministic insert IDs; set IP capture to null. Keep failures out of the UI and do not queue/replay them.
4. On decline/account purge, stop new events immediately and request PostHog person deletion. Record a pending deletion for retry by the existing maintenance loop; export the decision/status.

## Task 3: Add bounded recent presence

**Files:**
- Modify: `api/internal/accounts/product_analytics.go`
- Modify: `api/internal/admin/handlers_product_analytics.go`
- Modify: corresponding Go tests

1. Write failing tests for consent enforcement, one account across devices/windows, expiry, and no event emission per heartbeat.
2. Store only a pseudonymous account member and last-seen timestamp in one Redis sorted set; prune on write/read.
3. Return the bounded recently-seen count in the existing admin product overview with explicit wording that it is presence, not attention.

## Task 4: Add explicit website consent and sanitized events

**Files:**
- Modify: `myscrollr.com/package.json`
- Create: `myscrollr.com/src/lib/posthog.ts`
- Create: `myscrollr.com/src/lib/posthog.test.ts`
- Create: `myscrollr.com/src/components/AnalyticsConsent.tsx`
- Modify: `myscrollr.com/src/routes/__root.tsx`
- Modify: signup and download call sites
- Modify: `myscrollr.com/src/components/Footer.tsx`

1. Write failing tests for default-off/unknown, equal accept/decline, persistent opt-out, excluded routes, sanitized path-only pageviews, allowlisted attribution, and fixed conversion events.
2. Add the official SDK with autocapture, automatic pageviews/pageleave, replay, surveys, performance capture, and person profiles disabled.
3. Initialize and capture only in production when the public key/host are configured and consent is enabled. Never replay pre-consent events.
4. Add an accessible privacy control and footer entry; exclude account, callback, invite, support, admin, and public-profile surfaces.

## Task 5: Add desktop consent, lifecycle events, and presence

**Files:**
- Modify: `desktop/src/api/client.ts`
- Modify: `desktop/src/preferences.ts`
- Modify: `desktop/src/components/settings/pages/DataPrivacyPage.tsx`
- Modify: `desktop/src/components/settings/rows.ts`
- Modify: `desktop/src/routes/__root.tsx`
- Create: `desktop/src/hooks/usePostHogActivity.ts`
- Create: `desktop/src/hooks/usePostHogActivity.test.ts`

1. Write failing tests for separate tri-state consent, transition notice, server hydration, opt-out persistence, process ownership, app-open/running semantics, coarse feature adoption, and presence throttling.
2. Add the separate PostHog setting without changing the existing first-party toggle.
3. Mount one process owner using the existing shared-window ownership seam; send fixed events only while authenticated and enabled. No durable queue and no per-SSE-event or attention claims.

## Task 6: Reconcile copy and owner reporting

**Files:**
- Modify: `myscrollr.com/src/components/legal/documents.ts`
- Modify: `docs/VISION.md`
- Modify: public/support copy not owned by PR #380
- Modify: `myscrollr.com/src/components/admin/AnalyticsPage.tsx`
- Modify: focused copy/component tests

1. Replace absolute no-analytics claims with accurate consent, provider, pseudonymity, retention, opt-out, export, and deletion wording. Do not claim the unreleased desktop behavior is live.
2. Preserve PR #380's public-copy edits by coordinating merge order and avoiding overlapping edits where possible.
3. Add the recently-seen headline and a PostHog deep link; keep first-party totals authoritative and label website figures as estimates.

## Task 7: Verify, independently review, and open the PR

1. Run focused tests after each task, then all website/desktop tests and builds plus Go tests and the additive-migration guard.
2. Inspect desktop and mobile consent/settings states visually.
3. Commit and push the issue branch; open the PR with the activation checklist and explicit no-capture/no-release status.
4. Request independent privacy/security, lifecycle/deduplication, and copy/consent review on the final commit; fix findings and rerun verification.
5. Update SCROLLR-193 with evidence and move it to In Review. Do not merge, deploy, enable capture, or edit desktop-release workflow.
