import { createFileRoute } from '@tanstack/react-router'
import { usePageMeta } from '@/lib/usePageMeta'
import { SupportHero } from '@/components/support/SupportHero'
import { SupportGettingStarted } from '@/components/support/SupportGettingStarted'
import { SupportFAQ } from '@/components/support/SupportFAQ'
import { SupportTroubleshooting } from '@/components/support/SupportTroubleshooting'
import { SupportBilling } from '@/components/support/SupportBilling'
import { SupportContactForm } from '@/components/support/SupportContactForm'

export const Route = createFileRoute('/support')({
  component: SupportPage,
})

function SupportPage() {
  usePageMeta({
    title: 'Support - Scrollr',
    description:
      'Find answers, troubleshoot issues, or contact the Scrollr team. FAQs, troubleshooting articles, billing help, and a direct contact form.',
    canonicalUrl: 'https://myscrollr.com/support',
  })

  return (
    <main className="min-h-screen bg-base-100">
      <SupportHero />
      <SupportGettingStarted />
      <SupportFAQ />
      <SupportTroubleshooting />
      <SupportBilling />
      <SupportContactForm />
    </main>
  )
}
