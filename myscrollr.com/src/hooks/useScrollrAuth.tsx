/**
 * Auth wrapper around @logto/react.
 * Provides authentication state and token access for the marketing website.
 */

import { createContext, useCallback, useContext, useRef } from 'react'
import { useLogto } from '@logto/react'
import type { ReactNode } from 'react'
import type { IdTokenClaims } from '@logto/react'
import { beginWebsiteSignupFlow } from '@/lib/posthog'

// ── Context shape ─────────────────────────────────────────────────

interface ScrollrAuthContextValue {
  /** True if authenticated via Logto SDK. */
  isAuthenticated: boolean
  /** True only while the Logto SDK is initialising. */
  isLoading: boolean
  /** Initiate Logto sign-in redirect. Optionally pass a path to return to after auth. */
  signIn: (returnTo?: string) => void
  /** Sign out via Logto. */
  signOut: (postLogoutRedirectUri: string) => void
  /** Returns an access token from Logto. */
  getAccessToken: (resource?: string) => Promise<string | null>
  /** Returns ID token claims from Logto. */
  getIdTokenClaims: () => Promise<IdTokenClaims | undefined>
}

const ScrollrAuthContext = createContext<ScrollrAuthContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────

const API_RESOURCE =
  import.meta.env.VITE_LOGTO_RESOURCE || import.meta.env.VITE_API_URL || ''

export function ScrollrAuthProvider({ children }: { children: ReactNode }) {
  const logto = useLogto()

  // Ref to avoid stale closures — the logto context object gets new
  // references on every internal state change, so we store it in a ref
  // so callbacks below have stable identities.
  const logtoRef = useRef(logto)
  logtoRef.current = logto

  // ── Methods ───────────────────────────────────────────────────

  const signIn = useCallback((returnTo?: string) => {
    beginWebsiteSignupFlow()
    // Store the intended destination so the callback route can redirect
    // back after authentication. Falls back to /account if not set.
    if (returnTo) {
      sessionStorage.setItem('scrollr:returnTo', returnTo)
    }
    const callbackUrl = `${window.location.origin}/callback`
    void logtoRef.current.signIn(callbackUrl).catch((error: unknown) => {
      if (import.meta.env.DEV) {
        console.error('Logto sign-in failed', error)
      }
    })
  }, [])

  const signOut = useCallback((postLogoutRedirectUri: string) => {
    void logtoRef.current
      .signOut(postLogoutRedirectUri)
      .catch((error: unknown) => {
        if (import.meta.env.DEV) {
          console.error('Logto sign-out failed', error)
        }
      })
  }, [])

  const getAccessToken = useCallback(
    async (resource?: string): Promise<string | null> => {
      if (logtoRef.current.isAuthenticated) {
        const token = await logtoRef.current.getAccessToken(
          resource || API_RESOURCE,
        )
        return token ?? null
      }
      return null
    },
    [],
  )

  const getIdTokenClaims = useCallback(async (): Promise<
    IdTokenClaims | undefined
  > => {
    if (logtoRef.current.isAuthenticated) {
      return logtoRef.current.getIdTokenClaims()
    }
    return undefined
  }, [])

  // ── Render ────────────────────────────────────────────────────

  const value: ScrollrAuthContextValue = {
    isAuthenticated: logto.isAuthenticated,
    isLoading: logto.isLoading,
    signIn,
    signOut,
    getAccessToken,
    getIdTokenClaims,
  }

  return (
    <ScrollrAuthContext.Provider value={value}>
      {children}
    </ScrollrAuthContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────

export function useScrollrAuth(): ScrollrAuthContextValue {
  const ctx = useContext(ScrollrAuthContext)
  if (!ctx) {
    throw new Error('useScrollrAuth must be used within a ScrollrAuthProvider')
  }
  return ctx
}
