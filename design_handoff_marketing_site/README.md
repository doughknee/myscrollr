# Scrollr Marketing Site — Design Direction Handoff

**READ THIS FIRST: this is an evolution brief, not a rebuild spec.**

The mockups in this folder set a visual/verbal DIRECTION for myscrollr.com. The
existing site (`myscrollr.com/` in the repo) carries enormous invested value that
the mockups deliberately do NOT reproduce: Motion animation work, the
ConvergenceBackdrop and DeploymentFanout visuals, LCP/code-splitting
optimizations, SEO + JSON-LD structured data, hero image preloading, auth
(Logto) and billing (Stripe) wiring, self-hosted fonts for CSP, and the
zero-analytics promise. **None of that gets bulldozed.** Your job is to merge:
adopt the new visual system, copy, and interactive ideas INTO the existing
architecture, keeping every piece of infrastructure listed per-page below.

When a mockup and the existing site conflict on *content or layout*, the mockup
wins. When they conflict on *infrastructure, perf, SEO, or integrations*, the
existing site wins. When unsure, keep both paths and flag it.

## Files

| File | What it is |
|---|---|
| `Marketing - Redesign v2.dc.html` | Landing page mockup (open in browser) |
| `Widgets - Redesign.dc.html` | /channels replacement — full catalog |
| `Uplink - Redesign.dc.html` | /uplink — pricing |
| `Download - Redesign.dc.html` | /download |
| `Support - Redesign.dc.html` | /support |
| `Business - Redesign.dc.html` | /business |
| `screenshots/` | Key states captured from the mockups |
| `assets/desktop-home.png` | Real product screenshot used on the landing page |
| `support.js` | Mockup runtime — ignore, not part of the design |

Mockups are self-contained HTML; open them in a browser and interact. All
behavior is real: the pinned bar, widget picker, palette switcher, billing
toggle, white-label switcher, search, accordions.

## The design system ("terminal editorial")

Tokens (add to `src/styles.css` `@theme`; keep the existing palette values —
they match):

- **Display type:** Archivo (variable, `wdth` axis), rendered
  `font-stretch: 115%`, weight 800, UPPERCASE, tight leading (.94), for all
  headlines. Self-host in `public/fonts/` per the CSP convention (the mockups
  use Google Fonts only because they're standalone). Plus Jakarta Sans is
  RETIRED for display use; keep it or Archivo regular for body text — pick one
  and be consistent.
- **Mono:** IBM Plex Mono (already self-hosted) is promoted from code-font to a
  structural voice: section tags, stats, prices, labels, buttons' microcopy.
- **Colors:** unchanged from the existing theme. Page bg `#101018` (slightly
  deeper than base-100 `#141420` — add as a token, e.g. `--color-base-75`),
  hairlines `#232332` (major) and `#1c1c2a` (minor), panel `#15151f`,
  primary emerald `#34d399` as the near-only accent.
- **Texture:** 4px horizontal scanlines at ~1.2% white opacity on the page bg
  (`repeating-linear-gradient`), soft emerald radial glow behind each page
  header.
- **Radii:** sharp — 4px on controls, 8px on cards. The soft 12-16px radii of
  the current site are retired on marketing pages.
- **Signature type treatment:** two-part headlines; the payoff line is
  outlined (`-webkit-text-stroke: 1.5px #34d399; color: transparent`).
- **Section formula:** every section opens with a full-width hairline and a
  mono tag row: `SEC NN ／ NAME` left, optional stat right (11px, letter-spaced,
  `#5a5a72`).
- **Row vocabulary** (use instead of card grids wherever content is list-like):
  - *Ledger rows*: grid rows with mono code column, bold name, muted desc,
    hairline separators (catalog, audiences, refusals, FAQs).
  - *Departures rows*: full-width `<a>` rows with `↳ NN` index, big uppercase
    label, emerald mono action on the right, hover tint
    `rgba(52,211,153,.05)` (downloads, CTAs, escalation links).
  - *Ghost numerals*: oversized outlined `01/02/03` for step sequences.
- **Motion:** entrance = `riseIn` (24px rise + fade, 80ms stagger) on page
  headers, driven by the existing Motion library (`motion/react`) — port the
  inline CSS animations to the site's `EASE` constant and `useInView` patterns.
  Keep existing scroll-into-view reveals elsewhere.

## The persistent demo bar (new, cross-page — the brand's connective tissue)

A 48px fixed bar, default bottom, on EVERY marketing page. It is a working
mini-Scrollr:

- Left cell: pulsing emerald dot + `SCROLLR` mono label. Right cell: live clock.
- Middle: seamless marquee (duplicate the chip list 2x, `translateX(-50%)`
  keyframe loop, ~45s, pause on hover). Chips: colored source square, mono
  text, optional ▲/▼ delta, pulsing red `LIVE` tag on in-progress games.
- Fake-live data: jitter prices every 3s (see `chipsFor()` in any mockup's
  logic; port to a shared hook, e.g. `useDemoTicker`).
- State is shared across pages via localStorage key `scrollr-marketing-demo`:
  `{ active: string[] (widget ids), theme: string (palette id), pos: 'top'|'bottom' }`.
  The landing picker and the /channels "ADD TO BAR" buttons write it; every
  page reads it. Palette + position controls live on the landing page
  ("Make it yours" section).
- Business page exception: the bar becomes the white-label demo (see below)
  and does not write to the shared key.

## Approved copy (final — do not rewrite)

- Landing H1: `THE MOMENT IT HAPPENS,` / outlined `YOU ALREADY KNOW.`
- Landing sub: "The go-ahead run, the market swing, the breaking story, your
  fantasy comeback — live in a quiet bar above whatever you're working on. No
  checking, no feeds, no finding out late."
- Hero note: "the ticker is already running at the bottom of this page ↓ /
  that's the app — it stays on top of everything, including this site"
- Catalog: `PICK WIDGETS.` / `WATCH THE BAR CHANGE.` — "Start with the hits —
  the full catalog is one click away. Everything you add shows up in the bar
  below, immediately."
- Screenshot section: `THIS IS THE APP.` / `NOT A MOCKUP.` + `UNRETOUCHED` caption.
- Steps: "Installed before your coffee cools, no account required." / "Leagues,
  markets, feeds, your fantasy team — 35 widgets and counting. Each costs one
  slot. Three are free." / "The bar floats above every window — 40 pixels of
  your screen, none of your attention until something happens."
- Trust: `EVERY LINE OF CODE IS PUBLIC.` / `SO IS THE PROMISE.` — "…no
  'anonymous usage data.' Tests block any deploy that breaks this. You don't
  have to take our word for it." + live GitHub line (`★ N STARS · N FORKS ·
  LAST COMMIT N DAYS AGO`, correct pluralization).
- Landing CTA: `PUT IT ON YOUR DESKTOP.` — "three slots free, forever · nothing
  between you and the download"
- Upsell strip (past 3 widgets): "This is what Uplink feels like — 6, 12, or
  unlimited slots. From $6.67/mo, 7-day free trial."
- Uplink H1: `ONE PRICE LEVER:` / outlined `HOW MANY AT ONCE.` — "Every plan is
  the same app, and every widget costs the same. You're only choosing how many
  run on your bar at once. No feature matrix to squint at." (NOTE: the word
  "slots" was deliberately demoted — keep it out of headlines.)
- Uplink free-tier row: "Not ready? The free tier isn't a trial. Three slots,
  forever. No card, no clock."
- Download H1: `GET SCROLLR.` / outlined `FREE. NO SIGN-UP.`
- Support H1: `STUCK?` / outlined `PROBABLY NOT FOR LONG.`
- Business H1: `YOUR BRAND,` / outlined `OUR RAILS.`
- Footer everywhere: `ZERO ADS · ZERO TELEMETRY`
- Voice rules: quiet confidence, short declaratives, concrete numbers, no
  exclamation marks, mono for facts, em-dash payoffs.

## Per-page merge plan

### `/` — routes/index.tsx (mockup: Marketing - Redesign v2.dc.html)

- **KEEP:** code-splitting + Suspense placeholder architecture; hero image
  preload machinery; `seo()` head + all JSON-LD (`structured-data.ts`);
  `useGitHubStats` (drives the new trust stat line); `DownloadButton` +
  `detectPlatform` (drives the new OS-aware CTA); FAQ items feeding `faqPage`
  JSON-LD (update the 4 Q/As to the mockup's).
- **ADOPT:** the entire mockup page structure: nav → hero (static two-line
  headline, no typewriter) → SEC 01 catalog picker (9 featured pills, category
  count line, `+ 26 MORE` expander, slot meter `SLOTS ▓▓░ 2/3 FREE` flipping to
  amber `N RUNNING · UPLINK TERRITORY` + upsell strip past 3 — never blocking)
  → SEC 02 real screenshot w/ annotation rail (`assets/desktop-home.png`,
  FIG. 01 caption) → SEC 03 how-it-works ghost numerals → SEC 04 make-it-yours
  (6 palette swatches + PIN TOP/BOTTOM, both actually driving the bar) → SEC 05
  trust (refusals struck through in red) → SEC 06 FAQ → download departures
  rows with `YOURS` tag → footer. Plus the persistent demo bar.
- **RESTYLE:** `TickerShowcase`'s job is absorbed by the real demo bar — any
  content worth saving moves into SEC 01.
- **DROP:** typewriter hero (`Typewriter.tsx` word cycle), `HeroProductShowcase`
  carousel, `ChannelsShowcase`/`CustomizationShowcase`/`MakeItYoursSection`/
  `BenefitsSection` as separate long sections (their content is consolidated
  above). Confirm with Brandon before deleting files — prefer leaving them
  unimported for a release.

### `/channels` — routes/channels.tsx (mockup: Widgets - Redesign.dc.html)

- **KEEP:** the route, SEO head, and the real catalog data source — render from
  `GET /catalog` (or the generated snapshot) instead of the mockup's hardcoded
  35-item list. Category counts must be computed, not literals.
- **ADOPT:** header (`THE CATALOG.` / `35 AND COUNTING.` — make the number
  dynamic), search + category tabs, grouped ledger rows with mono source codes
  (`FIN—ST`, `SPT—NFL`…), dimmed sample-chip column, `＋ ADD TO BAR` writing to
  the shared demo-bar state, "Missing something?" row → GitHub issues, download
  departures row.
- **RESTYLE:** existing per-channel screenshots can live in a row detail or
  hover peek if desired — not required.

### `/uplink` — routes/uplink.tsx (mockup: Uplink - Redesign.dc.html)

- **KEEP:** live tier data from `GET /tier-limits` (never hardcode caps/prices),
  Stripe checkout + `CheckoutModal`, auth gating, `productOffers` JSON-LD,
  the AnimatePresence card-swap pattern for the billing toggle, lifetime
  route (`/uplink/lifetime`) and its purchase flow.
- **ADOPT:** header + toggle (MONTHLY / ANNUAL · 4 MO FREE / LIFETIME · LIMITED,
  annual default), 4 plan cards in terminal style with slot-square capacity
  visualization (3/6/12/∞), `MOST POPULAR` corner tag on Ultimate, assurance
  mono strip, "what paying gets you" trio, free-tier escape row, lifetime
  single amber card ($999 · `ONE PAYMENT.` / `EVERY WIDGET, FOREVER.` · 2.5-yr
  payback line).
- **RESTYLE:** the existing comparison table and alert/profile power-features
  section survive BELOW the cards if kept — re-skin to ledger rows. The
  animated aura/orb work on the lifetime card can stay, re-tinted amber.

### `/download` + `/download/$os` (mockup: Download - Redesign.dc.html)

- **KEEP:** `getDownloadInfo.ts` / `latestVersion.generated.ts` (version and
  asset URLs are generated — never hardcode `1.1.15`), `detectPlatform`,
  per-OS routes.
- **ADOPT:** `GET SCROLLR.` / `FREE. NO SIGN-UP.` header with detected-OS
  button + mono filename/arch line, platform departures board with `YOURS`
  tag and Linux format picker (.APPIMAGE/.DEB/.RPM), "first sixty seconds"
  trio, release-notes row → GitHub Releases.

### `/support` (mockup: Support - Redesign.dc.html)

- **KEEP:** `support-content.ts` as the single content source, the ticket
  form/flow (`SupportContactForm`), any osTicket integration.
- **ADOPT:** `STUCK?` / `PROBABLY NOT FOR LONG.` header with Discord + ticket
  CTAs, Q-grid for FAQ, accordion ledger for troubleshooting, three-channel
  escalation grid (Discord = fastest / ticket = billing / GitHub = bugs).

### `/business` (mockup: Business - Redesign.dc.html)

- **KEEP:** `businessApi` contact form (mockup uses mailto as placeholder — the
  real form stays), `ConvergenceBackdrop`, and **DeploymentFanout** — the 2x2
  branded-monitors visual is better than the mockup's text rows; re-skin it to
  the terminal palette and pair it with the hero.
- **ADOPT:** `YOUR BRAND, / OUR RAILS.` header; **the white-label bar demo**
  (hero buttons swap the pinned bar between SCROLLR / ACME CAPITAL / THE
  DUGOUT / NOVAX — each with own label, accent, palette, and audience-specific
  chips; this is the page's money moment); audience ledger; capability grid;
  NDA→scope→deploy steps; straight-answers FAQ (AGPL→commercial license
  wording verbatim); $500/mo departures CTA.
- **NOTE:** the mockup is intentionally text-heavier than the final should be —
  the kept DeploymentFanout + backdrop visuals close that gap.

### Pages NOT mocked (extrapolate from the system)

`/releases` (departures rows per version, mono dates, GitHub links),
`/status` (ledger rows per service + pulsing status dots), `/legal` (ledger
of documents), `/architecture` (keep current content; re-skin with section
tags + hairlines). `/account`, `/invite`, `/u/$username` are OUT OF SCOPE for
this pass — leave as-is.

## Global implementation notes

- Nav: mono uppercase links (`WIDGETS UPLINK GITHUB` + emerald `DOWNLOAD ↓`
  button), current page in emerald. Add BUSINESS to the footer at minimum.
- Dark mode: mockups are dark-only. Light mode must survive — derive a light
  mapping (paper bg `#f8f8fc`, hairlines `#d5d7e2`, same emerald) and verify
  the outlined-headline treatment; do not ship a broken light theme.
- Accessibility: bar marquee needs `prefers-reduced-motion` handling (pause,
  show static chips); accordion buttons need `aria-expanded`; outlined text
  needs a real color fallback where `-webkit-text-stroke` is unsupported.
- Keep zero analytics. Keep self-hosted fonts. Keep CSP intact (Archivo must
  be self-hosted, not Google Fonts).
- Mobile: mockups were designed desktop-first; nav collapses to a simple
  mono row, headline clamps are already responsive, ledger rows may stack
  their columns. Use judgment; keep the bar (it's the brand) but let it
  truncate to fewer chips.
