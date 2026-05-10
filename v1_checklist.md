# Scrollr Desktop 1.0.0 — Release Checklist

## Tier Reference

| Feature | Free | Uplink ($9.99/mo) | Uplink Pro ($24.99/mo) | Uplink Ultimate ($49.99/mo) |
|---|---|---|---|---|
| **Data delivery** | 60s polling | 30s polling | 10s polling | Real-time SSE |
| **Tracked symbols** | 5 | 25 | 75 | Unlimited |
| **News feeds** | 1 | 25 | 100 | Unlimited |
| **Sports leagues** | 1 | 8 | 20 | Unlimited |
| **Custom news feeds** | 0 | 1 | 3 | 10 |
| **Fantasy leagues** | 0 | 1 | 3 | 10 |
| **Custom alerts** | No | No | Yes *(post-v1)* | Yes *(post-v1)* |
| **Feed profiles** | No | No | Yes *(post-v1)* | Yes *(post-v1)* |
| **Widgets** | All | All | All | All |
| **Premium widgets** | No | No | Yes *(future)* | Yes *(future)* |
| **Webhooks** | No | No | No | Yes *(post-v1)* |
| **Data export** | No | No | No | Yes *(post-v1)* |
| **API access** | No | No | No | Yes *(post-v1)* |

**Tier pitches:**
- **Free → Uplink**: 5× symbols, 25× news feeds, 8 sports leagues, 1 fantasy league, 2× faster data. More of everything.
- **Uplink → Pro**: Higher limits again, plus new capabilities when they ship (alerts, profiles).
- **Pro → Ultimate**: Real-time SSE is the headline. Symbols, news, and sports become unlimited.

Annual pricing: Uplink $79.99/yr, Uplink Pro $199.99/yr, Uplink Ultimate $399.99/yr.
Lifetime: $399 one-time (permanent Uplink-tier access + 50% off Ultimate upgrade).
All paid tiers include a 7-day free trial.

---

## Verified Complete

> Confirmed done by codebase audit (March 2026). Kept for reference.

- [x] Stripe webhook signature verification
- [x] Tauri capability scoping (main vs ticker window split)
- [x] Tighten Tauri HTTP scope (ticker locked to API + auth only; main keeps `https://*/*` for Uptime Kuma widget)
- [x] Dependency audit in CI (`npm audit` + `cargo audit` in release workflow, `continue-on-error`)
- [x] Database migrations (golang-migrate for Go APIs, sqlx::migrate for Rust services; run on startup)
- [x] Tier rename: `uplink_unlimited` → `uplink_ultimate`, added `uplink_pro` (Logto roles, Stripe products, Go + TS types, DB values)
- [x] Upgrade/downgrade flows (immediate proration for upgrades, Subscription Schedules for downgrades, preview modals, frontend fully wired)
- [x] Account page billing info (price, cadence, renewal date, pending downgrade notice, Change Plan link)
- [x] Handle deleted Stripe customers in `getOrCreateStripeCustomer`
- [x] Webhook event idempotency (`stripe_webhook_events` table, dedup before processing, 7-day TTL cleanup)
- [x] Legal doc sync (pricing matches current tiers, quarterly billing references fully removed)
- [x] Pricing page rewrite (tier names, limits, "Coming Soon" labels, removed feed retention + referral program)
- [x] Auto-updater (state machine UI: check → download with progress → restart; minisign updater signing; same-version patch detection)
- [x] Toast notification system (Sonner, dark theme, 30+ toast calls across 7 files covering all key user actions)
- [x] Auth token refresh (silent refresh with 60s buffer, mutex for concurrent safety, SSE reconnect on 401, session-expired banner)
- [x] `X-User-Tier` header forwarding (core proxy sets it at `proxy.go:162` — channels don't read it yet, that's Track 4)
- [x] SSE delivery for Uplink Ultimate (Rust client → Hub → Sequin CDC pipeline)
- [x] Error boundaries (`RouteError` on all 6 routes + `QueryErrorBanner` for widget data)
- [x] Empty states (`DashboardEmptyState` + `EmptyChannelState` covering all channels and dashboard cards)
- [x] Wire `subscriptionTier` prop into all config panels (plumbed through ChannelConfigPanel — unused until enforcement)

---

## Track 1 — Code Signing & Distribution

> Start day 1. External wait times (Apple review ~24-48h, certificate issuance varies). Hard gate on shipping — Gatekeeper and SmartScreen block unsigned binaries.

- [ ] Apple Developer Program enrollment ($99/yr) + Developer ID Application certificate
- [ ] Configure macOS notarization in CI (`notarytool submit` + `stapler staple`)
- [ ] Windows Authenticode code signing certificate (EV or OV)
- [ ] Configure Windows signing in CI (`signtool sign`)
- [ ] Test auto-updater end-to-end (install old version → push update → verify download + install + restart)

---

## Track 2 — Billing

> Free trial is a compliance risk — pricing page promises "7-day free trial" but checkout charges immediately. Stripe Customer Portal is the only way users can update payment methods or view invoices.

- [x] Implement 7-day free trial (`SubscriptionData.TrialPeriodDays: 7` in `billing.go:230-232`)
- [x] Integrate Stripe Customer Portal (`HandleCreatePortalSession` at `billing.go:786-828`; route `POST /users/me/subscription/portal` at `server.go:172`)
- [x] Handle Customer Portal browser handoff from desktop app (`AccountSettings.tsx` opens portal URL via `shell:open`)
- [x] Failed payment dunning: `past_due` warning banner + "Update Payment Method" CTA in website `SubscriptionStatus.tsx`; desktop opens portal
- [ ] Test resubscribe after cancel (full lifecycle: subscribe → cancel → wait for period end → resubscribe)
- [x] Desktop billing UI on Account page:
  - [x] "Manage Subscription" button (opens Stripe Customer Portal in browser)
  - [x] Current plan with tier limits summary (`TierLimitsTable` component)
  - [x] Upgrade prompt linking to website pricing page

---

## Track 3 — Website Pivot

> Full pivot from browser extension to desktop app. 18 files affected. Hero visual: "Desktop Workspace" concept (animated desktop with real app windows + ticker at bottom edge). HowItWorks: "Download → Choose Your Data → Work as Usual."

### Download Page (new route)
- [x] Create `/download` route with OS detection (`navigator.platform` / `navigator.userAgent`)
- [x] Download buttons: macOS (Apple Silicon), Windows (x64), Linux (AppImage) — Intel Mac not built by CI
- [x] System requirements + unsigned binary instructions (until code signing is done)
- [x] Link to GitHub releases as fallback

### Landing Page Rewrites
- [x] Delete `src/components/InstallButton.tsx`
- [x] Create `DownloadButton.tsx` component (OS detection, GitHub releases link — replaces InstallButton across the site)
- [x] Rewrite `HeroBrowserStack.tsx` → `HeroDesktopPreview.tsx` (macOS traffic lights, app title bar, 4 desktop contexts)
- [x] Rewrite `HowItWorks.tsx` → "Download → Choose Your Data → Work as Usual" (DownloadVisual + WorkVisual)
- [x] Update `HeroSection.tsx` (copy: "bottom of your browser" → "edge of your screen")
- [x] Update `FAQSection.tsx` (all 8 answers reframed for desktop)
- [x] Update `CallToAction.tsx` (copy + browser list → platform list: macOS / Windows / Linux)
- [x] Update `ChannelsShowcase.tsx` ("every tab" → "your desktop/screen", 4 edits)
- [x] Update `BenefitsSection.tsx` ("specific sites" → "minimize it")
- [x] Update `TrustSection.tsx` ("Your browser, your data" → "Your device, your data"; "Extension component" → "Desktop component")
- [x] Update `Footer.tsx` (Chrome/Firefox store links → Download link; "every tab" tagline → desktop)
- [x] Update `routes/index.tsx` (title + meta description → desktop)
- [x] Update `routes/architecture.tsx` (Extension tech stack → Desktop: Tauri v2, React 19, SSE + Polling; "browser" → "desktop")
- [x] Update `routes/uplink.tsx` (4 FAQ lines: "extension" → "app")
- [x] Update `index.html` (3 meta tags → desktop)
- [x] Update `Header.tsx` comment (removed extension reference)
- [x] Update `useGetToken.ts` comment (removed bridge reference)

### Dead Code Removal
- [x] Evaluate `useScrollrAuth.tsx` bridge auth system — confirmed dead (no code dispatches bridge events)
- [x] Remove bridge auth; simplified to Logto-only wrapper (248 → 102 lines)

### Legal Documents (`documents.ts`)
- [x] Delete "Browser Extension Privacy" document (#6) — removed entirely
- [x] Create "Desktop Application Privacy" document (7 sections: local data, network, what's NOT accessed, auto updates, third-party, data deletion)
- [x] Add "Desktop Application" section to Terms of Service (confirmed present at `documents.ts:91-96`)
- [x] Update Privacy Policy body: "browser extension" → "desktop application"
- [x] Update Cookie & Storage Policy scope: "browser extension" → "desktop application"
- [x] Update Security Policy scope: "browser extension" → "desktop application"
- [x] Update Accessibility Statement: "Browser Extension" section → "Desktop Application" (Shadow Root → native ticker window)
- [x] Update Acceptable Use Policy scope: "browser extension" → "desktop application"
- [x] **Fix Finnhub → TwelveData** (all 9 occurrences replaced, including `finnhub.io` → `twelvedata.com` URLs)
- [x] Disclose desktop local data: auth tokens, preferences, widget configs, log files, window state (updated Cookie & Storage Policy + new Desktop Privacy doc)

---

## Track 4 — Tier Enforcement

> Client-side enforcement in the desktop app config panels. The `subscriptionTier` prop already flows into every config panel — it just needs to be used. Server-side enforcement deferred to v1.1.

- [x] Finance: enforce symbol limit (Free=5, Uplink=25, Pro=75, Ultimate=unlimited)
- [x] RSS: enforce feed count limit (Free=1, Uplink=25, Pro=100, Ultimate=unlimited)
- [x] RSS: enforce custom feed limit (Free=0, Uplink=1, Pro=3, Ultimate=10); block "Add Custom Feed" for Free
- [x] Sports: enforce league count limit (Free=1, Uplink=8, Pro=20, Ultimate=unlimited)
- [x] Fantasy: gate channel entirely for Free tier (upgrade prompt instead of Yahoo connect flow)
- [x] Fantasy: enforce league import limit (Uplink=1, Pro=3, Ultimate=10)
- [x] Usage indicators in all config panels ("5/25 symbols tracked")
- [x] Shared `UpgradePrompt` component reused across all channels
- [x] Server-side SSE access gating (`/events` endpoint now extracts roles from JWT claims and returns 403 for non-`uplink_ultimate` users)

---

## Track 5 — Ship Readiness

### Security
- [x] Configure CSP headers in Tauri webview (`script-src 'self'`, Google Fonts allowlisted, `connect-src https://*` for user-provided Kuma URLs; v1.1 tightening path documented in `desktop/src-tauri/CSP_NOTES.md`)
- [x] `withGlobalTauri: false` (2026-04 polish)
- [x] Move `tauri-plugin-mcp-bridge` to optional `dev-mcp-bridge` feature (release binary no longer links dev plugin)

### Legal
- [x] Bundle AGPL license with binary (`"resources": ["../../LICENSE"]` in `tauri.conf.json`)
- [x] Final legal review pass — `api.myscrollr.relentnet.dev` → `api.myscrollr.com` in docs; removed stale "Effective Q3 2026" callouts; Finnhub → TwelveData across marketing/legal
- [ ] Final legal review by counsel (external)

### Testing & Release
- [x] Vitest installed + 112 passing tests on desktop pure functions (selectors, tierLimits, stableStringify)
- [ ] Cross-platform testing (macOS arm64, Windows x64, Linux x64 — all three CI targets)
- [ ] Performance baseline (startup time, idle memory usage, no memory leaks on long runs)
- [ ] Verify rollback plan (unpublish GitHub release + push hotfix via auto-updater if critical bug found)
- [x] Create root README.md (2026-04)
- [ ] Prepare release notes
- [ ] Draft launch announcement

---

## 2026-04-25 Polish Pass — Shipped

> Comprehensive pre-super-user polish pass. Driven by audit across 4 codebases.
> See commit history for each stream.

### Security fixes
- [x] Stripe webhook replay tolerance wired (`api/core/stripe_webhook.go`)
- [x] Stripe webhook idempotency refactored to atomic INSERT ON CONFLICT
- [x] Yahoo OAuth `/yahoo/start` now requires auth header (account-hijack vector closed)
- [x] `crypto/rand.Read` error now checked in OAuth state generation
- [x] `GetDel` (atomic consume) on Yahoo state logto Redis key
- [x] `api/Dockerfile.test` deleted (Go-1.21 + dev-URL landmine)
- [x] Logto M2M token mutex replaced with singleflight (no more webhook stall)
- [x] Proxy strips `access_token`/`refresh_token` cookies except for `/yahoo/*`
- [x] Health no longer cached when degraded (probe sees outage immediately)
- [x] `superUserRoleID` moved from hardcoded to env
- [x] Email PII masking helper (`maskEmail` → `u***@d***.com`)
- [x] Dispatch-drop rate-limited log in `events.go` (no more silent drops)
- [x] Hostname hashed in desktop diagnostics payload
- [x] Fetch timeouts (15s AbortController) on all desktop API calls
- [x] ConfirmDialog focus trap (react-focus-lock)
- [x] RouteError sanitization (details behind `<details>` disclosure)
- [x] Channel docker-compose ports bound to 127.0.0.1 (dev-mode hardening)
- [x] Committed `sports_api` 17MB binary removed from repo

### Reliability fixes
- [x] All 3 channel Go APIs now have sized pgxpool (was defaults)
- [x] Subscriber Redis TTLs on finance/sports/rss channel APIs (7-day, mirrors fantasy)
- [x] RSS `deleteCustomFeed` now transactional (no more orphaned feed rows)
- [x] Connect timeout on core API DB pool (5s)
- [x] `pruneWebhookEvents` now runs every 6h (was startup-only)
- [x] New migration: `stripe_customers.lifetime` partial index (no more full-scan on webhook)
- [x] Rust services: RSS body cap 8 MiB streaming + `.error_for_status()` + Accept header
- [x] Rust services: async logger fallback to `eprintln!` (no more silent log drops)
- [x] Rust services: finance bridge no longer marks healthy without actual batch progress
- [x] Rust services: finance error_count increments on reconnect failure
- [x] Rust services: finance WebSocket 1 MiB message size cap
- [x] Rust services: sports API_SPORTS_KEY trimmed; `expect()` replaced with `?`
- [x] Rust services: sports `dates.first().unwrap()` guarded
- [x] Rust services: sports PCT formatting fixed (`1.000` not `.1000`)
- [x] Rust services: sports standings parser no longer guesses via `.values().next()`
- [x] Rust services: sports cleanup_old_games live threshold 4h → 24h
- [x] Rust services: silent `db.` prefix stripping removed from DB URL parsing
- [x] Rust services: pool sizing tuned (20/1, explicit idle_timeout secs)
- [x] Rust services: new `REPLICA IDENTITY FULL` migration for sports standings/teams
- [x] Rust services: migration startup invariant check (guards against deleted files)
- [x] Rust services: log level Debug → Info for finance (prod-appropriate)
- [x] Rust services: file logger removed (no more disk fill)
- [x] Rust services: TLS standardized on rustls (dropped native-tls)
- [x] Rust services: feeds.test.json no longer shipped in prod image
- [x] Rust services: RSS seed_tracked_feeds re-enables disabled defaults on deploy
- [x] Rust services: RSS retries quarantined feeds at cycle 0 too
- [x] Rust services: all clippy warnings fixed across 3 services

### User-facing fixes
- [x] **Universal display sorting** — Display tab prefs (`articlesPerSource`, `defaultSort`, `enabledLeagueKeys`, `primaryLeagueKey`) now apply to the ticker, not just feed pages. Shared selectors in `src/channels/*/view.ts`. *(user request)*
- [x] **Fantasy tier enforcement** on `/users/me/yahoo-leagues/import` (server-side count cap)
- [x] **Multi-deck ticker redesign** — per-row source selection, tier-gated (free=1, uplink=2, pro=3, ultimate=3+customization), pin row-scoping, migration from legacy `tickerRows`. UI ships without per-row scroll customization UI (data path wired, UI deferred to v1.0.2 per spec). *(user request)*
- [x] **Pinned widget duplication fix** — was rendering identically on every row; now correctly row-scoped
- [x] FreshnessPill mounted on finance/sports/rss feed pages (green→amber→red by staleness)
- [x] ConnectionBanner in main window when Ultimate user falls back to polling
- [x] CheckoutModal Stripe appearance now honors light/dark theme (was dark-hardcoded)
- [x] NotFound page rewritten with project Tailwind tokens (was rendering with undefined shadcn tokens)
- [x] Auto-updater `lastUpdateDate` fix (no more phantom "up to date")
- [x] AuthGate `text-white` → `text-surface` (high-contrast safe)
- [x] Legal docs: `api.myscrollr.relentnet.dev` → `api.myscrollr.com`
- [x] Legal docs: removed "Effective upon Uplink launch — Q3 2026" badges
- [x] Marketing copy: Finnhub → TwelveData (3 user-facing pages)
- [x] Marketing copy: removed extension-era references (tab juggling, browsing, etc.)
- [x] Footer: removed broken `/discover` and `/onboard` links (now 404-free)
- [x] `Unlimited` → `Ultimate` tier-name consistency across pricing + FAQ
- [x] Marketing site: 15 lint errors fixed (Infinity shadow, unnecessary conditions, stale rules)
- [x] Marketing site: `pk_live_` → `pk_test_REPLACE_ME` in `.env.example`
- [x] Marketing site: robots.txt Disallow for auth routes; sitemap.xml lastmod
- [x] Desktop diagnostics: hostname hashed before send

---

## v1.1 Backlog

> Deferred items. Important but not launch-blocking.

### Enforcement
- [ ] Server-side item count limits on finance/sports/rss channels (fantasy done 2026-04-25)
- [ ] Server-side polling rate enforcement (Free=60s, Uplink=30s, Pro=10s, Ultimate=SSE — separate half-day)
- [ ] ~~Server-side SSE access gating~~ *(promoted to Track 4)*

### Stability & Polish
- [ ] Crash reporting (Sentry or equivalent — desktop + Go APIs + Rust services)
- [ ] Offline detection + graceful degradation (show cached data, pause queries; `ConnectionBanner` already supports "offline" mode — just needs navigator-online detection)
- [ ] Window state persistence (main window size/position across restarts)
- [ ] API retry with custom backoff (currently TanStack Query `retry:1` default only)
- [ ] 429 rate limit handling on frontend
- [x] ~~Stale data visual indicators in UI~~ *(shipped 2026-04-25 — FreshnessPill)*
- [ ] Loading state audit (skeleton/shimmer components — currently text-based only)
- [ ] Fix configure page flash when adding items from catalog
- [ ] Ticker multi-deck Phase 2: per-row scroll customization UI (Ultimate) — data path already wired, just needs the UI controls in TickerSettings
- [ ] CSP connect-src tightening (user-configurable Kuma URL needs runtime CSP or Rust-side proxy — see `desktop/src-tauri/CSP_NOTES.md`)
- [x] Yahoo OAuth desktop flow returns JSON `{redirect_url}` when `Accept: application/json` (or `?response=json`) so the desktop can authFetch it and then `shell::open` the Yahoo consent URL externally; browser callers still get the 307
- [ ] `scrollr:navigate` payload fix so tray "Customize Ticker" opens the Ticker settings tab

### Features
- [ ] First-run onboarding wizard (beyond current welcome empty state + ghost cards)
- [ ] Channel/widget discovery catalog (browsable UI)
- [ ] Full Account tab (profile, billing summary, usage stats, connected accounts)

### Support & Docs
- [ ] In-app "Report a Bug" link (pre-filled GitHub issue)
- [ ] GitHub issue templates (bug report, feature request)
- [ ] Changelog / "What's New" display after updates
- [ ] Help docs / FAQ accessible from app

### Security Hardening
- [ ] ~~CSP headers~~ *(promoted to Track 5)*
- [ ] Tighten main window HTTP scope (currently `https://*/*` — evaluate restricting to known domains)
- [ ] CORS configuration review
- [ ] Input validation audit (currently ad-hoc `if field == ""` across all APIs)
- [ ] Config JSONB schema validation (channel config accepted with no shape validation)

### Website
- [ ] Desktop screenshots or preview video on landing page
- [ ] Update sitemap.xml (stale routes: /discover, /integrations, /onboard)
