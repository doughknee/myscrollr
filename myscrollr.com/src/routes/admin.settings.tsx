/**
 * Settings — the dashboard's one server-backed switch (SCROLLR-210).
 *
 * Same lazy-import shape as the other console sections: nothing in /admin
 * ships to a marketing visitor. The API gate (LogtoAuth + RequireAdmin) is the
 * real boundary; this split is about bundle weight.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'

const SettingsPage = lazy(() => import('@/components/admin/SettingsPage'))

export const Route = createFileRoute('/admin/settings')({
  component: () => (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <SettingsPage />
    </Suspense>
  ),
})
