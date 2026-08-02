import { ClientOnly, Link, useLocation } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { IdTokenClaims } from '@logto/react'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useDemoTicker } from '@/hooks/useDemoTicker'
import ScrollrSVG from '@/components/ScrollrSVG'

/**
 * Terminal-editorial nav (design_handoff_marketing_site/README.md):
 * wordmark + mono uppercase links, current page in emerald, emerald
 * DOWNLOAD ↓ button. Sticky — scrolls with the page. When the demo
 * ticker bar is pinned top the header offsets to sit beneath it; the
 * bar keeps the "pinned above everything" story (bar z-50 > header
 * z-40).
 *
 * Header is SSR-safe. Auth-dependent slices live inside the
 * <ClientOnly> children below (account link + auth menu, desktop and
 * mobile). The Header itself never calls `useScrollrAuth()`, so the
 * layout chrome prerenders correctly.
 */

const NAV_LINKS: Array<{ to: string; label: string }> = [
  { to: '/', label: 'HOME' },
  { to: '/widgets', label: 'WIDGETS' },
  { to: '/uplink', label: 'UPLINK' },
  { to: '/business', label: 'BUSINESS' },
]

export default function Header({
  barMode = 'none',
}: {
  /**
   * Which fixed bar the sticky header and drawer must dodge:
   * 'store' = the shared demo ticker bar (position/density from the
   * store), 'fixed-bottom' = /business's always-bottom compact
   * white-label bar, 'none' = bar-less routes.
   */
  barMode?: 'store' | 'fixed-bottom' | 'none'
}) {
  const [isOpen, setIsOpen] = useState(false)
  // Sticky offset: when the demo bar is pinned top, the header slots
  // in directly beneath it — the bar stays "on top of everything".
  // Bar height tracks density (h-12 compact / h-16 detailed).
  const { pos, density } = useDemoTicker()
  const barTopInset = density === 'detailed' ? 'top-16' : 'top-12'
  const barBottomInset = density === 'detailed' ? 'bottom-16' : 'bottom-12'
  const stickyTop = barMode === 'store' && pos === 'top' ? barTopInset : 'top-0'
  // The mobile drawer and the bar are both z-50 with the bar later in
  // the DOM, so the bar paints on top — inset the drawer on the bar's
  // edge so its header row / DOWNLOAD footer never sit underneath it.
  const drawerInsets =
    barMode === 'none'
      ? 'top-0 bottom-0'
      : barMode === 'fixed-bottom'
        ? 'top-0 bottom-12'
        : pos === 'top'
          ? `${barTopInset} bottom-0`
          : `top-0 ${barBottomInset}`
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
      <header
        className={`sticky z-40 flex h-[60px] items-center justify-between border-b border-hairline bg-base-75/85 backdrop-blur-xl px-5 sm:px-8 ${stickyTop}`}
      >
        <Wordmark />

        {/* Desktop navigation */}
        <nav className="hidden items-center gap-8 font-mono text-xs tracking-[0.08em] lg:flex">
          {NAV_LINKS.map((l) => (
            <NavLink key={l.to} to={l.to}>
              {l.label}
            </NavLink>
          ))}
          <ClientOnly>
            <DesktopAccountLink />
          </ClientOnly>
          <ThemeToggle />
          {/* Download owns the corner */}
          <Link
            to="/download"
            className="rounded-[4px] bg-primary px-[18px] py-2 font-semibold text-primary-content transition-colors hover:bg-[#6ee7b7] hover:text-primary-content hover:opacity-100"
          >
            DOWNLOAD ↓
          </Link>
        </nav>

        {/* Mobile: theme + menu button */}
        <div className="flex items-center gap-2 lg:hidden">
          {/* 40px tap target on phones, matching the hamburger */}
          <ThemeToggle className="max-lg:h-10 max-lg:w-10" />
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
              className={`fixed right-0 z-50 flex w-72 flex-col border-l border-hairline bg-base-75 lg:hidden ${drawerInsets}`}
            >
              <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
                <Wordmark />
                <button
                  onClick={closeDrawer}
                  className="flex cursor-pointer items-center justify-center rounded-[4px] border border-hairline p-2.5 transition-colors hover:border-primary/40"
                  aria-label="Close menu"
                >
                  <X size={18} />
                </button>
              </div>

              <nav className="flex-1 space-y-1 px-4 py-6 font-mono text-sm tracking-[0.08em]">
                {NAV_LINKS.map((l) => (
                  <MobileNavLink key={l.to} to={l.to} onClick={closeDrawer}>
                    {l.label}
                  </MobileNavLink>
                ))}
                <ClientOnly>
                  <MobileAccountLink onNavigate={closeDrawer} />
                </ClientOnly>
              </nav>

              {/* Download is the one action that matters here */}
              <div className="border-t border-hairline px-5 py-5">
                <Link
                  to="/download"
                  onClick={closeDrawer}
                  className="block rounded-[4px] bg-primary py-3 text-center font-mono text-sm font-bold tracking-[0.08em] text-primary-content hover:text-primary-content hover:opacity-100"
                >
                  DOWNLOAD ↓
                </Link>
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
      className="group flex items-center gap-2.5 text-xl font-extrabold tracking-[-0.02em] text-base-content hover:text-base-content hover:opacity-100"
      aria-label="Scrollr home"
    >
      <ScrollrSVG
        width={26}
        height={26}
        className="transition-transform duration-150 group-hover:scale-105"
      />
      <span className="flex items-baseline">
        scrollr
        <span className="text-primary">.</span>
      </span>
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
