import { useEffect, useState } from 'react'
import {
  getWebsiteAnalyticsDecision,
  getWebsiteAnalyticsPolicy,
  hasWebsiteAnalyticsOptOutSignal,
  setWebsiteAnalyticsDecision,
} from '@/lib/posthog'

function readAnalytics() {
  return {
    decision: getWebsiteAnalyticsDecision(),
    policy: getWebsiteAnalyticsPolicy(),
  }
}

export default function AnalyticsConsent() {
  const [analytics, setAnalytics] = useState(readAnalytics)
  const [managing, setManaging] = useState(false)

  useEffect(() => {
    const refresh = () => setAnalytics(readAnalytics())
    const manage = () => setManaging(true)
    refresh()
    window.addEventListener('scrollr:analytics-consent-changed', refresh)
    window.addEventListener('scrollr:manage-analytics', manage)
    return () => {
      window.removeEventListener('scrollr:analytics-consent-changed', refresh)
      window.removeEventListener('scrollr:manage-analytics', manage)
    }
  }, [])

  const { decision, policy } = analytics
  if (
    policy === 'unknown' ||
    (!managing && (decision !== 'unknown' || policy === 'default-on'))
  )
    return null

  const choose = (next: 'enabled' | 'declined') => {
    setWebsiteAnalyticsDecision(next)
    setAnalytics(readAnalytics())
    setManaging(false)
  }

  const browserOptedOut = hasWebsiteAnalyticsOptOutSignal()
  const buttonClass =
    'rounded-lg border border-base-300 px-4 py-2 text-sm font-semibold hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <section
      aria-label="Analytics privacy choice"
      className="fixed inset-x-4 bottom-4 z-[110] mx-auto max-w-xl rounded-xl border border-base-300 bg-base-100 p-4 shadow-xl"
    >
      <h2 className="text-sm font-bold">Analytics</h2>
      <p className="mt-1 text-sm text-base-content/75">
        Usage analytics help us improve Scrollr. PostHog counts public-page
        visits, signups, and downloads—never replay or page content. Scrollr
        checks your country locally to decide whether to ask first; PostHog
        receives no IP or location.{' '}
        <a className="underline hover:text-primary" href="/legal?doc=privacy">
          Privacy details
        </a>
        .
      </p>
      {browserOptedOut && (
        <p className="mt-1 text-xs text-base-content/65">
          Your browser privacy signal keeps analytics off.
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          className={buttonClass}
          onClick={() => choose('declined')}
        >
          Decline
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={browserOptedOut}
          onClick={() => choose('enabled')}
        >
          Allow
        </button>
      </div>
    </section>
  )
}
