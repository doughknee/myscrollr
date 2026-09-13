import { useEffect, useState } from 'react'
import { ChevronLeft, Loader2, Search } from 'lucide-react'
import { PageFrame } from './ui'
import type { AccountDetail, AccountRow, AccountsPage } from '@/api/admin'
import { adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'

/**
 * The Users section. Read-only, and not by omission.
 *
 * Reading another person's email, plan and ticket history is already the most
 * sensitive thing in this console. Editing it is a separate decision with
 * separate consequences, so there is no write path here at all — no disabled
 * button, no "coming soon" affordance, nothing to reach for.
 *
 * The list is every account, from Logto. It used to be every row in
 * user_preferences, which meant the 83 people who signed up and never set the
 * app up were not in it at all (REL-265). Search runs against Logto and so
 * matches email and username; widget and ticket counts are local and cannot be
 * searched or sorted across the whole set, which the page says out loud rather
 * than sorting one page and letting it look global.
 */

function planLabel(a: AccountRow): string {
  if (a.plan === 'free' || a.status === 'none') return 'Free'
  return `${a.plan}${a.lifetime ? ' · lifetime' : ''} · ${a.status}`
}

/** A date, or an em dash when the event never happened. */
function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

function DetailPanel({ sub, onBack }: { sub: string; onBack: () => void }) {
  const getToken = useGetToken()
  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    adminApi
      .account(getToken, sub)
      .then((res) => !cancelled && setDetail(res))
      .catch(
        (err: unknown) =>
          !cancelled &&
          setError(
            err instanceof Error ? err.message : 'Could not load that user',
          ),
      )
    return () => {
      cancelled = true
    }
  }, [getToken, sub])

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="flex cursor-pointer items-center gap-1 text-sm text-base-content/60 hover:text-base-content"
      >
        <ChevronLeft size={16} /> All users
      </button>

      {error && <p className="text-sm text-error">{error}</p>}
      {!detail && !error && (
        <Loader2 className="size-5 animate-spin text-base-content/40" />
      )}

      {detail && (
        <>
          <header>
            <h1 className="text-xl font-bold break-all">
              {detail.account.email ??
                detail.account.name ??
                detail.account.logto_sub}
            </h1>
            <p className="mt-1 font-mono text-xs break-all text-base-content/50">
              {detail.account.logto_sub}
            </p>
            <p className="mt-2 text-sm text-base-content/60">
              {planLabel(detail.account)}
              {detail.account.fantasy && ' · fantasy connected'}
              {detail.account.suspended && ' · suspended'}
              {detail.account.deletion_state &&
                ` · deletion ${detail.account.deletion_state}`}
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-base-content/50">Signed up</dt>
                <dd>{day(detail.account.signed_up_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/50">Last sign-in</dt>
                <dd>{day(detail.account.last_sign_in_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/50">
                  Last used the app
                </dt>
                <dd>{day(detail.account.last_used_app)}</dd>
              </div>
            </dl>
            {!detail.account.set_up && (
              <p className="mt-3 text-xs text-warning">
                This account has never set the app up — no preferences were ever
                saved.
              </p>
            )}
          </header>

          <section>
            <h2 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
              Widgets ({detail.widgets.length})
            </h2>
            <div className="mt-2 rounded-xl ring-1 ring-base-300/60">
              {detail.widgets.length === 0 ? (
                <p className="p-4 text-sm text-base-content/50">
                  No widgets configured.
                </p>
              ) : (
                detail.widgets.map((w) => (
                  <div
                    key={w.type}
                    className="flex items-center justify-between gap-3 border-b border-base-300/40 p-3 text-sm last:border-0"
                  >
                    <span className="font-medium">{w.type}</span>
                    <span className="text-xs text-base-content/60">
                      {w.enabled ? 'enabled' : 'disabled'}
                      {w.ticker_enabled && ' · on the bar'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
              Support history ({detail.cases.length})
            </h2>
            <div className="mt-2 rounded-xl ring-1 ring-base-300/60">
              {detail.cases.length === 0 ? (
                <p className="p-4 text-sm text-base-content/50">
                  No tickets opened.
                </p>
              ) : (
                detail.cases.map((k) => (
                  <div
                    key={k.ticket_number}
                    className="border-b border-base-300/40 p-3 last:border-0"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">
                        {k.subject || '(no subject)'}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-base-content/50">
                        {k.ticket_number}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-base-content/50">
                      {k.status}
                      {k.category && ` · ${k.category}`} ·{' '}
                      {new Date(k.opened_at).toLocaleDateString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default function UsersPage() {
  const getToken = useGetToken()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<AccountsPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Debounced so typing does not fire a query per keystroke.
    const timer = setTimeout(() => {
      adminApi
        .accounts(getToken, query, page)
        .then((res) => !cancelled && setData(res))
        .catch(
          (err: unknown) =>
            !cancelled &&
            setError(
              err instanceof Error ? err.message : 'Could not load users',
            ),
        )
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [getToken, query, page])

  if (selected) {
    return (
      <PageFrame>
        <DetailPanel sub={selected} onBack={() => setSelected(null)} />
      </PageFrame>
    )
  }

  const pageCount = data ? Math.ceil(data.total / data.page_size) : 0
  // The gap REL-265 uncovered: accounts that exist but never saved a
  // preference. Global counts, so they are only honest with no search term.
  const neverSetUp = data ? Math.max(0, data.total - data.set_up) : 0

  return (
    <PageFrame>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          {data?.source === 'local' ? (
            <p className="mt-1 text-sm text-warning">
              {data.note ?? 'Logto is unreachable.'} Showing{' '}
              {data.total.toLocaleString()} accounts with local data.
            </p>
          ) : (
            data && (
              <p className="mt-1 text-sm text-base-content/60">
                <span className="font-semibold text-base-content">
                  {data.total.toLocaleString()}
                </span>{' '}
                {query ? 'accounts match' : 'accounts'}
                {/* set_up is a count of the whole database, so pairing it with a
                  filtered total would read as a gap within the search. */}
                {!query && (
                  <>
                    {' · '}
                    <span className="font-semibold text-base-content">
                      {data.set_up.toLocaleString()}
                    </span>{' '}
                    have set up the app ·{' '}
                    <span className="font-semibold text-warning">
                      {neverSetUp.toLocaleString()}
                    </span>{' '}
                    never did
                  </>
                )}
              </p>
            )
          )}
          <p className="mt-1 text-sm text-base-content/60">
            Read-only — this console does not edit anyone&apos;s account.
          </p>
        </header>

        <div className="relative">
          <Search
            size={16}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-base-content/40"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            placeholder="Search by email or username"
            className="w-full rounded-lg bg-base-200/50 py-2.5 pr-3 pl-9 text-sm ring-1 ring-base-300/60 outline-none focus:ring-primary/50"
          />
        </div>

        {error && <p className="text-sm text-error">{error}</p>}
        {!data && !error && (
          <Loader2 className="size-5 animate-spin text-base-content/40" />
        )}

        {data && (
          <>
            <div className="overflow-x-auto rounded-xl ring-1 ring-base-300/60">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="text-xs text-base-content/50 uppercase">
                  <tr className="border-b border-base-300/60">
                    <th className="p-3 font-semibold">User</th>
                    <th className="p-3 font-semibold">Plan</th>
                    <th className="p-3 font-semibold">Widgets</th>
                    <th className="p-3 font-semibold">Tickets</th>
                    <th className="p-3 font-semibold">Signed up</th>
                    <th className="p-3 font-semibold">Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-6 text-center text-base-content/50"
                      >
                        No accounts match that search.
                      </td>
                    </tr>
                  )}
                  {data.accounts.map((a) => (
                    <tr
                      key={a.logto_sub}
                      onClick={() => setSelected(a.logto_sub)}
                      className="cursor-pointer border-b border-base-300/40 transition-colors last:border-0 hover:bg-base-200/50"
                    >
                      <td className="max-w-[18rem] p-3">
                        <span className="block truncate font-medium">
                          {a.email ?? a.name ?? '—'}
                        </span>
                        <span className="block truncate font-mono text-xs text-base-content/45">
                          {a.logto_sub}
                          {!a.set_up && (
                            <span className="text-warning">
                              {' '}
                              · never set up
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="p-3 text-base-content/70">
                        {planLabel(a)}
                      </td>
                      <td className="p-3 tabular-nums">
                        {a.widgets}
                        {a.on_ticker > 0 && (
                          <span className="text-base-content/45">
                            {' '}
                            ({a.on_ticker} on bar)
                          </span>
                        )}
                      </td>
                      <td className="p-3 tabular-nums">{a.tickets}</td>
                      <td className="p-3 text-base-content/60">
                        {day(a.signed_up_at)}
                      </td>
                      <td className="p-3 text-base-content/60">
                        {day(a.last_sign_in_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-base-content/45">
              Ordered by Logto; search matches email and username. Widgets and
              tickets come from this database and cannot be sorted or searched
              across the whole set — those columns describe only this page.
            </p>

            {pageCount > 1 && (
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="cursor-pointer rounded-lg px-3 py-1.5 ring-1 ring-base-300 disabled:cursor-default disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-base-content/60">
                  Page {page + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                  className="cursor-pointer rounded-lg px-3 py-1.5 ring-1 ring-base-300 disabled:cursor-default disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PageFrame>
  )
}
