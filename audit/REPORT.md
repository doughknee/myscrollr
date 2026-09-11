# SCROLLR-191 final audit report

## Outcome

The public marketing surface is crawler-accessible and internally coherent after the fixes in this branch. The audit found no evidence that a new `/open-source-desktop-ticker` route would add distinct value beyond the existing homepage, architecture page, widget catalog, downloads, and GitHub repository, so no duplicate landing page was added.

## Fixed here

| Finding | Resolution |
| --- | --- |
| Private SPA routes and unknown paths returned an indexable homepage shell | The nginx fallback is limited to known account, callback, invite, admin, and public-profile routes; those responses carry `X-Robots-Tag: noindex, nofollow`; unknown and case-variant paths return 404. `/admin` was added to `robots.txt`. |
| `/channels`, trailing slashes, and direct `index.html` URLs created duplicates | Narrow, query-preserving 301 redirects now lead to the slashless canonical URL and `/widgets`. |
| Software schema published the website package version | `SoftwareApplication.softwareVersion` now uses the fetched desktop release version, with a postbuild assertion. |
| Breadcrumb schema had no visible breadcrumb UI | Breadcrumb JSON-LD was removed instead of adding redundant navigation. |
| Crawler-visible widget snapshot was 15 entries behind the server catalog | The snapshot now matches all 50 server entries in server order; a source-level drift test prevents recurrence. |
| AI digests contained retired features, volatile counts, old URLs, and unsupported business promises | Both `llms` files were reduced to stable, canonical facts and current URLs. Business claims now require a written scope instead of promising price, SLA, licensing, or delivery terms. |
| “Zero tracking” and account-free absolutes conflicted with the product | Public copy now distinguishes no advertising trackers from operational diagnostics and opt-in product analytics, and distinguishes downloading/browsing from signing in to add live data. |
| Live delivery copy implied guaranteed source latency | Copy now states that updates appear when Scrollr receives them and names upstream and connectivity caveats. |
| Mobile navigation allowed keyboard focus to escape | The existing dialog now traps Tab and Shift+Tab using native focus APIs; Escape and focus return remain intact. |
| `/support` nested `<main>` and skipped from H1 to H3 | The route wrapper is now a `div` and FAQ questions are H2 headings. |
| Homepage preloaded both below-fold theme screenshots | The route-level high-priority preloads were removed; the existing lazy image behavior remains. |
| The responsive checker silently served directory requests as its own 500 page | Its local server now resolves route directories to `index.html`, so all viewport checks exercise the real pages. |
| Public GitHub links used the superseded owner | Active website, download, release, package, schema, and README links now use `doughknee/myscrollr`. |

## Verified

- Production baseline: 18 public routes returned 200 to Googlebot, Bingbot, and OAI-SearchBot; all had one H1, self-canonicals, matching Open Graph metadata, and parseable JSON-LD. No broken internal links were found.
- Local production build: 18 route contracts, sitemap, SPA-shell, Sentry tunnel, hydration-provider, structured-version, and 56 responsive checks passed.
- Exact nginx configuration in a stock Alpine nginx container: public route 200; canonical and legacy redirects 301 with query preservation; private routes 200 with `noindex, nofollow`; unknown, case-variant, and synthetic shell paths 404.
- Unit suite: 125 tests passed, including the new catalog drift guard.

## Deferred, not blockers

- The apex HTTP → HTTPS → apex behavior for `www` can take two hops because TLS/host normalization is split between ingress and nginx. Both paths converge correctly; changing ingress was outside this PR.
- The shared client chunk remains about 667 kB raw / 217 kB gzip. Route-level splitting is a broader performance task.
- Some public demo/status timers continue while their tab is hidden. Pausing them is a broader runtime optimization.
- The CSP still permits inline scripts/styles required by the current stack. No injection path was found; nonce/hash migration is a separate security project.
- Four orphaned legacy landing components retain old copy but are not imported, built, or crawler-visible. They can be deleted in a dedicated dead-code cleanup if desired.
- The released desktop help still mentions Intel macOS even though current public assets are Apple Silicon only. Correcting the already released binary belongs to a future desktop release; this PR does not imply that release or Windows signing has shipped.
