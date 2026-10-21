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
    view:
      search.view === 'traffic' ? ('traffic' as const) : ('health' as const),
  }),
  search: { middlewares: [stripSearchParams({ days: 30, view: 'health' })] },
  component: VersionsRoute,
})

function VersionsRoute() {
  const { days, view } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <Suspense fallback={<AdminRouteLoading page="System" />}>
      <VersionsPage
        days={days}
        view={view}
        onViewChange={(next) => {
          void navigate({
            search: (current) => ({ ...current, view: next }),
            resetScroll: false,
          })
        }}
        onDaysChange={(next) => {
          void navigate({
            search: (current) => ({ ...current, days: next }),
            resetScroll: false,
          })
        }}
      />
    </Suspense>
  )
}
