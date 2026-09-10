import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  BarChart3,
  Layers,
  LifeBuoy,
  Loader2,
  Lock,
  ShieldCheck,
  Users,
} from 'lucide-react'
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
  { to: '/admin', label: 'Overview', Icon: BarChart3, exact: true },
  { to: '/admin/support', label: 'Support', Icon: LifeBuoy },
  { to: '/admin/versions', label: 'Versions', Icon: Layers },
  { to: '/admin/users', label: 'Users', Icon: Users },
  { to: '/admin/admins', label: 'Admins', Icon: ShieldCheck },
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

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      setGate({ kind: 'signed-out' })
      return
    }
    let cancelled = false
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
        setGate({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Could not reach the API',
        })
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, getToken])

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
  children,
}: {
  email: string
  children: React.ReactNode
}) {
  const location = useLocation()
  return (
    /* Wide enough for the Support console's two panes to sit as drawn at
       1440, and capped so an ultrawide gives the extra width to margin
       instead of stretching a line of prose across 3440 pixels. The reading
       measure inside each pane is capped again, at 75ch, where it matters. */
    <div className="mx-auto flex w-full max-w-[104rem] flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:gap-6 lg:py-10 xl:gap-10">
      {/* Under 768px the nav is a scrolling row of full labels. From 768 to
          1279 it collapses to an icon rail, which is where the width has to
          come from for the queue and the case to stay side by side. From 1280
          the labels come back. */}
      <nav className="md:w-14 md:shrink-0 xl:w-52">
        <p className="px-3 text-xs font-semibold tracking-wide text-base-content/40 uppercase md:hidden xl:block">
          Staff
        </p>
        <p
          className="mt-1 truncate px-3 text-xs text-base-content/60 md:hidden xl:block"
          title={email}
        >
          {email}
        </p>
        <ul className="flex gap-1 overflow-x-auto md:mt-0 md:flex-col md:overflow-visible xl:mt-4">
          {SECTIONS.map(({ to, label, Icon, ...rest }) => {
            const exact = 'exact' in rest && rest.exact
            const active = exact
              ? location.pathname === '/admin' ||
                location.pathname === '/admin/'
              : location.pathname.startsWith(to)
            return (
              <li key={to}>
                <Link
                  to={to}
                  title={label}
                  aria-label={label}
                  className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors md:justify-center md:px-0 xl:justify-start xl:px-3 ${
                    active
                      ? 'bg-base-200 text-base-content'
                      : 'text-base-content/60 hover:bg-base-200/60 hover:text-base-content'
                  }`}
                >
                  <Icon size={16} strokeWidth={2} className="shrink-0" />
                  <span className="md:hidden xl:inline">{label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
