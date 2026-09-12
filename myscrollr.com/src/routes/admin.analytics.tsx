/**
 * Analytics — growth, desktop usage, revenue and support, one tab each.
 *
 * Lazy like every staff section. The API's LogtoAuth + RequireAdmin pair is
 * the access boundary; code splitting only keeps this UI out of public chunks.
 *
 * The tab, the period and the desktop filters are all search params, so a
 * URL names exactly what is on screen (SCROLLR-210).
 */

import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { SearchSchemaInput } from '@tanstack/react-router'
import type { Period } from '@/api/adminDashboard'
import type { AnalyticsView } from '@/lib/adminFormat'
import { parseFilter, parsePeriod, parseView } from '@/lib/adminFormat'

const AnalyticsPage = lazy(() => import('@/components/admin/AnalyticsPage'))

export interface AnalyticsSearch {
  period: Period
  view: AnalyticsView
  os?: string
  version?: string
  plan?: string
}

export const Route = createFileRoute('/admin/analytics')({
  validateSearch: (
    search: {
      period?: string
      view?: string
      os?: string
      version?: string
      plan?: string
    } & SearchSchemaInput,
  ): AnalyticsSearch => ({
    period: parsePeriod(search.period),
    view: parseView(search.view),
    os: parseFilter(search.os),
    version: parseFilter(search.version),
    plan: parseFilter(search.plan),
  }),
  component: () => (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <AnalyticsPage />
    </Suspense>
  ),
})
