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
    >
      <SupportAccordion entries={entries} idPrefix="billing" />
    </SupportSection>
  )
}
