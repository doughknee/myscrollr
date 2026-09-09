import { useCallback, useEffect, useState } from 'react'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import type { AdminRow } from '@/api/admin'
import { adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'

/**
 * The Admins section: who has staff access, and the controls to change it
 * without a deploy.
 *
 * A new admin is stored by email with no Logto sub. The server pins their sub
 * the first time they sign in and their Logto-verified address matches, so
 * "claimed" below means "has signed in at least once", not "is allowed".
 *
 * Two removals are refused by the server and hidden here: the last remaining
 * admin, and your own row. Between them there is no sequence of clicks that
 * ends with nobody able to get back in.
 */

export default function AdminsPage() {
  const getToken = useGetToken()
  const [admins, setAdmins] = useState<Array<AdminRow> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    adminApi
      .admins(getToken)
      .then((res) => setAdmins(res.admins))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load admins'),
      )
  }, [getToken])

  useEffect(load, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await adminApi.addAdmin(getToken, email.trim(), note.trim())
      setEmail('')
      setNote('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that admin')
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: AdminRow) {
    if (!confirm(`Remove ${row.email} from the admin list?`)) return
    setError(null)
    try {
      await adminApi.removeAdmin(getToken, row.id)
      load()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not remove that admin',
      )
    }
  }

  // The delete button is hidden for the two rows the server refuses, so the
  // UI never offers a click that is guaranteed to fail.
  const removable = (row: AdminRow) => !row.self && (admins?.length ?? 0) > 1

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Admins</h1>
        <p className="mt-1 text-sm text-base-content/60">
          Staff access is this list and nothing else — not a subscription tier,
          not a Stripe plan, not <code className="text-xs">super_user</code>.
        </p>
      </header>

      {error && (
        <p className="rounded-lg bg-error/5 p-3 text-sm text-error ring-1 ring-error/20">
          {error}
        </p>
      )}

      <form
        onSubmit={add}
        className="flex flex-col gap-3 rounded-xl bg-base-200/40 p-4 ring-1 ring-base-300/60 sm:flex-row sm:items-end"
      >
        <label className="flex-1">
          <span className="text-xs font-semibold text-base-content/50 uppercase">
            Email
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className="mt-1 w-full rounded-lg bg-base-100 px-3 py-2 text-sm ring-1 ring-base-300/60 outline-none focus:ring-primary/50"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs font-semibold text-base-content/50 uppercase">
            Note (optional)
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="why they need access"
            className="mt-1 w-full rounded-lg bg-base-100 px-3 py-2 text-sm ring-1 ring-base-300/60 outline-none focus:ring-primary/50"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-content transition-[filter] hover:brightness-110 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <UserPlus size={16} />
          )}
          Add admin
        </button>
      </form>

      {!admins ? (
        <Loader2 className="size-5 animate-spin text-base-content/40" />
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-base-300/60">
          <table className="w-full min-w-[38rem] text-left text-sm">
            <thead className="text-xs text-base-content/50 uppercase">
              <tr className="border-b border-base-300/60">
                <th className="p-3 font-semibold">Email</th>
                <th className="p-3 font-semibold">Added</th>
                <th className="p-3 font-semibold">Last seen</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {admins.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-base-300/40 last:border-0"
                >
                  <td className="p-3">
                    <span className="font-medium">{row.email}</span>
                    {row.self && (
                      <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                        you
                      </span>
                    )}
                    {!row.claimed && (
                      <span className="ml-2 rounded bg-base-300/60 px-1.5 py-0.5 text-xs text-base-content/60">
                        not signed in yet
                      </span>
                    )}
                    {row.note && (
                      <span className="block text-xs text-base-content/45">
                        {row.note}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-base-content/60">
                    {new Date(row.added_at).toLocaleDateString()}
                    {row.added_by && (
                      <span className="block text-xs text-base-content/45">
                        by {row.added_by}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-base-content/60">
                    {row.last_seen_at
                      ? new Date(row.last_seen_at).toLocaleString()
                      : '—'}
                  </td>
                  <td className="p-3 text-right">
                    {removable(row) ? (
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        aria-label={`Remove ${row.email}`}
                        className="cursor-pointer rounded-lg p-1.5 text-base-content/50 transition-colors hover:bg-error/10 hover:text-error"
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : (
                      <span className="text-xs text-base-content/35">
                        {row.self ? 'cannot remove yourself' : 'last admin'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
