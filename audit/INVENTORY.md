# SCROLLR-191 website audit inventory

## Scope and severity calibration

This audit is limited to the public `myscrollr.com` marketing, documentation,
pricing, support, status, and download surfaces plus the routing/deployment
configuration that controls their crawler delivery. Authenticated application
behavior is inspected only to verify that it is excluded from indexing. A P0
blocks the requested SEO QA PR; a P1 is a factual, indexability, accessibility,
or crawler-delivery defect that should be fixed in this PR; a P2 is a safe
follow-up that does not justify expanding this refinement pass.

## Stack and runtime

- React 19 + TanStack Router/Start static prerender, Vite 7, TypeScript 5.9,
  Tailwind 4; route source is `myscrollr.com/src/routes/`.
- `seo()` in `myscrollr.com/src/lib/seo.ts` owns per-route canonical, Open
  Graph, Twitter, robots, and JSON-LD tags.
- `myscrollr.com/src/lib/structured-data.ts` owns Organization, WebSite,
  SoftwareApplication, Product/Offer, FAQPage, and BreadcrumbList objects.
- `myscrollr.com/scripts/generate-sitemap.mjs` writes a hand-curated sitemap;
  `myscrollr.com/public/robots.txt` is shipped as a static file.
- Production serves `dist/client` from nginx configured in
  `myscrollr.com/Dockerfile`; `k8s/ingress.yaml` terminates TLS and routes apex,
  www, and API hostnames.

## Public surfaces

- Product: `/`, `/widgets`, `/sports`, `/markets`, `/news`, `/fantasy`.
- Downloads: `/download`, `/download/mac`, `/download/windows`,
  `/download/linux`.
- Commercial: `/uplink`, `/uplink/lifetime`, `/business`.
- Documentation/support: `/architecture`, `/releases`, `/support`, `/legal`,
  `/status`.
- Legacy public redirect: `/channels` -> `/widgets`.
- Dynamic/private or non-indexable: `/account`, `/admin/**`, `/callback`,
  `/invite`, `/u/$username`, `/tss-spa-shell`.

## External data and links

- GitHub releases and repository links supply published version/download
  information (`scripts/fetch-latest-version.mjs`,
  `scripts/fetch-releases.mjs`, route CTAs).
- Logto supplies website authentication (`@logto/react`).
- Stripe supplies checkout and billing (`@stripe/*`).
- The public status page requests core API health data.
- Sentry receives scrubbed operational errors through the same-origin
  `/api/sentry-envelope` nginx tunnel.
- Public outbound links include GitHub and Discord.

## Sensitive machinery and indexing boundaries

- Authenticated account and staff routes use Logto and API authorization; they
  must remain `noindex` and excluded from the sitemap/robots crawl surface.
- Stripe checkout and the Sentry tunnel are present but are not modified by
  this task.
- CSP and security headers are generated in the website Dockerfile.
- No native bridge, filesystem access, inbound webhook, or server-side
  user-controlled fetch exists in the scoped static marketing runtime.

## Long-running behavior

- Static marketing content has decorative motion and client hydration.
- `/status`, account, admin, support form, checkout, and release/version helpers
  have network-driven states. Only public SEO delivery and crawler-visible
  fallback content are in scope.

## Project constraints

- Preserve the current brand/design and the already shipped SCROLLR-187-189
  work; fix only evidenced defects.
- Do not change telemetry behavior, signing integration, support deployment, or
  analytics policy/VISION files owned by other active tasks.
- No new dependency, generic blog, doorway page, fabricated schema field, or
  external search/CDN/DNS mutation.
- Finish at an independently reviewed PR; do not merge or deploy.
