/**
 * A deploy replaces the hashed script files a tab was built against. A tab
 * that predates the deploy then asks for files that no longer exist the next
 * time it loads a route's code, and Vite reports it as `vite:preloadError`.
 * Reloading picks up the new build. The flag keeps it to one reload: if the
 * reload did not help, the error goes to the error page instead of looping.
 */
const FLAG = 'scrollr:reloaded-for-new-build'

/** How long a page must stay up before a later stale build may reload again. */
const CLEAR_AFTER_MS = 10_000

interface Deps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  reload: () => void
}

/** Handle one `vite:preloadError`. Returns true when it reloaded. */
export function reloadOnceForStaleBuild(event: Event, deps: Deps): boolean {
  try {
    if (deps.storage.getItem(FLAG)) return false
    deps.storage.setItem(FLAG, '1')
  } catch {
    // No session storage (blocked): without the flag a reload could loop.
    return false
  }
  event.preventDefault()
  deps.reload()
  return true
}

export function installStaleBuildReload(): void {
  if (typeof window === 'undefined') return
  const deps: Deps = {
    storage: window.sessionStorage,
    reload: () => window.location.reload(),
  }
  window.addEventListener('vite:preloadError', (event) => {
    reloadOnceForStaleBuild(event, deps)
  })
  // This page loaded its code fine, so a stale build later in the same tab
  // (another deploy) may reload again.
  window.setTimeout(() => {
    try {
      deps.storage.removeItem(FLAG)
    } catch {
      /* no session storage */
    }
  }, CLEAR_AFTER_MS)
}
