import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'

function getResolvedTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

// First-render snapshot guard.
//
// The prerendered HTML is always emitted with the dark variant because
// `getServerSnapshot` returns `'dark'`. On the client, the inline theme
// script in `__root.tsx` may flip `<html>` to light *before* React
// hydrates, so a naive `getResolvedTheme()` on the first client render
// would disagree with the SSR markup and trigger a hydration mismatch
// (React error #418) — visible as a Sun/Moon swap in `ThemeToggle`,
// and different image URLs in `ProductScreenshot`.
//
// We force the first client render to mirror SSR (`'dark'`), then flip
// to the real DOM-resolved theme inside `useEffect` on the next commit.
// React performs that follow-up render outside of hydration, so it
// applies cleanly without a warning. Users on light themes briefly see
// the dark assets for a single frame; this is the standard trade-off
// for SSR + client-only state and matches what other Start sites do.
let hasHydrated = false

function getStoredPreference(): Theme | null {
  if (typeof localStorage === 'undefined') return null
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return null
}

function applyTheme(theme: Theme) {
  const root = document.documentElement

  // Add transition class for smooth theme switching
  root.classList.add('theme-transition')

  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }

  // Update theme-color meta tag
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#141420' : '#ffffff')
  }

  // Remove transition class after animation completes
  setTimeout(() => {
    root.classList.remove('theme-transition')
  }, 350)
}

// External store for theme state (avoids re-render issues)
let listeners: Array<() => void> = []

function subscribe(listener: () => void) {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

export function useTheme() {
  // Track whether this hook instance has run its mount effect. Before
  // mount we hand back `'dark'` (the SSR snapshot) so the first render
  // matches the prerendered HTML byte-for-byte. After mount we read
  // from the external store like normal.
  const [mounted, setMounted] = useState(hasHydrated)
  useEffect(() => {
    hasHydrated = true
    setMounted(true)
  }, [])

  const storeTheme = useSyncExternalStore(
    subscribe,
    getResolvedTheme,
    () => 'dark',
  )
  const theme: Theme = mounted ? (storeTheme as Theme) : 'dark'

  const setTheme = useCallback((newTheme: Theme) => {
    localStorage.setItem(STORAGE_KEY, newTheme)
    applyTheme(newTheme)
    emitChange()
  }, [])

  const toggleTheme = useCallback(() => {
    const current = getResolvedTheme()
    setTheme(current === 'dark' ? 'light' : 'dark')
  }, [setTheme])

  // Listen for system preference changes (only when no explicit preference stored)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    function handleChange() {
      // Only follow system preference if user hasn't explicitly chosen
      if (!getStoredPreference()) {
        applyTheme(mq.matches ? 'dark' : 'light')
        emitChange()
      }
    }

    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  return { theme, setTheme, toggleTheme } as const
}
