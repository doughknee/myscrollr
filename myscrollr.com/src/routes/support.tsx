import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { seo } from '@/lib/seo'
import { breadcrumbs, faqPage } from '@/lib/structured-data'
import { FAQ_ITEMS } from '@/components/support/support-content'
import { SupportHero } from '@/components/support/SupportHero'
import { SupportGettingStarted } from '@/components/support/SupportGettingStarted'
import { SupportFAQ } from '@/components/support/SupportFAQ'
import { SupportTroubleshooting } from '@/components/support/SupportTroubleshooting'
import { SupportBilling } from '@/components/support/SupportBilling'
import { SupportContactForm } from '@/components/support/SupportContactForm'

export const Route = createFileRoute('/support')({
  head: () =>
    seo({
      title: 'Support — Scrollr',
      description:
        'Get help with Scrollr. FAQs, troubleshooting articles, billing help, and a direct contact form. Real humans, no chatbots.',
      path: '/support',
      jsonLd: [
        faqPage(FAQ_ITEMS),
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Support', path: '/support' },
        ]),
      ],
    }),
  component: SupportPage,
})

function SupportPage() {
  return (
    <main className="min-h-screen bg-base-100">
      <SupportHero />
      <SupportGettingStarted />
      <SupportFAQ />
      <SupportTroubleshooting />
      <SupportBilling />
      {/* Contact form is auth-aware (pre-fills name/email from claims).
          Wrapped in ClientOnly so the rest of /support prerenders. */}
      <ClientOnly>
        <SupportContactForm />
      </ClientOnly>
    </main>
  )
}
