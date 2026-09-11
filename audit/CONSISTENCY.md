# SCROLLR-191 consistency and factual-claim audit

## Scope and method

This report audits only crawler-visible marketing metadata, JSON-LD, public
copy, `llms*.txt`, canonical links, download/platform guidance, and the
implementation facts needed to verify those claims. It does not treat general
monorepo style debt as an SEO defect.

Reference checks used for every finding included exact-string searches across
`myscrollr.com`, the desktop client, core API, release workflow, and the
server-authoritative widget catalog. Import searches were also run before
calling any file dead. No production code was changed.

## Findings

### C-01 — P1 — SoftwareApplication publishes the website version as the desktop version

- **Locations:** `myscrollr.com/src/lib/structured-data.ts:12,44-55`;
  `myscrollr.com/vite.config.ts:19-24,115-116`;
  `myscrollr.com/package.json:3`; `desktop/src-tauri/tauri.conf.json:2-4`.
- **Defect:** `softwareApplication.softwareVersion` uses `__APP_VERSION__`, but
  Vite defines that value from the marketing site's package (`2.1.0`), not the
  desktop release (`1.6.3`). Every page that emits `softwareApplication`
  therefore tells crawlers that the desktop app is version 2.1.0.
- **Verification:** compare `package.json` and `tauri.conf.json`, then inspect
  the homepage's prerendered JSON-LD for `"softwareVersion":"2.1.0"`.
- **Suggested fix:** feed the already resolved latest desktop release version
  into `softwareApplication` and add one build assertion that it matches the
  download version.

### C-02 — P1 — The crawler-visible catalog snapshot is 15 widgets behind the server authority

- **Locations:** `myscrollr.com/src/lib/catalog.ts:4-13,21-70`;
  `api/internal/platform/widgets.go:119-644`;
  `myscrollr.com/src/routes/widgets.tsx:5,59-60`;
  `myscrollr.com/src/components/landing/CatalogPicker.tsx:53-58,73`.
- **Defect:** the marketing fallback contains 35 widgets and 14 sports league
  widgets, while the server authority contains 50 widgets and 28 sports league
  widgets. The live API can correct the hydrated page, but prerendered HTML and
  no-JS crawlers see the stale snapshot and stale counts.
- **Verification:** `rg '^\s*ID:\s+"' api/internal/platform/widgets.go`
  returns 50 entries and `rg '^\s*\[''[a-z]'
  myscrollr.com/src/lib/catalog.ts` returns 35; the equivalent sports counts
  are 28 and 14. Build `/widgets` and inspect the server HTML before hydration.
- **Suggested fix:** refresh or generate the marketing snapshot from the
  server catalog and keep one small sync test so crawler HTML cannot drift
  again.

### C-03 — P1 — The full LLM digest advertises retired or absent paid features

- **Locations:** `myscrollr.com/public/llms-full.txt:35-40,62-72,165-179,185-187`;
  `myscrollr.com/src/routes/uplink.tsx:105-130,224-271`;
  `AGENTS.md:53-59`.
- **Defect:** the AI digest advertises custom alerts, feed profiles, advanced
  controls, whitelist filtering, outbound webhooks, historical data export,
  personal API access, and a full web dashboard that configures channels.
  The current pricing page says all tiers have the same features and its
  comparison table contains only widget count, live updates, early access,
  and priority support. The project overview says the website is marketing,
  auth, and billing only. Repository searches found no corresponding end-user
  implementations for the advertised alert/profile/outbound-webhook features.
- **Verification:** compare the cited digest sections with the active
  `STATIC_FAQ` and `buildComparison`; search the desktop/API for the named
  features (excluding Stripe/Sequin/Discord infrastructure webhooks).
- **Suggested fix:** remove retired feature promises from the digest and make
  the active pricing source, rather than a hand-maintained second feature
  matrix, the factual authority.

### C-04 — P1 — “Zero tracking/analytics” promises contradict operational diagnostics

- **Locations:** `myscrollr.com/public/llms.txt:7`;
  `myscrollr.com/public/llms-full.txt:15`;
  `myscrollr.com/src/components/landing/PromiseSection.tsx:52,140`;
  `myscrollr.com/src/sentry.ts:22-45`;
  `desktop/src/preferences.ts:203-209,561-563`;
  `api/internal/platform/usage.go:23-44`;
  `myscrollr.com/src/components/legal/documents.ts:158-163,281`.
- **Defect:** two AI-facing files and a visible homepage label say “zero
  tracking,” while the product initializes Sentry in production, defaults
  desktop crash reporting on, stores aggregate API request/version/platform/
  error counts, and relies on Logto account records. The longer nearby privacy
  prose is materially more accurate, making the short absolute claim the
  inconsistency.
- **Verification:** enable a production DSN and inspect `initSentry`; inspect
  `DEFAULT_PRIVACY`; compare those paths and the legal policy to the exact
  “zero tracking” strings.
- **Suggested fix:** use one precise public formulation everywhere: no
  advertising trackers; operational diagnostics and authentication logs exist;
  optional product analytics, when enabled, is opt-in, coarse, account-linked,
  desktop-only, and described in the Privacy Policy.

### C-05 — P1 — Public FAQs disagree on whether an account is required

- **Locations:** `myscrollr.com/src/lib/structured-data.ts:174-178`;
  `myscrollr.com/src/components/support/support-content.ts:15-20,31-35,105-113`;
  `desktop/src/components/support/support-content.ts:32-35`;
  `desktop/src/components/marketplace/WidgetPanel.tsx:249-257`.
- **Defect:** the homepage's visible/schema FAQ promises three widget slots
  “forever, no account,” and public support says an account is unnecessary for
  the free tier and exists only for Uplink sync. The same public support page
  later tells users to create a free account, while the desktop's canonical
  help and add-widget UI require sign-in to add data widgets.
- **Verification:** open the public support FAQ and its Getting Started section,
  then open the desktop catalog signed out; the action is “Sign in to add.”
- **Suggested fix:** distinguish “download/browse without an account” from
  “sign in to add live data widgets and sync settings,” using that same
  distinction in visible FAQ text and FAQ JSON-LD.

### C-06 — P1 — AI-facing league and source counts contradict both each other and the catalog

- **Locations:** `myscrollr.com/public/llms-full.txt:19-24,115-117,157-159`;
  `myscrollr.com/src/lib/catalog.ts:21-52`;
  `api/internal/platform/widgets.go:158-426`.
- **Defect:** the digest says Sports has 14 league widgets, later says “20+,”
  and calls the product a four-channel system even though its own overview
  names five data sources. The current server catalog has 28 sports widgets.
  It also calls 10 named publishers plus Custom RSS “11 outlets,” although the
  custom-feed widget is not a publisher.
- **Verification:** count the server catalog's `sports_*` IDs and compare the
  cited paragraphs in one file; count the ten curated publishers in the
  marketing snapshot separately from `rss_custom`.
- **Suggested fix:** avoid volatile hard-coded totals in prose; state the
  stable capability and link to the live catalog, or generate counts from the
  server authority at build time.

### C-07 — P1 — “Instant/as they happen” delivery claims override the site's own upstream caveats

- **Locations:** `myscrollr.com/src/routes/uplink.tsx:112-115`;
  `myscrollr.com/src/routes/fantasy.tsx:112-115`;
  `myscrollr.com/public/llms-full.txt:11,131-143`;
  `myscrollr.com/src/routes/sports.tsx:33-35`;
  `myscrollr.com/src/routes/markets.tsx:33-35`.
- **Defect:** pricing, fantasy, and AI copy promise that changes appear
  “instant” or “as they happen.” The dedicated sports and markets pages
  correctly explain that upstream delays, corrections, availability, outages,
  and connectivity affect arrival time. SSE removes the client's polling wait;
  it cannot guarantee source latency.
- **Verification:** compare the quoted FAQs; interrupt an upstream ingester or
  observe a delayed/corrected source event—the transport cannot deliver data it
  has not received.
- **Suggested fix:** retain the live-streaming benefit but say updates appear
  automatically when Scrollr receives them, with upstream timing caveats.

### C-08 — P1 — The legacy `/channels` path is linked as current and lacks a direct server redirect

- **Locations:** `myscrollr.com/public/llms.txt:12`;
  `myscrollr.com/src/routes/channels.tsx:1-20,25-38`;
  `myscrollr.com/Dockerfile:143-166`;
  `myscrollr.com/scripts/generate-sitemap.mjs:26`.
- **Defect:** the sitemap declares `/widgets`, but `llms.txt` directs answer
  engines to `/channels`. That legacy route returns a prerendered page with a
  meta refresh/client navigation rather than a permanent HTTP redirect. It is
  also absent from nginx's slash-normalization/redirect rule, so directory
  handling can add `/channels/` before the meta redirect.
- **Verification:** request `/channels` and `/channels/` without following
  redirects and compare the response chain with `/widgets`; inspect the
  crawler-visible `http-equiv=refresh` rather than only the hydrated route.
- **Suggested fix:** link `/widgets` everywhere and add one narrow nginx 301
  from both legacy channel variants to `/widgets`, preserving the query string.

### C-09 — P1 — Platform guidance conflicts on Intel macOS and signing status

- **Locations:** `desktop/src/components/support/support-content.ts:27-30`;
  `myscrollr.com/src/routes/download_.$os.tsx:31-50`;
  `.github/workflows/desktop-release.yml:88-101,263-305,337-374`;
  `README.md:97-102`; `desktop/src-tauri/tauri.conf.json:2-4,22-23`.
- **Defect:** desktop help says macOS supports Apple Silicon **and Intel**, but
  the release matrix produces only `aarch64-apple-darwin` and the public
  download page correctly says Apple Silicon. Separately, the README still
  says Macs and PCs are unidentified until signing lands in v1.0.1, despite
  the current 1.6.3 macOS signing/notarization workflow. Windows signing is not
  established by that workflow and must not be implied.
- **Verification:** compare the support strings and README to the release
  matrix target and Apple notarization steps; inspect current release asset
  architectures rather than inferring from Tauri's cross-platform support.
- **Suggested fix:** remove Intel until an x64 macOS artifact exists, and
  replace the obsolete README promise with separate, current macOS and Windows
  guidance.

### C-10 — P1 — UNCERTAIN: business copy makes contract-level guarantees not evidenced in the repository

- **Locations:** `myscrollr.com/src/routes/business.tsx:165-187`;
  `myscrollr.com/public/llms-full.txt:78-80`.
- **Defect:** the page guarantees per-display scheduling, programmatic
  read/write API access, P1 response under one hour, uptime targets, a direct
  Slack channel, commercial licensing that removes AGPL distribution duties,
  standard NDAs, perpetual licensing, and fixed 2–4/6–12 week delivery ranges.
  Full-stack self-hosting is supported by repository deployment material, but
  searches found no public commercial license, SLA, NDA, or delivery contract
  that substantiates the rest. This is marked **UNCERTAIN** because private
  commercial documents may exist outside the repository.
- **Verification:** search outside `business.tsx`/`llms-full.txt` for each
  quoted promise and review any actual current sales templates or executed
  standard terms before publishing them as guarantees.
- **Suggested fix:** confirm each promise against the real commercial offer;
  otherwise qualify it as scoped/available by agreement and remove numeric
  guarantees from crawler-facing copy.

### C-11 — P2 — Public entity links use a superseded GitHub owner

- **Locations:** `myscrollr.com/src/lib/structured-data.ts:23-26`;
  `myscrollr.com/src/components/Footer.tsx:34`;
  `myscrollr.com/public/llms.txt:28`;
  `myscrollr.com/src/lib/getDownloadInfo.ts:36`;
  `myscrollr.com/package.json:12-16`.
- **Defect:** public links and Organization `sameAs` use
  `brandon-relentnet/myscrollr`, while the repository's configured origin is
  `doughknee/myscrollr`. GitHub currently redirects renamed repositories, but
  emitting the redirecting identity adds avoidable hops and entity ambiguity.
- **Verification:** run `git remote get-url origin`, then compare every public
  GitHub URL; request both repository URLs without following redirects.
- **Suggested fix:** choose the current repository URL as one shared constant
  and update visible links, package metadata, release fetches, and `sameAs`
  together after confirming GitHub's canonical owner.

### C-12 — P2 — Hand-maintained AI/FAQ copies and orphaned landing sections preserve stale claims

- **Locations:** `myscrollr.com/public/llms-full.txt:91-187`;
  `myscrollr.com/src/components/landing/FAQSection.tsx:26-90,420-425`;
  `myscrollr.com/src/components/landing/TrustSection.tsx:24,308-330`;
  `myscrollr.com/src/lib/structured-data.ts:163-193`;
  `myscrollr.com/src/components/support/support-content.ts:15-56`.
- **Defect:** the digest says it is aggregated from canonical live FAQs but is
  manually duplicated and already diverges. `FAQSection.tsx` and
  `TrustSection.tsx` are no longer imported by any route yet retain additional
  “no tracking,” “zero analytics,” and account claims, making repository-wide
  factual audits noisier and inviting accidental reintroduction.
- **Verification:** `rg -l 'FAQSection|TrustSection' myscrollr.com/src` finds
  their definitions/comments but no route import; compare the digest to active
  `STATIC_FAQ`, `HOMEPAGE_FAQ_ITEMS`, and support content.
- **Suggested fix:** delete the orphaned sections and either generate the
  digest from canonical content or keep it concise enough that facts are not
  copied into a second feature matrix.

## Verified-consistent areas

- `https://myscrollr.com` is consistently used by `BASE_URL`, sitemap URLs,
  robots sitemap declaration, route canonicals, Open Graph URLs, JSON-LD IDs,
  and the nginx `www` redirect.
- Active `/sports`, `/markets`, `/news`, and `/fantasy` pages accurately scope
  their core providers/capabilities: Yahoo only for fantasy, no trading on the
  markets page, and public RSS/Atom feeds with source-delay caveats.
- macOS 10.15+, Windows x64, and Linux x86_64 package formats in the public
  download guide match `tauri.conf.json`, the build matrix, and release asset
  naming. The public page does not claim that the pending Windows signing work
  is already shipped.
- The central `seo()` helper is live and used by route heads; searches found no
  competing `usePageMeta`/runtime-title helper. Generated HTML sampled from
  `/sports` contained one description, one canonical, and one `og:url`.

## Highest-value cleanups per effort

1. **C-01:** publish the desktop release version in app schema; one wrong value
   currently contaminates every SoftwareApplication block.
2. **C-03:** delete retired paid-feature claims from `llms-full.txt`; this is a
   small copy fix with high trust impact.
3. **C-04:** replace absolute “zero tracking” labels with the agreed precise
   privacy story across visible and AI-facing copy.
4. **C-05:** state the account boundary once and reuse it in homepage/support
   FAQ content and schema.
5. **C-02:** sync the marketing catalog fallback to the server authority and
   leave one automated drift check.
6. **C-06:** remove volatile league/channel totals from the AI digest or derive
   them from the catalog.
7. **C-08:** make `/channels` one permanent HTTP redirect and stop linking it.
8. **C-07:** change “instant” to truthful live-delivery language that preserves
   the benefit without overriding upstream-delay caveats.
9. **C-09:** align Intel/signing guidance with the actual release matrix.
10. **C-10:** validate or qualify contract-level business promises before they
    remain searchable guarantees.
