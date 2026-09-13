import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import ScrollrSVG from '@/components/ScrollrSVG'
import { AdminApiError, adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'

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

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-24 text-center">
      {children}
    </div>
  )
}

export default function AdminShell() {
  const { isAuthenticated, isLoading, signIn } = useScrollrAuth()
  const getToken = useGetToken()
  const [gate, setGate] = useState<GateState>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      setGate({ kind: 'signed-out' })
      return
    }
    let cancelled = false
    setGate({ kind: 'checking' })
    adminApi
      .me(getToken)
      .then((res) => {
        if (!cancelled) setGate({ kind: 'allowed', email: res.email })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // 403 is not a failure — it is the answer for everyone who is not
        // staff, and it gets the plain page rather than an error page.
        if (err instanceof AdminApiError && err.status === 403) {
          setGate({ kind: 'denied' })
          return
        }
        if (err instanceof AdminApiError && err.status === 401) {
          setGate({ kind: 'signed-out' })
          return
        }
        setGate({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Could not reach the API',
        })
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, getToken, attempt])

  if (isLoading || gate.kind === 'checking') {
    return (
      <Centered>
        <Loader2 className="size-6 animate-spin text-base-content/40" />
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
          onClick={() => signIn('/admin')}
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

  return <AdminChrome email={gate.email}>{<Outlet />}</AdminChrome>
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
  const links = SECTIONS.map(({ to, label, ...rest }) => {
    const exact = 'exact' in rest && rest.exact
    const active = exact
      ? location.pathname === '/admin' || location.pathname === '/admin/'
      : location.pathname.startsWith(to)
    return { to, label, active }
  })

  return (
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
        <nav className="hidden min-w-0 flex-1 md:block">
          <ul className="flex items-center gap-0.5">
            {links.map(({ to, label, active }) => (
              <li key={to}>
                <Link
                  to={to}
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
          <span
            className="hidden max-w-[18rem] truncate text-xs text-base-content/45 sm:block"
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
  )
}
