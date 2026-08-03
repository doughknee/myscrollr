import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, Shield, X } from 'lucide-react'
import { useLogto } from '@logto/react'
import type { FormEvent } from 'react'
import { inviteApi } from '@/api/client'

export const Route = createFileRoute('/invite')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || '',
    email: (search.email as string) || '',
  }),
  component: InvitePage,
})

type PageState = 'form' | 'submitting' | 'signing-in' | 'error'
type UsernameState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

const USERNAME_REGEX = /^[a-z0-9_]{3,24}$/

function InvitePage() {
  const { token, email } = Route.useSearch()
  const { signIn } = useLogto()

  const [state, setState] = useState<PageState>(
    token && email ? 'form' : 'error',
  )
  const [error, setError] = useState(
    !token || !email ? 'Invalid invite link — missing token or email.' : '',
  )

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [usernameState, setUsernameState] = useState<UsernameState>('idle')
  const [birthday, setBirthday] = useState('')
  const [gender, setGender] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const usernameRef = useRef<HTMLInputElement>(null)

  function handleUsernameChange(value: string) {
    const lower = value.toLowerCase().replace(/[^a-z0-9_]/g, '')
    setUsername(lower)
    setUsernameState('idle')
  }

  async function handleUsernameBlur() {
    if (!username) {
      setUsernameState('idle')
      return
    }
    if (!USERNAME_REGEX.test(username)) {
      setUsernameState('invalid')
      return
    }

    setUsernameState('checking')
    try {
      const result = await inviteApi.checkUsernameAvailable(email, username)
      if (result.available) {
        setUsernameState('available')
      } else {
        setUsernameState(result.reason === 'invalid' ? 'invalid' : 'taken')
      }
    } catch {
      setUsernameState('idle')
    }
  }

  const canSubmit =
    state !== 'submitting' &&
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    username !== '' &&
    USERNAME_REGEX.test(username) &&
    usernameState !== 'checking' &&
    usernameState !== 'taken' &&
    usernameState !== 'invalid' &&
    birthday !== '' &&
    gender !== '' &&
    password.length >= 8 &&
    password === confirmPassword

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!canSubmit) return

    setState('submitting')
    setError('')

    try {
      await inviteApi.completeInvite({
        email,
        token,
        password,
        birthday,
        gender,
        username,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      })

      setState('signing-in')

      sessionStorage.setItem('scrollr:returnTo', '/account')

      // The backend now VERIFIES the one-time token without consuming
      // it. That leaves the token still active so we can hand it to
      // Logto's magic-link sign-in flow here. Logto's flow consumes
      // the token AND signs the user in atomically — no password
      // prompt, no second redirect, just land on /callback already
      // authenticated.
      // Reference: https://docs.logto.io/end-user-flows/one-time-token
      const callbackUrl = `${window.location.origin}/callback`
      await signIn({
        redirectUri: callbackUrl,
        clearTokens: false,
        extraParams: {
          one_time_token: token,
          login_hint: email,
        },
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong'

      // Handle 409 — username was taken between check and submit
      if (message.toLowerCase().includes('username was taken')) {
        setUsernameState('taken')
        setState('form')
        usernameRef.current?.focus()
        return
      }

      setError(message)
      setState('error')
    }
  }

  if (state === 'signing-in') {
    return (
      <div className="min-h-dvh text-base-content flex flex-col items-center justify-start pt-32 pb-16 px-4 font-mono">
        <div className="text-center space-y-4 max-w-sm">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4" />
          <p className="uppercase tracking-[0.2em] text-primary animate-pulse">
            Redirecting to sign in...
          </p>
          <p className="text-xs text-base-muted font-sans normal-case tracking-normal">
            Use the password you just created.
          </p>
        </div>
      </div>
    )
  }

  if (!token || !email) {
    return (
      <div className="min-h-dvh text-base-content flex flex-col items-center justify-start pt-32 pb-16 px-4 font-sans">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-error/10 border border-error/20 mb-4">
            <X className="w-8 h-8 text-error-ink" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Invalid Invite Link</h1>
          <p className="text-base-muted text-sm">
            This link is missing required parameters. Please check your email
            for the correct invite link.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh text-base-content flex flex-col items-center justify-start pt-32 pb-16 px-4 font-sans">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Welcome, {email}</h1>
          <p className="text-base-muted text-sm">
            You&apos;ve been invited as a{' '}
            <span className="text-primary font-semibold">Super User</span>.
            Let&apos;s set up your account.
          </p>
        </div>

        {/* Form card */}
        <div className="bg-base-200/50 border border-base-300 rounded-2xl p-6 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* First Name */}
            <div>
              <label
                htmlFor="first-name"
                className="block text-xs font-medium text-base-muted uppercase tracking-wider mb-1.5"
              >
                First Name
              </label>
              <input
                id="first-name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                placeholder="Your first name"
                className="w-full px-3 py-2 bg-base-300/50 border border-base-300 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* Last Name */}
            <div>
              <label
                htmlFor="last-name"
                className="block text-xs font-medium text-base-muted uppercase tracking-wider mb-1.5"
              >
                Last Name
              </label>
              <input
                id="last-name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                placeholder="Your last name"
                className="w-full px-3 py-2 bg-base-300/50 border border-base-300 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="block text-xs font-medium text-base-muted uppercase tracking-wider mb-1.5"
              >
                Username
              </label>
              <div className="relative">
                <input
                  ref={usernameRef}
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  onBlur={handleUsernameBlur}
                  required
                  placeholder="Choose a username"
                  className="w-full px-3 py-2 pr-10 bg-base-300/50 border border-base-300 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  {usernameState === 'checking' && (
                    <Loader2 className="w-4 h-4 text-base-subtle animate-spin" />
                  )}
                  {usernameState === 'available' && (
                    <Check className="w-4 h-4 text-success-ink" />
                  )}
                  {(usernameState === 'taken' ||
                    usernameState === 'invalid') && (
                    <X className="w-4 h-4 text-error-ink" />
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-base-subtle">
                {usernameState === 'idle' &&
                  '3-24 characters, lowercase letters, digits, or underscores'}
                {usernameState === 'checking' && 'Checking availability...'}
                {usernameState === 'available' && (
                  <span className="text-success-ink">Username is available</span>
                )}
                {usernameState === 'taken' && (
                  <span className="text-error-ink">
                    Username is taken, try another
                  </span>
                )}
                {usernameState === 'invalid' && (
                  <span className="text-error-ink">
                    3-24 characters, lowercase letters, digits, or underscores
                    only
                  </span>
                )}
              </p>
            </div>

            {/* Birthday */}
            <div>
              <label
                htmlFor="birthday"
                className="block text-xs font-medium text-base-muted uppercase tracking-wider mb-1.5"
              >
                Birthday
              </label>
              <input
                id="birthday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                required
                className="w-full px-3 py-2 bg-base-300/50 border border-base-300 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* Gender */}
            <div>
              <label
                htmlFor="gender"
                className="block text-xs font-medium text-base-muted uppercase tracking-wider mb-1.5"
              >
                Gender
              </label>
              <select
                id="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                required
                className="w-full px-3 py-2 bg-base-300/50 border border-base-300 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors"
              >
                <option value="">Select...</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non-binary">Non-binary</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-base-muted uppercase tracking-wider mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  className="w-full px-3 py-2 pr-10 bg-base-300/50 border border-base-300 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-base-subtle hover:text-base-muted transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label
                htmlFor="confirm-password"
                className="block text-xs font-medium text-base-muted uppercase tracking-wider mb-1.5"
              >
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Re-enter your password"
                  className="w-full px-3 py-2 pr-10 bg-base-300/50 border border-base-300 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-base-subtle hover:text-base-muted transition-colors"
                >
                  {showConfirm ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Error message */}
            {state === 'error' && error && (
              <div className="space-y-2">
                <div className="px-3 py-2 bg-error/10 border border-error/20 rounded-lg text-sm text-error-ink">
                  {error}
                </div>
                {/* If the token was rejected (likely because the user
                    already completed setup in another tab/session)
                    offer them a sign-in path rather than a dead end. */}
                {error.toLowerCase().includes('invalid') ||
                error.toLowerCase().includes('expired') ? (
                  <button
                    type="button"
                    onClick={() => {
                      sessionStorage.setItem('scrollr:returnTo', '/account')
                      void signIn({
                        redirectUri: `${window.location.origin}/callback`,
                        extraParams: { login_hint: email },
                      })
                    }}
                    className="w-full text-xs text-primary hover:underline"
                  >
                    Already set up your account? Sign in here.
                  </button>
                ) : null}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-2.5 bg-primary text-primary-content font-medium rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {state === 'submitting'
                ? 'Setting up your account...'
                : 'Complete Setup'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
