import { useEffect, useState } from 'react'
import type { WebsiteAnalyticsDecision } from '@/lib/posthog'
import {
  getWebsiteAnalyticsDecision,
  setWebsiteAnalyticsDecision,
} from '@/lib/posthog'

export default function AnalyticsConsent() {
  const [decision, setDecision] = useState<WebsiteAnalyticsDecision>('unknown')
  const [managing, setManaging] = useState(false)

  useEffect(() => {
    const refresh = () => setDecision(getWebsiteAnalyticsDecision())
    const manage = () => setManaging(true)
    refresh()
    window.addEventListener('scrollr:analytics-consent-changed', refresh)
    window.addEventListener('scrollr:manage-analytics', manage)
    return () => {
      window.removeEventListener('scrollr:analytics-consent-changed', refresh)
      window.removeEventListener('scrollr:manage-analytics', manage)
    }
  }, [])

  if (decision !== 'unknown' && !managing) return null

  const choose = (next: 'enabled' | 'declined') => {
    setWebsiteAnalyticsDecision(next)
    setDecision(next)
    setManaging(false)
  }

  return (
    <section
      aria-label="Analytics privacy choice"
      className="fixed inset-x-4 bottom-4 z-[110] mx-auto max-w-xl rounded-xl border border-base-300 bg-base-100 p-4 shadow-xl"
    >
      <h2 className="text-sm font-bold">Analytics</h2>
      <p className="mt-1 text-sm text-base-content/75">
        Use PostHog to count public-page visits, signups, and downloads. No
        replay, page content, or IP location. Change this anytime.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="rounded-lg border border-base-300 px-4 py-2 text-sm font-semibold hover:bg-base-200"
          onClick={() => choose('declined')}
        >
          Not now
        </button>
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-content hover:brightness-110"
          onClick={() => choose('enabled')}
        >
          Allow
        </button>
      </div>
    </section>
  )
}
