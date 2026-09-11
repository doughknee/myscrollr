# SCROLLR-191 security and crawler-boundary audit

Scope: public `myscrollr.com` crawler delivery, private-route indexing controls,
nginx/ingress host handling, and the security headers that affect those
surfaces. This is an audit only; no production code was changed.

## Findings

### SEC-01 — P1 — Private SPA routes are served indexable homepage HTML

**References:** `myscrollr.com/Dockerfile:154`, `myscrollr.com/Dockerfile:163`,
`myscrollr.com/Dockerfile:166`, `myscrollr.com/public/robots.txt:10`,
`myscrollr.com/public/robots.txt:11`, `myscrollr.com/public/robots.txt:17`,
`myscrollr.com/vite.config.ts:71`, `myscrollr.com/vite.config.ts:78`,
`myscrollr.com/src/routes/account.tsx:29`,
`myscrollr.com/src/routes/admin.tsx:16`,
`myscrollr.com/src/routes/callback.tsx:4`,
`myscrollr.com/src/routes/invite.tsx:8`,
`myscrollr.com/src/routes/u.$username.tsx:16`.

The source-level `noindex` declarations on `/account`, `/admin`, and `/u/*`
only run after client routing. Those routes are excluded from prerendering and
nginx answers them with `_shell.html`; that raw response has the homepage title
and neither a robots meta tag nor an `X-Robots-Tag` header. `/callback` and
`/invite` do not declare route-level `noindex` at all. The wildcard robots group
also omits `/admin`. More fundamentally, a `Disallow` does not guarantee that a
known URL stays out of an index, and it prevents compliant crawlers from
fetching the page-level `noindex` directive.

**Reproduction/evidence:** Fetching `/admin`, `/account`,
`/callback?code=redacted`, `/invite?token=redacted`, and `/u/example` with a
`Googlebot` user agent returned `200`, the homepage title, no canonical, no
robots meta, and no `X-Robots-Tag`. Each response was the same 18,697-byte SPA
shell. Fetching `robots.txt` as Googlebot, Bingbot, GPTBot, ClaudeBot,
PerplexityBot, and CCBot returned the same wildcard rules; all included the
account rule and all omitted an admin rule.

**Suggested fix:** Give every known private/dynamic route an explicit nginx
location that serves the SPA shell with `X-Robots-Tag: noindex, nofollow`, add
the missing route heads for defense in depth, and make the robots policy
consistent with the chosen crawl-versus-noindex strategy.

### SEC-02 — P1 — Arbitrary paths return a 200 homepage shell (soft 404)

**References:** `myscrollr.com/Dockerfile:154`,
`myscrollr.com/Dockerfile:163`, `myscrollr.com/Dockerfile:166`.

The catch-all `try_files` sends every nonexistent path to `_shell.html` with a
successful status. This lets crawlers discover unlimited 200 responses with
homepage metadata at arbitrary URLs, wasting crawl budget and creating soft-404
or duplicate-content signals.

**Reproduction/evidence:** A Googlebot request to
`https://myscrollr.com/does-not-exist` returned `200`, an 18,697-byte body, and
the title `Scrollr — Live Desktop Ticker for Sports, Stocks & News`, with no
robots tag or canonical. It was byte-identical in size to the five private SPA
route responses above.

**Suggested fix:** Restrict SPA fallback handling to the finite authenticated
and dynamic route patterns and return a real `404` for all other missing paths.

### SEC-03 — P2 — CSP permits all inline scripts on public and authenticated pages

**References:** `myscrollr.com/Dockerfile:184`,
`myscrollr.com/Dockerfile:187`, `myscrollr.com/src/routes/__root.tsx:126`.

The site has a useful CSP, but `script-src 'unsafe-inline'` removes most of its
protection against an injected inline script on every route, including account
and staff routes. The current static shell legitimately contains inline
bootstrap code, so removing the directive is not a one-line change; no
exploitable injection source was demonstrated in this scoped audit.

**Reproduction/evidence:** The live `Content-Security-Policy` header contains
`script-src 'self' 'unsafe-inline' https://js.stripe.com`; the built
`dist/client/_shell.html` contains four inline script elements with bodies of
695, 919, 739, and 35 bytes.

**Suggested fix:** Move the inline theme/bootstrap code behind CSP hashes or
per-response nonces, then remove `'unsafe-inline'` from `script-src`.

### SEC-04 — P2 UNCERTAIN — An external origin may frame every site route

**References:** `myscrollr.com/Dockerfile:187`.

`frame-ancestors` allows `https://relentnet.com` to embed public, account, and
staff routes. A repository-wide search found no other reference documenting an
embed integration, so this may be a stale permission; if it is intentional,
the external dependency is not represented in this repository.

**Reproduction/evidence:** The live CSP is `frame-ancestors 'self'
https://relentnet.com`, and `rg "relentnet.com|frame-ancestors"` found only the
Dockerfile directive.

**Suggested fix:** Confirm the embed owner and remove
`https://relentnet.com` from `frame-ancestors` unless an active integration
requires it.

## Verified controls and non-findings

| Boundary | Evidence | Verdict |
|---|---|---|
| Crawler user agents | `robots.txt:10` uses one `User-agent: *` group; live requests from Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot, and CCBot received the same rules. | Correct wildcard coverage; the private-route omissions are captured in SEC-01. |
| Sitemap | `scripts/generate-sitemap.mjs:18-37` and `public/sitemap.xml:3-92` contain only the 18 intended public routes; no account, admin, callback, invite, profile, or shell URL is listed. | Pass. |
| Canonical host | `Dockerfile:83-88` redirects www to apex. Live `https://www.myscrollr.com/sports/?probe=security` returned `301` to `https://myscrollr.com/sports/?probe=security`. | Pass; query string preserved. |
| Trailing slash | `Dockerfile:158-160` narrows redirects to public marketing routes. Live `/sports/?probe=security` returned `301` to `/sports?probe=security`. | Pass; query string preserved. |
| Host routing | `k8s/ingress.yaml:27-74` declares only apex, www, and API hosts. A TLS request sent to the apex address with `Host: evil.example` returned `404`; apex returned `200`, and www returned the intended `301`. | Pass at the public ingress. The Docker default server's broad `_` name is not publicly reachable through the tested ingress. |
| HTTPS/HSTS | The live HTTP endpoint returned `308` to the same HTTPS URL with its query intact; HTTPS responses carry `Strict-Transport-Security: max-age=31536000; includeSubDomains`. | Pass, but both controls are supplied by the ingress/controller rather than this website manifest and therefore require deployment-level regression checks. |
| Response headers | `Dockerfile:184-187` supplies nosniff, referrer, permissions, CSP, `base-uri`, `form-action`, and `frame-ancestors`; live apex, www redirect, public, and private-shell responses carried them. | Pass except SEC-03 and the uncertain exception in SEC-04. |
| Injection search | `releases.tsx:76-77` sanitizes rendered release markdown with DOMPurify; `CustomizationShowcase.tsx:173-176` injects only module-owned constant copy; `__root.tsx:126` injects a module-owned theme script. | No crawler-boundary injection finding. |
| Native/IPC | The scoped website is a static React/nginx runtime and the inventory identifies no native bridge or IPC entry point. | Not applicable. |
| Webhooks/server-side fetch | The scoped static marketing runtime has no inbound webhook or user-controlled server-side fetch. | Not applicable. |
| Secrets | `Dockerfile:49-68` distinguishes public `VITE_*` values from builder-only Sentry credentials, and the final image starts from a fresh nginx stage at `Dockerfile:75-79`. | No client-secret finding in scope. |

## Dependency audit

`npm audit --omit=dev --json` reported 33 advisories (11 high, 16 moderate,
6 low, 0 critical). The high chains are Vite/build tooling and its transitive
packages (`@babel/core`, Browserslist, js-yaml, nanoid, picomatch, PostCSS,
Rollup, and Undici). They are used during build/dev, do not ship in the fresh
nginx runtime image (`Dockerfile:75-79`), and their advisory preconditions
require a dev server, untrusted build input/config, proxy/cache APIs, or direct
parser/generator calls that the static production site does not expose. The
runtime DOMPurify advisory is moderate/low and requires
`CUSTOM_ELEMENT_HANDLING` or the `IN_PLACE` hook; `releases.tsx:76-77` uses only
`USE_PROFILES: { html: true }`. No high/critical advisory was found reachable
through the scoped production crawler surface.

## Summary

| Severity | Count | Findings |
|---|---:|---|
| P0 | 0 | — |
| P1 | 2 | SEC-01 private routes lack effective raw-response noindex; SEC-02 arbitrary paths are soft 404s |
| P2 | 2 | SEC-03 inline-script CSP weakening; SEC-04 uncertain external framing exception |

The SEO QA PR is blocked on the two shared nginx fallback defects. The existing
sitemap, wildcard crawler coverage, canonical host redirects, query
preservation, public ingress host rejection, and edge-managed HTTPS/HSTS all
passed direct verification.
