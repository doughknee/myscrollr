# Bundled fonts

Self-hosted so the webview never asks a CDN for a font (SCROLLR-254): no
reflow when a font lands, and offline launches render identically. Declared in
`src/style.css` (`font-display: block`); the four upright files are preloaded
from `index.html` / `app.html`.

All latin subsets, woff2, from Google Fonts (`fonts.gstatic.com`, v20 / v12).
Both families are licensed under the SIL Open Font License 1.1.

| File | Family | Weight |
|---|---|---|
| `ibm-plex-mono-400.woff2` | IBM Plex Mono | 400 |
| `ibm-plex-mono-500.woff2` | IBM Plex Mono | 500 |
| `ibm-plex-mono-600.woff2` | IBM Plex Mono | 600 |
| `plus-jakarta-sans-latin.woff2` | Plus Jakarta Sans (variable) | 200-800 |
| `plus-jakarta-sans-italic-latin.woff2` | Plus Jakarta Sans italic (variable) | 200-800 |

The three Plex files are the same ones `myscrollr.com/public/fonts/` ships.
To add a weight or a script, fetch the CSS from the Google Fonts API with a
modern user agent and take the `/* latin */` woff2 URL.
