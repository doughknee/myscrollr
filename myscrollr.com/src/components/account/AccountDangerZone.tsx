/**
 * AccountDangerZone — GDPR data export + account-delete UI.
 *
 * Renders three things:
 *   1. A pending-deletion banner (visible only when a request is pending),
 *      with the exact purge date and a one-click "Cancel Deletion" button.
 *   2. An "Export Your Data" button that downloads a JSON archive.
 *   3. A "Delete Account" button that opens a type-to-confirm modal and,
 *      on success, schedules purge 30 days out.
 *
 * Deletion status is read from the parent's /users/me/overview fetch
 * (passed in as props). Mutating actions (export, request, cancel) still
 * hit the dedicated GDPR endpoints; on success we call onDeletionChange
 * so the parent re-fetches overview and re-renders us with fresh state.
 *
 * Lives at the bottom of the Account hub. Intentionally destructive
 * visual treatment so users don't click it casually.
 */
import { useCallback, useState } from 'react'
import { AlertTriangle, Download, Loader2, Trash2, X } from 'lucide-react'
import { motion } from 'motion/react'
import { gdprApi } from '@/api/client'

interface AccountDangerZoneProps {
  getToken: () => Promise<string | null>
  deletionStatus: 'none' | 'pending' | 'canceled' | 'purged'
  /** ISO RFC3339 string. Drives the pending banner's countdown. Null when no pending request. */
  purgeAt: string | null
  /** Called after a deletion request is scheduled or canceled, so the parent can re-fetch overview. */
  onDeletionChange?: () => void | Promise<void>
}

export default function AccountDangerZone({
  getToken,
  deletionStatus,
  purgeAt,
  onDeletionChange,
}: AccountDangerZoneProps) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  // ── Export ──────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setExporting(true)
    setExportError(null)
    try {
      await gdprApi.exportData(getToken)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [getToken])

  // ── Cancel pending deletion ─────────────────────────────────

  const [canceling, setCanceling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const handleCancel = useCallback(async () => {
    setCanceling(true)
    setCancelError(null)
    try {
      await gdprApi.cancelDeletion(getToken)
      await onDeletionChange?.()
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : 'Failed to cancel deletion',
      )
    } finally {
      setCanceling(false)
    }
  }, [getToken, onDeletionChange])

  return (
    <section className="relative overflow-hidden">
      <div className="container py-16 lg:py-24">
        <motion.div
          className="text-center mb-10"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight leading-[0.95] mb-3">
            Your Data
          </h2>
          <p className="text-sm text-base-content/45 leading-relaxed max-w-lg mx-auto">
            Export everything we store about you, or permanently delete your
            account. Deletions have a 30-day undo window.
          </p>
        </motion.div>

        {deletionStatus === 'pending' && purgeAt && (
          <PendingBanner
            purgeAt={purgeAt}
            canceling={canceling}
            cancelError={cancelError}
            onCancel={handleCancel}
          />
        )}

        <div className="max-w-2xl mx-auto space-y-4">
          {/* Export */}
          <div className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-6 overflow-hidden">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-info/15 text-info">
                <Download size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-base-content mb-1">
                  Export your data
                </h3>
                <p className="text-xs text-base-content/50 leading-relaxed">
                  Download a JSON archive of your preferences, channels,
                  subscription summary, and fantasy league metadata. Yahoo OAuth
                  tokens are omitted for security.
                </p>
                {exportError && (
                  <p className="mt-2 text-xs text-error">{exportError}</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-base-300/50 bg-base-200/60 px-4 py-2 text-xs font-semibold text-base-content hover:border-info/40 hover:text-info transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                {exporting ? 'Preparing…' : 'Download'}
              </button>
            </div>
          </div>

          {/* Delete */}
          <div className="relative bg-error/[0.04] border border-error/25 rounded-xl p-6 overflow-hidden">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-error/15 text-error">
                <Trash2 size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-base-content mb-1">
                  Delete your account
                </h3>
                <p className="text-xs text-base-content/60 leading-relaxed">
                  Permanently removes your account, preferences, channels, and
                  Yahoo OAuth connection. Active subscriptions must be canceled
                  first. If you have a lifetime membership, we keep an
                  anonymized purchase record for accounting.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                disabled={deletionStatus === 'pending'}
                className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-error/40 bg-error/10 px-4 py-2 text-xs font-semibold text-error hover:bg-error/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={14} />
                {deletionStatus === 'pending' ? 'Scheduled' : 'Delete…'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {modalOpen && (
        <DeleteConfirmModal
          getToken={getToken}
          onClose={() => setModalOpen(false)}
          onScheduled={async () => {
            setModalOpen(false)
            await onDeletionChange?.()
          }}
        />
      )}
    </section>
  )
}

// ── Pending banner ──────────────────────────────────────────────

function PendingBanner({
  purgeAt,
  canceling,
  cancelError,
  onCancel,
}: {
  purgeAt: string
  canceling: boolean
  cancelError: string | null
  onCancel: () => void
}) {
  const purgeDate = new Date(purgeAt)
  const now = Date.now()
  const daysLeft = Math.max(
    0,
    Math.ceil((purgeDate.getTime() - now) / (1000 * 60 * 60 * 24)),
  )
  const formatted = purgeDate.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="max-w-2xl mx-auto mb-8 rounded-xl border border-warning/40 bg-warning/[0.08] p-5">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-warning/20 text-warning">
          <AlertTriangle size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-base-content">
            Account scheduled for deletion
          </h3>
          <p className="mt-1 text-xs text-base-content/70 leading-relaxed">
            Your account will be permanently deleted on{' '}
            <span className="font-semibold text-base-content">{formatted}</span>{' '}
            ({daysLeft} {daysLeft === 1 ? 'day' : 'days'} from now). You can
            cancel any time before that.
          </p>
          {cancelError && (
            <p className="mt-2 text-xs text-error">{cancelError}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={canceling}
          className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-xs font-semibold text-warning hover:bg-warning/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {canceling ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <X size={14} />
          )}
          Cancel deletion
        </button>
      </div>
    </div>
  )
}

// ── Confirm modal ──────────────────────────────────────────────

function DeleteConfirmModal({
  getToken,
  onClose,
  onScheduled,
}: {
  getToken: () => Promise<string | null>
  onClose: () => void
  onScheduled: () => void | Promise<void>
}) {
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expected = 'DELETE MY ACCOUNT'
  const canSubmit = confirmText === expected && !submitting

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await gdprApi.requestDeletion(getToken)
      await onScheduled()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to schedule deletion',
      )
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, getToken, onScheduled])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-100/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-lg rounded-xl border border-error/40 bg-base-200 p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-error/15 text-error">
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1">
            <h2
              id="delete-account-title"
              className="text-lg font-bold text-base-content"
            >
              Permanently delete your account?
            </h2>
            <p className="mt-1 text-sm text-base-content/70 leading-relaxed">
              Your account will be scheduled for purge in{' '}
              <span className="font-semibold">30 days</span>. You can cancel
              from this page during that window by signing in and clicking
              Cancel deletion.
            </p>
          </div>
        </div>

        <ul className="mb-5 space-y-1.5 text-xs text-base-content/70">
          <li>• All channel configurations and preferences will be deleted.</li>
          <li>• Connected Yahoo Fantasy account will be disconnected.</li>
          <li>• Billing records stay anonymized for tax compliance.</li>
          <li>• You will be signed out and unable to sign back in.</li>
        </ul>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-base-content/50">
            Type <span className="font-mono text-error">{expected}</span> to
            confirm
          </span>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 w-full rounded-lg border border-base-300/40 bg-base-100 px-3 py-2 font-mono text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-error/60"
            placeholder={expected}
          />
        </label>

        {error && <p className="mt-3 text-xs text-error">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-base-content/70 hover:bg-base-300/30 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-error px-4 py-2 text-sm font-semibold text-base-100 hover:bg-error/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            Schedule deletion
          </button>
        </div>
      </motion.div>
    </div>
  )
}
