import { ClientOnly, Link, useLocation } from '@tanstack/react-router'
import { LogOut, Menu, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { IdTokenClaims } from '@logto/react'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { ThemeToggle } from '@/components/ThemeToggle'

/**
 * Terminal-editorial nav (design_handoff_marketing_site/README.md):
 * wordmark + mono uppercase links, current page in emerald, emerald
 * DOWNLOAD ↓ button. Static (not fixed) — the persistent demo ticker
 * bar owns the "pinned above everything" story.
 *
 * Header is SSR-safe. Auth-dependent slices live inside the
 * <ClientOnly> children below (account link + auth menu, desktop and
 * mobile). The Header itself never calls `useScrollrAuth()`, so the
 * layout chrome prerenders correctly.
 */

const NAV_LINKS: Array<{ to: string; label: string }> = [
  { to: '/channels', label: 'WIDGETS' },
  { to: '/uplink', label: 'UPLINK' },
  { to: '/business', label: 'BUSINESS' },
]

export default function Header() {
  const [isOpen, setIsOpen] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  // Close drawer on Escape and return focus to the menu button
  const closeDrawer = useCallback(() => {
    setIsOpen(false)
    requestAnimationFrame(() => menuButtonRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeDrawer()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeDrawer])

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => drawerRef.current?.focus())
    }
  }, [isOpen])

  return (
    <>
      <header className="relative z-30 flex h-[60px] items-center justify-between border-b border-hairline bg-base-75 px-5 sm:px-8">
        <Wordmark />

        {/* Desktop navigation */}
        <nav className="hidden items-center gap-8 font-mono text-xs tracking-[0.08em] lg:flex">
          {NAV_LINKS.map((l) => (
            <NavLink key={l.to} to={l.to}>
              {l.label}
            </NavLink>
          ))}
          <a
            href="https://github.com/brandon-relentnet/myscrollr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-base-content/55 transition-colors hover:text-base-content hover:opacity-100"
          >
            GITHUB
          </a>
          <ClientOnly>
            <DesktopAccountLink />
          </ClientOnly>
          <Link
            to="/download"
            className="rounded-[4px] bg-primary px-[18px] py-2 font-semibold text-primary-content transition-colors hover:bg-[#6ee7b7] hover:text-primary-content hover:opacity-100"
          >
            DOWNLOAD ↓
          </Link>
          <ThemeToggle />
          <ClientOnly>
            <DesktopAuthMenu />
          </ClientOnly>
        </nav>

        {/* Mobile: theme + menu button */}
        <div className="flex items-center gap-2 lg:hidden">
          <ThemeToggle />
          <button
            ref={menuButtonRef}
            onClick={() => setIsOpen(true)}
            className="flex cursor-pointer items-center justify-center rounded-[4px] border border-hairline p-2.5 transition-colors hover:border-primary/40"
            aria-label="Open menu"
            aria-expanded={isOpen}
            aria-controls="mobile-nav-drawer"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={closeDrawer}
              className="pointer-events-auto fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
              aria-hidden="true"
            />

            <motion.aside
              ref={drawerRef}
              id="mobile-nav-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Mobile navigation"
              tabIndex={-1}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 z-50 flex h-full w-72 flex-col border-l border-hairline bg-base-75 lg:hidden"
            >
              <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
                <Wordmark />
                <button
                  onClick={closeDrawer}
                  className="cursor-pointer rounded-[4px] p-2 transition-colors hover:bg-base-200"
                  aria-label="Close menu"
                >
                  <X size={18} />
                </button>
              </div>

              <nav className="flex-1 space-y-1 px-4 py-6 font-mono text-sm tracking-[0.08em]">
                <MobileNavLink to="/" onClick={closeDrawer}>
                  HOME
                </MobileNavLink>
                {NAV_LINKS.map((l) => (
                  <MobileNavLink key={l.to} to={l.to} onClick={closeDrawer}>
                    {l.label}
                  </MobileNavLink>
                ))}
                <a
                  href="https://github.com/brandon-relentnet/myscrollr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-[4px] px-4 py-3 text-base-content/55 transition-colors hover:bg-base-200 hover:text-base-content hover:opacity-100"
                >
                  GITHUB ↗
                </a>
                <MobileNavLink to="/download" onClick={closeDrawer}>
                  <span className="text-primary">DOWNLOAD ↓</span>
                </MobileNavLink>
                <ClientOnly>
                  <MobileAccountLink onNavigate={closeDrawer} />
                </ClientOnly>
              </nav>

              <div className="border-t border-hairline px-5 py-5">
                <ClientOnly>
                  <MobileAuthMenu onAfterAction={closeDrawer} />
                </ClientOnly>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

function Wordmark() {
  return (
    <Link
      to="/"
      className="flex items-baseline text-xl font-extrabold tracking-[-0.02em] text-base-content hover:text-base-content hover:opacity-100"
      aria-label="Scrollr home"
    >
      scrollr
      <span className="text-primary">.</span>
    </Link>
  )
}

// ── Auth-dependent slices ────────────────────────────────────────────
// Each of these calls `useScrollrAuth()` and therefore must render
// only on the client (wrapped in <ClientOnly> at the call site).

function useUserClaims(): IdTokenClaims | undefined {
  const { isAuthenticated, getIdTokenClaims } = useScrollrAuth()
  const [userClaims, setUserClaims] = useState<IdTokenClaims>()

  useEffect(() => {
    if (isAuthenticated) {
      getIdTokenClaims().then(setUserClaims)
    } else {
      setUserClaims(undefined)
    }
  }, [isAuthenticated, getIdTokenClaims])

  return userClaims
}

function DesktopAccountLink() {
  const { isAuthenticated } = useScrollrAuth()
  const userClaims = useUserClaims()

  if (!isAuthenticated) return null

  return (
    <NavLink to="/account">
      {(userClaims?.username || userClaims?.name || 'ACCOUNT').toUpperCase()}
    </NavLink>
  )
}

function DesktopAuthMenu() {
  const { signIn, signOut, isAuthenticated, isLoading } = useScrollrAuth()

  if (isLoading) {
    return <span className="h-2 w-2 animate-pulse rounded-full bg-primary/40" />
  }

  if (isAuthenticated) {
    return (
      <button
        onClick={() => signOut(`${window.location.origin}`)}
        className="flex cursor-pointer items-center gap-2 rounded-[4px] border border-hairline px-3 py-2 text-base-content/55 transition-colors hover:border-error/50 hover:text-error"
        aria-label="Sign out"
      >
        <LogOut size={13} />
      </button>
    )
  }

  return (
    <button
      onClick={() => signIn()}
      className="cursor-pointer rounded-[4px] border border-hairline px-[14px] py-2 text-base-content/70 transition-colors hover:border-primary hover:text-primary"
    >
      SIGN IN
    </button>
  )
}

function MobileAccountLink({ onNavigate }: { onNavigate: () => void }) {
  const { isAuthenticated } = useScrollrAuth()
  const userClaims = useUserClaims()

  if (!isAuthenticated) return null

  return (
    <MobileNavLink to="/account" onClick={onNavigate}>
      {(userClaims?.username || userClaims?.name || 'ACCOUNT').toUpperCase()}
    </MobileNavLink>
  )
}

function MobileAuthMenu({ onAfterAction }: { onAfterAction: () => void }) {
  const { signIn, signOut, isAuthenticated, isLoading } = useScrollrAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-3">
        <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        <span className="font-mono text-xs text-base-content/40">LOADING…</span>
      </div>
    )
  }

  if (isAuthenticated) {
    return (
      <button
        onClick={() => {
          signOut(`${window.location.origin}`)
          onAfterAction()
        }}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[4px] border border-error/30 px-5 py-3 font-mono text-sm tracking-[0.08em] text-error/80 transition-colors hover:bg-error/10"
      >
        <LogOut size={14} />
        SIGN OUT
      </button>
    )
  }

  return (
    <button
      onClick={() => {
        signIn()
        onAfterAction()
      }}
      className="w-full cursor-pointer rounded-[4px] border border-hairline px-5 py-3 font-mono text-sm tracking-[0.08em] text-base-content/70 transition-colors hover:border-primary hover:text-primary"
    >
      SIGN IN
    </button>
  )
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation()
  const isActive =
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

  return (
    <Link
      to={to}
      className={`transition-colors hover:opacity-100 ${
        isActive
          ? 'text-primary'
          : 'text-base-content/55 hover:text-base-content'
      }`}
    >
      {children}
    </Link>
  )
}

function MobileNavLink({
  to,
  children,
  onClick,
}: {
  to: string
  children: React.ReactNode
  onClick?: () => void
}) {
  const location = useLocation()
  const isActive =
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`block rounded-[4px] px-4 py-3 transition-colors hover:bg-base-200 hover:opacity-100 ${
        isActive ? 'text-primary' : 'text-base-content/70'
      }`}
    >
      {children}
    </Link>
  )
}
