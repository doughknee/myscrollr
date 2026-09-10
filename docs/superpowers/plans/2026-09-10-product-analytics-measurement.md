# Product Analytics Measurement and Owner Overview Implementation Plan

> **For Codex:** Execute this plan in order with test-driven development. SCROLLR-1 owns Tasks 1-7; SCROLLR-186 owns Tasks 8-10 on a stacked branch. Do not merge or deploy either PR.

**Goal:** Measure opt-in, authenticated, qualifying ticker activity as privacy-bounded daily facts and turn those facts plus existing truthful sources into a useful owner analytics overview.

**Architecture:** Core stores one server-authoritative enrollment/cohort row per participating account and one idempotent fact per account/UTC day. The primary native ticker window is the only process coordinator: it qualifies only while the native window is visible and at least one ticker widget is enabled for 30 uninterrupted seconds, then sends fixed coarse category flags through an authenticated endpoint. Admin UI loads existing overview, new product aggregates, existing version reliability, and existing signup diagnostics independently so one failure never blanks the others.

**Tech Stack:** Go 1.25/Fiber/pgx/PostgreSQL, React 19/TypeScript/TanStack, Tauri v2 window APIs, Vitest. No new dependency or analytics SDK.

## Fixed measurement contract

- `product_analytics_enrollments`: `logto_sub` primary key, `enrolled_at`, `first_active_day`, and nullable `retained_d1`, `retained_d7`, `retained_d30`. Deleting the row is opt-out and deletes all daily facts by cascade. Nullable retention values are interpreted only once the cohort is old enough; a qualifying return on the exact target day sets the matching flag true. This preserves fixed outcomes after 90-day fact pruning without retaining a timeline.
- `product_activity_daily`: primary key `(logto_sub, day)`, server UTC `day`, and six booleans: `sports`, `markets`, `news`, `fantasy`, `predictions`, `utilities`. Duplicate deliveries OR the flags. The API accepts only those six category strings and never accepts identity, timestamps, content identifiers, URLs, query strings, or arbitrary metadata.
- Enrollment is default-off. `PUT /users/me/product-analytics` with `{enabled:boolean}` creates the enrollment idempotently or deletes it and its facts transactionally. `GET` returns the authoritative value. A reporting transaction locks the enrollment row before inserting; concurrent devices serialize first-observed/retention updates, and opt-out therefore either deletes an earlier fact or completes before a later report observes enrollment.
- Activation is first successful qualifying configured ticker use. There is no separate setup event because the product has no reliable explicit setup-completion action. Existing auto-created preference rows remain labeled setup snapshots, never activation.
- Fact retention is 90 UTC days. The existing daily request-counter maintenance loop prunes the daily product facts too; enrollment/cohort rows remain while consent is on so pruning cannot relabel an old participant as first observed.
- No backfill. `collection_started_at` is the earliest current enrollment timestamp and all responses disclose `enrolled_accounts`. Opt-out removes the account from the measured population; re-enrollment begins a new first-observed cohort because prior measurement was deleted.
- DAU/WAU/MAU are distinct enrolled accounts with facts in inclusive UTC 1/7/30-day windows. D1/D7/D30 denominators include only current enrolled cohorts old enough for the exact day; immature denominators are unavailable, not zero. Feature share is distinct active accounts with a category flag divided by distinct measured active accounts in the selected 7/30-day period; shares may overlap.
- Desktop keeps no durable queue. One bounded retry is allowed only while still authenticated, opted in, visible, configured, and on the same UTC day. Logout, opt-out, native hide, document hide, an enabled-widget loss, a timer gap over two polling intervals (suspend), or day rollover aborts/reset qualification. Demo/dev/test builds never report.

### Task 1: Pin schema and migration behavior

**Files:**
- Create: `api/migrations/000020_product_analytics.up.sql`
- Create: `api/migrations/000020_product_analytics.down.sql`
- Modify: `api/internal/testsupport/testsupport.go`
- Test: `api/core/product_analytics_integration_test.go`

1. Write failing integration tests that apply migrations and assert both table shapes, defaults, primary/foreign keys, category booleans, and cascade deletion.
2. Run the focused Docker Go integration test and witness failure because migration 20 is absent.
3. Add the two-table additive migration and test cleanup support; rerun focused tests.
4. Run `scripts/migrations/check-additive.sh` against the new migration.

### Task 2: Add server-authoritative enrollment and collection

**Files:**
- Create: `api/internal/accounts/product_analytics.go`
- Create: `api/internal/accounts/product_analytics_test.go`
- Modify: `api/core/server.go`
- Test: `api/core/product_analytics_integration_test.go`

1. Write failing handler/unit and DB integration tests for missing auth identity, malformed bodies, invalid/duplicate categories, identity spoof fields being rejected, default-off GET, idempotent enable, duplicate account/day/device delivery, category union, exact UTC server day, and opt-out/report races.
2. Add `GET`/`PUT /users/me/product-analytics` and `POST /users/me/product-activity` behind `LogtoAuth`.
3. Implement the three handlers with typed strict request bodies, validated identity from `platform.GetUserID`, row locking, server time injection through a test seam, idempotent upsert, and transactional opt-out deletion.
4. Rerun focused tests, then the complete accounts/core test packages in Docker.

### Task 3: Preserve privacy through export, purge, and retention

**Files:**
- Modify: `api/internal/accounts/user_deletion.go`
- Modify: `api/core/user_deletion_integration_test.go`
- Modify: `api/internal/platform/usage.go`
- Modify: `api/internal/platform/usage_test.go`
- Test: `api/core/product_analytics_integration_test.go`

1. Extend failing export/purge tests to require consent/cohort/facts in the export and complete deletion cascade.
2. Add the enrollment delete to the existing purge transaction (facts cascade).
3. Add failing pruning tests for the 90-day boundary and proof that cohort metadata survives pruning.
4. Extend the existing daily usage-maintenance prune function to delete only expired `product_activity_daily` rows; keep the scheduler unchanged.
5. Run focused and full Docker Go tests with a disposable Postgres database.

### Task 4: Build truthful product aggregates

**Files:**
- Create: `api/internal/admin/handlers_product_analytics.go`
- Create: `api/internal/admin/handlers_product_analytics_test.go`
- Modify: `api/core/server.go`
- Modify: `api/core/widgets_test.go`

1. Write failing pure aggregation/SQL integration tests for DAU/WAU/MAU boundaries, account/day dedup, exact D1/D7/D30 returns, immature/zero denominators, UTC rollover, overlapping feature shares, first-observed counts, collection start, and unauthorized admin access.
2. Add `GET /admin/product-analytics?days=7|30`, gated by `LogtoAuth` and `RequireAdmin`.
3. Return `generated_at`, `collection_started_at`, `enrolled_accounts`, activity headline/curve, activation count/curve, retention measurements with mature denominators, and category active-account shares. Return empty arrays and explicit unavailable reasons instead of invented zero rates.
4. Run focused tests and all Go tests in Docker.

### Task 5: Add desktop consent API and setting

**Files:**
- Modify: `desktop/src/api/client.ts`
- Modify: `desktop/src/preferences.ts`
- Modify: `desktop/src/preferences.test.ts`
- Modify: `desktop/src/components/settings/rows.ts`
- Modify: `desktop/src/components/settings/pages/DataPrivacyPage.tsx`
- Modify: `desktop/src/components/settings/SettingsSurface.tsx`
- Modify: `desktop/src/routes/__root.tsx`
- Test: `desktop/src/components/settings/pages/DataPrivacyPage.test.tsx`

1. Write failing tests for default-off migration/reset, signed-out disabled state, server hydration, optimistic prevention (local state changes only after server success), independent crash-report consent, opt-out errors, and cross-window preference broadcast.
2. Add typed consent GET/PUT client calls and `privacy.shareProductAnalytics` default false.
3. Add a separate “Share product activity” toggle with concise population/category/retention language. Keep it disabled signed out; persist only after the server confirms.
4. On authenticated main-shell startup, hydrate the local mirror from the server; on logout force it false locally without a server write.
5. Run focused Vitest tests.

### Task 6: Qualify activity once per process from true ticker lifecycle

**Files:**
- Create: `desktop/src/hooks/useProductActivity.ts`
- Create: `desktop/src/hooks/useProductActivity.test.ts`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/api/client.ts`

1. Write failing fake-timer tests for primary/non-primary windows, native hidden, document hidden, no enabled ticker widgets, opt-out, logout, demo/dev exclusion, 30 continuous seconds, suspend-sized tick gaps, UTC day rollover, duplicate monitors/devices, fixed category mapping, abort on state loss, one bounded retry, and no render/feed failure propagation.
2. Implement a small state machine in `useProductActivity`: only `isPrimaryTicker()`, poll `getCurrentWindow().isVisible()`, advance accumulated eligible time only across short monotonic ticks, reset on any disqualifier, report after 30 seconds, and stop after success until the UTC day changes.
3. Map catalog categories to the fixed vocabulary (`finance` to `markets`, `utility` to `utilities`) and report categories only from currently enabled ticker widgets.
4. Mount the hook in ticker `App.tsx`; do not alter chip layout/rendering.
5. Run focused tests, all desktop Vitest tests, and `npm run build`.

### Task 7: Document collection truthfully and finish SCROLLR-1 PR

**Files:**
- Modify: `myscrollr.com/src/components/legal/documents.ts`
- Modify: `docs/VISION.md`
- Modify: `myscrollr.com/src/components/support/support-content.ts`
- Regenerate: `api/internal/support/kb/kb.generated.md`
- Modify/add focused wording tests where present

1. Update privacy and desktop-privacy documents with explicit opt-in, authenticated account/day dedup, 30-second native-visible qualification, coarse categories, 90-day daily retention, cohort metadata, deletion/opt-out, and offline undercount. Preserve the separate Sentry/request-counter promises.
2. Update VISION and the source support snippet; regenerate the knowledge base with the existing generator.
3. Run website tests, lint, and full prerender build; run repository privacy-string checks.
4. Commit, push, open the SCROLLR-1 PR, run CI, request independent privacy/counting/lifecycle review on the final commit, fix findings, rerun checks, and move SCROLLR-1 to In Review with exact evidence. Do not merge.

### Task 8: Add independent owner-dashboard data loaders (SCROLLR-186 stacked branch)

**Files:**
- Create: `myscrollr.com/src/api/adminProductAnalytics.ts`
- Create: `myscrollr.com/src/api/adminProductAnalytics.test.ts`
- Modify: `myscrollr.com/src/api/adminAnalytics.ts`

1. Branch from the reviewed SCROLLR-1 head using SCROLLR-186 `gitBranchName`; move SCROLLR-186 to In Progress.
2. Write failing tests for bounded timeout, caller cancellation, error-body handling, and independent concurrent loads.
3. Add the product aggregate client while retaining SCROLLR-185 signup-diagnostic cancellation semantics unchanged.
4. Run focused Vitest tests.

### Task 9: Replace the analytics landing view with the product overview

**Files:**
- Modify: `myscrollr.com/src/components/admin/AnalyticsPage.tsx`
- Add: `myscrollr.com/src/components/admin/AnalyticsPage.test.tsx`
- Reuse: `myscrollr.com/src/api/admin.ts`, `myscrollr.com/src/lib/adminFormat.ts`

1. Write failing component tests for populated, empty/collecting, and partial/error states; verify each section can fail/retry/cancel without hiding successful sections.
2. Build one responsive page with compact navigation to Growth, Usage & retention, Features, Revenue, Reliability, and Diagnostics. Reuse existing cards/tables/bars; no dashboard framework or empty route shells.
3. Growth uses existing Logto account totals/trends and clearly labels Logto authentication activity separately from measured ticker use. Usage/Retention and Features use only the new opted-in facts. Revenue shows current paying count and plan/status/lifetime mix; omit revenue dollars because `stripe_customers` has no normalized amount/currency/interval source. Reliability reuses version/platform/error aggregates, ingest freshness, connections, and support counts with their existing proxy labels. Diagnostics contains the existing signup event/error UI and selectors.
4. Give overview, measured usage, version reliability, and signup diagnostics separate abort controllers, slow states, errors, and retry actions. Show source freshness and collection/population notes near the relevant section.
5. Run focused and full website tests, lint, and full build.

### Task 10: Visual QA and reviewed SCROLLR-186 PR

**Files:** no production-only fixture files; use test/runtime synthetic responses.

1. Start the website on a free port with realistic synthetic API aggregates; do not touch preview3012/SEO3013 or production data.
2. Capture and inspect desktop-width and mobile-width populated, collecting-history, empty, and one-section-failed states. Verify headings, tables, overlaps, keyboard focus, contrast, and mobile overflow.
3. Commit, push, open the stacked SCROLLR-186 PR with dependency/rollout order and screenshots.
4. Run CI and request independent final-commit UX/data-truth/loading review; fix findings and rerun exact checks.
5. Comment evidence on SCROLLR-186 and move it to In Review. Report both PR URLs, heads, CI, screenshots, schema/event definitions, limits, and rollout order to home. Do not merge, deploy, tag, release, or message users.
