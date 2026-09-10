/**
 * Signup analytics — independent registration event/error counts.
 *
 * Lazy like every staff section. The API's LogtoAuth + RequireAdmin pair is
 * the access boundary; code splitting only keeps this UI out of public chunks.
 */

import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const AnalyticsPage = lazy(() => import('@/components/admin/AnalyticsPage'))

export const Route = createFileRoute('/admin/analytics')({
  component: () => (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <AnalyticsPage />
    </Suspense>
  ),
})
