import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { createContext, useContext, useEffect, useState } from 'react'
import { Loader2, Lock, Moon, Sun } from 'lucide-react'
import ScrollrSVG from '@/components/ScrollrSVG'
import { AdminApiError, adminApi } from '@/api/admin'
import { ADMIN_SESSION_EXPIRED } from '@/api/adminRequest'
import { useGetToken } from '@/hooks/useGetToken'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { useTheme } from '@/hooks/useTheme'

/**
 * The staff console shell: one gate, one nav, one Outlet.
 *
 * The gate is a single `GET /admin/me`. The server has already decided by the
 * time it answers, so the client never reasons about tiers or roles — it only
 * reports what the API said. A non-admin gets a plain "staff only" page,
 * which is a correct outcome rather than a broken one.
 */

const SECTIONS = [
  { to: '/admin', label: 'Overview', exact: true },
  { to: '/admin/analytics', label: 'Analytics' },
  { to: '/admin/support', label: 'Support' },
  { to: '/admin/versions', label: 'Versions' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/admins', label: 'Admins' },
  { to: '/admin/settings', label: 'Settings' },
] as const

type GateState =
  | { kind: 'checking' }
  | { kind: 'allowed'; email: string }
  | { kind: 'denied' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }

const MEMO_KEY = 'scrollr:admin-gate'

/**
 * "This account was allowed earlier this browser session", as `sub|email`.
 * sessionStorage, never localStorage: it dies with the tab, and it is read
 * only inside an effect so the first client render matches the shared
 * _shell.html. It buys speed, not security.
 */
function readMemo(sub: string): string | null {
  try {
    const raw = sessionStorage.getItem(MEMO_KEY)
    if (!raw?.startsWith(sub + '|')) return null
    return raw.slice(sub.length + 1) || null
  } catch {
    return null
  }
}

function writeMemo(sub: string, email: string) {
  try {
    sessionStorage.setItem(MEMO_KEY, `${sub}|${email}`)
  } catch {
    // Private mode: the gate just behaves as it did before the memo.
  }
}

function clearMemo() {
  try {
    sessionStorage.removeItem(MEMO_KEY)
  } catch {
    // Nothing to clear.
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-24 text-center">
      {children}
    </div>
  )
}

export default function AdminShell() {
  const location = useLocation()
  const { isAuthenticated, isLoading, signIn, getIdTokenClaims } =
    useScrollrAuth()
  const getToken = useGetToken()
  const [gate, setGate] = useState<GateState>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)
  const [sessionExpired, setSessionExpired] = useState(false)

  useEffect(() => {
    const expired = () => {
      clearMemo()
      setSessionExpired(true)
    }
    window.addEventListener(ADMIN_SESSION_EXPIRED, expired)
    return () => window.removeEventListener(ADMIN_SESSION_EXPIRED, expired)
  }, [])

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      setGate({ kind: 'signed-out' })
      return
    }
    let cancelled = false
    const controller = new AbortController()
    let settled = false
    // Staying 'allowed' while a re-check runs keeps the page mounted, and its
    // data requests flying, on every navigation after the first.
    setGate((g) => (g.kind === 'allowed' ? g : { kind: 'checking' }))
    // The id token is cached locally, so this costs no round trip. It runs
    // beside /admin/me, not before it; a memo hit only renders the chrome
    // early, the server still decides every request.
    const subPromise = getIdTokenClaims()
      .then((claims) => claims?.sub)
      .catch(() => undefined)
    void subPromise.then((sub) => {
      const email = sub ? readMemo(sub) : null
      if (!cancelled && !settled && email) setGate({ kind: 'allowed', email })
    })
    adminApi
      .me(getToken, controller.signal)
      .then((res) => {
        settled = true
        if (cancelled) return
        setGate({ kind: 'allowed', email: res.email })
        void subPromise.then((sub) => {
          if (!cancelled && sub) writeMemo(sub, res.email)
        })
      })
      .catch((err: unknown) => {
        settled = true
        if (cancelled) return
        // 403 is not a failure — it is the answer for everyone who is not
        // staff, and it gets the plain page rather than an error page.
        if (err instanceof AdminApiError && err.status === 403) {
          clearMemo()
          setGate({ kind: 'denied' })
          return
        }
        if (err instanceof AdminApiError && err.status === 401) {
          clearMemo()
          setGate({ kind: 'signed-out' })
          return
        }
        // An unreachable API must not evict a page that is already showing.
        setGate((g) =>
          g.kind === 'allowed'
            ? g
            : {
                kind: 'error',
                message:
                  err instanceof Error
                    ? err.message
                    : 'Could not reach the API',
              },
        )
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [isAuthenticated, isLoading, getToken, getIdTokenClaims, attempt])

  if (isLoading || gate.kind === 'checking') {
    return (
      <Centered>
        <Loader2
          role="status"
          aria-label="Checking staff access"
          className="size-6 animate-spin text-base-content/40"
        />
      </Centered>
    )
  }

  if (gate.kind === 'signed-out') {
    return (
      <Centered>
        <Lock className="size-8 text-base-content/30" />
        <h1 className="mt-4 text-2xl font-bold">Sign in to continue</h1>
        <p className="mt-2 max-w-sm text-sm text-base-content/60">
          The Scrollr staff console is only available to signed-in staff
          accounts.
        </p>
        <button
          type="button"
          onClick={() => signIn(location.href)}
          className="mt-6 cursor-pointer rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content transition-[filter] hover:brightness-110"
        >
          Sign in
        </button>
      </Centered>
    )
  }

  if (gate.kind === 'denied') {
    return (
      <Centered>
        <Lock className="size-8 text-base-content/30" />
        <h1 className="mt-4 text-2xl font-bold">Staff only</h1>
        <p className="mt-2 max-w-md text-sm text-base-content/60">
          This area is limited to the Scrollr admin list. If you think you
          should have access, ask an existing admin to add your account.
        </p>
        <Link
          to="/account"
          className="mt-6 rounded-lg px-5 py-2.5 text-sm font-semibold ring-1 ring-base-300 transition-colors hover:bg-base-200"
        >
          Back to your account
        </Link>
      </Centered>
    )
  }

  if (gate.kind === 'error') {
    return (
      <Centered>
        <h1 className="text-2xl font-bold">Could not check access</h1>
        <p className="mt-2 max-w-md text-sm text-base-content/60">
          {gate.message}
        </p>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="mt-6 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content"
        >
          Retry access check
        </button>
      </Centered>
    )
  }

  return (
    <AdminChrome email={gate.email}>
      {sessionExpired && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-5 py-3 text-sm"
        >
          <p>
            Your staff session expired. Sign in again to load current data or
            make changes.
          </p>
          <button
            type="button"
            className="cursor-pointer rounded-lg bg-primary px-3 py-2 font-semibold text-primary-content"
            onClick={() => signIn(location.href)}
          >
            Sign in again
          </button>
        </div>
      )}
      <Outlet />
    </AdminChrome>
  )
}

/**
 * The bar's status slot, reachable from the page inside the Outlet.
 *
 * Support's live-stream and auto-send state belong in the bar (SCROLLR-219)
 * but are known only to the page, which renders two levels down. The page
 * hands its node up through this; `status` stays a prop so the chrome can
 * still be rendered with a filled bar and no page at all.
 */
const StatusSlot = createContext<(node: React.ReactNode) => void>(() => {})

/**
 * Fill the console bar's status slot from a page.
 *
 * `node` MUST be memoised on the values it renders — an element rebuilt every
 * render would set state every render, and the shell would re-render forever.
 */
export function useAdminStatus(node: React.ReactNode) {
  const fill = useContext(StatusSlot)
  useEffect(() => {
    fill(node)
    return () => fill(null)
  }, [fill, node])
}

/**
 * The console's chrome: the container, the nav and the slot.
 *
 * Split out from the gate so it can be rendered without one — the Support
 * console cannot be signed into from a development machine, and the only
 * honest way to check its layout at four widths is to render the real chrome
 * around the real page.
 */
export function AdminChrome({
  email,
  status,
  children,
}: {
  email: string
  /** Right-hand slot on the bar. Support fills it in SCROLLR-219. */
  status?: React.ReactNode
  children: React.ReactNode
}) {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const [slot, setSlot] = useState<React.ReactNode>(null)
  const links = SECTIONS.map(({ to, label, ...rest }) => {
    const exact = 'exact' in rest && rest.exact
    const active = exact
      ? location.pathname === '/admin' || location.pathname === '/admin/'
      : location.pathname.startsWith(to)
    return { to, label, active }
  })

  return (
    <StatusSlot.Provider value={setSlot}>
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b border-hairline bg-base-75 px-4">
          <Link
            to="/admin"
            className="flex shrink-0 items-center gap-2 text-[15px] font-extrabold tracking-[-0.02em] text-base-content hover:text-base-content hover:opacity-100"
          >
            <ScrollrSVG width={20} height={20} />
            <span className="flex items-baseline">
              scrollr<span className="text-primary">.</span>
            </span>
            <span className="ml-1 text-[13px] font-medium text-base-content/45">
              / admin
            </span>
          </Link>

          {/* From 768 the sections sit in the bar. Below it they get their own
            scrolling row underneath, where a tap target can be 44px tall. */}
          <nav className="hidden min-w-0 flex-1 overflow-hidden md:block">
            {/* The bar now also carries a page's status pills (SCROLLR-219).
                Between 768 and the width where everything fits, the sections
                scroll inside their share of the bar; overflow visible let
                them run under the pills instead. */}
            <ul className="flex items-center gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
              {links.map(({ to, label, active }) => (
                <li key={to}>
                  <Link
                    to={to}
                    aria-current={active ? 'page' : undefined}
                    className={`rounded-lg px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-base-200 text-base-content'
                        : 'text-base-content/60 hover:bg-base-200/60 hover:text-base-content'
                    }`}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-4 md:ml-0">
            {status}
            {slot}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              title={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-base-content/60 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <span
              /* From lg, not sm: the bar now also carries a page's status
               pills (SCROLLR-219), and who you are signed in as is the
               least urgent thing on it. */
              className="hidden max-w-[18rem] truncate text-xs text-base-content/45 lg:block"
              title={email}
            >
              {email}
            </span>
            <Link
              to="/"
              className="text-xs font-semibold whitespace-nowrap text-base-content/60 hover:text-base-content"
            >
              Back to site
            </Link>
          </div>
        </header>

        <nav className="shrink-0 border-b border-hairline bg-base-75 md:hidden">
          <ul className="flex gap-0.5 overflow-x-auto px-2">
            {links.map(({ to, label, active }) => (
              <li key={to}>
                <Link
                  to={to}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                    active
                      ? 'text-base-content'
                      : 'text-base-content/60 hover:text-base-content'
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Full-bleed. Each page brings its own PageFrame if it wants a cap. */}
        <main className="min-h-[calc(100dvh-48px)] min-w-0 flex-1">
          {children}
        </main>
      </div>
    </StatusSlot.Provider>
  )
}
