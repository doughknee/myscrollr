# Invite Token Verification — Sprint 1B

## Problem

`POST /invite/complete` accepts a `token` field in its request body but never
validates that token against Logto. The current authorization check is
"the email maps to a user that has the `super_user` role." Anyone who
knows an invited email address can submit the endpoint with a bogus token,
set the user's password, and take over the account on next sign-in.

Reference: `api/core/invite.go:40-114`. The verification call was present
historically but was removed in commit `6fc0dad` because the frontend
flow consumed the same one-time token twice (once on the backend, once
again via `signIn({ extraParams: { one_time_token }})` on the client),
and the second call failed.

This is an account-takeover-class bug scoring BLOCKER in the v1.0 launch
audit (`audit-in-conversation`, Security section A2).

## Goals

1. Reject `POST /invite/complete` unless the caller presents a currently-
   valid Logto one-time token bound to the same email address.
2. Keep the invite flow usable end-to-end: user clicks the emailed link,
   fills out the form, completes setup, and ends up signed in.
3. Fail safely: no silent bypasses if Logto is down, and no dangling
   half-migrated state if any step in the setup sequence errors.

## Non-Goals

- Changing the invite email template or CLI script (`scripts/invite-super-users.go`).
- Altering any other endpoint's auth model.
- Rotating any credentials — the audit already documented Logto/Resend
  secrets concerns; that's a separate post-launch task.

## Design

### Token lifecycle

Logto's Management API endpoint `POST /api/one-time-tokens/verify`
returns 200 and **consumes** the token on success. A consumed token
cannot be re-verified or used for `signIn({ extraParams: { one_time_token }})`.

This is why commit `6fc0dad` removed the server-side verify — the
frontend was still trying to consume the same token a second time during
sign-in, which broke the UX. The fix is to stop using the OTT as a
sign-in credential entirely and instead have the user sign in with the
password they just chose.

### Server-side verification

`HandleCompleteInvite` runs steps in this order:

1. Body-parse + field validation (unchanged).
2. **New:** call `verifyOneTimeToken(cfg.Endpoint, m2mToken, email, token)`.
   - On non-200, return 400 with `{error: "Invite link is invalid or has expired"}`.
   - The verify request consumes the token, so the rest of the flow must
     not re-send it anywhere.
3. M2M calls to look up user, check `super_user` role, check username
   availability (unchanged).
4. Update password, profile, identity (unchanged).
5. Return `{success: true, username}`.

If any step after `verifyOneTimeToken` fails, the token is already burned.
We surface an actionable error and log enough detail for support to
generate a fresh invite.

### Frontend flow

After `POST /invite/complete` returns 200 the client must NOT call
`signIn({ extraParams: { one_time_token }})` — the token is consumed.
Instead:

1. Persist return path `/account` in `sessionStorage('scrollr:returnTo')`.
2. Call `signIn({ redirectUri: '/callback', extraParams: { login_hint: email } })`.
3. Logto's hosted sign-in screen loads with the email pre-filled.
4. User types the password they just chose.
5. Callback route signs them in and redirects to `/account`.

This adds one "type your password" step to the user journey — an
acceptable trade-off for eliminating the account-takeover vector.

### Error handling

| Failure | HTTP | Body | Frontend behavior |
|---|---|---|---|
| Token verify fails (expired/invalid) | 400 | `"Invite link is invalid or has expired"` | Show error, offer "go to sign-in" if the user already has a password set |
| User lookup fails | 404 | `"Invite not found"` | Show error, no retry |
| Role check fails (no super_user role) | 403 | `"Not authorized"` | Show error |
| Username taken | 409 | `"Username was taken, please choose another"` | Refocus username field, flip state to `taken` |
| Password / profile / identity update fails | 500 | `"Failed to complete setup"` | Show error, advise contacting support (token consumed, user needs fresh invite) |

## Implementation plan

### Backend — `api/core/invite.go`

1. Add helper `verifyOneTimeToken(endpoint, token, email, ott string) error`
   that POSTs to `{endpoint}/api/one-time-tokens/verify` with body
   `{"token": ott, "email": email}` and returns nil on 2xx, error otherwise.
2. In `HandleCompleteInvite`, after M2M token acquisition, call
   `verifyOneTimeToken(cfg.Endpoint, m2mToken, req.Email, req.Token)`.
3. If it errors, return `400 {"error": "Invite link is invalid or has expired"}`.

### Frontend — `myscrollr.com/src/routes/invite.tsx`

1. Replace the existing `signIn({ redirectUri, extraParams: { one_time_token, login_hint } })`
   call with `signIn({ redirectUri, extraParams: { login_hint } })`.
2. Tweak the "signing-in" state message to reflect the new flow
   ("One more step — sign in with your new password" or similar).
3. In the top-level error state, if the submitted token was rejected
   (HTTP 400 with "expired" in message), show a secondary CTA "If you
   already set up your account, sign in here" that calls `signIn({ extraParams: { login_hint: email } })`.

### Deployment

- Branch: `feature/sprint-1b-invite-token-verify`
- Deploy: `core-api` + `website` (both need to ship together — if backend
  deploys alone, current website tries to double-consume; if website
  deploys alone, current backend still lets unauthorized callers in).

## Acceptance criteria

1. A request to `POST /invite/complete` with a missing or invalid `token`
   returns 400 and does NOT modify the user.
2. A request with a valid token succeeds exactly once — a second submit
   with the same token returns 400.
3. The invite flow end-to-end (email link → form → password typed on
   Logto hosted UI → `/account`) works for a test super-user invite.
4. Verified by probing `GET /users/{id}` via M2M: password_changed_at
   advances, username is set, profile gender+birthdate are populated,
   super_user role is preserved.
