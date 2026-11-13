import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useHandleSignInCallback } from '@logto/react'
import { useEffect, useRef, useState } from 'react'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { seo } from '@/lib/seo'

// How long a callback may sit with nothing in flight before we say so.
const STALL_MS = 5000

export const Route = createFileRoute('/callback')({
  head: () =>
    seo({
      title: 'Signing In | Scrollr',
      description: 'Completing your secure Scrollr sign-in.',
      path: '/callback',
      noindex: true,
    }),
  component: Callback,
})

function Callback() {
  const navigate = useNavigate()
  const { signIn } = useScrollrAuth()
  const [stalled, setStalled] = useState(false)

  // The hook's success callback and the authenticated effect below can both
  // fire on one sign-in; the second would find returnTo already gone.
  const went = useRef(false)
  const goOn = () => {
    if (went.current) return
    went.current = true
    const returnTo = sessionStorage.getItem('scrollr:returnTo')
    sessionStorage.removeItem('scrollr:returnTo')
    navigate({ to: returnTo || '/account' })
  }

  const { isLoading, isAuthenticated, error } = useHandleSignInCallback(goOn)

  // The hook does nothing when this page is opened without a sign-in in
  // flight (a refresh, the back button, a second tab): no error, no
  // redirect. Signed in already means we are done; otherwise give it a few
  // seconds and then stop pretending.
  useEffect(() => {
    if (isAuthenticated && !isLoading) goOn()
  }, [isAuthenticated, isLoading])

  useEffect(() => {
    const t = setTimeout(() => setStalled(true), STALL_MS)
    return () => clearTimeout(t)
  }, [])

  if (error || (stalled && !isLoading && !isAuthenticated)) {
    return (
      <div className="min-h-dvh text-base-content flex items-center justify-center px-6 font-mono">
        <div className="text-center space-y-4 max-w-md">
          <div className="h-12 w-12 rounded-full border-2 border-error flex items-center justify-center mx-auto mb-4">
            <span className="text-error text-xl">!</span>
          </div>
          <h1 className="uppercase tracking-[0.2em] text-error">
            {error ? 'Sign-in failed' : 'Sign-in did not finish'}
          </h1>
          <p className="text-xs text-base-content/60 [overflow-wrap:anywhere]">
            {error
              ? 'Something went wrong while signing you in. Nothing was changed on your account.'
              : 'There is no sign-in in progress on this page. Start again, or head back to the site.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => signIn()}
              className="btn btn-primary btn-sm"
            >
              Sign in again
            </button>
            <Link to="/" className="btn btn-outline btn-sm">
              Go home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // In-flight exchange (isLoading), or the brief gap after success while
  // `navigate()` is still being processed by the router.
  return (
    <div className="min-h-dvh text-base-content flex items-center justify-center font-mono">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4" />
        <h1 className="uppercase tracking-[0.2em] text-primary animate-pulse">
          {isLoading ? 'Establishing Secure Session...' : 'Redirecting...'}
        </h1>
        <p className="text-[10px] opacity-40 uppercase">
          Redirecting to master control
        </p>
      </div>
    </div>
  )
}
