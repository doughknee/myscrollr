/**
 * Overview - every number Scrollr actually has, in one place.
 *
 * The component is behind a dynamic import so the staff console lands in its
 * own chunk: nothing in /admin ships to a marketing visitor. The API gate
 * (LogtoAuth + RequireAdmin) is the real boundary — this split is about bundle
 * weight and not leaking internal UI, never about access control.
 *
 * `period` lives in the URL so a link to the Overview is a link to a window,
 * and the same value rides along to Analytics (SCROLLR-210).
 */

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import type { SearchSchemaInput } from '@tanstack/react-router'
import type { Period } from '@/api/adminDashboard'
import { parsePeriod } from '@/lib/adminFormat'

const OverviewPage = lazy(() => import('@/components/admin/OverviewPage'))

export interface OverviewSearch {
  period: Period
}

export const Route = createFileRoute('/admin/')({
  validateSearch: (
    search: { period?: string } & SearchSchemaInput,
  ): OverviewSearch => ({ period: parsePeriod(search.period) }),
  component: () => (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <OverviewPage />
    </Suspense>
  ),
})
