# Super User Invite System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a CLI-driven invite system that pre-creates Logto accounts, assigns the super_user role, and sends branded invite emails with magic links that lead to a profile-completion page.

**Architecture:** CLI script creates users + sends emails via Resend. Backend endpoint validates invite token and updates user profile/password via Logto Management API. Frontend route provides the onboarding form and auto-signs users in via Logto's one-time token flow.

**Tech Stack:** Go (CLI script + backend endpoint), Logto Management API, Resend email API, React/TanStack Router (frontend), `@logto/react` SDK.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/invite-super-users.go` | **Create.** Standalone CLI — reads emails, creates Logto users, assigns super_user role, generates one-time tokens, sends invite emails via Resend |
| `api/core/invite.go` | **Create.** Backend handler for `POST /invite/complete` — verifies invite token, updates password + profile in Logto |
| `api/core/server.go` | **Modify.** Register the new route |
| `myscrollr.com/src/api/client.ts` | **Modify.** Add `completeInvite()` method (unauthenticated) |
| `myscrollr.com/src/routes/invite.tsx` | **Create.** Invite landing page with onboarding form |

---

### Task 1: Backend — `HandleCompleteInvite` endpoint

**Files:**
- Create: `api/core/invite.go`
- Modify: `api/core/server.go:195` (add route before user routes)

This task creates the backend endpoint that the invite page calls after the user fills in their profile info. It uses the Logto Management API (M2M auth pattern from `api/core/logto_admin.go`) to verify the token, look up the user, update password, and update profile.

- [ ] **Step 1: Create `api/core/invite.go` with the complete handler**

Create `api/core/invite.go` with the following content:

```go
package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"

	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Invite — Super User onboarding flow
// =============================================================================

// CompleteInviteRequest is the request body for POST /invite/complete.
type CompleteInviteRequest struct {
	Email    string `json:"email"`
	Token    string `json:"token"`
	Password string `json:"password"`
	Birthday string `json:"birthday"`
	Gender   string `json:"gender"`
}

const superUserRoleID = "saaf40fy2iaxu1bwhy0m8"

// HandleCompleteInvite verifies an invite token, updates the user's password
// and profile in Logto, then returns success so the frontend can sign them in.
//
// POST /invite/complete (no auth middleware — user isn't logged in yet)
func HandleCompleteInvite(c *fiber.Ctx) error {
	var req CompleteInviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid request body"})
	}

	// Validate required fields
	if req.Email == "" || req.Token == "" || req.Password == "" || req.Birthday == "" || req.Gender == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "All fields are required"})
	}
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Password must be at least 8 characters"})
	}

	// Get M2M token for Logto Management API calls
	m2mToken, err := getM2MToken()
	if err != nil {
		log.Printf("[Invite] Failed to get M2M token: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}

	cfg := getM2MConfig()

	// Step 1: Verify the one-time token server-side
	if err := verifyOneTimeToken(cfg.Endpoint, m2mToken, req.Token, req.Email); err != nil {
		log.Printf("[Invite] Token verification failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{Error: "Invalid or expired invite link"})
	}

	// Step 2: Look up user by email
	userID, username, err := findUserByEmail(cfg.Endpoint, m2mToken, req.Email)
	if err != nil {
		log.Printf("[Invite] User lookup failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{Error: "Invite not found"})
	}

	// Step 3: Verify user has super_user role
	hasSuperUser, err := userHasRole(cfg.Endpoint, m2mToken, userID, superUserRoleID)
	if err != nil {
		log.Printf("[Invite] Role check failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}
	if !hasSuperUser {
		return c.Status(fiber.StatusForbidden).JSON(ErrorResponse{Error: "Not authorized"})
	}

	// Step 4: Update password
	if err := updateUserPassword(cfg.Endpoint, m2mToken, userID, req.Password); err != nil {
		log.Printf("[Invite] Password update failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to set password"})
	}

	// Step 5: Update profile (gender + birthdate are built-in Logto profile fields)
	if err := updateUserProfile(cfg.Endpoint, m2mToken, userID, req.Gender, req.Birthday); err != nil {
		log.Printf("[Invite] Profile update failed for %s: %v", req.Email, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to update profile"})
	}

	log.Printf("[Invite] Completed invite for %s (user: %s, username: %s)", req.Email, userID, username)

	return c.JSON(fiber.Map{
		"success":  true,
		"username": username,
	})
}

// ── Logto Management API helpers ────────────────────────────────────

// verifyOneTimeToken verifies a one-time token via Logto Management API.
func verifyOneTimeToken(endpoint, token, ottToken, email string) error {
	payload, _ := json.Marshal(map[string]string{
		"token": ottToken,
		"email": email,
	})

	req, err := http.NewRequest("POST", endpoint+"/api/one-time-tokens/verify", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create verify request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("verify request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("verify returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// findUserByEmail searches for a user by primary email and returns (userID, username, error).
func findUserByEmail(endpoint, token, email string) (string, string, error) {
	searchURL := fmt.Sprintf("%s/api/users?search.primaryEmail=%s", endpoint, url.QueryEscape(email))
	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return "", "", fmt.Errorf("create search request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("search returned %d: %s", resp.StatusCode, string(body))
	}

	var users []struct {
		ID       string  `json:"id"`
		Username *string `json:"username"`
	}
	if err := json.Unmarshal(body, &users); err != nil {
		return "", "", fmt.Errorf("parse search response: %w", err)
	}
	if len(users) == 0 {
		return "", "", fmt.Errorf("no user found with email %s", email)
	}

	username := ""
	if users[0].Username != nil {
		username = *users[0].Username
	}
	return users[0].ID, username, nil
}

// userHasRole checks whether a Logto user has a specific role.
func userHasRole(endpoint, token, userID, roleID string) (bool, error) {
	reqURL := fmt.Sprintf("%s/api/users/%s/roles", endpoint, userID)
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return false, fmt.Errorf("create roles request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("roles request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("roles returned %d: %s", resp.StatusCode, string(body))
	}

	var roles []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &roles); err != nil {
		return false, fmt.Errorf("parse roles response: %w", err)
	}

	for _, r := range roles {
		if r.ID == roleID {
			return true, nil
		}
	}
	return false, nil
}

// updateUserPassword updates a user's password via Logto Management API.
func updateUserPassword(endpoint, token, userID, password string) error {
	payload, _ := json.Marshal(map[string]string{
		"password": password,
	})

	req, err := http.NewRequest("PATCH", fmt.Sprintf("%s/api/users/%s/password", endpoint, userID), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create password update request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("password update request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("password update returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// updateUserProfile updates a user's gender and birthdate via Logto Management API.
func updateUserProfile(endpoint, token, userID, gender, birthdate string) error {
	payload, _ := json.Marshal(map[string]interface{}{
		"profile": map[string]string{
			"gender":    gender,
			"birthdate": birthdate,
		},
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

- [ ] **Step 2: Register the route in `server.go`**

In `api/core/server.go`, add the invite route after the support route (line 181) and before the billing routes (line 183). Add this line:

```go
	// Invite (no auth — user isn't logged in yet, token-verified server-side)
	s.App.Post("/invite/complete", HandleCompleteInvite)
```

- [ ] **Step 3: Verify Go build passes**

Run: `go build ./...` from `api/`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add api/core/invite.go api/core/server.go
git commit -m "feat(invite): add POST /invite/complete endpoint for super user onboarding"
```

---

### Task 2: Frontend — API client method + invite route

**Files:**
- Modify: `myscrollr.com/src/api/client.ts`
- Create: `myscrollr.com/src/routes/invite.tsx`

This task adds the unauthenticated API call and the invite landing page.

- [ ] **Step 1: Add `completeInvite` to the API client**

In `myscrollr.com/src/api/client.ts`, add a new section after the billing API section (near the end of the file). This uses the unauthenticated `request<T>()` function (line 20), NOT `authenticatedFetch`:

```typescript
// ── Invite API ───────────────────────────────────────────────────

export interface CompleteInviteRequest {
  email: string
  token: string
  password: string
  birthday: string
  gender: string
}

export interface CompleteInviteResponse {
  success: boolean
  username: string
}

export const inviteApi = {
  completeInvite: (data: CompleteInviteRequest) =>
    request<CompleteInviteResponse>('/invite/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
}
```

- [ ] **Step 2: Create the invite route page**

Create `myscrollr.com/src/routes/invite.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Shield, Eye, EyeOff } from 'lucide-react'
import { useLogto } from '@logto/react'
import { inviteApi } from '@/api/client'
import type { FormEvent } from 'react'

export const Route = createFileRoute('/invite')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || '',
    email: (search.email as string) || '',
  }),
  component: InvitePage,
})

type PageState = 'form' | 'submitting' | 'signing-in' | 'error'

function InvitePage() {
  const { token, email } = Route.useSearch()
  const { signIn } = useLogto()

  const [state, setState] = useState<PageState>(
    token && email ? 'form' : 'error',
  )
  const [error, setError] = useState(
    !token || !email ? 'Invalid invite link — missing token or email.' : '',
  )

  const [birthday, setBirthday] = useState('')
  const [gender, setGender] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      setState('error')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      setState('error')
      return
    }
    if (!birthday) {
      setError('Birthday is required.')
      setState('error')
      return
    }
    if (!gender) {
      setError('Please select a gender.')
      setState('error')
      return
    }

    setState('submitting')
    setError('')

    try {
      await inviteApi.completeInvite({
        email,
        token,
        password,
        birthday,
        gender,
      })

      setState('signing-in')

      // Store return path so callback redirects to /account
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

  return (
    <div className="min-h-screen text-base-content flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Welcome to MyScrollr</h1>
          <p className="text-base-content/60 text-sm">
            You&apos;ve been invited as a{' '}
            <span className="text-primary font-semibold">Super User</span>.
            Complete your profile to get started.
          </p>
        </div>

        {/* Form card */}
        <div className="bg-base-200/50 border border-base-300 rounded-2xl p-6 space-y-5">
          {/* Email (read-only) */}
          <div>
            <label className="block text-xs font-medium text-base-content/50 uppercase tracking-wider mb-1.5">
              Email
            </label>
            <div className="px-3 py-2 bg-base-300/50 rounded-lg text-sm text-base-content/70">
              {email}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
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
              disabled={state === 'submitting'}
              className="w-full py-2.5 bg-primary text-primary-content font-medium rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {state === 'submitting' ? 'Setting up your account...' : 'Complete Setup'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Regenerate the route tree**

Run: `npx @tanstack/router-cli generate` from `myscrollr.com/`

This updates `src/routeTree.gen.ts` to include the new `/invite` route.

Alternatively, running `npm run dev` or `npm run build` will also trigger route generation.

- [ ] **Step 4: Verify the build passes**

Run: `npm run build` from `myscrollr.com/`
Expected: `vite build` + `tsc` both pass.

- [ ] **Step 5: Run prettier + eslint**

Run: `npm run check` from `myscrollr.com/`
Expected: Only pre-existing errors in unrelated files.

- [ ] **Step 6: Commit**

```bash
git add myscrollr.com/src/api/client.ts myscrollr.com/src/routes/invite.tsx myscrollr.com/src/routeTree.gen.ts
git commit -m "feat(invite): add invite landing page and API client method"
```

---

### Task 3: CLI Script — `scripts/invite-super-users.go`

**Files:**
- Create: `scripts/invite-super-users.go`

This is a standalone Go program (not part of the API module). It has its own `main` function and uses only the standard library (no external dependencies). It reads a JSON file of email addresses, creates Logto users, assigns the super_user role, generates one-time tokens, and sends invite emails via Resend.

- [ ] **Step 1: Create the CLI script**

Create `scripts/invite-super-users.go`:

```go
//go:build ignore

package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// ── Configuration ───────────────────────────────────────────────────

type config struct {
	LogtoEndpoint  string
	LogtoAppID     string
	LogtoAppSecret string
	LogtoResource  string
	ResendAPIKey   string
	ResendFrom     string
	FrontendURL    string
}

func loadConfig() config {
	c := config{
		LogtoEndpoint:  os.Getenv("LOGTO_ENDPOINT"),
		LogtoAppID:     os.Getenv("LOGTO_M2M_APP_ID"),
		LogtoAppSecret: os.Getenv("LOGTO_M2M_APP_SECRET"),
		LogtoResource:  os.Getenv("LOGTO_M2M_RESOURCE"),
		ResendAPIKey:   os.Getenv("RESEND_API_KEY"),
		ResendFrom:     os.Getenv("RESEND_FROM_EMAIL"),
		FrontendURL:    os.Getenv("FRONTEND_URL"),
	}
	if c.LogtoResource == "" {
		c.LogtoResource = "https://default.logto.app/api"
	}
	if c.FrontendURL == "" {
		c.FrontendURL = "https://myscrollr.com"
	}
	c.FrontendURL = strings.TrimSuffix(c.FrontendURL, "/")
	c.LogtoEndpoint = strings.TrimSuffix(c.LogtoEndpoint, "/")

	// Validate required
	missing := []string{}
	if c.LogtoEndpoint == "" {
		missing = append(missing, "LOGTO_ENDPOINT")
	}
	if c.LogtoAppID == "" {
		missing = append(missing, "LOGTO_M2M_APP_ID")
	}
	if c.LogtoAppSecret == "" {
		missing = append(missing, "LOGTO_M2M_APP_SECRET")
	}
	if c.ResendAPIKey == "" {
		missing = append(missing, "RESEND_API_KEY")
	}
	if c.ResendFrom == "" {
		missing = append(missing, "RESEND_FROM_EMAIL")
	}
	if len(missing) > 0 {
		log.Fatalf("Missing required env vars: %s", strings.Join(missing, ", "))
	}

	return c
}

// ── M2M Token ───────────────────────────────────────────────────────

func getM2MToken(cfg config) (string, error) {
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("resource", cfg.LogtoResource)
	data.Set("scope", "all")

	req, err := http.NewRequest("POST", cfg.LogtoEndpoint+"/oidc/token", strings.NewReader(data.Encode()))
	if err != nil {
		return "", fmt.Errorf("create token request: %w", err)
	}
	req.SetBasicAuth(cfg.LogtoAppID, cfg.LogtoAppSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token request returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("parse token response: %w", err)
	}

	return tokenResp.AccessToken, nil
}

// ── Logto API helpers ───────────────────────────────────────────────

var httpClient = &http.Client{Timeout: 10 * time.Second}

func logtoRequest(method, url string, token string, payload interface{}) ([]byte, int, error) {
	var bodyReader io.Reader
	if payload != nil {
		data, _ := json.Marshal(payload)
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	return body, resp.StatusCode, nil
}

// usernameExists checks if a username is taken in Logto.
func usernameExists(endpoint, token, username string) (bool, error) {
	searchURL := fmt.Sprintf("%s/api/users?search.username=%s", endpoint, url.QueryEscape(username))
	body, status, err := logtoRequest("GET", searchURL, token, nil)
	if err != nil {
		return false, err
	}
	if status != http.StatusOK {
		return false, fmt.Errorf("search returned %d: %s", status, string(body))
	}

	var users []struct {
		Username *string `json:"username"`
	}
	if err := json.Unmarshal(body, &users); err != nil {
		return false, err
	}

	// Logto search is partial match, so verify exact match
	for _, u := range users {
		if u.Username != nil && *u.Username == username {
			return true, nil
		}
	}
	return false, nil
}

// deriveUsername generates a unique username from an email prefix.
// Truncates to 12 chars (Logto's max), appends numbers on collision.
func deriveUsername(endpoint, token, email string) (string, error) {
	prefix := strings.Split(email, "@")[0]
	// Sanitize: only keep alphanumeric and underscore
	clean := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			return r
		}
		if r >= 'A' && r <= 'Z' {
			return r + 32 // lowercase
		}
		return '_'
	}, prefix)
	if clean == "" {
		clean = "user"
	}

	// Truncate to 12 chars (Logto username maxLength)
	if len(clean) > 12 {
		clean = clean[:12]
	}

	candidate := clean
	for i := 2; i <= 99; i++ {
		exists, err := usernameExists(endpoint, token, candidate)
		if err != nil {
			return "", fmt.Errorf("check username %s: %w", candidate, err)
		}
		if !exists {
			return candidate, nil
		}
		suffix := fmt.Sprintf("%d", i)
		maxBase := 12 - len(suffix)
		if maxBase < 1 {
			maxBase = 1
		}
		base := clean
		if len(base) > maxBase {
			base = base[:maxBase]
		}
		candidate = base + suffix
	}

	return "", fmt.Errorf("could not find unique username for %s after 99 attempts", email)
}

func randomPassword() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b) + "Aa1!" // Ensure complexity requirements
}

// createUser creates a Logto user and returns the user ID.
func createUser(endpoint, token, username, email, password string) (string, error) {
	payload := map[string]interface{}{
		"username":     username,
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

// assignRole assigns a role to a Logto user.
func assignRole(endpoint, token, userID, roleID string) error {
	payload := map[string][]string{"roleIds": {roleID}}
	body, status, err := logtoRequest("POST", fmt.Sprintf("%s/api/users/%s/roles", endpoint, userID), token, payload)
	if err != nil {
		return fmt.Errorf("assign role: %w", err)
	}
	// 201 = assigned, 422 = already assigned
	if status != http.StatusCreated && status != http.StatusUnprocessableEntity {
		return fmt.Errorf("assign role returned %d: %s", status, string(body))
	}
	return nil
}

// createOneTimeToken generates a one-time token for magic link auth.
func createOneTimeToken(endpoint, token, email string) (string, error) {
	payload := map[string]interface{}{
		"email":     email,
		"expiresIn": 604800, // 7 days
	}
	body, status, err := logtoRequest("POST", endpoint+"/api/one-time-tokens", token, payload)
	if err != nil {
		return "", fmt.Errorf("create one-time token: %w", err)
	}
	if status != http.StatusCreated {
		return "", fmt.Errorf("create one-time token returned %d: %s", status, string(body))
	}

	var result struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse one-time token response: %w", err)
	}
	return result.Token, nil
}

// ── Resend email ────────────────────────────────────────────────────

func sendInviteEmail(apiKey, from, toEmail, inviteURL, username string) error {
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
      Your username is <strong style="color:#ffffff;">%s</strong>.
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
</html>`, username, inviteURL)

	textBody := fmt.Sprintf("You've been invited to MyScrollr as a Super User!\n\nYour username: %s\n\nComplete your account: %s\n\nThis link expires in 7 days.", username, inviteURL)

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

// ── Main ────────────────────────────────────────────────────────────

const superUserRoleID = "saaf40fy2iaxu1bwhy0m8"

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: go run scripts/invite-super-users.go <emails.json>\n")
		os.Exit(1)
	}

	cfg := loadConfig()

	// Read email list
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		log.Fatalf("Failed to read file: %v", err)
	}

	var emails []string
	if err := json.Unmarshal(data, &emails); err != nil {
		log.Fatalf("Failed to parse JSON: %v", err)
	}

	if len(emails) == 0 {
		log.Fatal("No emails in the file")
	}

	fmt.Printf("Processing %d invites...\n\n", len(emails))

	// Get M2M token
	m2mToken, err := getM2MToken(cfg)
	if err != nil {
		log.Fatalf("Failed to get M2M token: %v", err)
	}

	var successes, failures int

	for i, email := range emails {
		email = strings.TrimSpace(email)
		if email == "" {
			continue
		}

		fmt.Printf("[%d/%d] %s\n", i+1, len(emails), email)

		// 1. Derive unique username
		username, err := deriveUsername(cfg.LogtoEndpoint, m2mToken, email)
		if err != nil {
			fmt.Printf("  ✗ Username derivation failed: %v\n", err)
			failures++
			continue
		}
		fmt.Printf("  → username: %s\n", username)

		// 2. Create user
		password := randomPassword()
		userID, err := createUser(cfg.LogtoEndpoint, m2mToken, username, email, password)
		if err != nil {
			fmt.Printf("  ✗ User creation failed: %v\n", err)
			failures++
			continue
		}
		fmt.Printf("  → user ID: %s\n", userID)

		// 3. Assign super_user role
		if err := assignRole(cfg.LogtoEndpoint, m2mToken, userID, superUserRoleID); err != nil {
			fmt.Printf("  ✗ Role assignment failed: %v\n", err)
			failures++
			continue
		}
		fmt.Printf("  → super_user role assigned\n")

		// 4. Generate one-time token
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

		// 5. Send invite email
		if err := sendInviteEmail(cfg.ResendAPIKey, cfg.ResendFrom, email, inviteURL, username); err != nil {
			fmt.Printf("  ✗ Email send failed: %v\n", err)
			failures++
			continue
		}
		fmt.Printf("  ✓ Invite sent!\n")
		successes++
		fmt.Println()
	}

	fmt.Printf("\n══════════════════════════════════\n")
	fmt.Printf("Results: %d succeeded, %d failed (out of %d)\n", successes, failures, len(emails))
}
```

- [ ] **Step 2: Verify script compiles**

Run: `go run scripts/invite-super-users.go` (with no args)
Expected: prints usage message and exits with code 1: `Usage: go run scripts/invite-super-users.go <emails.json>`

- [ ] **Step 3: Commit**

```bash
git add scripts/invite-super-users.go
git commit -m "feat(invite): add CLI script for batch super user invites"
```

---

### Task 4: Build verification + deploy

**Files:** None (verification only)

- [ ] **Step 1: Verify Go build**

Run: `go build ./...` from `api/`
Expected: Clean build.

- [ ] **Step 2: Verify TypeScript build**

Run: `npm run build` from `myscrollr.com/`
Expected: `vite build` + `tsc` both pass.

- [ ] **Step 3: Run prettier + eslint**

Run: `npm run check` from `myscrollr.com/`
Expected: Only pre-existing errors in unrelated files. The new `invite.tsx` and `client.ts` changes should pass.

- [ ] **Step 4: Push and deploy**

```bash
git push origin main
```

Then trigger deployments:
```bash
gh workflow run deploy.yml -f services=core-api
gh workflow run deploy.yml -f services=website
```

Wait for both to complete, then verify pods are running:
```bash
kubectl get pods -n scrollr -l app=core-api --no-headers
kubectl get pods -n scrollr -l app=website --no-headers
```

- [ ] **Step 5: Test the invite flow end-to-end**

Create a test email file:
```bash
echo '["your-test-email@example.com"]' > /tmp/test-invites.json
```

Run the script (requires env vars):
```bash
LOGTO_ENDPOINT=https://auth.myscrollr.com \
LOGTO_M2M_APP_ID=<your-app-id> \
LOGTO_M2M_APP_SECRET=<your-app-secret> \
RESEND_API_KEY=<your-resend-key> \
RESEND_FROM_EMAIL=noreply@myscrollr.com \
go run scripts/invite-super-users.go /tmp/test-invites.json
```

Expected: Script creates user, assigns role, sends email. Check your email for the invite link. Click it. Should see the onboarding page. Fill in the form. Should be signed in and redirected to /account.
