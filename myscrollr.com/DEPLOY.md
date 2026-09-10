# Deployment Notes

The marketing site is statically prerendered via TanStack Start. The build emits two trees:

- `dist/client/` — static HTML, hashed assets, fonts, images. This is the directory served by nginx.
- `dist/server/` — Node SSR bundle. Not used in static deployment but produced by Start.

The Dockerfile in this directory copies `dist/client/` to `/usr/share/nginx/html`. **Do not copy `dist/` itself** — that nests the server bundle under the web root and breaks the routing.

The site is deployed via Kubernetes (see `k8s/website.yaml` and `k8s/ingress.yaml`). The Deployment runs the nginx-based image from `registry.digitalocean.com/scrollr/website` and the Ingress forwards `myscrollr.com` + `www.myscrollr.com` to the `website` Service on port 3000. The nginx config inside the container (defined in this Dockerfile) handles SPA fallback — the K8s Ingress is path-agnostic and just forwards everything.

## Prerendered marketing routes

The following routes are prerendered at build time and ship as static HTML with full per-route meta, OpenGraph, Twitter card, canonical, and JSON-LD scripts:

- `/` (`index.html`)
- `/channels` (`channels/index.html`)
- `/download` (`download/index.html`)
- `/download/mac` (`download/mac/index.html`)
- `/download/windows` (`download/windows/index.html`)
- `/download/linux` (`download/linux/index.html`)
- `/widgets` (`widgets/index.html`)
- `/fantasy` (`fantasy/index.html`)
- `/sports` (`sports/index.html`)
- `/markets` (`markets/index.html`)
- `/news` (`news/index.html`)
- `/releases` (`releases/index.html`)
- `/business` (`business/index.html`)
- `/architecture` (`architecture/index.html`)
- `/support` (`support/index.html`)
- `/legal` (`legal/index.html`)
- `/uplink` (`uplink/index.html`)
- `/uplink/lifetime` (`uplink/lifetime/index.html`)
- `/status` (`status/index.html`; live values populate after hydration)

## Dynamic / auth routes (SPA fallback)

These routes are NOT prerendered. They require nginx's SPA fallback to serve `index.html`, after which the client-side TanStack Router takes over:

- `/account` — Logto-gated user account page
- `/callback` — Logto OAuth callback
- `/invite` — invite-code redemption flow
- `/u/<username>` — public profile pages (dynamic param)

The nginx config in `Dockerfile` uses `try_files $uri $uri/index.html /_shell.html;` to handle this. Any path that doesn't match a prerendered file or route falls back to `_shell.html`, which boots the SPA and lets the router resolve the actual route from `window.location`.

### About `_shell.html`

TanStack Start emits `dist/client/_shell.html` from the synthetic `/tss-spa-shell` mask path. It contains the shared application chrome but cannot collide with the separately prerendered homepage at `dist/client/index.html`. nginx uses `_shell.html` only as the fallback for dynamic routes.

Dynamic routes briefly carry the shell metadata until the client router updates the document after hydration. The current dynamic routes are blocked in `public/robots.txt`, so crawlers are directed to the substantive prerendered pages instead.

## IndexNow activation (not enabled)

IndexNow is intentionally not wired yet: this repository has no owner-approved key, and deployment must not make external search submissions implicitly. To activate it later:

1. Generate an IndexNow key with 8–128 supported characters and store it as the GitHub Actions secret `INDEXNOW_KEY`; do not commit the key.
2. In the website build job, write the secret value to `myscrollr.com/public/<key>.txt` immediately before `docker build`. The file name and its UTF-8 contents must both be the key.
3. Deploy the website and verify `https://myscrollr.com/<key>.txt` returns only that key before submitting anything.
4. After the production smoke test succeeds, POST only the canonical URLs changed by that deployment to `https://api.indexnow.org/indexnow` with `host`, `key`, `keyLocation`, and `urlList`. Keep the current sitemap as the full crawl inventory; IndexNow is only a change notification.
5. Treat HTTP 200 or 202 as receipt, not proof of crawling or indexing. Failures should warn, not roll back an otherwise healthy website deployment.

The official protocol documentation defines the key-file ownership check, request payload, and response meanings. Do not add the submission step until the owner authorizes the key and outbound notification.

## nginx fallback (alternative web servers)

Other static hosts use equivalent SPA fallback config. The config baked into the Dockerfile is:

```nginx
location / {
  try_files $uri $uri/index.html /_shell.html;
}
```

For Caddy (minimal site block):

```caddyfile
myscrollr.com {
  root * /srv
  try_files {path} {path}/index.html /_shell.html
  file_server
}
```

The `try_files` directive only rewrites the URI — it must be paired with `file_server` (or another responder) to actually serve the rewritten file.

For the Kubernetes deploy in this repo: the nginx config baked into the Dockerfile handles SPA fallback. The Ingress (`k8s/ingress.yaml`) just forwards `myscrollr.com` → the `website` Service; no additional fallback config is needed at the K8s layer.

## Build pipeline

```sh
npm run build
```

Runs:

1. `prebuild` — four scripts in order:
   - `fetch-latest-version.mjs` → `src/lib/latestVersion.generated.ts` (pins the latest desktop version)
   - `fetch-releases.mjs` → `src/lib/releases.generated.ts` (feeds the `/releases` page)
   - `generate-sitemap.mjs` → `public/sitemap.xml`
   - `optimize-screenshots.mjs`

   Both `*.generated.ts` files are gitignored — they do not exist in a clean
   checkout and are rebuilt every time. `predev` runs `fetch-latest-version`
   alone, so `npm run dev` works without the rest.

2. `vite build` — builds the client + SSR bundles, runs the Start prerender phase, then runs the `copyShellToIndex()` plugin.
3. `tsc` — final type check.
4. `postbuild` — three gates that fail the build: `check-sentry-tunnel.mjs`,
   `check-prerender.mjs`, `check-mobile-viewport.mjs`.

Output: `dist/client/` and `dist/server/`. Only `dist/client/` is shipped.
