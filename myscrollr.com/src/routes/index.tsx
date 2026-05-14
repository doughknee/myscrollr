import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { seo } from '@/lib/seo'
import {
  organization,
  softwareApplication,
  website,
} from '@/lib/structured-data'
import { HeroSection } from '@/components/landing/HeroSection'
import { TickerShowcase } from '@/components/landing/TickerShowcase'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { ChannelsShowcase } from '@/components/landing/ChannelsShowcase'
import { CustomizationShowcase } from '@/components/landing/CustomizationShowcase'
import { MakeItYoursSection } from '@/components/landing/MakeItYoursSection'
import { BenefitsSection } from '@/components/landing/BenefitsSection'
import { TrustSection } from '@/components/landing/TrustSection'

// FAQSection and CallToAction are below-the-fold and animation-heavy
// (FAQ has 8 simultaneous spring/blur pipelines; CallToAction has the
// mouse-parallax orb + 12 particles + 3 pulse rings + animated counters).
// Splitting them into separate chunks keeps the initial JS bundle lean
// for first paint, and defers their parse cost until the user is
// scrolling toward them.
//
// Sized Suspense fallbacks below match each section's typical rendered
// height to prevent any layout shift on chunk arrival.
const FAQSection = lazy(() =>
  import('@/components/landing/FAQSection').then((m) => ({
    default: m.FAQSection,
  })),
)
const CallToAction = lazy(() =>
  import('@/components/landing/CallToAction').then((m) => ({
    default: m.CallToAction,
  })),
)

export const Route = createFileRoute('/')({
  component: HomePage,
  head: () =>
    seo({
      title: 'Scrollr — Live Data on Your Desktop',
      description:
        'A quiet ticker at the edge of your screen with live sports, markets, news, and fantasy data. Free and open source. macOS, Windows, Linux.',
      path: '/',
      imageAlt: 'Scrollr desktop ticker showing live market and sports data.',
      jsonLd: [organization, website, softwareApplication],
    }),
})

function HomePage() {
  return (
    <>
      <HeroSection />

      <TickerShowcase />

      <HowItWorks />

      <ChannelsShowcase />

      <CustomizationShowcase />

      <MakeItYoursSection />

      <BenefitsSection />

      <TrustSection />

      <Suspense fallback={<SectionPlaceholder height="900px" />}>
        <FAQSection />
      </Suspense>

      <Suspense fallback={<SectionPlaceholder height="700px" />}>
        <CallToAction />
      </Suspense>
    </>
  )
}

/**
 * Sized placeholder for `<Suspense>` fallback. Reserves vertical space
 * so the page does not jump when the lazy chunk finishes loading. Heights
 * approximate the average rendered size of each section on desktop;
 * mobile breakpoints land slightly off but the visual jump is small
 * since the deferred sections sit below the viewport on mobile too.
 */
function SectionPlaceholder({ height }: { height: string }) {
  return (
    <div
      aria-hidden="true"
      style={{ minHeight: height }}
      className="bg-base-100"
    />
  )
}
