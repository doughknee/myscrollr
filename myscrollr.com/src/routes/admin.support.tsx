/**
 * Support — a deliberate stub.
 *
 * The support queue is REL-263. It is a large surface (the queue, the drafts,
 * the per-category intervention rates, the send/hold/skip controls) and
 * building it here would have made REL-260 unreviewable. The nav entry exists
 * now so the shell is complete and the section has somewhere to land.
 *
 * No dynamic import: there is nothing here worth a chunk.
 */

import { Link, createFileRoute } from '@tanstack/react-router'
import { LifeBuoy } from 'lucide-react'

export const Route = createFileRoute('/admin/support')({
  component: SupportStub,
})

function SupportStub() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Support</h1>
        <p className="mt-1 text-sm text-base-content/60">
          The support queue lives here.
        </p>
      </header>

      <div className="flex flex-col items-center rounded-xl bg-base-200/40 px-6 py-16 text-center ring-1 ring-base-300/60">
        <LifeBuoy className="size-8 text-base-content/30" />
        <h2 className="mt-4 text-lg font-semibold">Not built yet</h2>
        <p className="mt-2 max-w-md text-sm text-base-content/60">
          The queue, the AI drafts and the send controls are REL-263. Until
          then, the Overview tile carries the numbers that already exist: open
          cases, drafts waiting, what auto-sent, and what needed a person.
        </p>
        <Link
          to="/admin"
          className="mt-6 rounded-lg px-4 py-2 text-sm font-semibold ring-1 ring-base-300 transition-colors hover:bg-base-200"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  )
}
