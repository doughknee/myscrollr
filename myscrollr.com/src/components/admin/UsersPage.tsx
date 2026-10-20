import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Loader2, Search } from 'lucide-react'
import { ErrorPanel, PageFrame } from './ui'
import type { AccountDetail, AccountRow, AccountsPage } from '@/api/admin'
import type { UsersSearch } from '@/lib/adminSearch'
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
  const [attempt, setAttempt] = useState(0)
  const backButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    backButton.current?.focus()
  }, [sub])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setDetail(null)
    setError(null)
    adminApi
      .account(getToken, sub, controller.signal)
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
      controller.abort()
    }
  }, [getToken, sub, attempt])

  return (
    <div className="space-y-6">
      <button
        ref={backButton}
        type="button"
        onClick={onBack}
        className="flex min-h-11 cursor-pointer items-center gap-1 text-sm text-base-content/60 hover:text-base-content"
      >
        <ChevronLeft size={16} /> All users
      </button>

      {error && (
        <ErrorPanel message={error} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {!detail && !error && (
        <Loader2
          role="status"
          aria-label="Loading user"
          className="size-5 animate-spin text-base-content/40"
        />
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
              {detail.account.suspended && ' · suspended'}
              {detail.account.deletion_state &&
                ` · deletion ${detail.account.deletion_state}`}
            </p>
            <dl className="admin-user-dates mt-3 grid grid-cols-3 gap-3 text-sm">
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
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300/40 p-3 text-sm [overflow-wrap:anywhere] last:border-0"
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
                      <a
                        href={`/admin/support?ticket=${encodeURIComponent(k.ticket_number)}&rows=ticket`}
                        className="truncate text-sm font-medium text-primary hover:underline"
                      >
                        {k.subject || '(no subject)'}
                      </a>
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

export default function UsersPage({
  search,
  onSearchChange,
}: {
  search?: UsersSearch
  onSearchChange?: (patch: Partial<UsersSearch>, replace?: boolean) => void
} = {}) {
  const getToken = useGetToken()
  const [localSearch, setLocalSearch] = useState<UsersSearch>({
    q: '',
    page: 0,
  })
  const { q: query, page, user: selected } = search ?? localSearch
  const updateSearch = (patch: Partial<UsersSearch>, replace = false) => {
    if (onSearchChange) onSearchChange(patch, replace)
    else setLocalSearch((current) => ({ ...current, ...patch }))
  }
  const setSelected = (user: string | null) =>
    updateSearch({ user: user ?? undefined })
  const [result, setResult] = useState<{
    query: string
    page: number
    data: AccountsPage
  } | null>(null)
  // A previous page is useful on return from detail, but must not be relabeled
  // as matches for a new query or page while its request is still pending.
  const data =
    result?.query === query && result.page === page ? result.data : null
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const previousSelection = useRef(selected)
  const userButtons = useRef(new Map<string, HTMLButtonElement>())
  const searchInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const previous = previousSelection.current
    previousSelection.current = selected
    if (!selected && previous) {
      // The list is retained while detail is open. Resume at that account;
      // a changed search can remove it, in which case search is the safe target.
      const target = userButtons.current.get(previous) ?? searchInput.current
      target?.focus()
    }
  }, [selected])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setError(null)
    setLoading(true)
    // Debounced so typing does not fire a query per keystroke.
    const timer = setTimeout(() => {
      adminApi
        .accounts(getToken, query, page, controller.signal)
        .then((res) => !cancelled && setResult({ query, page, data: res }))
        .catch(
          (err: unknown) =>
            !cancelled &&
            setError(
              err instanceof Error ? err.message : 'Could not load users',
            ),
        )
        .finally(() => !cancelled && setLoading(false))
    }, 250)
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [getToken, query, page, attempt])

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
          <h1 className="admin-page-heading">Users</h1>
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
                {data.total === 1 ? 'account' : 'accounts'}
                {query && (data.total === 1 ? ' matches' : ' match')}
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
            ref={searchInput}
            type="search"
            value={query}
            onChange={(e) => {
              updateSearch({ q: e.target.value, page: 0 }, true)
            }}
            placeholder="Search by email or username"
            aria-label="Search users by email or username"
            className="w-full rounded-lg bg-base-200/50 py-2.5 pr-3 pl-9 text-sm ring-1 ring-base-300/60 outline-none focus:ring-primary/50"
          />
        </div>

        {error && (
          <ErrorPanel
            message={error}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}
        {loading && (
          <Loader2
            role="status"
            aria-label="Loading users"
            className="size-5 animate-spin text-base-content/40"
          />
        )}

        {data && !error && (
          <>
            {data.accounts.length === 0 ? (
              <div className="rounded-xl bg-base-200/30 p-6 text-sm text-base-content/65 ring-1 ring-base-300/60">
                No accounts match that search.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl ring-1 ring-base-300/60">
                <table className="admin-mobile-table w-full min-w-[42rem] text-left text-sm">
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
                    {data.accounts.map((a) => (
                      <tr
                        key={a.logto_sub}
                        onClick={() => setSelected(a.logto_sub)}
                        className="cursor-pointer border-b border-base-300/40 transition-colors last:border-0 hover:bg-base-200/50"
                      >
                        <td className="max-w-[18rem] p-3">
                          <button
                            ref={(element) => {
                              if (element)
                                userButtons.current.set(a.logto_sub, element)
                              else userButtons.current.delete(a.logto_sub)
                            }}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelected(a.logto_sub)
                            }}
                            className="block max-w-full cursor-pointer truncate text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                            aria-label={`View ${a.email ?? a.name ?? a.logto_sub}`}
                          >
                            {a.email ?? a.name ?? '—'}
                          </button>
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
                        <td
                          data-label="Plan"
                          className="p-3 text-base-content/70"
                        >
                          {planLabel(a)}
                        </td>
                        <td data-label="Widgets" className="p-3 tabular-nums">
                          {a.widgets}
                          {a.on_ticker > 0 && (
                            <span className="text-base-content/45">
                              {' '}
                              ({a.on_ticker} on bar)
                            </span>
                          )}
                        </td>
                        <td data-label="Tickets" className="p-3 tabular-nums">
                          {a.tickets}
                        </td>
                        <td
                          data-label="Signed up"
                          className="p-3 text-base-content/60"
                        >
                          {day(a.signed_up_at)}
                        </td>
                        <td
                          data-label="Last sign-in"
                          className="p-3 text-base-content/60"
                        >
                          {day(a.last_sign_in_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

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
                  onClick={() => updateSearch({ page: page - 1 })}
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
                  onClick={() => updateSearch({ page: page + 1 })}
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
