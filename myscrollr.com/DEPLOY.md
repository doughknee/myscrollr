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
- `/business` (`business/index.html`)
- `/architecture` (`architecture/index.html`)
- `/support` (`support/index.html`)
- `/legal` (`legal/index.html`)
- `/uplink` (`uplink/index.html`)
- `/uplink/lifetime` (`uplink/lifetime/index.html`)

## Dynamic / auth routes (SPA fallback)

These routes are NOT prerendered. They require nginx's SPA fallback to serve `index.html`, after which the client-side TanStack Router takes over:

- `/account` — Logto-gated user account page
- `/callback` — Logto OAuth callback
- `/invite` — invite-code redemption flow
- `/status` — live system status
- `/u/<username>` — public profile pages (dynamic param)

The nginx config in `Dockerfile` uses `try_files $uri $uri/ /index.html;` to handle this. Any path that doesn't match a prerendered file or directory falls back to `index.html`, which boots the SPA and lets the router resolve the actual route from `window.location`.

### About `_shell.html`

TanStack Start emits `dist/client/_shell.html` as the SPA shell — it's the HTML rendered by fetching `/` during prerender, so it contains the home route's `head()` output. A small `copyShellToIndex()` Vite plugin (in `vite.config.ts`) copies `_shell.html` to `index.html` after Start's post-build step, because Start's internal post-build always claims `index.html` for itself and would otherwise overwrite our home prerender.

Both files exist in `dist/client/`; they are currently byte-identical. The SPA fallback target is `index.html` — equivalent to `_shell.html` for now.

**Known limitation:** because `_shell.html` is rendered from `/`, dynamic routes that fall back to `index.html` briefly carry the home page's `<title>`, canonical, and JSON-LD until the client router updates document metadata after hydration. This affects crawlers that don't execute JS and the very first moments of the browser tab title. Most dynamic routes (`/account`, `/invite`, `/callback`, `/u/*`) are already blocked in `public/robots.txt`, so the impact is mainly on `/status` and any future non-disallowed dynamic routes. This is a known artifact of Start's current shell behavior and is acceptable for the current set of dynamic routes.

## nginx fallback (alternative web servers)

Other static hosts use equivalent SPA fallback config. The config baked into the Dockerfile is:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

For Caddy (minimal site block):

```caddyfile
myscrollr.com {
  root * /srv
  try_files {path} {path}/index.html /index.html
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

1. `prebuild` — `scripts/fetch-latest-version.mjs` (pins the latest desktop version into `src/lib/latestVersion.generated.ts`).
2. `vite build` — builds the client + SSR bundles, runs the Start prerender phase, then runs the `copyShellToIndex()` plugin.
3. `tsc` — final type check.

Output: `dist/client/` and `dist/server/`. Only `dist/client/` is shipped.
