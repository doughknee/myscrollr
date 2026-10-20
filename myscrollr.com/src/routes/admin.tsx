/**
 * Staff console layout: the gate, the left navigation, and the Outlet.
 *
 * The component is behind a dynamic import so the staff console lands in its
 * own chunk: nothing in /admin ships to a marketing visitor. The API gate
 * (LogtoAuth + RequireAdmin) is the real boundary — this split is about bundle
 * weight and not leaking internal UI, never about access control.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import { AdminRouteLoading } from '@/components/admin/AdminRouteLoading'
import { seo } from '@/lib/seo'

const AdminShell = lazy(() => import('@/components/admin/AdminShell'))

export const Route = createFileRoute('/admin')({
  head: () =>
    seo({
      title: 'Staff | Scrollr',
      description: 'Scrollr staff console.',
      path: '/admin',
      noindex: true,
    }),
  component: () => (
    <Suspense fallback={<AdminRouteLoading page="staff console" />}>
      <AdminShell />
    </Suspense>
  ),
})
