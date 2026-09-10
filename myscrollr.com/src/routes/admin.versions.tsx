/**
 * Versions — version adoption, platform mix and error rate by version.
 *
 * Same lazy-import shape as the other console sections: nothing in /admin
 * ships to a marketing visitor. The API gate (LogtoAuth + RequireAdmin) is the
 * real boundary; this split is about bundle weight.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'

const VersionsPage = lazy(() => import('@/components/admin/VersionsPage'))

export const Route = createFileRoute('/admin/versions')({
  component: () => (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <VersionsPage />
    </Suspense>
  ),
})
