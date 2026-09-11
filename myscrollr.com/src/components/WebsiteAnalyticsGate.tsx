import { useEffect, useRef, useState } from 'react'
import type { WebsiteAnalyticsContext } from '@/lib/posthog'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { analyticsPolicyApi, authenticatedFetch } from '@/api/client'
import {
  applyWebsiteAnalyticsContext,
  captureWebsitePageview,
  getWebsiteAnalyticsDecision,
  normalizeWebsiteAnalyticsPolicy,
  resetWebsiteAnalyticsIdentity,
  setWebsiteAnalyticsPolicy,
  setWebsiteAnalyticsSuppressed,
} from '@/lib/posthog'

export function WebsiteAnalyticsGate() {
  const { getAccessToken, isAuthenticated, isLoading } = useScrollrAuth()
  const checkedUser = useRef(false)
  const retriedUser = useRef(false)
  const wasAuthenticated = useRef(false)
  const [consentRevision, setConsentRevision] = useState(0)
  const [policyReady, setPolicyReady] = useState(false)
  const [policyRevision, setPolicyRevision] = useState(0)

  useEffect(() => {
    let current = true
    setPolicyReady(false)
    void analyticsPolicyApi
      .get()
      .then(({ policy }) => {
        if (!current) return
        setWebsiteAnalyticsPolicy(normalizeWebsiteAnalyticsPolicy(policy))
      })
      .catch(() => {
        if (current) setWebsiteAnalyticsPolicy('consent-required')
      })
      .finally(() => {
        if (current) setPolicyReady(true)
      })
    return () => {
      current = false
    }
  }, [policyRevision])

  useEffect(() => {
    const refresh = () => setPolicyRevision((value) => value + 1)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const timer = window.setInterval(refresh, 15 * 60 * 1000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  useEffect(() => {
    const changed = () => setConsentRevision((value) => value + 1)
    window.addEventListener('scrollr:analytics-consent-changed', changed)
    return () =>
      window.removeEventListener('scrollr:analytics-consent-changed', changed)
  }, [])

  useEffect(() => {
    if (!policyReady) {
      setWebsiteAnalyticsSuppressed(true)
      return
    }
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
  }, [consentRevision, getAccessToken, isAuthenticated, isLoading, policyReady])

  return null
}
