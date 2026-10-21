import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Search, Ticket, UserRound, X } from 'lucide-react'
import type { AccountsPage, SupportQueue } from '@/api/admin'
import { adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'

export function AdminQuickSearch() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(
    () => router.subscribe('onResolved', () => setOpen(false)),
    [router],
  )
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === 'k' &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        const panel = document.querySelector('dialog[open]')
        if (panel && !panel.classList.contains('admin-quick-search')) return
        event.preventDefault()
        panel?.querySelector('input')?.focus()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])

  return (
    <>
      <button
        type="button"
        className="admin-search-trigger"
        aria-label="Search users and tickets"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+k Meta+k"
        title="Search users and tickets (Ctrl / ⌘ K)"
        onClick={() => setOpen(true)}
      >
        <Search size={17} aria-hidden />
        <span>Search</span>
        <kbd>⌘ / Ctrl K</kbd>
      </button>
      {open && <QuickSearchDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function QuickSearchDialog({ onClose }: { onClose: () => void }) {
  const getToken = useGetToken()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [retry, setRetry] = useState(0)
  const query = text.trim().replace(/^#(?=\d+$)/, '')
  const ready = query.length >= 2 || /^\d+$/.test(query)
  const [result, setResult] = useState<{
    query: string
    users?: AccountsPage
    tickets?: SupportQueue
    usersFailed?: boolean
    ticketsFailed?: boolean
  }>({ query: '' })
  const current = result.query === query ? result : { query }

  useEffect(() => {
    const panel = dialog.current!
    panel.showModal()
    input.current?.focus()
    return () => panel.close()
  }, [])

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    const { signal } = controller
    setResult({ query })
    const timer = setTimeout(() => {
      void adminApi.accounts(getToken, query, 0, signal).then(
        (users) => {
          if (!signal.aborted) setResult((prev) => ({ ...prev, users }))
        },
        () => {
          if (!signal.aborted)
            setResult((prev) => ({ ...prev, usersFailed: true }))
        },
      )
      void adminApi
        .supportQueue(
          getToken,
          { q: query, rows: 'ticket', state: 'all' },
          signal,
        )
        .then(
          (tickets) => {
            if (!signal.aborted) setResult((prev) => ({ ...prev, tickets }))
          },
          () => {
            if (!signal.aborted)
              setResult((prev) => ({ ...prev, ticketsFailed: true }))
          },
        )
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [getToken, query, ready, retry])

  return (
    <dialog
      ref={dialog}
      className="admin-quick-search"
      aria-labelledby="admin-search-title"
      onClose={(event) => {
        if (!event.currentTarget.open) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const items = [
          input.current!,
          ...event.currentTarget.querySelectorAll<HTMLAnchorElement>(
            '[data-search-result]',
          ),
        ]
        const index = items.indexOf(document.activeElement as HTMLInputElement)
        if (index < 0) return
        event.preventDefault()
        items[
          (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) %
            items.length
        ]?.focus()
      }}
    >
      <div className="admin-search-panel">
        <header>
          <div>
            <h2 id="admin-search-title">Quick search</h2>
            <p>Jump to a user or support ticket.</p>
          </div>
          <button
            type="button"
            aria-label="Close search"
            onClick={() => dialog.current?.close()}
          >
            <X size={19} aria-hidden />
          </button>
        </header>
        <div className="admin-search-input">
          <Search size={19} aria-hidden />
          <input
            ref={input}
            type="text"
            role="searchbox"
            aria-label="Search users and tickets"
            aria-describedby="admin-search-hint"
            placeholder="Email, name, subject or ticket #"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            enterKeyHint="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {text && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setText('')
                input.current?.focus()
              }}
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
        <div className="admin-search-results">
          {!ready ? (
            <div className="admin-search-empty">
              <Search size={28} aria-hidden />
              <p>Find the person. Pick up the conversation.</p>
              <span id="admin-search-hint">
                Enter at least 2 characters, or a ticket number.
              </span>
            </div>
          ) : (
            <>
              <p id="admin-search-hint" className="sr-only">
                Use the arrow keys to move through results, then Enter to open.
              </p>
              {/^[0-9]{1,20}$/.test(query) && (
                <Link
                  to="/admin/support"
                  search={{
                    ticket: query,
                    rows: 'ticket',
                    resolved: true,
                    inbox: 'all',
                  }}
                  className="admin-search-result"
                  data-search-result
                >
                  <span>
                    <strong>Open ticket #{query}</strong>
                    <span>
                      Look up this exact ticket, including older cases
                    </span>
                  </span>
                  <ArrowUpRight size={16} aria-hidden />
                </Link>
              )}
              <section aria-labelledby="admin-search-users">
                <div className="admin-search-section-heading">
                  <h3 id="admin-search-users">
                    <UserRound size={15} aria-hidden /> Users
                  </h3>
                  {current.users && (
                    <Link to="/admin/users" search={{ q: query, page: 0 }}>
                      View all <ArrowUpRight size={14} aria-hidden />
                    </Link>
                  )}
                </div>
                <div role="status">
                  {current.usersFailed ? (
                    <p className="admin-search-message">
                      User search couldn’t load.
                    </p>
                  ) : !current.users ? (
                    <p className="admin-search-message">Searching users…</p>
                  ) : !current.users.accounts.length ? (
                    <p className="admin-search-message">No matching users.</p>
                  ) : null}
                  {current.users?.source === 'local' && (
                    <p className="admin-search-message">
                      Account directory unavailable. Showing local accounts
                      only.
                    </p>
                  )}
                </div>
                {current.users?.accounts.slice(0, 5).map((user) => (
                  <Link
                    key={user.logto_sub}
                    to="/admin/users"
                    search={{ user: user.logto_sub }}
                    className="admin-search-result"
                    data-search-result
                  >
                    <span>
                      <strong>
                        {user.name || user.email || 'Unnamed user'}
                      </strong>
                      <span>
                        {user.name
                          ? user.email || 'No email available'
                          : 'User account'}
                      </span>
                    </span>
                    <ArrowUpRight size={16} aria-hidden />
                  </Link>
                ))}
              </section>
              <section aria-labelledby="admin-search-tickets">
                {/* shortcut: queue search covers 500 recent cases; use a dedicated search API if the queue outgrows this. Exact ticket links bypass that cap. */}
                <div className="admin-search-section-heading">
                  <h3 id="admin-search-tickets">
                    <Ticket size={15} aria-hidden /> Recent tickets
                  </h3>
                  {current.tickets && (
                    <Link
                      to="/admin/support"
                      search={{
                        q: query,
                        rows: 'ticket',
                        resolved: true,
                        inbox: 'all',
                      }}
                    >
                      View all <ArrowUpRight size={14} aria-hidden />
                    </Link>
                  )}
                </div>
                <div role="status">
                  {current.ticketsFailed ? (
                    <p className="admin-search-message">
                      Ticket search couldn’t load.
                    </p>
                  ) : !current.tickets ? (
                    <p className="admin-search-message">Searching tickets…</p>
                  ) : !current.tickets.rows?.length ? (
                    <p className="admin-search-message">
                      No matches in the recent queue.
                    </p>
                  ) : null}
                </div>
                {current.tickets?.rows?.slice(0, 5).map((ticket) => (
                  <Link
                    key={ticket.ticket_number}
                    to="/admin/support"
                    search={{
                      ticket: ticket.ticket_number,
                      rows: 'ticket',
                      resolved: true,
                      inbox: 'all',
                    }}
                    className="admin-search-result"
                    data-search-result
                  >
                    <span>
                      <strong>{ticket.subject || 'Untitled ticket'}</strong>
                      <span>
                        #{ticket.ticket_number} ·{' '}
                        {ticket.name ||
                          ticket.user_email ||
                          'Requester unknown'}
                      </span>
                    </span>
                    <ArrowUpRight size={16} aria-hidden />
                  </Link>
                ))}
                <p className="admin-search-message">
                  Searches the latest 500 tickets. Enter a ticket number to open
                  an older case.
                </p>
              </section>
              {(current.usersFailed || current.ticketsFailed) && (
                <button
                  className="admin-search-retry"
                  type="button"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Retry search
                </button>
              )}
            </>
          )}
        </div>
        <footer>
          <span>↑ ↓ to navigate · Enter to open</span>
          <span>Esc to close</span>
        </footer>
      </div>
    </dialog>
  )
}
