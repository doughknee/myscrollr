# Super User Invite System

## Problem

Super users need to be onboarded with pre-created accounts. There is no invite system, no email sending capability, and no programmatic user creation in the codebase. The Logto dashboard supports manual role assignment but not batch account creation with branded invite emails.

## Solution

Three components: a CLI script for batch account creation + invite sending, a backend endpoint for profile completion, and a frontend onboarding page.

## Architecture

```
CLI Script (local)
  │
  ├── Logto Management API: POST /api/users (create account)
  ├── Logto Management API: POST /api/users/{id}/roles (assign super_user)
  ├── Logto Management API: POST /api/one-time-tokens (generate magic link token)
  └── Resend API: send branded invite email
        │
        └── Email contains: https://myscrollr.com/invite?token=...&email=...
              │
              └── /invite page (myscrollr.com)
                    │
                    ├── Collects: birthday, gender, password
                    ├── POST /invite/complete (core-api)
                    │     ├── Logto: PATCH /api/users/{id}/password
                    │     └── Logto: PATCH /api/users/{id}/profile (gender + birthdate)
                    └── signIn() with one_time_token + login_hint
```

## Component 1: CLI Script

**File:** `scripts/invite-super-users.go` — standalone `main` package, not part of the API.

**Input:** JSON file with email addresses:
```json
[
  "alice@example.com",
  "bob@example.com"
]
```

**For each email, the script:**

1. Derives username from email prefix (`alice@example.com` → `alice`). Checks for collision via `GET /api/users?search.username={username}`. On collision, appends incrementing number (`alice2`, `alice3`) and re-checks until unique.
2. Creates user via Logto Management API: `POST /api/users` with `{ username, primaryEmail, password }`. Password is a random 32-character string (temporary — user replaces it during onboarding).
3. Assigns `super_user` role: `POST /api/users/{id}/roles` with `{ roleIds: ["saaf40fy2iaxu1bwhy0m8"] }`.
4. Generates one-time token: `POST /api/one-time-tokens` with `{ email, expiresIn: 604800 }` (7-day expiry).
5. Sends invite email via Resend API with branded HTML template. Magic link: `https://myscrollr.com/invite?token={token}&email={email}`.
6. Prints summary line: username, email, invite link (backup).

**After all emails processed:** prints final report with success/failure counts.

**Error handling:** If any step fails for one user, log the error and continue to the next user.

**Environment variables:**
- `LOGTO_ENDPOINT` — Logto base URL (e.g. `https://auth.myscrollr.com`)
- `LOGTO_M2M_APP_ID` — M2M application ID
- `LOGTO_M2M_APP_SECRET` — M2M application secret
- `LOGTO_M2M_RESOURCE` — M2M token audience (defaults to `https://default.logto.app/api`)
- `RESEND_API_KEY` — Resend API key
- `RESEND_FROM_EMAIL` — sender address (e.g. `noreply@myscrollr.com`)
- `FRONTEND_URL` — base URL for invite links (defaults to `https://myscrollr.com`)

**M2M token acquisition:** Same pattern as `api/core/logto_admin.go` — `POST {LOGTO_ENDPOINT}/oidc/token` with `client_credentials` grant, `scope: all`, resource: `LOGTO_M2M_RESOURCE`.

### Email Template

Branded HTML email:
- Subject: "You've been invited to MyScrollr"
- Body: greeting, brief explanation of Super User access, prominent CTA button linking to the invite URL
- Plain text fallback with the same link
- From: `RESEND_FROM_EMAIL`

## Component 2: Backend Endpoint

**Route:** `POST /invite/complete` — no auth middleware (user isn't logged in yet).

**File:** `api/core/invite.go` — new file, separate concern from billing.

**Request body:**
```json
{
  "email": "alice@example.com",
  "token": "YHwbXSXxQfL02IoxFqr1hGvkB13uTqcd",
  "password": "MyNewPassword123!",
  "birthday": "1995-03-15",
  "gender": "male"
}
```

**Handler logic:**

1. Validates all fields present. Password minimum 8 characters.
2. Looks up user by email: `GET /api/users?search.primaryEmail={email}` via Logto Management API.
3. Verifies user exists and has `super_user` role: `GET /api/users/{id}/roles`, checks for role ID `saaf40fy2iaxu1bwhy0m8`.
4. Verifies the one-time token server-side: `POST /api/one-time-tokens/verify` with `{ token, email }`. Rejects if expired/consumed/revoked.
5. Updates password: `PATCH /api/users/{id}/password` with `{ password }`.
6. Updates profile: `PATCH /api/users/{id}/profile` with `{ profile: { gender, birthdate } }` (both are built-in Logto profile fields).
7. Returns `{ success: true, username }`.

**Security:**
- The `super_user` role check prevents abuse — only pre-created invite users can use this endpoint.
- The one-time token is validated by Logto during the subsequent `signIn()` call, not by our backend.
- Password validation enforces minimum length.

**Route registration:** `s.App.Post("/invite/complete", HandleCompleteInvite)` in `server.go` (no auth middleware).

## Component 3: Frontend Invite Page

**Route:** `myscrollr.com/src/routes/invite.tsx` — public page, no auth required.

**URL:** `https://myscrollr.com/invite?token=...&email=...`

**Search params validation:** `token` (string, required), `email` (string, required).

**Flow:**

1. On mount, reads `token` and `email` from search params. Missing params → error state.
2. Displays welcome message with Super User branding.
3. Shows email (read-only).
4. Form fields:
   - **Birthday** — date input
   - **Gender** — select: male, female, non-binary, prefer not to say
   - **Password** — password input (min 8 chars)
   - **Confirm password** — must match
5. On submit: calls `POST /invite/complete` with `{ email, token, password, birthday, gender }`.
6. On success: triggers `signIn()` from `@logto/react` with `extraParams: { one_time_token: token, login_hint: email }`.
7. Logto handles authentication → redirects to `/callback` → redirects to `/account`.

**States:**
- **Form** — default state, shows the onboarding form
- **Submitting** — loading indicator on submit button
- **Error** — missing params, expired token, network failure, password too short, passwords don't match
- **Success** — brief "Signing you in..." message before Logto redirect

**API client:** New method `billingApi.completeInvite({ email, token, password, birthday, gender })` in `myscrollr.com/src/api/client.ts`. Unauthenticated call (no `getToken`).

**Styling:** Centered card matching the site's existing dark theme. Nothing elaborate.

## Dependencies

### New
- **Resend Go SDK** or direct HTTP calls to `https://api.resend.com/emails` (CLI script only, not added to core API)

### Existing (no changes)
- Logto Management API (M2M token pattern already established in `api/core/logto_admin.go`)
- `@logto/react` `signIn()` with `extraParams` (already available in the SDK)

## Logto Configuration

No changes needed. The `super_user` role (ID: `saaf40fy2iaxu1bwhy0m8`) already exists. The M2M application already has Management API access. The one-time token feature is available in Logto without configuration.

## Out of Scope

- Admin UI for managing invites
- Re-invite / token refresh mechanism (can re-run the script if needed)
- Email delivery tracking / bounce handling
- Custom Logto sign-in experience changes
- 2FA setup during onboarding (not needed — invite goes directly to their email)
