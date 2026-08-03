import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { BILLING_FAQ } from './support-content'
import { SupportAccordion } from './SupportAccordion'
import { SupportSection } from './SupportSection'

export function SupportBilling() {
  const entries = BILLING_FAQ.map((item) => ({
    title: item.question,
    body: <p>{item.answer}</p>,
  }))

  return (
    <SupportSection
      id="billing"
      eyebrow="Account & Billing"
      title="Subscriptions, plans, and payment"
      description="How upgrades, cancellations, trials, and billing-portal access work."
      screenshot={{
        basename: 'support/account-billing',
        alt: 'The in-app account and billing tab in Scrollr, showing plan, usage, and payment details.',
      }}
    >
      <SupportAccordion entries={entries} idPrefix="billing" />

      {/* Internal CTA: billing FAQs reference plans; deep-link to the
          pricing page for readers comparing tiers. */}
      <div className="mt-6 flex justify-start">
        <Link
          to="/uplink"
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary transition-colors"
        >
          View plans and pricing
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </SupportSection>
  )
}
