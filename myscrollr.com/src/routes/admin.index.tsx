/**
 * Overview - every number Scrollr actually has, in one place.
 *
 * The component is behind a dynamic import so the staff console lands in its
 * own chunk: nothing in /admin ships to a marketing visitor. The API gate
 * (LogtoAuth + RequireAdmin) is the real boundary — this split is about bundle
 * weight and not leaking internal UI, never about access control.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'

const OverviewPage = lazy(() => import('@/components/admin/OverviewPage'))

export const Route = createFileRoute('/admin/')({
  component: () => (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <OverviewPage />
    </Suspense>
  ),
})
