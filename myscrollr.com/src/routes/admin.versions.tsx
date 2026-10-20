/**
 * Versions — version adoption, platform mix and error rate by version.
 *
 * Same lazy-import shape as the other console sections: nothing in /admin
 * ships to a marketing visitor. The API gate (LogtoAuth + RequireAdmin) is the
 * real boundary; this split is about bundle weight.
 */

import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import type { SearchSchemaInput } from '@tanstack/react-router'
import { AdminRouteLoading } from '@/components/admin/AdminRouteLoading'
import { parseVersionDays } from '@/lib/adminSearch'

const VersionsPage = lazy(() => import('@/components/admin/VersionsPage'))

export const Route = createFileRoute('/admin/versions')({
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput) => ({
    days: parseVersionDays(search.days),
  }),
  search: { middlewares: [stripSearchParams({ days: 30 })] },
  component: VersionsRoute,
})

function VersionsRoute() {
  const { days } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <Suspense fallback={<AdminRouteLoading page="Versions" />}>
      <VersionsPage
        days={days}
        onDaysChange={(next) => {
          void navigate({ search: { days: next } })
        }}
      />
    </Suspense>
  )
}
