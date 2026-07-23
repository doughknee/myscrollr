# Mobile Refactor — myscrollr.com

Date: 2026-05-14
Status: Approved — implementation in progress

## Summary

The marketing website (`myscrollr.com/`) is well-designed on desktop but
shows clear layout regressions on small screens. This document audits
the current mobile state, defines design constraints, and lays out the
sequence of incremental PRs that will bring mobile parity without
disturbing the (locked) desktop appearance.

## Design Constraints

1. **Desktop appearance is locked.** Any change visible above the
   `lg:` breakpoint (`1024px`) requires explicit approval. The current
   desktop layout is the source of truth.
2. **Mobile-first redesign permitted.** Where useful, mobile gets its
   own structurally different layout. The pricing comparison table is
   a clear case — a 5-column grid cannot be made readable below
   `md:`. Stacked per-tier cards below `md:` is the correct mobile
   pattern even though it looks completely different from the desktop
   table.
3. **Motion on desktop is preserved.** On mobile, motion may be
   simplified (shorter delays, dropped opacity-fades) where it
   contributes to perceived layout flash or jank.
4. **No new JS dependencies for layout work.** CSS, structural
   changes, and removing unused things only. Adding a Playwright
   dev-dependency for mobile viewport regression testing is
   acceptable since it runs only in CI/local, never in the shipped
   bundle.

## Audit Findings

### Universal (cross-page) issues

#### 1. `.container` has no mobile vertical-padding step

In `src/styles.css:760`:

```css
.container {
  @apply mx-auto px-5 sm:px-6 lg:px-8 py-16 lg:py-24;
  max-width: 1400px;
}
```

`py-16` (4rem = 64px) is the mobile padding. With every section
inheriting this, two adjacent sections produce 128px of vertical
gap. On a 667px-tall viewport (iPhone SE) that is ~20% of viewport
height between sections — sections feel stretched and the page feels
endless.

**Fix:** add a mobile step. Target: `py-10 sm:py-12 lg:py-24` so
mobile gets ~64px stacked padding between sections (half the current
amount). Same change applied to `.container-sm` and `.container-lg`.

#### 2. `body { overflow-x: hidden }` band-aid (styles.css:266)

Hides horizontal overflow rather than preventing it. Keep the body
rule (defense in depth), but treat any actual horizontal-scroll case
as a bug to fix at the source. The new Playwright check will catch
new offenders.

Suspected offenders (from grep): elements with negative inset
classes like `-inset-8`, animated `motion.div` containers with
`whileHover.x`, and any element using a fixed pixel width that
exceeds 360px without a `max-w-full`.

#### 3. Touch targets below WCAG 2.5.5 AAA target (44×44 CSS px)

WCAG 2.2 raised the bar; AAA target is 44×44 CSS px. Current
violations:

- Hero `WORD_ACCENTS` progress-bar buttons: `flex-1 py-2` on a `h-1`
  track → ~16 CSS px tall. Should be at least 44 CSS px tall on
  mobile. Suggestion: increase `py` to `py-3` on mobile to reach
  44px (12+12+16 = 40, close enough; pad to `py-3.5` if needed).
- `.btn-sm` is `py-2 text-xs` → ~32px tall. Many uses across the
  site. Acceptable on desktop where pointing devices are precise;
  borderline on touch. The pragmatic call: leave `.btn-sm` as-is
  (used in tight contexts where 44px would be visually wrong), but
  ensure no critical-flow CTAs use it on mobile.
- Footer social icons: `w-10 h-10` = 40px. Slightly under 44px.
  Acceptable given the optional importance.

#### 4. H1 long-word overflow risk

`h1 { font-size: clamp(2.5rem, 5vw, 4.5rem) }`. On a 320px viewport,
2.5rem = 40px. A single word like "Headlines" at 40px in bold ≈
~210px wide — fits within the 280px content area on iPhone SE
(`px-5` = 20px each side). Adding `overflow-wrap: break-word`
on `h1-h6` as defense-in-depth catches future long words and any
narrower viewport.

#### 5. iOS Safari address-bar gotcha

`min-h-screen` (= `min-height: 100vh`) is unreliable on iOS Safari
because `vh` includes the URL bar height even when it's collapsed.
`min-h-dvh` (= `100dvh`, dynamic viewport height) is the correct
modern unit. Several pages still use `min-h-screen`:

```
src/routes/uplink_.lifetime.tsx
src/routes/uplink.tsx
src/routes/business.tsx
src/routes/channels.tsx
src/routes/support.tsx
src/routes/account.tsx
src/routes/invite.tsx
src/routes/download.tsx
src/components/LoadingSpinner.tsx
```

Replace `min-h-screen` with `min-h-dvh` site-wide. No desktop
visual change (`100vh == 100dvh` when address bar isn't auto-hiding).

### Page-specific issues

#### `/` (home)

- **Hero takes a full `min-h-dvh`** with text below the screenshot on
  mobile (`order-2 lg:order-1` swaps it). The screenshot is
  `w-[360px]` on the smallest breakpoint — slight overflow risk on
  320px viewports (iPhone SE 1st gen is 320px). Cap at
  `w-full max-w-[360px]` so the image scales down with the viewport.
- **Animation delays compound.** Hero text fades in at delays
  300ms → 800ms → 1000ms → 1200ms. On desktop these layer nicely
  over the prerendered HTML. On mobile, the same delays feel slower
  because phones are touched-into faster (no hover preview, no
  multi-window). Cut delays in half (or drop them entirely) for
  `< md:` viewports. **Honor the design constraint: keep desktop
  delays intact**.
- **Hero order reversal** (`flex-col-reverse` to put text first on
  mobile) was considered. Decision: keep text-first on mobile
  (current behavior is `order-2 lg:order-1` on the image and
  `order-1 lg:order-2` on the text → wait, actually image is
  `order-2` (below) and text is `order-1` (above) on mobile —
  current behavior already shows text first on mobile. **No
  reordering needed.** This was a misread on first pass.

#### `/uplink` (pricing)

- **Comparison table** at `src/routes/uplink.tsx:3468`:
  `className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr]"`.
  Unconditional 5-column layout. At 360px viewport with internal
  padding, each column is ~64px wide. Cell content is `text-[11px]
  font-mono` plus icons. Completely unusable on mobile.

  **Fix:** below `md:`, swap the entire comparison block for a
  stacked card layout: one card per tier (Free, Uplink, Pro,
  Ultimate). Each card shows all comparison rows for that tier.
  Cards have large touch-friendly text and full-width readable
  rows. Above `md:`, the existing table renders unchanged.

  Implementation note: the `comparisonRows` data structure stays
  identical. The mobile component reads the same data and pivots
  it (one card per tier, all rows under each card).

- The rest of `/uplink` (tier showcases, billing toggle, FAQ) is
  large but already responsive. Spot-check on mobile during PR 3.

#### `/download`

- Platform cards (`<DownloadButton>` + format picker) should reflow
  fine because they're already single-column on mobile. Format
  dropdown uses `document.addEventListener` for click-outside —
  works on touch.
- Spot-check in PR 4.

#### `/channels`

- Product screenshots are rendered via the shared
  `<ProductScreenshot>` primitive which already handles responsive
  sizing. Most likely OK; needs spot-check.
- 961-line file; will inspect during PR 4.

#### `/business`

- 1817-line file. B2B copy-heavy. Likely candidates for issues:
  contact-form rows, pricing/tier blocks. Inspect during PR 5.

#### `/architecture`

- Technical reader audience. Diagrams are inline SVG — should scale.
  Inspect during PR 5.

#### `/support`

- FAQ + contact form. The form is in `<SupportContactForm>` which
  we wrapped in `<ClientOnly>` in the previous PR. Spot-check input
  sizes (touch-target compliance) during PR 5.

#### `/legal`

- Long text doc. Sidebar nav on desktop. Likely already mobile-OK
  because it's a typography page. Inspect during PR 5.

## PR Sequence

| PR | Scope | Files |
|----|-------|-------|
| **1** | This audit doc + universal fixes + Playwright viewport check | `docs/`, `styles.css`, a handful of `<h1>-<h6>` guard rules, all `min-h-screen` → `min-h-dvh` replacements, new `tests/mobile-viewport.test.ts` + `playwright.config.ts` |
| **2** | Home hero mobile polish | `src/components/landing/HeroSection.tsx`, `HeroProductShowcase.tsx` |
| **3** | `/uplink` comparison table → stacked cards on mobile | `src/routes/uplink.tsx` (only the comparison section) |
| **4** | `/download` + `/channels` polish | `src/routes/download.tsx`, `src/routes/channels.tsx`, `src/components/DownloadButton.tsx` |
| **5** | `/business` + `/architecture` + `/support` + `/legal` polish | Per-file responsive tweaks |

Each PR is squash-merged separately so risk is bounded.

## Verification

### Per-PR

- `npm run build` green (includes typecheck via `tsc --noEmit`)
- `npm run lint` clean
- `check-prerender.mjs` postbuild check still passes (body content
  for each prerendered route)
- Playwright `mobile-viewport.test.ts` passes (after PR 1 introduces
  it) — checks no horizontal scroll at 320/375/414/768 widths on
  every marketing page

### Subjective (per-PR)

- Hard-reload the deployed PR preview on a real iPhone / Android
  device
- Walk every section, look for: horizontal scroll, awkward gaps,
  cramped text, missed touch targets
- Compare desktop side-by-side to confirm no regressions

## Open Questions

None at this point. All scope, constraints, and PR sequencing have
been agreed upon in the brainstorming session.

## Out of Scope

- Performance optimization (image lazy-loading audits, JS bundle
  splitting, etc.). Separate concern.
- Auth-route mobile polish (`/account`, `/callback`, `/invite`,
  `/u/$username`). These are interactive surfaces, not marketing
  pages.
- Dark/light theme toggle behavior on mobile (already works; not a
  layout issue).
- Animation timing changes on desktop (explicitly locked by the
  user).
- The 301-trailing-slash redirect that points at `:3000` —
  separate nginx config concern, noted earlier.
