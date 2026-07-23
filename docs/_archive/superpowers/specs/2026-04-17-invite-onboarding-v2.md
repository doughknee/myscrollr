# Invite Onboarding v2

> Extends the super user invite flow to let users choose their own username and enter their name during onboarding.

## Background

The v1 invite system auto-generates usernames from email prefixes in the CLI script. Users cannot choose their own username. The onboarding form collects only birthday, gender, and password. This v2 adds first/last name and username (with live availability checking) to the invite page, and removes username generation from the CLI.

## Changes

### 1. CLI Script (`scripts/invite-super-users.go`)

- Remove `deriveUsername()` and `usernameExists()` functions entirely
- Remove `username` parameter from `createUser()` — create users with `primaryEmail` + `password` only (no username field)
- Remove `username` parameter from `sendInviteEmail()` — email body no longer mentions a username
- Update email template: remove "Your username is X" line, greet with email instead
- Update main loop: skip the username derivation step

### 2. Backend — Extend `HandleCompleteInvite` (`api/core/invite.go`)

**Request struct changes:**
```go
type CompleteInviteRequest struct {
    Email     string `json:"email"`
    Token     string `json:"token"`
    Password  string `json:"password"`
    Birthday  string `json:"birthday"`
    Gender    string `json:"gender"`
    Username  string `json:"username"`   // NEW: 3-24 chars, ^[a-z0-9_]{3,24}$
    FirstName string `json:"first_name"` // NEW
    LastName  string `json:"last_name"`  // NEW
}
```

**Validation:** All fields required. Username must match `^[a-z0-9_]{3,24}$`. Password >= 8 chars.

**New helpers:**
- `checkUsernameAvailable(endpoint, token, username) (bool, error)` — `GET /api/users?search.username=X`, exact match comparison
- `updateUserIdentity(endpoint, token, userID, username, name) error` — `PATCH /api/users/{id}` with `{username, name}`. On Logto 422 (username taken), return a distinct error.

**Extended helpers:**
- `updateUserProfile` — add `givenName` and `familyName` to the profile payload alongside gender and birthdate

**Handler flow:**
1. Parse + validate (including username format regex)
2. Get M2M token + config
3. Find user by email
4. Verify super_user role
5. Check username available (if not, return 409)
6. Update password
7. Update profile (gender, birthdate, givenName, familyName)
8. Update identity (username + combined "First Last" name). On 422 → return 409 `{"error": "Username was taken, please choose another"}`
9. Return `{success: true, username: req.Username}`

### 3. Backend — New endpoint `HandleCheckUsernameAvailable`

- Route: `GET /invite/username-available?email=X&username=Y` (no auth)
- Validates both params present
- Validates username format (`^[a-z0-9_]{3,24}$`) — if invalid, return `{available: false, reason: "invalid"}`
- Finds user by email, verifies super_user role (Option A auth). On failure → 403
- Calls `checkUsernameAvailable()` — return `{available: bool}` or `{available: false, reason: "taken"}`

### 4. Frontend — API Client (`myscrollr.com/src/api/client.ts`)

- Extend `CompleteInviteRequest`: add `username`, `first_name`, `last_name`
- Add `CheckUsernameResponse`: `{ available: boolean, reason?: 'invalid' | 'taken' }`
- Add `inviteApi.checkUsernameAvailable(email, username)` — `GET /invite/username-available?email=X&username=Y`, unauthenticated

### 5. Frontend — Invite Page (`myscrollr.com/src/routes/invite.tsx`)

**Layout changes:**
- Remove standalone "Email" read-only field
- Add email to greeting: "Welcome, alice@example.com"
- Add fields: First Name, Last Name, Username (above birthday)
- Field order: First Name → Last Name → Username → Birthday → Gender → Password → Confirm Password

**Username field behavior:**
- Controlled input, lowercase enforced via `onChange`
- Format validation client-side: `^[a-z0-9_]{3,24}$`
- On blur: if format valid, call `inviteApi.checkUsernameAvailable(email, username)`
- State: `idle | checking | available | taken | invalid`
- Visual: inline spinner while checking, green check if available, red X if taken/invalid
- Helper text below field shows status

**Submit button disabled when:**
- Any required field empty
- Passwords don't match or < 8 chars
- Username format invalid
- Username check in-flight
- Username check returned `taken`

**409 handling:** On submit, if backend returns 409, set username state to `taken`, show inline error.

## Out of Scope

- Email re-verification
- Profile avatar upload
- Admin UI for invites
- Anything in Tranches B or C
