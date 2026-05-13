# Marketing Site SEO + SSG Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `myscrollr.com` from a pure SPA to a statically prerendered site with per-route head management, structured data, optimized social previews, and AI-crawler-friendly artifacts — without losing the "deploys as a static bundle" property.

**Architecture:** Migrate from `@tanstack/router-plugin` to `@tanstack/react-start` with `spa: { enabled: true }` and `prerender: { enabled: true }`. Each public marketing route gets a `head()` function returning `<title>`, meta, OpenGraph, Twitter card, canonical, and JSON-LD. Auth/dynamic routes (`/account`, `/callback`, `/invite`, `/u/$username`, `/status`) stay client-rendered. Output remains pure static HTML in `dist/client/` — Coolify deploy is unchanged except for the SPA fallback path.

**Tech Stack:** Vite 7, React 19, TanStack Start 1.167+, TanStack Router 1.169+, Tailwind v4, TypeScript 5.9 strict.

**Sequencing notes:**
- Task 0 (NEW) fixes hydration-mismatch hot spots flagged by the pre-flight SSR audit. Must run before prerender is enabled.
- Task 1 (router bump on plain SPA) is the safety net — if it breaks, fix it before touching Start.
- Task 2 introduces Start but keeps everything client-rendered. Behavior should be byte-identical.
- Task 3 converts ONE route (`/legal`) end-to-end as proof. Verify the static HTML output before continuing.
- Tasks 4–9 roll out the remaining public routes one at a time.
- Tasks 10–14 add new SEO artifacts (JSON-LD helpers, OG images, llms.txt, sitemap regenerator).
- Task 15 deletes `usePageMeta` and the static fallback meta from `index.html`.

**Pre-flight audit findings (2026-05-12):** Logto, theme toggle, mobile drawer, motion/react, and all hooks are SSR-safe. No `ClientOnly` wrappers needed. The ONLY blocker for prerender is four module-scope `Math.random()` particle arrays — fixed in Task 0.

---

## Task 0: Fix hydration-mismatch hot spots (decorative particles)

**Files:**
- Modify: `myscrollr.com/src/components/landing/CallToAction.tsx`
- Modify: `myscrollr.com/src/routes/business.tsx`
- Modify: `myscrollr.com/src/routes/uplink.tsx` (two separate locations)

**Rationale:** The pre-flight SSR audit flagged four module-scope or render-time `Math.random()` calls that generate particle coordinates. On the prerender server they produce one set of coordinates; on the client they produce different ones, causing React hydration mismatch warnings on every prerendered page that includes these components.

Bonus: the `uplink.tsx:1997-2014` array is built INSIDE the component render with `Math.random()`, which means particles also re-shuffle on every re-render of the component — a UX bug independent of SSR. Hoisting fixes both.

**Fix pattern:** Add a tiny seeded PRNG (Mulberry32, 5 lines) and use it instead of `Math.random()`. Output is visually indistinguishable from random for decorative particles.

- [ ] **Step 1: Create a shared seeded-random helper**

Create `myscrollr.com/src/lib/seededRandom.ts`:
```ts
/**
 * Mulberry32 PRNG — deterministic pseudo-random number generator.
 *
 * Used for decorative particle coordinates that must produce identical output
 * on the server (during prerender) and the client (during hydration). Using
 * Math.random() would cause hydration mismatches because the seed differs.
 *
 * Output is visually indistinguishable from Math.random() for decorative use.
 */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
```

- [ ] **Step 2: Fix `CallToAction.tsx` particles**

Open `myscrollr.com/src/components/landing/CallToAction.tsx`. Around lines 42-50 there's a `const PARTICLES = Array.from({ length: 12 }, ...)`. Replace it with:
```tsx
import { seededRandom } from '@/lib/seededRandom'

const PARTICLES = Array.from({ length: 12 }, (_, i) => {
  const rng = seededRandom(i * 9301 + 49297)
  return {
    id: i,
    x: rng() * 100,
    y: rng() * 100,
    size: rng() * 3 + 1.5,
    delay: rng() * 5,
    duration: rng() * 6 + 8,
    channelIndex: i % 4,
  }
})
```

(Adjust the shape to match the existing PARTICLES type — read the file first to verify exact property names.)

- [ ] **Step 3: Fix `business.tsx` CTA particles**

Open `myscrollr.com/src/routes/business.tsx`. Around lines 344-352 there's a `const CTA_PARTICLES = Array.from(...)` with 12 particles. Apply the same seeded-random pattern. Use a different seed offset (e.g. `i * 7919 + 31337`) so the visual pattern differs from CallToAction.

- [ ] **Step 4: Fix `uplink.tsx` module-scope particles**

Open `myscrollr.com/src/routes/uplink.tsx`. Around lines 547-555 there's a `const CTA_PARTICLES = Array.from(...)` with 20 particles. Same pattern, different seed (e.g. `i * 6151 + 12289`).

- [ ] **Step 5: Fix `uplink.tsx` inline render-time particles**

In the same file, around lines 1997-2014, there's an `Array.from({ length: 14 }, ...)` built INSIDE the render function with `Math.random()`. Move it to module scope:
```tsx
const FOOTER_PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const rng = seededRandom(i * 4093 + 8191)
  return {
    x: 20 + rng() * 60,
    // ... rest of original shape (read existing code to confirm)
  }
})
```

Then in the render, replace the inline `Array.from(...)` with `FOOTER_PARTICLES.map(...)`.

- [ ] **Step 6: Build and verify no visual regression**

```bash
cd myscrollr.com && npm run dev
```

Visit `/`, `/business`, `/uplink`. Confirm:
- Particles still appear in the same general locations
- Animations still play (`motion.div` props unchanged)
- No console warnings about Math.random or hydration

- [ ] **Step 7: Lint and commit**

```bash
cd myscrollr.com && npm run check
git add myscrollr.com/src/lib/seededRandom.ts myscrollr.com/src/components/landing/CallToAction.tsx myscrollr.com/src/routes/business.tsx myscrollr.com/src/routes/uplink.tsx
git commit -m "fix(myscrollr.com): use seeded PRNG for decorative particles to fix SSR hydration"
```

---

## Task 1: Bump TanStack Router on the current SPA

**Files:**
- Modify: `myscrollr.com/package.json`
- Modify: `myscrollr.com/src/routeTree.gen.ts` (auto-regenerated, do NOT hand-edit)

**Rationale:** Going from 1.132 → 1.169 is 37 minor releases. We do this BEFORE introducing Start so any regressions surface in isolation.

- [ ] **Step 1: Pin current state**

Run from `myscrollr.com/`:
```bash
npm run build
```
Expected: build succeeds, `dist/` populated. Note bundle sizes for comparison later.

- [ ] **Step 2: Bump router dependencies**

Edit `myscrollr.com/package.json`:
```json
{
  "dependencies": {
    "@tanstack/react-router": "^1.169.2",
    "@tanstack/router-plugin": "^1.169.2"
  }
}
```

Run:
```bash
cd myscrollr.com && npm install
```

- [ ] **Step 3: Regenerate route tree and rebuild**

```bash
cd myscrollr.com && rm -rf src/routeTree.gen.ts node_modules/.vite && npm run build
```

Expected: build succeeds. If TypeScript errors appear, they are likely from `verbatimModuleSyntax` + new router type exports — fix by adding `import type` where the compiler asks.

- [ ] **Step 4: Smoke test in dev**

```bash
cd myscrollr.com && npm run dev
```

Manually visit `/`, `/uplink`, `/download`, `/channels`, `/architecture`, `/legal?doc=privacy`, `/u/test`. Confirm:
- All routes render
- Navigation between routes works
- Mobile drawer (Header) opens/closes
- Theme toggle still functions
- No console errors

- [ ] **Step 5: Run lint + format**

```bash
cd myscrollr.com && npm run check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd myscrollr.com && git add package.json package-lock.json src/routeTree.gen.ts
git commit -m "chore(myscrollr.com): bump @tanstack/react-router 1.132 → 1.169"
```

---

## Task 2: Introduce TanStack Start (client-only first, no prerender yet)

**Files:**
- Modify: `myscrollr.com/package.json`
- Modify: `myscrollr.com/vite.config.ts`
- Modify: `myscrollr.com/src/main.tsx`
- Modify: `myscrollr.com/src/routes/__root.tsx`
- Modify: `myscrollr.com/index.html` (deleted body skeleton — Start manages document)

**Rationale:** Get Start working in SPA mode first, validate that everything still renders, THEN turn on prerender. This isolates the "does Logto/Motion break under SSR" question from the "did I configure prerender correctly" question.

- [ ] **Step 1: Install Start**

```bash
cd myscrollr.com && npm install @tanstack/react-start@^1.169.2 @tanstack/start-plugin-core@^1.169.2
```

- [ ] **Step 2: Swap Vite plugin**

Replace contents of `myscrollr.com/vite.config.ts`:
```ts
import { readFileSync } from 'node:fs'
import { URL, fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./package.json', import.meta.url)),
    'utf8',
  ),
)

export default defineConfig({
  plugins: [
    tanstackStart({
      target: 'static', // pure static output (no Node runtime)
      router: {
        autoCodeSplitting: true,
      },
      spa: {
        enabled: true, // SPA shell fallback for client-only routes
      },
      // prerender intentionally OFF in this task — added in Task 3
    }),
    viteReact(),
    tailwindcss(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
```

- [ ] **Step 3: Convert `__root.tsx` to a full-document layout**

Start requires the root route to render the full `<html>` document. Replace `myscrollr.com/src/routes/__root.tsx`:

```tsx
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { MotionConfig } from 'motion/react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import appCss from '@/styles.css?url'

function RootErrorComponent({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-32 text-center">
      <p className="text-sm font-semibold text-error">Error</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
        Something went wrong
      </h1>
      <p className="mt-4 text-base text-base-content/60 max-w-md">
        An unexpected error occurred. Please try refreshing the page.
      </p>
      {import.meta.env.DEV && (
        <pre className="mt-6 max-w-lg text-left text-xs text-error/80 bg-error/5 p-4 rounded-lg overflow-auto border border-error/20">
          {error.message}
        </pre>
      )}
      <div className="mt-8 flex gap-4">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content shadow-sm hover:brightness-110 transition-[filter] cursor-pointer"
        >
          Refresh page
        </button>
        <Link
          to="/"
          className="rounded-lg px-5 py-2.5 text-sm font-semibold ring-1 ring-base-300 hover:bg-base-200 transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-32 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-base-content sm:text-5xl">
        Page not found
      </h1>
      <p className="mt-4 text-base text-base-content/70 max-w-md">
        Sorry, we couldn&rsquo;t find the page you&rsquo;re looking for.
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          to="/"
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content shadow-sm hover:brightness-110 transition-[filter] cursor-pointer"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="manifest" href="/manifest.json" />
        <link
          rel="preload"
          href="/fonts/plus-jakarta-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href={appCss} />
        <HeadContent />
        {/* Blocking theme init — runs before first paint to prevent FOUC */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=localStorage.getItem('theme');var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var k=s==='dark'||(!s&&d);if(k)document.documentElement.classList.add('dark');var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',k?'#141420':'#ffffff');})();`,
          }}
        />
      </head>
      <body>
        <div id="app">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: false })
    })
  }, [pathname])

  return (
    <RootDocument>
      <MotionConfig reducedMotion="user">
        <div className="min-h-screen relative overflow-x-clip">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:text-primary-content focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg"
          >
            Skip to main content
          </a>
          <Header />
          <main
            ref={mainRef}
            id="main-content"
            className="relative"
            tabIndex={-1}
          >
            <Outlet />
          </main>
          <Footer />
        </div>
      </MotionConfig>
    </RootDocument>
  )
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        title: 'Scrollr — Live Data on Your Desktop',
      },
      {
        name: 'description',
        content:
          'Finance, sports, news & fantasy scores — one live ticker on your desktop. Download the Scrollr desktop app and never miss a signal.',
      },
      // Default OG (per-route head() overrides these)
      { property: 'og:site_name', content: 'Scrollr' },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: 'https://myscrollr.com/og/default.png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: 'https://myscrollr.com/og/default.png' },
    ],
    links: [{ rel: 'canonical', href: 'https://myscrollr.com/' }],
  }),
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RootErrorComponent,
})
```

- [ ] **Step 4: Update `main.tsx` to wrap with Start's client entry**

Start handles the createRoot call differently — it hydrates the prerendered HTML. Update `myscrollr.com/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { StartClient } from '@tanstack/react-start'
import { hydrateRoot } from 'react-dom/client'
import { LogtoProvider } from '@logto/react'
import type { LogtoConfig } from '@logto/react'
import { ScrollrAuthProvider } from '@/hooks/useScrollrAuth'
import { createRouter } from '@/router'

import '@/styles.css'

const logtoResource =
  import.meta.env.VITE_LOGTO_RESOURCE || import.meta.env.VITE_API_URL || ''

const logtoConfig: LogtoConfig = {
  endpoint: import.meta.env.VITE_LOGTO_ENDPOINT || '',
  appId: import.meta.env.VITE_LOGTO_APP_ID || '',
  resources: [logtoResource],
}

const router = createRouter()

hydrateRoot(
  document,
  <StrictMode>
    <LogtoProvider config={logtoConfig}>
      <ScrollrAuthProvider>
        <StartClient router={router} />
      </ScrollrAuthProvider>
    </LogtoProvider>
  </StrictMode>,
)
```

- [ ] **Step 5: Create the shared router factory**

Start needs the router instantiation to be importable from both client and prerender contexts. Create `myscrollr.com/src/router.ts`:

```ts
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from '@/routeTree.gen'

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    context: {},
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultStructuralSharing: true,
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
```

- [ ] **Step 6: Strip the now-redundant content from `index.html`**

Start owns the document. Replace `myscrollr.com/index.html` with the minimal entry that Start expects:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="app"><!--app-html--></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

The skeleton CSS and inline theme script are now inside `RootDocument` in `__root.tsx`. The fallback meta tags will be replaced by per-route `head()` outputs — they're no longer needed here.

- [ ] **Step 7: Audit module-scope `window`/`document` access**

Start renders components on the server (build time). Any module-scope access to `window`, `document`, `localStorage`, `navigator` will crash prerender. Search:

```bash
cd myscrollr.com/src && rg -n "^(?!\s*//).*\b(window|document|localStorage|navigator)\b" --type ts --type tsx | grep -v useEffect | grep -v 'function ' | head -40
```

For each hit at module scope (not inside a function/component/effect), wrap in a `typeof window !== 'undefined'` guard or move into a `useEffect`. Expected culprits:
- `LogtoProvider` config — already inside `main.tsx` which only runs client-side, so safe
- `ThemeToggle.tsx` — verify any top-level reads of `localStorage.getItem`
- `useScrollrAuth.ts` — same

**Critical:** the FOUC theme script in `RootDocument` is already wrapped in an IIFE inside `dangerouslySetInnerHTML`, so it only executes in the browser — safe.

- [ ] **Step 8: Build & verify SPA behavior unchanged**

```bash
cd myscrollr.com && npm run build
```

Expected: build succeeds. `dist/client/` contains assets. There should be a `dist/client/index.html` (the SPA shell) — open it in a browser and verify all routes still work via client-side navigation.

```bash
cd myscrollr.com && npm run serve
```

Visit `http://localhost:4173/` and click through every nav link. Watch the browser console for hydration mismatches.

- [ ] **Step 9: Lint, format, commit**

```bash
cd myscrollr.com && npm run check
git add myscrollr.com/
git commit -m "feat(myscrollr.com): introduce TanStack Start in SPA mode"
```

---

## Task 3: Enable prerender for ONE route (`/legal`) as proof of concept

**Files:**
- Modify: `myscrollr.com/vite.config.ts`
- Modify: `myscrollr.com/src/routes/legal.tsx`
- Modify: `myscrollr.com/src/lib/usePageMeta.ts` (NOT deleted yet — other routes still use it)

**Rationale:** `/legal` is a good first test: pure marketing content, has dynamic query param (`?doc=`) so we verify Start handles that, and a regression here is low-impact.

- [ ] **Step 1: Enable prerender for `/legal` only**

Update `myscrollr.com/vite.config.ts` plugin block:
```ts
tanstackStart({
  target: 'static',
  router: {
    autoCodeSplitting: true,
  },
  spa: {
    enabled: true,
  },
  prerender: {
    enabled: true,
    crawlLinks: false, // explicit list this task; broader crawl in Task 9
    filter: ({ path }: { path: string }) => path === '/legal',
  },
}),
```

- [ ] **Step 2: Convert `legal.tsx` route to use `head()`**

Open `myscrollr.com/src/routes/legal.tsx`. Find the route definition (search for `createFileRoute`). The current `usePageMeta` call (line 37) inside the component reads `activeDoc.title`, which is derived from the `?doc=` query param. Since query params are NOT known at prerender time, the prerendered HTML must use generic copy and `usePageMeta` (kept temporarily) will refine it client-side.

Add the `head` option to the route definition:
```tsx
export const Route = createFileRoute('/legal')({
  validateSearch: /* existing validateSearch */,
  head: () => ({
    meta: [
      { title: 'Legal — Scrollr' },
      {
        name: 'description',
        content:
          'Terms of Service, Privacy Policy, License, and Cookie Policy for the Scrollr desktop app and myscrollr.com.',
      },
      { property: 'og:title', content: 'Legal — Scrollr' },
      {
        property: 'og:description',
        content:
          'Terms of Service, Privacy Policy, License, and Cookie Policy for the Scrollr desktop app and myscrollr.com.',
      },
      { property: 'og:url', content: 'https://myscrollr.com/legal' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:title', content: 'Legal — Scrollr' },
      {
        name: 'twitter:description',
        content:
          'Terms of Service, Privacy Policy, License, and Cookie Policy for the Scrollr desktop app and myscrollr.com.',
      },
    ],
    links: [{ rel: 'canonical', href: 'https://myscrollr.com/legal' }],
  }),
  component: LegalRouteComponent,
})
```

Keep the existing `usePageMeta` call inside the component — it will refine the title client-side when `?doc=` is set.

- [ ] **Step 3: Build and inspect the prerendered HTML**

```bash
cd myscrollr.com && npm run build
```

Expected output: `dist/client/legal/index.html` (or `dist/client/legal.html` depending on Start version). Check it:

```bash
cat myscrollr.com/dist/client/legal/index.html | grep -E '<title>|<meta|<link rel="canonical"'
```

Expected to find:
- `<title>Legal — Scrollr</title>`
- `<meta name="description" content="Terms of Service...">`
- `<meta property="og:title" content="Legal — Scrollr">`
- `<link rel="canonical" href="https://myscrollr.com/legal">`

If the file is missing or any tag isn't present, debug the `head()` return shape and verify `<HeadContent />` is inside `RootDocument`'s `<head>`.

- [ ] **Step 4: Verify hydration works**

```bash
cd myscrollr.com && npm run serve
```

Open `http://localhost:4173/legal` in browser. DevTools → Network → disable JavaScript → reload. The page should still display readable content with correct `<title>`. Re-enable JS → should hydrate without console errors.

Test with query param: `http://localhost:4173/legal?doc=privacy`. The title should client-side update via `usePageMeta`.

- [ ] **Step 5: Commit**

```bash
git add myscrollr.com/vite.config.ts myscrollr.com/src/routes/legal.tsx
git commit -m "feat(myscrollr.com): prerender /legal route with head()"
```

---

## Task 4: Create a typed `seo()` helper for consistent meta generation

**Files:**
- Create: `myscrollr.com/src/lib/seo.ts`

**Rationale:** Every route's `head()` will generate ~10 meta tags. Without a helper, it's copy-paste hell and easy to forget OG fields. The helper enforces our standard set and accepts overrides.

- [ ] **Step 1: Write the helper**

Create `myscrollr.com/src/lib/seo.ts`:
```ts
type SeoInput = {
  title: string
  description: string
  path: string // e.g. "/uplink" — leading slash required, no trailing slash except "/"
  image?: string // absolute URL; default: og/default.png
  imageAlt?: string
  type?: 'website' | 'article' | 'product'
  noindex?: boolean
  jsonLd?: object | Array<object>
}

const BASE_URL = 'https://myscrollr.com'

type MetaTag = { title: string } | { name: string; content: string } | { property: string; content: string }
type LinkTag = { rel: string; href: string; type?: string }
type ScriptTag = { type: string; children: string }

export type RouteHead = {
  meta: Array<MetaTag>
  links: Array<LinkTag>
  scripts?: Array<ScriptTag>
}

export function seo(input: SeoInput): RouteHead {
  const url = `${BASE_URL}${input.path}`
  const image = input.image ?? `${BASE_URL}/og/default.png`
  const imageAlt = input.imageAlt ?? 'Scrollr — a quiet ticker at the edge of your screen.'
  const type = input.type ?? 'website'

  const meta: Array<MetaTag> = [
    { title: input.title },
    { name: 'description', content: input.description },
    // OpenGraph
    { property: 'og:title', content: input.title },
    { property: 'og:description', content: input.description },
    { property: 'og:url', content: url },
    { property: 'og:type', content: type },
    { property: 'og:site_name', content: 'Scrollr' },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: imageAlt },
    // Twitter
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: input.title },
    { name: 'twitter:description', content: input.description },
    { name: 'twitter:image', content: image },
    { name: 'twitter:image:alt', content: imageAlt },
  ]

  if (input.noindex) {
    meta.push({ name: 'robots', content: 'noindex, nofollow' })
  }

  const links: Array<LinkTag> = [{ rel: 'canonical', href: url }]

  const scripts: Array<ScriptTag> = []
  if (input.jsonLd) {
    const payload = Array.isArray(input.jsonLd) ? input.jsonLd : [input.jsonLd]
    for (const item of payload) {
      scripts.push({
        type: 'application/ld+json',
        children: JSON.stringify(item),
      })
    }
  }

  return { meta, links, scripts: scripts.length ? scripts : undefined }
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd myscrollr.com && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add myscrollr.com/src/lib/seo.ts
git commit -m "feat(myscrollr.com): add typed seo() helper for route head()"
```

---

## Task 5: Create JSON-LD structured data templates

**Files:**
- Create: `myscrollr.com/src/lib/structured-data.ts`

**Rationale:** Centralizes the Organization, WebSite, SoftwareApplication, and FAQ schemas so they're consistent and easy to update.

- [ ] **Step 1: Write the templates**

Create `myscrollr.com/src/lib/structured-data.ts`:
```ts
/**
 * JSON-LD structured data templates.
 *
 * These objects are serialized as <script type="application/ld+json"> tags
 * and read by search engines (Google rich results) and AI crawlers.
 *
 * Test with: https://search.google.com/test/rich-results
 */

export const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Scrollr',
  url: 'https://myscrollr.com',
  logo: 'https://myscrollr.com/icon-512.png',
  description:
    'Scrollr is a quiet desktop ticker for live finance, sports, news, and fantasy data. Open source and privacy-first.',
  sameAs: ['https://github.com/brandon-relentnet/myscrollr'],
}

export const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Scrollr',
  url: 'https://myscrollr.com',
  potentialAction: {
    '@type': 'SearchAction',
    target: 'https://myscrollr.com/support?q={search_term_string}',
    'query-input': 'required name=search_term_string',
  },
}

export const softwareApplication = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Scrollr',
  operatingSystem: 'macOS, Windows, Linux',
  applicationCategory: 'ProductivityApplication',
  description:
    'A quiet desktop ticker for live finance, sports, news, and fantasy data. Open source and privacy-first.',
  url: 'https://myscrollr.com',
  downloadUrl: 'https://myscrollr.com/download',
  softwareVersion: '__APP_VERSION__', // replaced at build time via Vite define
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.8',
    reviewCount: '1', // update when real reviews exist
  },
}

type Tier = {
  name: string
  description: string
  priceMonthly: number
  priceAnnual: number
}

export function productOffers(tiers: Array<Tier>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Scrollr Uplink',
    description:
      'Premium subscription tiers for the Scrollr desktop app — unlimited tracking, real-time delivery, and early access to new channels.',
    brand: { '@type': 'Brand', name: 'Scrollr' },
    offers: tiers.flatMap((t) => [
      {
        '@type': 'Offer',
        name: `${t.name} (Monthly)`,
        description: t.description,
        price: t.priceMonthly.toFixed(2),
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: t.priceMonthly.toFixed(2),
          priceCurrency: 'USD',
          unitText: 'MONTH',
        },
        url: 'https://myscrollr.com/uplink',
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: `${t.name} (Annual)`,
        description: t.description,
        price: t.priceAnnual.toFixed(2),
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: t.priceAnnual.toFixed(2),
          priceCurrency: 'USD',
          unitText: 'YEAR',
        },
        url: 'https://myscrollr.com/uplink',
        availability: 'https://schema.org/InStock',
      },
    ]),
  }
}

type FaqEntry = { question: string; answer: string }

export function faqPage(items: Array<FaqEntry>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    })),
  }
}

type BreadcrumbItem = { name: string; path: string }

export function breadcrumbs(items: Array<BreadcrumbItem>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: `https://myscrollr.com${item.path}`,
    })),
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd myscrollr.com && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add myscrollr.com/src/lib/structured-data.ts
git commit -m "feat(myscrollr.com): add JSON-LD structured data templates"
```

---

## Task 6: Convert `/` (home) to use `head()` with full SEO + structured data

**Files:**
- Modify: `myscrollr.com/src/routes/index.tsx`
- Modify: `myscrollr.com/vite.config.ts` (extend prerender filter)

**Rationale:** The home page is the highest-value SEO surface. It gets full treatment: SEO meta, Organization JSON-LD, WebSite JSON-LD, SoftwareApplication JSON-LD.

- [ ] **Step 1: Add `head()` to the route**

In `myscrollr.com/src/routes/index.tsx`, find the `createFileRoute('/')` call. Add `head`:
```tsx
import { seo } from '@/lib/seo'
import {
  organization,
  website,
  softwareApplication,
} from '@/lib/structured-data'

export const Route = createFileRoute('/')({
  head: () =>
    seo({
      title: 'Scrollr — Live Data on Your Desktop',
      description:
        'A quiet ticker at the edge of your screen with live sports, markets, news, and fantasy data. Free and open source. macOS, Windows, Linux.',
      path: '/',
      imageAlt: 'Scrollr desktop ticker showing live market and sports data.',
      jsonLd: [organization, website, softwareApplication],
    }),
  component: HomeRouteComponent,
})
```

- [ ] **Step 2: Remove the in-component `usePageMeta` call**

In `myscrollr.com/src/routes/index.tsx` lines 36–41, delete the `usePageMeta({...})` block. The `head()` function now handles this.

- [ ] **Step 3: Extend prerender filter to include `/`**

In `myscrollr.com/vite.config.ts`:
```ts
prerender: {
  enabled: true,
  crawlLinks: false,
  filter: ({ path }: { path: string }) => path === '/legal' || path === '/',
},
```

- [ ] **Step 4: Build & inspect**

```bash
cd myscrollr.com && npm run build
```

Verify:
```bash
cat myscrollr.com/dist/client/index.html | grep -E '<title>|application/ld\+json' | head -5
```

Expected:
- `<title>Scrollr — Live Data on Your Desktop</title>`
- Three `<script type="application/ld+json">` tags (Organization, WebSite, SoftwareApplication)

Validate JSON-LD with the Rich Results tester (manual step, recorded for completeness):
1. `npm run serve`
2. Open `http://localhost:4173/`
3. Copy the rendered HTML or hit https://search.google.com/test/rich-results with the URL

- [ ] **Step 5: Commit**

```bash
git add myscrollr.com/src/routes/index.tsx myscrollr.com/vite.config.ts
git commit -m "feat(myscrollr.com): full SEO + JSON-LD on home route, prerender"
```

---

## Task 7: Convert `/uplink` (pricing) with Product JSON-LD + FAQPage JSON-LD

**Files:**
- Modify: `myscrollr.com/src/routes/uplink.tsx`
- Modify: `myscrollr.com/vite.config.ts`

**Rationale:** Pricing pages benefit enormously from Product JSON-LD (Google can show prices in search results) and FAQPage JSON-LD (expandable FAQ rich results). This page has 13 FAQ items per the audit.

- [ ] **Step 1: Add `head()` with Product + FAQ structured data**

In `myscrollr.com/src/routes/uplink.tsx`, near the top of the file, define the tier data as a static constant so it can feed JSON-LD at build time. The full `tierLimits` shape is fetched live, but the **pricing** is hard-coded ($9.99 / $24.99 / $49.99 per the audit). Add:

```tsx
import { seo } from '@/lib/seo'
import { productOffers, faqPage, breadcrumbs } from '@/lib/structured-data'

const STATIC_TIERS = [
  {
    name: 'Uplink',
    description: 'Unlimited tracking, real-time delivery, all channels.',
    priceMonthly: 9.99,
    priceAnnual: 79.99,
  },
  {
    name: 'Pro',
    description: 'Everything in Uplink plus priority support and early access.',
    priceMonthly: 24.99,
    priceAnnual: 199.99,
  },
  {
    name: 'Ultimate',
    description: 'Pro plus business features and dedicated support.',
    priceMonthly: 49.99,
    priceAnnual: 399.99,
  },
]

const STATIC_FAQ = [
  {
    question: 'Is there a free trial?',
    answer: 'Yes — every paid tier includes a 14-day free trial. No credit card required for the free plan.',
  },
  {
    question: 'Can I switch plans?',
    answer: 'Yes. You can upgrade or downgrade at any time. Upgrades are prorated; downgrades take effect at the next renewal.',
  },
  // Add 8-11 more drawn from the existing FAQ in uplink.tsx — exact copy must match
  // (Subagent: read uplink.tsx FAQ section and inline the 13 Q/A pairs here)
]
```

**Subagent note:** When implementing, open `uplink.tsx`, find the FAQ section (search for `FAQ` or `faqItems`), and copy the actual 13 Q/A pairs verbatim into `STATIC_FAQ`. The JSON-LD must match the visible content exactly or Google flags it as spam.

Then update the route:
```tsx
export const Route = createFileRoute('/uplink')({
  validateSearch: /* existing */,
  head: () =>
    seo({
      title: 'Uplink — Pricing for Scrollr',
      description:
        'Unlock unlimited tracking, real-time data delivery, and early access to new channels. Plans from $9.99/month with annual savings.',
      path: '/uplink',
      type: 'product',
      jsonLd: [
        productOffers(STATIC_TIERS),
        faqPage(STATIC_FAQ),
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Uplink', path: '/uplink' },
        ]),
      ],
    }),
  component: UplinkRouteComponent,
})
```

- [ ] **Step 2: Remove the in-component `usePageMeta` call**

Delete the `usePageMeta({...})` block at `uplink.tsx:957`.

- [ ] **Step 3: Add `/uplink` to prerender filter**

```ts
filter: ({ path }: { path: string }) =>
  ['/', '/legal', '/uplink'].includes(path),
```

- [ ] **Step 4: Build & verify**

```bash
cd myscrollr.com && npm run build
cat myscrollr.com/dist/client/uplink/index.html | grep -c 'application/ld+json'
```

Expected: at least 3 (Product, FAQPage, BreadcrumbList).

Verify JSON-LD is valid JSON:
```bash
cat myscrollr.com/dist/client/uplink/index.html | rg -o 'application/ld\+json"[^>]*>([^<]+)' -r '$1' | head -1 | python3 -m json.tool
```

Expected: parses successfully.

- [ ] **Step 5: Commit**

```bash
git add myscrollr.com/src/routes/uplink.tsx myscrollr.com/vite.config.ts
git commit -m "feat(myscrollr.com): pricing page SEO + Product/FAQ JSON-LD"
```

---

## Task 8: Convert remaining marketing routes (`/channels`, `/download`, `/business`, `/architecture`, `/support`, `/uplink/lifetime`)

**Files:**
- Modify: `myscrollr.com/src/routes/channels.tsx`
- Modify: `myscrollr.com/src/routes/download.tsx`
- Modify: `myscrollr.com/src/routes/business.tsx`
- Modify: `myscrollr.com/src/routes/architecture.tsx`
- Modify: `myscrollr.com/src/routes/support.tsx`
- Modify: `myscrollr.com/src/routes/uplink_.lifetime.tsx`
- Modify: `myscrollr.com/vite.config.ts`

**Rationale:** Mechanical conversion of all remaining marketing routes. Each gets `head()` + breadcrumbs JSON-LD. Support page also gets FAQPage JSON-LD.

- [ ] **Step 1: Convert `/channels`**

Find `createFileRoute('/channels')` in `myscrollr.com/src/routes/channels.tsx`. Add:
```tsx
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'

export const Route = createFileRoute('/channels')({
  head: () =>
    seo({
      title: 'Channels — Scrollr',
      description:
        'Browse the channels and widgets available in the Scrollr desktop app: Finance, Sports, News, Fantasy, Clock, Timer, Weather, and System Monitor. Plus upcoming integrations.',
      path: '/channels',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Channels', path: '/channels' },
      ]),
    }),
  component: ChannelsRouteComponent,
})
```

Delete the `usePageMeta` call at line 205.

- [ ] **Step 2: Convert `/download`**

Same pattern in `myscrollr.com/src/routes/download.tsx`:
```tsx
import { seo } from '@/lib/seo'
import { breadcrumbs, softwareApplication } from '@/lib/structured-data'

export const Route = createFileRoute('/download')({
  head: () =>
    seo({
      title: 'Download Scrollr — Free Desktop App',
      description:
        'Download Scrollr for macOS, Windows, or Linux. A quiet ticker at the edge of your screen with live sports, markets, news, and fantasy data. Free and open source.',
      path: '/download',
      jsonLd: [
        softwareApplication,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Download', path: '/download' },
        ]),
      ],
    }),
  component: DownloadRouteComponent,
})
```

Delete the `usePageMeta` call at line 92.

- [ ] **Step 3: Convert `/business`**

In `myscrollr.com/src/routes/business.tsx`:
```tsx
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'

export const Route = createFileRoute('/business')({
  head: () =>
    seo({
      title: 'Scrollr for Business — Branded Desktop Deployments',
      description:
        'Custom-branded Scrollr deployments for brokerages, sports venues, fantasy platforms, crypto exchanges, and news publishers. Multi-display, self-hosted, dedicated support. Starts at $500/mo.',
      path: '/business',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Business', path: '/business' },
      ]),
    }),
  component: BusinessRouteComponent,
})
```

Delete the `usePageMeta` call at line 1780.

- [ ] **Step 4: Convert `/architecture`**

In `myscrollr.com/src/routes/architecture.tsx`:
```tsx
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'

export const Route = createFileRoute('/architecture')({
  head: () =>
    seo({
      title: 'How Scrollr Works — Architecture Deep-Dive',
      description:
        'Behind the scenes: how Scrollr delivers real-time finance, sports, news, and fantasy data from source APIs through CDC PubSub to your desktop. Built with Go, Rust, React, PostgreSQL, and Redis.',
      path: '/architecture',
      type: 'article',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Architecture', path: '/architecture' },
      ]),
    }),
  component: ArchitectureRouteComponent,
})
```

Delete the `usePageMeta` call at line 282.

- [ ] **Step 5: Convert `/support`**

In `myscrollr.com/src/routes/support.tsx`. The audit notes this page composes 6 support components including an FAQ — extract those questions for FAQPage JSON-LD.

```tsx
import { seo } from '@/lib/seo'
import { breadcrumbs, faqPage } from '@/lib/structured-data'

const SUPPORT_FAQ = [
  // Subagent: read SupportFAQ.tsx (or similar) and copy the 5-10 most common Q/A pairs here.
  // Must match visible page text exactly.
]

export const Route = createFileRoute('/support')({
  head: () =>
    seo({
      title: 'Support — Scrollr',
      description:
        'Get help with Scrollr. FAQs, troubleshooting articles, billing help, and a direct contact form. Real humans, no chatbots.',
      path: '/support',
      jsonLd: [
        faqPage(SUPPORT_FAQ),
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Support', path: '/support' },
        ]),
      ],
    }),
  component: SupportRouteComponent,
})
```

Delete the `usePageMeta` call at line 15.

- [ ] **Step 6: Convert `/uplink/lifetime`**

In `myscrollr.com/src/routes/uplink_.lifetime.tsx`:
```tsx
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'

export const Route = createFileRoute('/uplink/lifetime')({
  validateSearch: /* existing */,
  head: () =>
    seo({
      title: 'Lifetime Uplink — Scrollr Founding Members',
      description:
        'One payment, forever access to all Scrollr Uplink features. Only 128 founding member slots available.',
      path: '/uplink/lifetime',
      type: 'product',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Uplink', path: '/uplink' },
        { name: 'Lifetime', path: '/uplink/lifetime' },
      ]),
    }),
  component: LifetimeRouteComponent,
})
```

Delete the `usePageMeta` call at line 47.

- [ ] **Step 7: Update prerender filter and switch to crawlLinks for safety net**

In `myscrollr.com/vite.config.ts`:
```ts
prerender: {
  enabled: true,
  crawlLinks: true, // discover any internal links we forgot
  filter: ({ path }: { path: string }) => {
    // Auth/dynamic routes — stay client-rendered
    const excluded = [
      '/account',
      '/callback',
      '/invite',
      '/status', // live data, no value prerendering
    ]
    if (excluded.includes(path)) return false
    if (path.startsWith('/u/')) return false // dynamic profile pages
    return true
  },
  autoStaticPathsDiscovery: true, // skip dynamic-param routes automatically
},
```

- [ ] **Step 8: Build, verify, commit**

```bash
cd myscrollr.com && npm run build
ls myscrollr.com/dist/client/
```

Expected directories:
- `index.html` (home)
- `channels/`, `download/`, `business/`, `architecture/`, `support/`, `legal/`, `uplink/`, `uplink/lifetime/`
- Each should contain an `index.html` (or be a flat `.html` file, depending on Start)
- NO directories for `/account`, `/callback`, `/invite`, `/u/`, `/status`

Spot-check 3 of them:
```bash
for r in channels download business architecture; do
  echo "=== /$r ==="
  grep -E '<title>|<meta name="description"|<link rel="canonical"' myscrollr.com/dist/client/$r/index.html | head -3
done
```

Expected: each has a unique title, description, canonical.

Commit:
```bash
cd myscrollr.com && git add -A
git commit -m "feat(myscrollr.com): prerender all marketing routes with SEO + JSON-LD"
```

---

## Task 9: Verify auth/dynamic routes still work via SPA fallback

**Files:**
- (Verification only — no source edits in this task)

**Rationale:** Auth routes must serve the SPA shell so client-side routing can take over. Test all five non-prerendered routes.

- [ ] **Step 1: Build and serve**

```bash
cd myscrollr.com && npm run build && npm run serve
```

- [ ] **Step 2: Test each auth/dynamic route**

For each URL below, open in a browser AND in `curl`:

| URL | Expected curl response | Expected browser behavior |
|---|---|---|
| `http://localhost:4173/account` | SPA shell HTML | Hydrates, redirects to login if not authed |
| `http://localhost:4173/callback?code=test` | SPA shell HTML | Processes auth callback |
| `http://localhost:4173/invite` | SPA shell HTML | Renders invite flow |
| `http://localhost:4173/u/testuser` | SPA shell HTML | Hydrates user profile component |
| `http://localhost:4173/status` | SPA shell HTML | Fetches live status |

If any of these return a 404 from `serve`, the SPA fallback in Vite preview is misconfigured. Check `vite.config.ts` for a `preview.host` or `appType` override; Start should set `appType: 'spa'` automatically.

- [ ] **Step 3: Verify nginx/Coolify fallback config**

Add a note to the deploy documentation. Create `myscrollr.com/DEPLOY.md` (if it doesn't exist):
```markdown
# Deployment Notes

## Coolify / nginx fallback

The site is prerendered to static HTML for marketing routes. Dynamic routes
(`/account`, `/callback`, `/invite`, `/u/*`, `/status`) require an SPA fallback:

For nginx:
```
location / {
  try_files $uri $uri/index.html $uri.html /index.html;
}
```

For Caddy:
```
try_files {path} {path}/index.html {path}.html /index.html
```

Coolify static-site presets handle this automatically; no manual config needed.
```

- [ ] **Step 4: Commit**

```bash
git add myscrollr.com/DEPLOY.md
git commit -m "docs(myscrollr.com): document SPA fallback for dynamic routes"
```

---

## Task 10: Generate 1200×630 OpenGraph images

**Files:**
- Create: `myscrollr.com/public/og/default.png`
- Create: `myscrollr.com/public/og/uplink.png`
- Create: `myscrollr.com/public/og/business.png`
- Create: `myscrollr.com/public/og/download.png`
- Create: `myscrollr.com/public/og/architecture.png`
- Create: `myscrollr.com/scripts/generate-og-images.mjs`

**Rationale:** Current OG image is 128×128 (a favicon). Social platforms render it as a tiny thumbnail. We need 1200×630 — the recommended OG dimensions across Facebook, LinkedIn, Slack, Discord, and Twitter (which uses `summary_large_image`).

**Approach:** Generate them with Playwright + a static HTML template. Run once locally, commit the PNGs to `public/og/`. No need to regenerate on every build.

- [ ] **Step 1: Install Playwright as a dev dep**

```bash
cd myscrollr.com && npm install --save-dev playwright
npx playwright install chromium
```

- [ ] **Step 2: Create the generator script**

Create `myscrollr.com/scripts/generate-og-images.mjs`:
```js
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public', 'og')

const PAGES = [
  {
    file: 'default.png',
    eyebrow: 'Scrollr',
    title: 'A quiet ticker at the edge of your screen.',
    subtitle: 'Live finance, sports, news, and fantasy. Free and open source.',
    accent: '#7c3aed',
  },
  {
    file: 'uplink.png',
    eyebrow: 'Scrollr Uplink',
    title: 'Unlimited tracking. Real-time delivery.',
    subtitle: 'From $9.99/month. 14-day free trial.',
    accent: '#06b6d4',
  },
  {
    file: 'business.png',
    eyebrow: 'Scrollr for Business',
    title: 'Branded desktop deployments for your team.',
    subtitle: 'Custom branding, multi-display, self-hosted. From $500/mo.',
    accent: '#f59e0b',
  },
  {
    file: 'download.png',
    eyebrow: 'Download',
    title: 'Scrollr for macOS, Windows, and Linux.',
    subtitle: 'Free. Open source. Never tracks you.',
    accent: '#10b981',
  },
  {
    file: 'architecture.png',
    eyebrow: 'Architecture',
    title: 'How Scrollr delivers real-time data.',
    subtitle: 'Source APIs → CDC → your desktop, in milliseconds.',
    accent: '#ec4899',
  },
]

const template = ({ eyebrow, title, subtitle, accent }) => `
<!doctype html>
<html>
<head>
<style>
  @font-face {
    font-family: 'Plus Jakarta Sans';
    src: url('http://localhost:3000/fonts/plus-jakarta-sans-latin.woff2') format('woff2');
    font-weight: 100 900;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    background: #0a0a14;
    color: #e2e2ec;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    display: flex; flex-direction: column;
    justify-content: space-between;
    padding: 80px;
    position: relative;
    overflow: hidden;
  }
  body::before {
    content: '';
    position: absolute;
    top: -200px; right: -200px;
    width: 600px; height: 600px;
    background: radial-gradient(circle, ${accent}33 0%, transparent 70%);
    border-radius: 50%;
  }
  .eyebrow {
    font-size: 24px; font-weight: 600;
    color: ${accent};
    letter-spacing: 0.05em;
    text-transform: uppercase;
    z-index: 1;
  }
  .title {
    font-size: 72px; font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.025em;
    max-width: 1000px;
    z-index: 1;
  }
  .subtitle {
    font-size: 28px; font-weight: 400;
    color: #a8a8b8;
    max-width: 900px;
    z-index: 1;
  }
  .footer {
    display: flex; align-items: center;
    justify-content: space-between;
    z-index: 1;
  }
  .brand {
    display: flex; align-items: center; gap: 16px;
    font-size: 28px; font-weight: 600;
  }
  .logo {
    width: 48px; height: 48px;
    background: ${accent};
    border-radius: 12px;
  }
  .domain {
    font-size: 20px;
    color: #8a8a98;
    font-feature-settings: 'tnum';
  }
</style>
</head>
<body>
  <div class="eyebrow">${eyebrow}</div>
  <div>
    <div class="title">${title}</div>
    <div class="subtitle" style="margin-top: 24px">${subtitle}</div>
  </div>
  <div class="footer">
    <div class="brand"><div class="logo"></div>Scrollr</div>
    <div class="domain">myscrollr.com</div>
  </div>
</body>
</html>
`

async function main() {
  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2, // crisp images
  })
  const page = await context.newPage()

  for (const pg of PAGES) {
    await page.setContent(template(pg))
    await page.waitForLoadState('networkidle')
    const buf = await page.screenshot({ type: 'png' })
    const outPath = join(outDir, pg.file)
    await writeFile(outPath, buf)
    console.log(`✓ ${pg.file}`)
  }

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 3: Add npm script**

In `myscrollr.com/package.json`, add to `scripts`:
```json
"og-images": "node scripts/generate-og-images.mjs"
```

- [ ] **Step 4: Generate images**

Start the dev server in one terminal (the script fetches fonts from localhost:3000):
```bash
cd myscrollr.com && npm run dev
```

In another terminal:
```bash
cd myscrollr.com && npm run og-images
```

Expected: 5 PNG files written to `public/og/`. Each ~50-150 KB.

- [ ] **Step 5: Verify image dimensions**

```bash
cd myscrollr.com && file public/og/*.png
```

Expected: each reports `1200 x 630, 8-bit/color RGBA`.

- [ ] **Step 6: Wire per-route OG images**

Update each route's `head()` call (from Tasks 6-8) to pass a specific `image`:
- `/`: `image: 'https://myscrollr.com/og/default.png'` (this is also the default, so it's redundant)
- `/uplink`: `image: 'https://myscrollr.com/og/uplink.png'`
- `/uplink/lifetime`: `image: 'https://myscrollr.com/og/uplink.png'`
- `/business`: `image: 'https://myscrollr.com/og/business.png'`
- `/download`: `image: 'https://myscrollr.com/og/download.png'`
- `/architecture`: `image: 'https://myscrollr.com/og/architecture.png'`
- `/channels`: `image: 'https://myscrollr.com/og/default.png'` (default is fine)
- `/support`: `image: 'https://myscrollr.com/og/default.png'`
- `/legal`: `image: 'https://myscrollr.com/og/default.png'`

- [ ] **Step 7: Build, verify, commit**

```bash
cd myscrollr.com && npm run build
grep 'og:image' myscrollr.com/dist/client/uplink/index.html
```

Expected: `og:image` content is `https://myscrollr.com/og/uplink.png`.

Validate with the Facebook sharing debugger (manual):
- Deploy a preview build
- Test https://developers.facebook.com/tools/debug/ with `/uplink`, `/business`, etc.

```bash
cd myscrollr.com && git add -A
git commit -m "feat(myscrollr.com): add 1200x630 OG images per route"
```

---

## Task 11: Add `llms.txt` for AI crawlers

**Files:**
- Create: `myscrollr.com/public/llms.txt`
- Create: `myscrollr.com/public/llms-full.txt`

**Rationale:** The `llms.txt` proposal (https://llmstxt.org) provides AI crawlers (ChatGPT, Claude, Perplexity) with a curated digest of your site. Adoption is uneven but free real estate.

- [ ] **Step 1: Write `llms.txt` (the index)**

Create `myscrollr.com/public/llms.txt`:
```markdown
# Scrollr

> Scrollr is a quiet desktop ticker for live finance, sports, news, and fantasy data. Open source, privacy-first, and free. Available for macOS, Windows, and Linux.

Scrollr displays a thin always-on-top bar at the edge of your screen showing real-time market prices, sports scores, news headlines, and fantasy league updates. The desktop app is the primary product; this website serves marketing, account management, and billing.

Core principles: zero tracking, no ads, no data brokers, source available, runs locally.

## Product

- [Download](https://myscrollr.com/download): Get the Scrollr desktop app for macOS, Windows, or Linux. Free.
- [Channels](https://myscrollr.com/channels): The data sources Scrollr supports — Finance, Sports, News, Fantasy — plus Clock, Timer, Weather, and System Monitor widgets.
- [Architecture](https://myscrollr.com/architecture): How Scrollr works under the hood — source APIs through CDC PubSub to your desktop.

## Pricing

- [Uplink](https://myscrollr.com/uplink): Premium subscription tiers — Uplink ($9.99/mo), Pro ($24.99/mo), Ultimate ($49.99/mo). 14-day free trial.
- [Lifetime](https://myscrollr.com/uplink/lifetime): One-time payment for forever access. 128 founding member slots.
- [Business](https://myscrollr.com/business): Branded desktop deployments for teams. From $500/mo.

## Support

- [Support](https://myscrollr.com/support): FAQs, troubleshooting, billing help, contact form.
- [Status](https://myscrollr.com/status): Live system status.
- [Legal](https://myscrollr.com/legal): Terms, Privacy, License, Cookies.

## Optional

- [GitHub](https://github.com/brandon-relentnet/myscrollr): Source code.
```

- [ ] **Step 2: Write `llms-full.txt` (the full digest)**

Create `myscrollr.com/public/llms-full.txt`. This is a longer plain-text dump of all the key marketing content — the value prop, channels list, pricing details, FAQ entries. **A subagent implementing this should aggregate the visible copy from `/`, `/channels`, `/uplink`, `/business`, `/support`, and `/architecture` into a clean Markdown document.**

Template structure:
```markdown
# Scrollr — Full LLM Digest

## What Scrollr Is
[3-4 paragraph product description, lifted from home page hero + benefits]

## Channels
[List all 4 live channels + 4 widgets + 6 roadmap items, with descriptions]

## Pricing
### Free
[free tier description]
### Uplink — $9.99/month
[tier description, features]
### Pro — $24.99/month
[tier description, features]
### Ultimate — $49.99/month
[tier description, features]
### Lifetime
[description, slot count]

## FAQ
[All 8 home FAQ items + 13 pricing FAQ items + support FAQ items, Q/A format]

## Privacy
[Bullet points from Trust section: no tracking, no ads, no brokers, etc.]

## Technical Architecture
[Summarized version of /architecture page]

## Business / Enterprise
[Summary of /business page]
```

- [ ] **Step 3: Update `robots.txt` to mention llms.txt and add AI bot rules**

Replace `myscrollr.com/public/robots.txt`:
```
# https://www.robotstxt.org/robotstxt.html
User-agent: *
Disallow: /account
Disallow: /invite
Disallow: /callback
Disallow: /u/

# AI crawlers — explicitly allow indexing of public pages
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: CCBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://myscrollr.com/sitemap.xml
```

- [ ] **Step 4: Commit**

```bash
cd myscrollr.com && git add public/llms.txt public/llms-full.txt public/robots.txt
git commit -m "feat(myscrollr.com): add llms.txt + AI-crawler robots rules"
```

---

## Task 12: Regenerate sitemap.xml programmatically with current dates

**Files:**
- Create: `myscrollr.com/scripts/generate-sitemap.mjs`
- Modify: `myscrollr.com/package.json`
- Modify: `myscrollr.com/public/sitemap.xml` (auto-generated each build)

**Rationale:** The current sitemap has stale `lastmod` dates and is hand-edited. Generating it at build time keeps it fresh and adds new routes automatically.

- [ ] **Step 1: Write the generator**

Create `myscrollr.com/scripts/generate-sitemap.mjs`:
```js
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, '..', 'public', 'sitemap.xml')

const today = new Date().toISOString().slice(0, 10)

// Hand-curated route table — single source of truth
const ROUTES = [
  { path: '/', priority: 1.0, changefreq: 'weekly' },
  { path: '/download', priority: 0.9, changefreq: 'weekly' },
  { path: '/uplink', priority: 0.9, changefreq: 'monthly' },
  { path: '/uplink/lifetime', priority: 0.8, changefreq: 'monthly' },
  { path: '/channels', priority: 0.8, changefreq: 'weekly' },
  { path: '/architecture', priority: 0.7, changefreq: 'monthly' },
  { path: '/business', priority: 0.7, changefreq: 'monthly' },
  { path: '/support', priority: 0.7, changefreq: 'monthly' },
  { path: '/status', priority: 0.5, changefreq: 'daily' },
  { path: '/legal', priority: 0.3, changefreq: 'monthly' },
]

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${ROUTES.map(
  (r) => `  <url>
    <loc>https://myscrollr.com${r.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority.toFixed(1)}</priority>
  </url>`,
).join('\n')}
</urlset>
`

await writeFile(outPath, xml)
console.log(`✓ sitemap.xml written with ${ROUTES.length} URLs`)
```

- [ ] **Step 2: Wire into prebuild**

In `myscrollr.com/package.json`, update `prebuild`:
```json
"prebuild": "node scripts/fetch-latest-version.mjs && node scripts/generate-sitemap.mjs"
```

- [ ] **Step 3: Run and verify**

```bash
cd myscrollr.com && npm run build
cat myscrollr.com/public/sitemap.xml | head -20
```

Expected: 10 URL entries with today's date.

- [ ] **Step 4: Commit**

```bash
cd myscrollr.com && git add scripts/generate-sitemap.mjs package.json public/sitemap.xml
git commit -m "feat(myscrollr.com): auto-generate sitemap.xml on build"
```

---

## Task 13: Preload IBM Plex Mono font in document head

**Files:**
- Modify: `myscrollr.com/src/routes/__root.tsx`

**Rationale:** Audit found only Plus Jakarta is preloaded. IBM Plex Mono is used for code blocks and ticker mono numerics — late discovery causes FOUC.

- [ ] **Step 1: Add preload for the most-used Plex Mono weight**

In `myscrollr.com/src/routes/__root.tsx`, in `RootDocument`, after the existing Plus Jakarta preload:
```tsx
<link
  rel="preload"
  href="/fonts/ibm-plex-mono-400.woff2"
  as="font"
  type="font/woff2"
  crossOrigin="anonymous"
/>
```

(Verify the exact filename in `myscrollr.com/public/fonts/`; the audit said the file is `ibm-plex-mono-400.woff2` but confirm with `ls myscrollr.com/public/fonts/`.)

- [ ] **Step 2: Build and verify in browser dev tools**

```bash
cd myscrollr.com && npm run build && npm run serve
```

Open `http://localhost:4173/`, DevTools → Network → filter "Font". Both fonts should show as `preload` initiator instead of CSS-discovered.

- [ ] **Step 3: Commit**

```bash
cd myscrollr.com && git add src/routes/__root.tsx
git commit -m "perf(myscrollr.com): preload IBM Plex Mono 400 in document head"
```

---

## Task 14: Tighten and validate `manifest.json` + invalid meta cleanup

**Files:**
- Modify: `myscrollr.com/public/manifest.json`
- (No file changes for the meta cleanup — already removed in Task 2 when the document head was reorganized)

**Rationale:** Audit found `theme_color: "#000000"` in manifest contradicts the head's `#ffffff`. Also clean up the non-standard `<meta name="Scrollr">` tag (already gone after Task 2's `index.html` overhaul — verify).

- [ ] **Step 1: Read current manifest**

```bash
cat myscrollr.com/public/manifest.json
```

- [ ] **Step 2: Align theme_color and add maskable icon entries**

Replace contents of `myscrollr.com/public/manifest.json`:
```json
{
  "name": "Scrollr",
  "short_name": "Scrollr",
  "description": "A quiet desktop ticker for live finance, sports, news, and fantasy data.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a14",
  "theme_color": "#0a0a14",
  "icons": [
    {
      "src": "/icon-128.png",
      "sizes": "128x128",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

(If `/icon-512.png` doesn't exist, generate it — there should be a source icon to upscale. Otherwise, omit the 512 entry for now.)

- [ ] **Step 3: Verify no `<meta name="Scrollr">` remains**

```bash
cd myscrollr.com && grep -rn 'name="Scrollr"' src/ index.html public/ 2>/dev/null
```

Expected: no matches. (Task 2 already replaced `index.html`; the new `RootDocument` does not include this invalid tag.)

- [ ] **Step 4: Commit**

```bash
cd myscrollr.com && git add public/manifest.json
git commit -m "fix(myscrollr.com): align manifest theme_color, add maskable icon"
```

---

## Task 15: Delete `usePageMeta` and the static fallback meta in `index.html`

**Files:**
- Delete: `myscrollr.com/src/lib/usePageMeta.ts`
- Modify: `myscrollr.com/index.html` (already minimal after Task 2 — verify)
- Modify: all routes that still call `usePageMeta` (should be only `/account`, `/u/$username` per the verification below)

**Rationale:** After Tasks 6-8, marketing routes use `head()`. The only remaining `usePageMeta` callers are `/account`, `/status`, and `/u/$username` — three auth/dynamic routes. They don't need `usePageMeta` because they're client-rendered and any non-JS crawler should be blocked from them anyway (per `robots.txt`).

- [ ] **Step 1: Find remaining callers**

```bash
cd myscrollr.com && rg -l 'usePageMeta' src/
```

Expected after Tasks 6-8: `account.tsx`, `status.tsx`, `u.$username.tsx`.

- [ ] **Step 2: Convert these three to `head()` as well**

Even though they're client-rendered, Start's head management still injects the meta during hydration — and `<HeadContent />` works at runtime. We get consistency for free.

In `myscrollr.com/src/routes/account.tsx`:
```tsx
import { seo } from '@/lib/seo'

export const Route = createFileRoute('/account')({
  head: () =>
    seo({
      title: 'Account — Scrollr',
      description: 'Manage your Scrollr account, subscription, and connected services.',
      path: '/account',
      noindex: true, // private page
    }),
  component: AccountRouteComponent,
})
```

Delete the `usePageMeta` call at line 103.

In `myscrollr.com/src/routes/status.tsx`:
```tsx
export const Route = createFileRoute('/status')({
  head: () =>
    seo({
      title: 'System Status — Scrollr',
      description: 'Live system status for the Scrollr platform.',
      path: '/status',
    }),
  component: StatusRouteComponent,
})
```

Delete the `usePageMeta` call at line 152.

In `myscrollr.com/src/routes/u.$username.tsx`: this one has dynamic title (`${username}`). Convert to:
```tsx
export const Route = createFileRoute('/u/$username')({
  loader: ({ params }) => ({ username: params.username }),
  head: ({ loaderData }) =>
    seo({
      title: `${loaderData?.username ?? 'User'} — Scrollr`,
      description: `View ${loaderData?.username ?? 'this user'}'s Scrollr profile and connected channels.`,
      path: `/u/${loaderData?.username ?? ''}`,
      noindex: true, // user profiles not indexed
    }),
  component: ProfileRouteComponent,
})
```

Delete the `usePageMeta` call at line 40.

- [ ] **Step 3: Delete `usePageMeta.ts`**

```bash
rm myscrollr.com/src/lib/usePageMeta.ts
```

- [ ] **Step 4: Verify nothing imports it**

```bash
cd myscrollr.com && rg -l 'usePageMeta'
```

Expected: no matches.

- [ ] **Step 5: Build, lint, type-check**

```bash
cd myscrollr.com && npm run build && npm run check
```

Expected: clean build, no lint errors.

- [ ] **Step 6: Commit**

```bash
cd myscrollr.com && git add -A
git commit -m "refactor(myscrollr.com): replace usePageMeta with Start head() everywhere; delete the hook"
```

---

## Task 16: Performance audit and bundle-size guard

**Files:**
- (Verification only)

**Rationale:** Adding Start + JSON-LD + OG image preload metadata adds bytes. Verify the migration didn't bloat the bundle.

- [ ] **Step 1: Compare bundle sizes**

Before migration baseline (from audit): main vendor 472 KB, CSS 170 KB.

After this plan:
```bash
cd myscrollr.com && npm run build
du -sh dist/client/assets/*.js | sort -h | tail -10
du -sh dist/client/assets/*.css
```

Expected: main vendor within ±15% of baseline (Start adds ~50 KB; we likely save some from removing duplicate fallback meta logic). CSS should be unchanged.

If main vendor grows by more than 20%, investigate. Common culprit: Start may pull in extra integrations that need tree-shaking.

- [ ] **Step 2: Run Lighthouse on a built preview**

```bash
cd myscrollr.com && npm run build && npm run serve &
sleep 2
npx lighthouse http://localhost:4173/ --only-categories=performance,seo,accessibility --chrome-flags="--headless" --output=json --output-path=./lighthouse.json --quiet
cat lighthouse.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('Performance:', d['categories']['performance']['score']*100); print('SEO:', d['categories']['seo']['score']*100); print('A11y:', d['categories']['accessibility']['score']*100)"
kill %1
rm lighthouse.json
```

Target scores:
- Performance: ≥85
- SEO: 100
- Accessibility: ≥95

If Performance drops below 85, profile with Lighthouse details and address the biggest contributor (likely "Reduce unused JavaScript" or "Largest Contentful Paint").

- [ ] **Step 3: Verify social previews end-to-end**

After deploying to staging (manual step):
1. Facebook debugger: https://developers.facebook.com/tools/debug/ → test 3 URLs
2. Twitter card validator: https://cards-dev.twitter.com/validator → test 3 URLs
3. LinkedIn post inspector: https://www.linkedin.com/post-inspector/ → test 3 URLs

Expected: each shows `summary_large_image` style card with route-specific title, description, and 1200×630 image.

- [ ] **Step 4: Verify JSON-LD with Google Rich Results Test**

After deploy:
- https://search.google.com/test/rich-results → test `/`, `/uplink`, `/support`
- Expected: `/` shows Organization + WebSite + SoftwareApplication detected
- `/uplink` shows Product + FAQPage + BreadcrumbList detected
- `/support` shows FAQPage + BreadcrumbList detected
- Zero errors, zero warnings beyond "Missing recommended fields" (which is acceptable for optional fields)

- [ ] **Step 5: Final commit (if any fixes)**

If any fixes were made:
```bash
cd myscrollr.com && git add -A
git commit -m "perf(myscrollr.com): performance + SEO validation fixes"
```

---

## Task 17: Update `myscrollr.com/AGENTS.md` (or root AGENTS.md) with new conventions

**Files:**
- Modify: `myscrollr.com/AGENTS.md` (or `myscrollr.com/` section of root `AGENTS.md`)

**Rationale:** Future agents need to know the site is now prerendered, that `usePageMeta` is gone, and that head management is per-route via `head()`.

- [ ] **Step 1: Identify the relevant AGENTS.md**

```bash
cd myscrollr.com && ls -la AGENTS.md 2>/dev/null && cd .. && ls AGENTS.md
```

If `myscrollr.com/AGENTS.md` exists, edit it. Otherwise, edit the `myscrollr.com/` section in the root `AGENTS.md` (we already saw it has detailed myscrollr.com content).

- [ ] **Step 2: Add new section**

Add (or update the existing rendering section) with:
```markdown
## Rendering: TanStack Start static prerender

The marketing site is **statically prerendered** via `@tanstack/react-start` in `target: 'static'` mode.

- Marketing routes (`/`, `/channels`, `/download`, `/uplink`, `/uplink/lifetime`, `/business`, `/architecture`, `/support`, `/legal`) emit `dist/client/<route>/index.html` at build time with full per-route `<title>`, meta, OpenGraph, Twitter card, canonical, and JSON-LD scripts.
- Auth/dynamic routes (`/account`, `/callback`, `/invite`, `/status`, `/u/$username`) are excluded from prerender and fall back to the SPA shell.
- Per-route head management uses `Route.head: () => seo({...})` from `src/lib/seo.ts`. Do NOT use `useEffect` to set `document.title` or meta tags — they will be ignored by social-preview crawlers.
- Structured data templates live in `src/lib/structured-data.ts` (Organization, WebSite, SoftwareApplication, Product, FAQPage, BreadcrumbList).
- OpenGraph images are 1200×630 PNGs in `public/og/`. Regenerate with `npm run og-images` (Playwright required).
- The sitemap is auto-generated by `scripts/generate-sitemap.mjs` as part of `prebuild`. Edit the `ROUTES` array there, not `public/sitemap.xml` directly.

## SSR safety

Components are rendered at build time in a Node environment. Any module-scope access to `window`, `document`, `localStorage`, or `navigator` will crash the prerender step. Wrap such access in `typeof window !== 'undefined'` checks or move into `useEffect` / event handlers.
```

- [ ] **Step 3: Commit**

```bash
cd myscrollr.com && git add AGENTS.md
git commit -m "docs(myscrollr.com): document Start prerender + SEO conventions in AGENTS.md"
```

---

## Self-Review Checklist (post-implementation)

After all tasks complete, before declaring done:

- [ ] All 10 marketing-route HTML files exist in `dist/client/` with unique `<title>` and `<meta name="description">`
- [ ] At least one `<script type="application/ld+json">` is present on every marketing route
- [ ] `/` has 3 JSON-LD scripts (Organization, WebSite, SoftwareApplication)
- [ ] `/uplink` has 3 JSON-LD scripts (Product, FAQPage, BreadcrumbList)
- [ ] OG image is 1200×630 PNG for at least 5 routes
- [ ] Twitter card meta uses `summary_large_image`
- [ ] Canonical URLs are correct per route (no longer hardcoded to `/`)
- [ ] `/account`, `/callback`, `/invite`, `/u/<anything>`, `/status` still work via SPA fallback
- [ ] No `usePageMeta` import or call anywhere in the codebase
- [ ] `llms.txt` and `llms-full.txt` accessible at root
- [ ] `robots.txt` lists explicit allow rules for AI crawlers
- [ ] `sitemap.xml` regenerates on every build with today's date
- [ ] `npm run check` passes
- [ ] Bundle size within ±15% of pre-migration baseline
- [ ] Lighthouse SEO score = 100, Performance ≥85, Accessibility ≥95
