# UI states audit — SCROLLR-191

Audit date: 2026-09-10

Scope: the public website surfaces listed in `audit/INVENTORY.md`. This was a
read-only audit; no production code or external data was changed.

## Method

- Inspected the public production site in a fresh Codex in-app browser tab.
- Visited every inventory route at desktop, 320 px, 390 px, and 768 px viewport
  overrides. The live DOM was checked for horizontal overflow, landmark counts,
  heading order, unnamed links/buttons, and images without `alt` attributes.
- Ran the existing `scripts/check-mobile-viewport.mjs` against the current local
  build. Its 56 route/viewport checks passed at 320, 390, 412, and 768 px.
- Exercised keyboard entry, the skip link, the mobile navigation dialog, Escape,
  and focus return. The status API was temporarily delayed and then blocked in
  the isolated QA tab to verify loading and error states; normal networking was
  restored and the healthy state reverified.
- Filtered `/widgets` with a 204-character unbroken query to exercise its empty
  and maximal-input state. It showed a named empty result and did not overflow.
- Read warning/error console entries after the live public-route pass. None were
  recorded, including no hydration warning on these public loads.

Screenshots were not created. Each failure below is a DOM/accessibility-state
defect (landmark nesting, heading level, or focus containment) that a still image
would not materially evidence; the exact runtime observations are included.

## Findings

### UI-1 — P1 — Support nests a second `main` landmark

- **Location:** `myscrollr.com/src/routes/support.tsx:58` (inside the shared
  `main#main-content` in `myscrollr.com/src/routes/__root.tsx:236`).
- **Reproduction/evidence:** Load `/support` and evaluate
  `document.querySelectorAll('main')`. Production returns `2`; the outer element
  is `main#main-content` and its first child route landmark begins `<main>...`.
  Every other public inventory route returned exactly one `main`.
- **Impact:** Nested main landmarks make screen-reader landmark navigation
  ambiguous and violate the page's otherwise consistent one-main document
  structure.
- **Suggested fix:** Change the route wrapper at line 58 (and closing tag at
  line 125) to a neutral `div`; keep the shared root `main` as the sole landmark.

### UI-2 — P1 — Support jumps from its H1 directly to FAQ H3 headings

- **Location:** `myscrollr.com/src/components/support/SupportFAQ.tsx:35`.
- **Reproduction/evidence:** On production `/support`, the rendered heading list
  is one H1 (`STUCK? PROBABLY NOT FOR LONG.`) followed directly by eight H3 FAQ
  questions. No H2 is rendered anywhere on the page. The section labels are
  styled text, not headings.
- **Impact:** The document outline implies missing parent sections and makes the
  FAQ hierarchy less useful to crawlers and heading-based assistive navigation.
- **Suggested fix:** Make the FAQ question headings H2, or add a real visible or
  visually-hidden H2 that owns the FAQ group before retaining H3 questions. The
  former is the smallest correct change for the current flat page structure.

### UI-3 — P1 — Keyboard focus escapes the modal mobile navigation

- **Location:** `myscrollr.com/src/components/Header.tsx:129-190`, especially the
  `aria-modal="true"` dialog at lines 142-153.
- **Reproduction/evidence:** At the 390 px production viewport, open **Open
  menu**, then press Tab through its controls. Focus begins on the dialog and
  traverses its wordmark, Close, four navigation links, account link, and
  Download. The next Tab lands on the page's background **Download for Windows**
  button (`insideDialog === false`), followed by **See the widgets**. The
  background is not inert. Escape does close the drawer and correctly returns
  focus to **Open menu**.
- **Impact:** The control declares a modal dialog but permits keyboard users to
  interact with obscured background content.
- **Suggested fix:** While open, trap Tab/Shift+Tab within the drawer and make
  the background inert. Reuse the existing first/last focusable elements; no
  dependency is needed. Preserve the already-correct Escape and focus-return
  behavior.

## Verified positives

- Every route rendered exactly one H1, one footer, descriptive names for all
  rendered links/buttons, and no image missing an `alt` attribute.
- All routes except `/support` rendered exactly one `main`; navigation landmarks
  were named where multiple navigation regions need disambiguation.
- Heading order on all non-Support pages followed the rendered H1/H2/H3 section
  structure without a skipped level.
- The first Tab on mobile reveals **Skip to main content**; activating it moves
  focus to `main#main-content` and updates the fragment to `#main-content`.
- A global `:focus-visible` ring exists in `src/styles.css:1117-1118`, and the
  skip link has a visible focused treatment.
- Current content produced no horizontal overflow on any inventory route at the
  tested desktop, 320, 390, or 768 px browser sizes. The existing local check
  also passed all 56 checks at 320, 390, 412, and 768 px.
- `/status` showed stable **CHECKING** / **Waiting on first health check** content
  under a delayed API and styled **API UNREACHABLE** / channel fallback content
  under blocked API requests, with no horizontal overflow. It automatically
  retries on the existing 30-second polling interval. Normal networking was
  restored and **ALL SYSTEMS OPERATIONAL** was reverified.
- `/widgets` showed a descriptive no-match state for a long client-side search
  query and remained within the viewport.
- `/channels` resolved to `/widgets` as intended and inherited its responsive,
  semantic, and empty-state results.

## State coverage

Legend: **U-S** = VERIFIED UNREACHABLE because the surface is statically
rendered and has no runtime loading/empty/error branch; **U-R** = VERIFIED
UNREACHABLE because `/channels` immediately redirects to `/widgets`; **PASS-S**
= source-verified fallback not triggerable from the populated static production
artifact. “Constrained” includes the 320/390/768 px layout and basic keyboard
checks.

| Surface | Loading | Empty | Error | Overflow / maximal content | Constrained / keyboard |
|---|---|---|---|---|---|
| `/` | U-S | U-S | U-S | PASS | **FAIL UI-3** |
| `/widgets` | U-S | PASS (long no-match query) | U-S | PASS | PASS |
| `/sports` | U-S | U-S | U-S | PASS | PASS |
| `/markets` | U-S | U-S | U-S | PASS | PASS |
| `/news` | U-S | U-S | U-S | PASS | PASS |
| `/fantasy` | U-S | U-S | U-S | PASS | PASS |
| `/download` | U-S | U-S | U-S | PASS | PASS |
| `/download/mac` | U-S | U-S | U-S | PASS | PASS |
| `/download/windows` | U-S | U-S | U-S | PASS | PASS |
| `/download/linux` | U-S | U-S | U-S | PASS | PASS |
| `/uplink` | U-S | U-S | U-S | PASS | PASS |
| `/uplink/lifetime` | U-S | U-S | U-S | PASS | PASS |
| `/business` | U-S | U-S | U-S | PASS | PASS |
| `/architecture` | U-S | U-S | U-S | PASS | PASS |
| `/releases` | U-S | PASS-S (`EmptyState`) | U-S | PASS | PASS |
| `/support` | U-S | U-S | U-S | PASS | **FAIL UI-1, UI-2** |
| `/legal` | U-S | U-S | U-S | PASS | PASS |
| `/status` | PASS | PASS (service fallback) | PASS | PASS | PASS |
| `/channels` | U-R | U-R | U-R | PASS after redirect | PASS after redirect |

The authenticated account/admin routes were not opened or modified; they are
outside this public-surface lens and the QA tab did not touch existing preview
or authenticated admin tabs. Checkout and support-form submission states were
not forced because doing so would create external side effects and belongs to
their owning workstreams, not this read-only SEO audit.
