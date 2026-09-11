# Performance audit — SCROLLR-191

## Calibration

This lens is calibrated to the statically prerendered `myscrollr.com` marketing
site, where crawler-visible HTML and cold-load cost matter more than sustained
desktop-ticker behavior. The persistent demo bar and `/status` polling are
included because they run after hydration on public pages; authenticated admin
and desktop-app hot paths are outside this inventory.

## Measurement notes

- A production-mode Vite build emitted 2,829 transformed client modules. Its
  shared client chunk was 667,377 bytes raw / 216,950 bytes gzip and its shared
  stylesheet was 177,846 bytes raw / 24,920 bytes gzip. The build was stopped
  after client, SSR, and 23-page prerender output because another audit process
  needed exclusive ownership of the shared `dist` directory; this lens does not
  claim the interrupted `tsc`/postbuild stages passed.
- A fresh headless Chromium load of
  `https://myscrollr.com/?audit=performance` at 1440x900, with no CPU or network
  throttling, returned HTTP 200. Navigation response end was 118.8 ms,
  `DOMContentLoaded` was 211.4 ms, and load was 304.9 ms. A second cold process
  measured first contentful paint at 316 ms and largest contentful paint at
  1,176 ms (the `H1`, 573,945 px²). These are diagnostic single-run numbers,
  not field Core Web Vitals.
- During a five-second settled-page sample, 301 animation frames averaged
  16.64 ms; p95 was 16.70 ms and maximum was 16.80 ms. No frame-time finding
  was reproduced during that unthrottled sample.
- Chromium reported a 10,000,000-byte used JS heap after the cold homepage
  load. The lens's 0/5/15-minute heap series was not run: there is no defined
  representative 15-minute activity for this static marketing surface, and it
  would profile the wrong product (the long-running desktop ticker is explicitly
  outside the audit inventory). Timer cleanup and hidden-page behavior were
  inspected directly instead.

## Findings

### PERF-1 — P1: a non-LCP, below-fold screenshot consumes two cold-load image transfers

**Location:** `myscrollr.com/src/routes/index.tsx:65-79`,
`myscrollr.com/src/routes/index.tsx:97-112`,
`myscrollr.com/src/routes/index.tsx:118-127`, and
`myscrollr.com/src/components/landing/DesktopProof.tsx:91-99`.

**Evidence/reproduction:** The route marks the light and dark desktop screenshot
preloads `fetchpriority="high"`, although `DesktopProof` is the third homepage
section after `TerminalHero` and `CatalogPicker`, and the image itself is
`loading="lazy"`. The measured page was 5,233 px tall with a 900 px viewport;
its LCP was the hero `H1` at 1,176 ms, not this image. Nevertheless, the cold
production request transferred both
`desktop-home-light@1x.webp` (69,854 encoded bytes, initiated by `link`) and
`desktop-home-dark@1x.webp` (70,624 encoded bytes, initiated by `img`): 140,478
encoded bytes before any scroll. The SSR snapshot renders the dark source and
hydration can switch it to the visitor's light theme, while the light preload
has already run.

**Suggested fix:** Remove the route-level high-priority image preloads and let
the existing lazy image load near the section. If early discovery is later
proven necessary, render a theme-selecting `<picture>` whose media sources are
stable across SSR and hydration, then validate that one—not two—renditions load.

### PERF-2 — P2: every public route hydrates through a 667 KB shared client chunk

**Location:** `myscrollr.com/src/client.tsx:4-15` and
`myscrollr.com/src/client.tsx:48-58`.

**Evidence/reproduction:** The production build emitted a 667,377-byte raw /
216,950-byte gzip common chunk, above the lens's 100 KB threshold. The current
production homepage transferred a 240,670-byte encoded common chunk. Generated
HTML module-preloads that chunk on each sampled prerender: `/` referenced
865,028 raw bytes of CSS/JS assets, `/sports` 851,027, `/download` 845,223,
`/status` 856,853, and `/releases` 961,505. Source-map attribution for the local
common chunk included 545,403 source bytes from `react-dom`, 337,368 from
`motion-dom`, 165,013 from `@tanstack/router-core`, 157,443 from `framer-motion`,
105,319 from `@sentry/core`, and the globally imported Logto/Jose code. The same
build also emitted two other assets above 100 KB raw: shared CSS at 177,846
bytes (24,920 gzip) and the `/releases` route chunk at 116,282 bytes (40,940
gzip).

**Suggested fix:** Treat this as a measured follow-up, not scope for the SEO-copy
refinement. Split authenticated Logto/provider code and route-only libraries
from the public bootstrap while preserving operational Sentry coverage; then
use a bundle visualizer/metafile to pick the next split. Do not add manual
chunks blindly—the common bundle needs attribution first.

### PERF-3 — P2: public recurring work continues while the document is hidden

**Location:** `myscrollr.com/src/hooks/useDemoTicker.ts:683-693`,
`myscrollr.com/src/components/DemoTickerBar.tsx:85-90`,
`myscrollr.com/src/routes/widgets.tsx:66-78`,
`myscrollr.com/src/routes/business.tsx:877-885`, and
`myscrollr.com/src/routes/status.tsx:108,155-193`.

**Evidence/reproduction:** The shared demo ticker schedules a React state update
every 3,000 ms on nearly every public route and a clock update every 30,000 ms.
`/widgets` and `/business` each add another 3,000 ms interval. `/status` issues
three requests (`/health`, `/events/count`, `/channels`) immediately and every
30,000 ms, or 360 requests/hour while left open. All intervals clean up on
unmount, but none checks `document.visibilityState`; therefore their callbacks
(and status requests) remain scheduled for background tabs. Browser RAF-based
visual motion is automatically throttled/paused by the browser and is not part
of this finding.

**Suggested fix:** Pause the 3-second demo updates and `/status` polling on
`visibilitychange`, resuming with one immediate refresh when visible. The
30-second display clock can use the same shared visibility gate if profiling
shows it matters.

## Timer, listener, and background-work inventory

| Surface | Recurring work | Cleanup | Hidden behavior |
|---|---:|---|---|
| Shared demo ticker | 3 s chip update; 30 s clock update | Both intervals clear on unmount (`useDemoTicker.ts:687-694`, `DemoTickerBar.tsx:85-90`) | No visibility gate |
| `/widgets` | 3 s sample-chip update | Clears on unmount (`widgets.tsx:71-78`) | No visibility gate |
| `/business` | 3 s branded-chip update | Clears on unmount (`business.tsx:881-885`) | No visibility gate |
| `/status` | 3 fetches immediately and every 30 s | Clears interval on unmount (`status.tsx:188-194`) | No visibility gate |
| Theme media query | `change` listener | Removed on cleanup (`useTheme.ts:108-120`) | Event-driven only |
| Header and dialogs | Keyboard/pointer listeners | Removed on cleanup (`Header.tsx:67-76`, `DownloadButton.tsx:176-195`) | Event-driven only |
| FAQ | Resize and keyboard listeners | Removed on cleanup (`FAQSection.tsx:434-476`) | Event-driven only |
| Demo store | One module-lifetime `storage` listener | No component cleanup (`useDemoTicker.ts:255-266`) | One listener per loaded module, not per subscription; no accumulating leak found |
| Business copy feedback | One 2 s timeout after click | No explicit cancellation (`business.tsx:627`) | Bounded single timeout; no material growth reproduced |

## SEO-change risk summary

- Fix PERF-1 in this refinement: it is directly evidenced on production, is
  localized, and removes an unnecessary high-priority transfer without changing
  crawler content.
- Keep PERF-2 and PERF-3 as separate measured follow-ups unless this task is
  explicitly expanded. Neither requires a new dependency, and neither should
  block factual/canonical/schema corrections.
- No render-blocking synchronous external script was found. The generated entry
  script is `type="module" async`; the 177,846-byte stylesheet is the only
  render-blocking asset class observed, and the two self-hosted font preloads are
  90,096 bytes (Archivo variable) and 25,336 bytes (IBM Plex Mono 400).
