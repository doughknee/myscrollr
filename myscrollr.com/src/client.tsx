// Sentry must initialize before any other module imports so the SDK can
// attach to browser globals before React/Logto/etc start running.

import { StrictMode, useEffect, useRef, useState } from 'react'
import * as Sentry from '@sentry/react'
import { StartClient } from '@tanstack/react-start/client'
import { hydrateRoot } from 'react-dom/client'
import { LogtoProvider } from '@logto/react'
import { initSentry } from './sentry'
import type { LogtoConfig } from '@logto/react'
import type { WebsiteAnalyticsContext } from '@/lib/posthog'
import { ScrollrAuthProvider, useScrollrAuth } from '@/hooks/useScrollrAuth'
import { authenticatedFetch } from '@/api/client'
import {
  applyWebsiteAnalyticsContext,
  captureWebsitePageview,
  getWebsiteAnalyticsDecision,
  resetWebsiteAnalyticsIdentity,
  setWebsiteAnalyticsSuppressed,
} from '@/lib/posthog'

import '@/styles.css'

initSentry()

// Logto configuration — values come from VITE_ env vars (see .env.example)
const logtoResource =
  import.meta.env.VITE_LOGTO_RESOURCE || import.meta.env.VITE_API_URL || ''

const logtoConfig: LogtoConfig = {
  endpoint: import.meta.env.VITE_LOGTO_ENDPOINT || '',
  appId: import.meta.env.VITE_LOGTO_APP_ID || '',
  resources: [logtoResource],
}

function SentryFallback() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-32 text-center">
      <p className="text-sm font-semibold text-error">Error</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
        Something went wrong
      </h1>
      <p className="mt-4 max-w-md text-base text-base-content/60">
        An unexpected error occurred. The team has been notified.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-8 cursor-pointer rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content shadow-sm transition-[filter] hover:brightness-110"
      >
        Refresh
      </button>
    </div>
  )
}

function WebsiteAnalyticsGate() {
  const { getAccessToken, isAuthenticated, isLoading } = useScrollrAuth()
  const checkedUser = useRef(false)
  const retriedUser = useRef(false)
  const wasAuthenticated = useRef(false)
  const [consentRevision, setConsentRevision] = useState(0)

  useEffect(() => {
    const changed = () => setConsentRevision((value) => value + 1)
    window.addEventListener('scrollr:analytics-consent-changed', changed)
    return () =>
      window.removeEventListener('scrollr:analytics-consent-changed', changed)
  }, [])

  useEffect(() => {
    if (isLoading) {
      setWebsiteAnalyticsSuppressed(true)
      return
    }
    if (!isAuthenticated) {
      if (wasAuthenticated.current) resetWebsiteAnalyticsIdentity()
      wasAuthenticated.current = false
      checkedUser.current = false
      retriedUser.current = false
      setWebsiteAnalyticsSuppressed(false)
      captureWebsitePageview(window.location.pathname)
      return
    }
    wasAuthenticated.current = true
    setWebsiteAnalyticsSuppressed(true)
    if (getWebsiteAnalyticsDecision() !== 'enabled') {
      checkedUser.current = false
      retriedUser.current = false
      return
    }
    if (checkedUser.current) return
    checkedUser.current = true
    let current = true
    let retryTimer: number | undefined
    void authenticatedFetch<WebsiteAnalyticsContext>(
      '/users/me/verify-website-signup',
      { method: 'POST' },
      getAccessToken,
    )
      .then((context) => {
        if (!current) return
        if (!applyWebsiteAnalyticsContext(context)) return
        retriedUser.current = false
        setWebsiteAnalyticsSuppressed(false)
        captureWebsitePageview(window.location.pathname)
      })
      .catch(() => {
        if (!current || retriedUser.current) return
        checkedUser.current = false
        retriedUser.current = true
        retryTimer = window.setTimeout(
          () => setConsentRevision((value) => value + 1),
          2000,
        )
      })
    return () => {
      current = false
      checkedUser.current = false
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [consentRevision, getAccessToken, isAuthenticated, isLoading])

  return null
}

hydrateRoot(
  document,
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<SentryFallback />}>
      <LogtoProvider config={logtoConfig}>
        <ScrollrAuthProvider>
          <WebsiteAnalyticsGate />
          <StartClient />
        </ScrollrAuthProvider>
      </LogtoProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
