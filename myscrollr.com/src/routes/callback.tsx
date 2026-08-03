import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useHandleSignInCallback } from '@logto/react'

export const Route = createFileRoute('/callback')({
  component: Callback,
})

function Callback() {
  const navigate = useNavigate()

  const { isLoading, error } = useHandleSignInCallback(() => {
    const returnTo = sessionStorage.getItem('scrollr:returnTo')
    sessionStorage.removeItem('scrollr:returnTo')
    navigate({ to: returnTo || '/account' })
  })

  // Show the error UI only when the callback exchange itself failed.
  if (error) {
    return (
      <div className="min-h-dvh text-base-content flex items-center justify-center font-mono">
        <div className="text-center space-y-4 max-w-md">
          <div className="h-12 w-12 rounded-full border-2 border-error flex items-center justify-center mx-auto mb-4">
            <span className="text-error-ink text-xl">!</span>
          </div>
          <p className="uppercase tracking-[0.2em] text-error-ink">
            Authentication Failed
          </p>
          <p className="text-xs text-base-muted">{error.message}</p>
          <button
            onClick={() => navigate({ to: '/' })}
            className="btn btn-primary btn-sm mt-4"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // Loading covers both the in-flight exchange (isLoading=true) and the
  // brief gap after success while `navigate()` is still being processed
  // by the router — previously this returned `null`, which rendered the
  // page as just header + footer with an empty body for ~1 frame to a
  // few hundred ms depending on how the route transition was scheduled.
  return (
    <div className="min-h-dvh text-base-content flex items-center justify-center font-mono">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4" />
        <p className="uppercase tracking-[0.2em] text-primary animate-pulse">
          {isLoading ? 'Establishing Secure Session...' : 'Redirecting...'}
        </p>
        <p className="text-[10px] opacity-40 uppercase">
          Redirecting to master control
        </p>
      </div>
    </div>
  )
}
