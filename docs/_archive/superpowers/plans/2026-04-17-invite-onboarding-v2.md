# Invite Onboarding v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add name + username fields to invite onboarding, with live username availability checking, and remove auto-generated usernames from the CLI script.

**Architecture:** Extend existing invite backend (`api/core/invite.go`) with new helpers and a username-check endpoint. Rebuild the frontend invite page with additional form fields and on-blur availability checking. Simplify CLI to create users without usernames.

**Tech Stack:** Go 1.22 / Fiber v2 (backend), React 19 / TanStack Router / Tailwind v4 (frontend), Logto Management API

---

### Task 1: Backend — Extend request struct, add new helpers, update existing helpers

**Files:**
- Modify: `api/core/invite.go:20-26` (request struct), `api/core/invite.go:200-228` (updateUserProfile)

**Context:** The invite handler at `api/core/invite.go` currently has `CompleteInviteRequest` with 5 fields (email, token, password, birthday, gender). It has 4 helpers: `findUserByEmail`, `userHasRole`, `updateUserPassword`, `updateUserProfile`. We need to add 3 fields to the struct, add 2 new helpers, and extend `updateUserProfile` to include name fields.

- [ ] **Step 1: Extend `CompleteInviteRequest` struct**

In `api/core/invite.go`, replace the struct at lines 20-26:

```go
type CompleteInviteRequest struct {
	Email     string `json:"email"`
	Token     string `json:"token"`
	Password  string `json:"password"`
	Birthday  string `json:"birthday"`
	Gender    string `json:"gender"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}
```

- [ ] **Step 2: Add `regexp` to imports**

Add `"regexp"` to the import block at lines 3-13.

- [ ] **Step 3: Add username validation regex constant**

After the `superUserRoleID` constant (line 28), add:

```go
var usernameRegex = regexp.MustCompile(`^[a-z0-9_]{3,24}$`)
```

- [ ] **Step 4: Add `checkUsernameAvailable` helper**

Add this function after `userHasRole` (after line 169):

```go
// checkUsernameAvailable checks if a username is available in Logto.
// Logto search is partial match, so we verify exact match in results.
func checkUsernameAvailable(endpoint, token, username string) (bool, error) {
	searchURL := fmt.Sprintf("%s/api/users?search.username=%s", endpoint, url.QueryEscape(username))
	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return false, fmt.Errorf("create username search request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("username search request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("username search returned %d: %s", resp.StatusCode, string(body))
	}

	var users []struct {
		Username *string `json:"username"`
	}
	if err := json.Unmarshal(body, &users); err != nil {
		return false, fmt.Errorf("parse username search response: %w", err)
	}

	for _, u := range users {
		if u.Username != nil && *u.Username == username {
			return false, nil // taken
		}
	}
	return true, nil // available
}
```

- [ ] **Step 5: Add `updateUserIdentity` helper**

Add this function after `checkUsernameAvailable`:

```go
// updateUserIdentity sets the username and display name on a Logto user.
// Returns a special error message if Logto rejects the username (422 = taken/invalid).
func updateUserIdentity(endpoint, token, userID, username, name string) error {
	payload, _ := json.Marshal(map[string]string{
		"username": username,
		"name":     name,
	})

	req, err := http.NewRequest("PATCH", fmt.Sprintf("%s/api/users/%s", endpoint, userID), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create identity update request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("identity update request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnprocessableEntity {
		return fmt.Errorf("username_taken")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("identity update returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
```

- [ ] **Step 6: Extend `updateUserProfile` to include name fields**

Replace the `updateUserProfile` function (lines 199-228) with:

```go
// updateUserProfile updates a user's profile fields via Logto Management API.
func updateUserProfile(endpoint, token, userID, gender, birthdate, givenName, familyName string) error {
	profileFields := map[string]string{
		"gender":    gender,
		"birthdate": birthdate,
	}
	if givenName != "" {
		profileFields["givenName"] = givenName
	}
	if familyName != "" {
		profileFields["familyName"] = familyName
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"profile": profileFields,
	})

	req, err := http.NewRequest("PATCH", fmt.Sprintf("%s/api/users/%s/profile", endpoint, userID), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create profile update request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("profile update request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("profile update returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
```

- [ ] **Step 7: Build verification**

Run: `go build ./...` from `api/`
Expected: Build passes (the handler still calls `updateUserProfile` with 5 args — we need to update that in Task 2, so the build may fail here. That's OK — we'll fix it in Task 2.)

- [ ] **Step 8: Commit**

```bash
git add api/core/invite.go
git commit -m "feat(invite): extend request struct, add username/identity helpers"
```

---

### Task 2: Backend — Rewrite `HandleCompleteInvite` to use new fields

**Files:**
- Modify: `api/core/invite.go:34-92` (HandleCompleteInvite function)

**Context:** The handler currently validates 5 fields, then calls findUserByEmail → userHasRole → updateUserPassword → updateUserProfile. We need to add validation for the 3 new fields (username format regex, non-empty first/last name), add a username availability check before the writes, extend the updateUserProfile call with name fields, and add an updateUserIdentity call that handles 422→409 mapping.

- [ ] **Step 1: Replace `HandleCompleteInvite`**

Replace the entire function (lines 34-92) with:

```go
func HandleCompleteInvite(c *fiber.Ctx) error {
	var req CompleteInviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid request body"})
	}

	// Validate required fields
	if req.Email == "" || req.Token == "" || req.Password == "" || req.Birthday == "" || req.Gender == "" || req.Username == "" || req.FirstName == "" || req.LastName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "All fields are required"})
	}
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Password must be at least 8 characters"})
	}
	if !usernameRegex.MatchString(req.Username) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Username must be 3-24 characters, lowercase letters, digits, or underscores"})
	}

	// Get M2M token for Logto Management API calls
	m2mToken, err := getM2MToken()
	if err != nil {
		log.Printf("[Invite] Failed to get M2M token: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}

	cfg := getM2MConfig()

	// Look up user by email
	userID, _, err := findUserByEmail(cfg.Endpoint, m2mToken, req.Email)
	if err != nil {
		log.Printf("[Invite] User lookup failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{Error: "Invite not found"})
	}

	// Verify user has super_user role
	hasSuperUser, err := userHasRole(cfg.Endpoint, m2mToken, userID, superUserRoleID)
	if err != nil {
		log.Printf("[Invite] Role check failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}
	if !hasSuperUser {
		return c.Status(fiber.StatusForbidden).JSON(ErrorResponse{Error: "Not authorized"})
	}

	// Check username availability
	available, err := checkUsernameAvailable(cfg.Endpoint, m2mToken, req.Username)
	if err != nil {
		log.Printf("[Invite] Username check failed for %s: %v", req.Username, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}
	if !available {
		return c.Status(fiber.StatusConflict).JSON(ErrorResponse{Error: "Username was taken, please choose another"})
	}

	// Update password
	if err := updateUserPassword(cfg.Endpoint, m2mToken, userID, req.Password); err != nil {
		log.Printf("[Invite] Password update failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to set password"})
	}

	// Update profile (gender, birthdate, givenName, familyName)
	if err := updateUserProfile(cfg.Endpoint, m2mToken, userID, req.Gender, req.Birthday, req.FirstName, req.LastName); err != nil {
		log.Printf("[Invite] Profile update failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to update profile"})
	}

	// Set username and display name
	displayName := req.FirstName + " " + req.LastName
	if err := updateUserIdentity(cfg.Endpoint, m2mToken, userID, req.Username, displayName); err != nil {
		if err.Error() == "username_taken" {
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{Error: "Username was taken, please choose another"})
		}
		log.Printf("[Invite] Identity update failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to set username"})
	}

	log.Printf("[Invite] Completed invite for %s (user: %s, username: %s)", req.Email, userID, req.Username)

	return c.JSON(fiber.Map{
		"success":  true,
		"username": req.Username,
	})
}
```

- [ ] **Step 2: Build verification**

Run: `go build ./...` from `api/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add api/core/invite.go
git commit -m "feat(invite): rewrite handler with username/name fields + 409 handling"
```

---

### Task 3: Backend — Add `HandleCheckUsernameAvailable` + register route

**Files:**
- Modify: `api/core/invite.go` (add handler at end)
- Modify: `api/core/server.go:184` (add route)

**Context:** New endpoint `GET /invite/username-available?email=X&username=Y` — no auth middleware. Validates params, verifies the email belongs to a super_user (Option A auth), then checks username availability via the `checkUsernameAvailable` helper added in Task 1.

- [ ] **Step 1: Add `HandleCheckUsernameAvailable` handler**

Add at the end of `api/core/invite.go`, before the helpers section:

```go
// HandleCheckUsernameAvailable checks if a username is available.
// GET /invite/username-available?email=X&username=Y (no auth — verified via email+role)
func HandleCheckUsernameAvailable(c *fiber.Ctx) error {
	email := c.Query("email")
	username := c.Query("username")

	if email == "" || username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "email and username are required"})
	}

	// Validate format first — no need to hit Logto for invalid usernames
	if !usernameRegex.MatchString(username) {
		return c.JSON(fiber.Map{
			"available": false,
			"reason":    "invalid",
		})
	}

	// Get M2M token
	m2mToken, err := getM2MToken()
	if err != nil {
		log.Printf("[Invite] Username check: M2M token failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}

	cfg := getM2MConfig()

	// Verify email belongs to an invited super_user
	userID, _, err := findUserByEmail(cfg.Endpoint, m2mToken, email)
	if err != nil {
		return c.Status(fiber.StatusForbidden).JSON(ErrorResponse{Error: "Not authorized"})
	}

	hasSuperUser, err := userHasRole(cfg.Endpoint, m2mToken, userID, superUserRoleID)
	if err != nil || !hasSuperUser {
		return c.Status(fiber.StatusForbidden).JSON(ErrorResponse{Error: "Not authorized"})
	}

	// Check availability
	available, err := checkUsernameAvailable(cfg.Endpoint, m2mToken, username)
	if err != nil {
		log.Printf("[Invite] Username availability check failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}

	if !available {
		return c.JSON(fiber.Map{
			"available": false,
			"reason":    "taken",
		})
	}

	return c.JSON(fiber.Map{
		"available": true,
	})
}
```

- [ ] **Step 2: Register route in `server.go`**

In `api/core/server.go`, after line 184 (`s.App.Post("/invite/complete", HandleCompleteInvite)`), add:

```go
	s.App.Get("/invite/username-available", HandleCheckUsernameAvailable)
```

- [ ] **Step 3: Build verification**

Run: `go build ./...` from `api/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add api/core/invite.go api/core/server.go
git commit -m "feat(invite): add GET /invite/username-available endpoint"
```

---

### Task 4: Frontend — Extend API client types + add availability method

**Files:**
- Modify: `myscrollr.com/src/api/client.ts:399-421`

**Context:** The invite API section has `CompleteInviteRequest` (5 fields), `CompleteInviteResponse`, and `inviteApi` object. We need to add 3 fields to the request, add `CheckUsernameResponse` type, and add the `checkUsernameAvailable` method.

- [ ] **Step 1: Extend `CompleteInviteRequest`**

Replace the interface at lines 401-407:

```typescript
export interface CompleteInviteRequest {
  email: string
  token: string
  password: string
  birthday: string
  gender: string
  username: string
  first_name: string
  last_name: string
}
```

- [ ] **Step 2: Add `CheckUsernameResponse` type**

After `CompleteInviteResponse` (line 412), add:

```typescript
export interface CheckUsernameResponse {
  available: boolean
  reason?: 'invalid' | 'taken'
}
```

- [ ] **Step 3: Add `checkUsernameAvailable` method**

In the `inviteApi` object, after the `completeInvite` method, add:

```typescript
  checkUsernameAvailable: (email: string, username: string) =>
    request<CheckUsernameResponse>(
      `/invite/username-available?email=${encodeURIComponent(email)}&username=${encodeURIComponent(username)}`,
    ),
```

- [ ] **Step 4: Build verification**

Run: `npm run build` from `myscrollr.com/`
Expected: PASS (vite build + tsc)

- [ ] **Step 5: Commit**

```bash
git add myscrollr.com/src/api/client.ts
git commit -m "feat(invite): extend API client with username/name fields + availability check"
```

---

### Task 5: Frontend — Rebuild invite page with new fields and username checking

**Files:**
- Modify: `myscrollr.com/src/routes/invite.tsx` (full rewrite)

**Context:** Current invite page (264 lines) has: birthday, gender, password, confirm password fields. Email shown as read-only field. We need to: add first name, last name, username fields above birthday; move email into the greeting header; add on-blur username availability checking with visual feedback; handle 409 from backend on submit; enforce lowercase on username input.

**Existing patterns to preserve:**
- Website code style: no semicolons, single quotes, Prettier formatting
- DaisyUI classes: `base-content`, `base-200`, `base-300`, `primary`, `error`
- Import order: React → third-party → internal modules → type-only imports
- `useLogto()` directly (not `useScrollrAuth()`) because we need `extraParams` on `signIn()`
- Eye/EyeOff toggle pattern for password fields
- `sessionStorage.setItem('scrollr:returnTo', '/account')` before `signIn()`

- [ ] **Step 1: Rewrite the invite page**

Replace the entire contents of `myscrollr.com/src/routes/invite.tsx` with:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef } from 'react'
import { Eye, EyeOff, Shield, Check, X, Loader2 } from 'lucide-react'
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

      const callbackUrl = `${window.location.origin}/callback`
      await signIn({
        redirectUri: callbackUrl,
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
      <div className="min-h-screen text-base-content flex items-center justify-center font-mono">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4" />
          <p className="uppercase tracking-[0.2em] text-primary animate-pulse">
            Signing you in...
          </p>
        </div>
      </div>
    )
  }

  if (!token || !email) {
    return (
      <div className="min-h-screen text-base-content flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-error/10 border border-error/20 mb-4">
            <X className="w-8 h-8 text-error" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Invalid Invite Link</h1>
          <p className="text-base-content/60 text-sm">
            This link is missing required parameters. Please check your email
            for the correct invite link.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen text-base-content flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">
            Welcome, {email}
          </h1>
          <p className="text-base-content/60 text-sm">
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
                className="block text-xs font-medium text-base-content/50 uppercase tracking-wider mb-1.5"
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
                className="block text-xs font-medium text-base-content/50 uppercase tracking-wider mb-1.5"
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
                className="block text-xs font-medium text-base-content/50 uppercase tracking-wider mb-1.5"
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
                    <Loader2 className="w-4 h-4 text-base-content/40 animate-spin" />
                  )}
                  {usernameState === 'available' && (
                    <Check className="w-4 h-4 text-success" />
                  )}
                  {(usernameState === 'taken' ||
                    usernameState === 'invalid') && (
                    <X className="w-4 h-4 text-error" />
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-base-content/40">
                {usernameState === 'idle' &&
                  '3-24 characters, lowercase letters, digits, or underscores'}
                {usernameState === 'checking' && 'Checking availability...'}
                {usernameState === 'available' && (
                  <span className="text-success">Username is available</span>
                )}
                {usernameState === 'taken' && (
                  <span className="text-error">
                    Username is taken, try another
                  </span>
                )}
                {usernameState === 'invalid' && (
                  <span className="text-error">
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
                className="block text-xs font-medium text-base-content/50 uppercase tracking-wider mb-1.5"
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
                className="block text-xs font-medium text-base-content/50 uppercase tracking-wider mb-1.5"
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
                className="block text-xs font-medium text-base-content/50 uppercase tracking-wider mb-1.5"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content/70 transition-colors"
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
                className="block text-xs font-medium text-base-content/50 uppercase tracking-wider mb-1.5"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content/70 transition-colors"
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
              <div className="px-3 py-2 bg-error/10 border border-error/20 rounded-lg text-sm text-error">
                {error}
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
```

- [ ] **Step 2: Build verification**

Run: `npm run build` from `myscrollr.com/`
Expected: PASS (vite build + tsc)

- [ ] **Step 3: Run format + lint**

Run: `npm run check` from `myscrollr.com/`
Expected: PASS (or only pre-existing errors in unrelated files)

- [ ] **Step 4: Commit**

```bash
git add myscrollr.com/src/routes/invite.tsx
git commit -m "feat(invite): rebuild invite page with username/name fields + availability check"
```

---

### Task 6: CLI — Strip username generation, update email template

**Files:**
- Modify: `scripts/invite-super-users.go`

**Context:** The CLI currently derives usernames from email prefixes via `deriveUsername()` and `usernameExists()`, passes username to `createUser()` and `sendInviteEmail()`. We need to: remove `deriveUsername` + `usernameExists` functions, simplify `createUser` to omit `username`, simplify `sendInviteEmail` to omit username from template, update the main loop.

- [ ] **Step 1: Remove `usernameExists` function**

Delete lines 193-218 (the `usernameExists` function).

- [ ] **Step 2: Remove `deriveUsername` function**

Delete lines 220-265 (the `deriveUsername` function).

- [ ] **Step 3: Simplify `createUser`**

Replace the function (line 274):

```go
// createUser creates a Logto user and returns the user ID.
func createUser(endpoint, token, email, password string) (string, error) {
	payload := map[string]interface{}{
		"primaryEmail": email,
		"password":     password,
	}
	body, status, err := logtoRequest("POST", endpoint+"/api/users", token, payload)
	if err != nil {
		return "", fmt.Errorf("create user: %w", err)
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("create user returned %d: %s", status, string(body))
	}

	var user struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &user); err != nil {
		return "", fmt.Errorf("parse create user response: %w", err)
	}
	return user.ID, nil
}
```

- [ ] **Step 4: Simplify `sendInviteEmail`**

Replace the function to remove username references:

```go
func sendInviteEmail(apiKey, from, toEmail, inviteURL string) error {
	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:32px;background-color:#141414;border:1px solid #262626;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:48px;height:48px;background-color:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.2);border-radius:12px;line-height:48px;font-size:24px;">&#x1f6e1;</div>
    </div>
    <h1 style="color:#ffffff;font-size:22px;text-align:center;margin:0 0 8px;">You're Invited to MyScrollr</h1>
    <p style="color:#a0a0a0;font-size:14px;text-align:center;margin:0 0 24px;line-height:1.5;">
      You've been granted <span style="color:#34d399;font-weight:600;">Super User</span> access.
      Click below to set up your profile and choose a username.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="%s" style="display:inline-block;padding:12px 32px;background-color:#34d399;color:#0a0a0a;font-weight:600;font-size:14px;text-decoration:none;border-radius:8px;">
        Complete Your Account
      </a>
    </div>
    <p style="color:#666;font-size:12px;text-align:center;margin:0;line-height:1.4;">
      This link expires in 7 days. If you didn't expect this invitation, you can ignore this email.
    </p>
  </div>
</body>
</html>`, inviteURL)

	textBody := fmt.Sprintf("You've been invited to MyScrollr as a Super User!\n\nComplete your account and choose a username: %s\n\nThis link expires in 7 days.", inviteURL)

	payload := map[string]interface{}{
		"from":    from,
		"to":      []string{toEmail},
		"subject": "You've been invited to MyScrollr",
		"html":    htmlBody,
		"text":    textBody,
	}

	data, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", "https://api.resend.com/emails", bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create email request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("email request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("resend returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
```

- [ ] **Step 5: Update main loop**

Replace the main loop (lines 432-491) to remove username derivation:

```go
	for i, email := range emails {
		email = strings.TrimSpace(email)
		if email == "" {
			continue
		}

		fmt.Printf("[%d/%d] %s\n", i+1, len(emails), email)

		// 1. Create user (no username — user picks it during onboarding)
		password := randomPassword()
		userID, err := createUser(cfg.LogtoEndpoint, m2mToken, email, password)
		if err != nil {
			fmt.Printf("  ✗ User creation failed: %v\n", err)
			failures++
			continue
		}
		fmt.Printf("  → user ID: %s\n", userID)

		// 2. Assign super_user role
		if err := assignRole(cfg.LogtoEndpoint, m2mToken, userID, superUserRoleID); err != nil {
			fmt.Printf("  ✗ Role assignment failed: %v\n", err)
			failures++
			continue
		}
		fmt.Printf("  → super_user role assigned\n")

		// 3. Generate one-time token
		ottToken, err := createOneTimeToken(cfg.LogtoEndpoint, m2mToken, email)
		if err != nil {
			fmt.Printf("  ✗ One-time token creation failed: %v\n", err)
			failures++
			continue
		}

		inviteURL := fmt.Sprintf("%s/invite?token=%s&email=%s",
			cfg.FrontendURL,
			url.QueryEscape(ottToken),
			url.QueryEscape(email),
		)
		fmt.Printf("  → invite URL: %s\n", inviteURL)

		// 4. Send invite email
		if err := sendInviteEmail(cfg.ResendAPIKey, cfg.ResendFrom, email, inviteURL); err != nil {
			fmt.Printf("  ✗ Email send failed: %v\n", err)
			failures++
			continue
		}
		fmt.Printf("  ✓ Invite sent!\n")
		successes++
		fmt.Println()
	}
```

- [ ] **Step 6: Remove unused `net/url` import if no longer needed**

Check: `url.QueryEscape` is still used in `main()` for the invite URL. Keep the import. However, `usernameExists` used `url.QueryEscape` too — but it's still needed in the main loop. No import changes needed.

Also remove unused `crypto/rand` and `encoding/hex` imports only if `randomPassword` is removed. But `randomPassword` is still used, so keep all imports.

- [ ] **Step 7: Build verification**

Run: `go run scripts/invite-super-users.go` (no args, expect usage error)
Expected: `Usage: go run scripts/invite-super-users.go <emails.json>` then exit 1

- [ ] **Step 8: Commit**

```bash
git add scripts/invite-super-users.go
git commit -m "refactor(invite): remove username generation from CLI, let users choose"
```

---

### Task 7: Build verification + final check

**Files:** All modified files

- [ ] **Step 1: Go build**

Run: `go build ./...` from `api/`
Expected: PASS

- [ ] **Step 2: TypeScript build**

Run: `npm run build` from `myscrollr.com/`
Expected: PASS

- [ ] **Step 3: Lint + format**

Run: `npm run check` from `myscrollr.com/`
Expected: PASS (or only pre-existing errors in unrelated files)

- [ ] **Step 4: Verify no references to old patterns**

Grep for old `CheckoutForm` or `deriveUsername` to ensure cleanup is complete:
- `grep -r "deriveUsername" scripts/` → no results
- `grep -r "usernameExists" scripts/` → no results

Done — do NOT push or deploy. Prompt user to test first.
