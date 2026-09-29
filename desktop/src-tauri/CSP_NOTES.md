# Content Security Policy Notes

The CSP lives in `tauri.conf.json` under `app.security.csp`.

## Current (v1.0)

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
connect-src 'self' https://*;
img-src 'self' data: blob: https://*;
worker-src 'self' blob:;
```

### Why `connect-src https://*` (permissive)

The Uptime Kuma widget (`src/widgets/uptime/`) connects to a
user-configured status page URL. Since this URL is entirely user-supplied
and can point to any self-hosted Kuma instance on any domain, a static
allowlist is not possible for v1.0.

`img-src https://*` is similarly permissive to allow user-provided
RSS feed thumbnails and arbitrary external icons to load.

## Intended allowlist (v1.1+, tracked)

Once Kuma's URL is handled via a runtime-generated CSP (rewriting the
policy at app startup from user preferences) or via a Tauri HTTP-plugin
proxy that moves the request off the WebView, the `connect-src` should
be tightened to:

```
connect-src 'self'
  https://api.myscrollr.com
  https://auth.myscrollr.com
  https://api.open-meteo.com
  https://geocoding-api.open-meteo.com
  https://api.github.com
  https://github.com
  https://objects.githubusercontent.com
  https://raw.githubusercontent.com;
```

Plus the user's configured Kuma origin, injected at runtime.

### Implementation options for v1.1

1. **Runtime CSP injection** — Tauri allows setting a dynamic CSP by
   rewriting `index.html`'s `<meta http-equiv="Content-Security-Policy">`
   at startup from persisted user prefs. Requires care: restart needed
   when the user changes the Kuma URL.
2. **Proxy Kuma requests through the Rust backend** — add a Tauri
   command `fetch_kuma_status(url)` that performs the HTTP request
   from Rust, bypassing the WebView CSP entirely. Cleanest option.

Option 2 is preferred because it also solves CORS issues that
self-hosted Kuma instances may have.
