/**
 * Support - the queue and the triage pipeline, read-only (REL-263).
 *
 * The component is behind a dynamic import so the staff console lands in its
 * own chunk: nothing in /admin ships to a marketing visitor. The API gate
 * (LogtoAuth + RequireAdmin) is the real boundary — this split is about bundle
 * weight and not leaking internal UI, never about access control.
 */

import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import type { SearchSchemaInput } from '@tanstack/react-router'
import { AdminRouteLoading } from '@/components/admin/AdminRouteLoading'
import { parseSupportSearch } from '@/lib/adminSearch'

const SupportPage = lazy(() => import('@/components/admin/SupportPage'))

export const Route = createFileRoute('/admin/support')({
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput) =>
    parseSupportSearch(search),
  search: {
    middlewares: [
      stripSearchParams({
        q: '',
        sort: 'last_wrote',
        dir: 'desc',
        rows: 'person',
        resolved: false,
        inbox: 'all',
      }),
    ],
  },
  component: SupportRoute,
})

function SupportRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <Suspense fallback={<AdminRouteLoading page="Support" />}>
      <SupportPage
        search={search}
        onSearchChange={(patch, replace) => {
          void navigate({
            search: (current) => ({ ...current, ...patch }),
            replace,
            resetScroll: false,
          })
        }}
      />
    </Suspense>
  )
}
