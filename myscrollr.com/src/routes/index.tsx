import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { seo } from '@/lib/seo'
import {
  HOMEPAGE_FAQ_ITEMS,
  faqPage,
  organization,
  softwareApplication,
  website,
} from '@/lib/structured-data'
import { TerminalHero } from '@/components/landing/TerminalHero'
import { CatalogPicker } from '@/components/landing/CatalogPicker'

// Code-splitting the home page.
//
// TerminalHero and CatalogPicker stay eagerly imported because they are
// the LCP target (hero) and the first section, which holds the
// prerender-check assertion (scripts/check-prerender.mjs asserts on the
// hero sub copy). Every section below is split into its own lazy chunk
// so the initial JS bundle ships only what's needed for first paint and
// the immediate scroll.
//
// SSR safety: TanStack Start's build-time prerender resolves lazy
// imports synchronously, so the prerendered HTML body still contains
// every section's real content. The Suspense fallback below only
// shows at *runtime* hydration if the chunk hasn't downloaded yet —
// which on a warm cache or fast connection is rarely visible. Sized
// placeholders keep CLS at 0 either way.
//
// Placeholder heights are rough desktop estimates of each terminal
// section; slight under-estimates are preferred because they collapse
// cleanly when the real chunk renders.
const DesktopProof = lazy(() =>
  import('@/components/landing/DesktopProof').then((m) => ({
    default: m.DesktopProof,
  })),
)
const StepsSection = lazy(() =>
  import('@/components/landing/StepsSection').then((m) => ({
    default: m.StepsSection,
  })),
)
const MakeItYours = lazy(() =>
  import('@/components/landing/MakeItYours').then((m) => ({
    default: m.MakeItYours,
  })),
)
const PromiseSection = lazy(() =>
  import('@/components/landing/PromiseSection').then((m) => ({
    default: m.PromiseSection,
  })),
)
const QuickAnswers = lazy(() =>
  import('@/components/landing/QuickAnswers').then((m) => ({
    default: m.QuickAnswers,
  })),
)
const ClosingCta = lazy(() =>
  import('@/components/landing/ClosingCta').then((m) => ({
    default: m.ClosingCta,
  })),
)

// Page-image preload. The SEC 02 screenshot is the page's main image
// and its <img> only renders after React mounts the lazy chunk, so the
// browser can't discover the URL from the initial HTML. Preloading from
// the head lets the fetch run in parallel with the JS bundle. The image
// is theme-independent (one rendition pair for dark and light), so no
// per-scheme media queries are needed.
//
// Keep both constants in sync with components/landing/DesktopProof.tsx
// so the preloaded rendition is the one the <img> actually requests.
// Light/dark variants of the SEC 02 desktop screenshot. Preloads are
// scoped per OS color scheme; users whose stored theme contradicts
// their OS eat one wasted preload (same trade-off as the original
// hero preloads — see useTheme for the rationale).
const pageImageSrcset = (theme: 'dark' | 'light') =>
  `/marketing/desktop-home-${theme}@1x.webp 1600w, /marketing/desktop-home-${theme}@2x.webp 2940w`
const PAGE_IMAGE_SIZES = '(max-width: 1023px) 100vw, 990px'

export const Route = createFileRoute('/')({
  component: HomePage,
  head: () =>
    seo({
      title: 'Scrollr: Live Data Ticker for Desktop',
      description:
        'A quiet desktop ticker for live sports, markets, news, and fantasy data. Free and open source. macOS, Windows, Linux.',
      path: '/',
      image: 'https://myscrollr.com/og/home.png',
      imageAlt: 'Scrollr desktop ticker showing live market and sports data.',
      jsonLd: [
        organization,
        website,
        softwareApplication,
        faqPage(HOMEPAGE_FAQ_ITEMS),
      ],
      extraLinks: [
        {
          rel: 'preload',
          as: 'image',
          imagesrcset: pageImageSrcset('dark'),
          imagesizes: PAGE_IMAGE_SIZES,
          fetchpriority: 'high',
          media: '(prefers-color-scheme: dark)',
        },
        {
          rel: 'preload',
          as: 'image',
          imagesrcset: pageImageSrcset('light'),
          imagesizes: PAGE_IMAGE_SIZES,
          fetchpriority: 'high',
          media: '(prefers-color-scheme: light)',
        },
      ],
    }),
})

function HomePage() {
  return (
    <>
      <TerminalHero />

      <CatalogPicker />

      <Suspense fallback={<SectionPlaceholder height="1050px" />}>
        <DesktopProof />
      </Suspense>

      <Suspense fallback={<SectionPlaceholder height="480px" />}>
        <StepsSection />
      </Suspense>

      <Suspense fallback={<SectionPlaceholder height="640px" />}>
        <MakeItYours />
      </Suspense>

      <Suspense fallback={<SectionPlaceholder height="700px" />}>
        <PromiseSection />
      </Suspense>

      <Suspense fallback={<SectionPlaceholder height="600px" />}>
        <QuickAnswers />
      </Suspense>

      <Suspense fallback={<SectionPlaceholder height="640px" />}>
        <ClosingCta />
      </Suspense>
    </>
  )
}

/**
 * Sized placeholder for `<Suspense>` fallback. Reserves vertical space
 * so the page does not jump when the lazy chunk finishes loading.
 * Transparent — the page background (base-75 + scanlines) comes from
 * __root.tsx.
 */
function SectionPlaceholder({ height }: { height: string }) {
  return <div aria-hidden="true" style={{ minHeight: height }} />
}
