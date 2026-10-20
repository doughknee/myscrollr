/**
 * Users - a read-only directory of accounts.
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
import { parseUsersSearch } from '@/lib/adminSearch'

const UsersPage = lazy(() => import('@/components/admin/UsersPage'))

export const Route = createFileRoute('/admin/users')({
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput) =>
    parseUsersSearch(search),
  search: { middlewares: [stripSearchParams({ q: '', page: 0 })] },
  component: UsersRoute,
})

function UsersRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <Suspense fallback={<AdminRouteLoading page="Users" />}>
      <UsersPage
        search={search}
        onSearchChange={(patch, replace) => {
          void navigate({
            search: (current) => ({ ...current, ...patch }),
            replace,
          })
        }}
      />
    </Suspense>
  )
}
