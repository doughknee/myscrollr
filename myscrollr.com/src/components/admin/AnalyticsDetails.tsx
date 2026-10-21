import { useId, useRef } from 'react'
import { ArrowUpRight, Info, X } from 'lucide-react'
import type { ReactNode } from 'react'

/** Native modal keeps focus, Escape and the background's scroll position intact. */
export function AnalyticsDetails({
  children,
  title = 'Explore this report',
  compact = false,
}: {
  children: ReactNode
  title?: string
  compact?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  return (
    <>
      <button
        type="button"
        className={compact ? 'analytics-info' : 'analytics-explore'}
        aria-label={compact ? title : undefined}
        title={compact ? title : undefined}
        onClick={() => dialog.current?.showModal()}
      >
        {compact ? (
          <Info size={15} aria-hidden />
        ) : (
          <>
            {title} <ArrowUpRight size={17} aria-hidden />
          </>
        )}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className={
          compact
            ? 'analytics-drawer analytics-drawer-info'
            : 'analytics-drawer'
        }
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close()
        }}
      >
        <div className="analytics-drawer-surface">
          <header>
            <h2 id={titleId}>{title}</h2>
            <button type="button" onClick={() => dialog.current?.close()}>
              Close <X size={15} aria-hidden />
            </button>
          </header>
          <div className="analytics-detail-content">{children}</div>
        </div>
      </dialog>
    </>
  )
}
