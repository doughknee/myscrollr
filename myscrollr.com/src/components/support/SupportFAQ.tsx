import { FAQ_ITEMS } from './support-content'
import { SupportAccordion } from './SupportAccordion'
import { SupportSection } from './SupportSection'

export function SupportFAQ() {
  const entries = FAQ_ITEMS.map((item) => ({
    title: item.question,
    body: <p>{item.answer}</p>,
  }))

  return (
    <SupportSection
      id="faq"
      eyebrow="FAQ"
      title="Frequently asked questions"
      description="Quick answers to the questions people most often have about Scrollr."
    >
      <SupportAccordion entries={entries} idPrefix="faq" />
    </SupportSection>
  )
}
