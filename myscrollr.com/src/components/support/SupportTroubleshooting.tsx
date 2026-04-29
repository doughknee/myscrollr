import { TROUBLESHOOTING_ARTICLES } from './support-content'
import { SupportAccordion } from './SupportAccordion'
import { SupportSection } from './SupportSection'

export function SupportTroubleshooting() {
  const entries = TROUBLESHOOTING_ARTICLES.map((article) => ({
    title: article.title,
    body: (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold tracking-wider text-base-content/60 uppercase">
            Symptoms
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {article.symptoms.map((symptom) => (
              <li key={symptom}>{symptom}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wider text-base-content/60 uppercase">
            Try this
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {article.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    ),
  }))

  return (
    <SupportSection
      id="troubleshooting"
      eyebrow="Troubleshooting"
      title="When something isn't working"
      description="Common symptoms and the steps that resolve them. If none of these help, send us a note from the contact form below."
    >
      <SupportAccordion entries={entries} idPrefix="trouble" />
    </SupportSection>
  )
}
