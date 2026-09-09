/**
 * Admins - the staff list, and add/remove without a deploy.
 *
 * The component is behind a dynamic import so the staff console lands in its
 * own chunk: nothing in /admin ships to a marketing visitor. The API gate
 * (LogtoAuth + RequireAdmin) is the real boundary — this split is about bundle
 * weight and not leaking internal UI, never about access control.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'

const AdminsPage = lazy(() => import('@/components/admin/AdminsPage'))

export const Route = createFileRoute('/admin/admins')({
  component: () => (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <AdminsPage />
    </Suspense>
  ),
})
