# Sprint 4 — GDPR Export + 30-day Soft-Delete

**Date:** 2026-04-19
**Branch:** `feature/sprint-4-gdpr`
**Status:** Spec → Build

## Problem

The v1.0 launch audit flagged this as a **HIGH** blocker. Our Privacy
Policy promises users can delete their account and export their data,
but neither endpoint exists. Today the only path is "open a GitHub
issue" — not GDPR Article 17 compliant for EU users.

## Scope

**In scope:**

1. `GET /users/me/export` — JSON archive download.
2. `POST /users/me/delete` — schedule purge in 30 days.
3. `POST /users/me/delete/cancel` — cancel a pending purge.
4. `GET /users/me/delete/status` — UI polls this to render a "your
   account will be deleted on X" banner with a Cancel button.
5. Background purge worker: scans `user_deletion_requests` for expired
   pending rows, cascades the delete, marks the row `purged`.
6. Website UI: Export + Delete buttons on `/account`, two-step confirm
   modal with type-to-confirm, pending-deletion banner.

**Out of scope:**

- Email notifications about deletion request. User sees the in-app
  banner and can cancel from there; adding email is a v1.1 polish.
- Admin-initiated delete. Sprint 5 hygiene may add an admin view.
- Desktop app UI. The website is the canonical account-management
  surface; desktop links out to `/account`.

## Data export shape

Single JSON file with stable top-level keys. Content-Type
`application/json`, `Content-Disposition: attachment;
filename="myscrollr-export-YYYY-MM-DD.json"`.

```json
{
  "exported_at": "2026-04-19T19:00:00Z",
  "user": {
    "logto_sub": "...",
    "email": "user@example.com",
    "username": "...",
    "name": "..."
  },
  "preferences": { /* user_preferences row as-is */ },
  "channels": [ /* user_channels rows as-is, config + timestamps */ ],
  "subscription": {
    "plan": "...",
    "status": "...",
    "lifetime": false,
    "current_period_end": "..."
    /* stripe_customer_id + subscription_id omitted — server-internal */
  },
  "fantasy_leagues": [ /* yahoo_user_leagues joined to yahoo_leagues.data */ ],
  "notes": "Yahoo OAuth tokens are omitted intentionally for security."
}
```

Deliberately excluded:
- Encrypted Yahoo refresh_tokens (security risk if exported).
- Internal Stripe IDs (not user-visible data).
- Sequin webhook metadata.

## Soft-delete storage

New table `user_deletion_requests`:

```sql
CREATE TABLE user_deletion_requests (
  logto_sub        TEXT PRIMARY KEY,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_at         TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  canceled_at      TIMESTAMPTZ,
  purged_at        TIMESTAMPTZ
);
CREATE INDEX user_deletion_requests_purge_at
  ON user_deletion_requests (purge_at) WHERE status = 'pending';
```

Status values: `pending` | `canceled` | `purged`. Primary key on
`logto_sub` so a user cannot have two pending requests; re-requesting
while pending is a no-op (idempotent).

`purge_at = requested_at + 30 days`.

## Endpoints

### `GET /users/me/export`

- Assembles the export by querying all user-scoped tables.
- Streams JSON with `Content-Disposition: attachment`.
- Rate-limited at the global 120/min/IP (no stricter gate yet — the
  body is ~KB-scale for a typical user).

### `POST /users/me/delete`

Body:

```json
{ "confirm": "DELETE MY ACCOUNT" }
```

- If `confirm` string doesn't match exactly, returns 400.
- If user has an active/trialing/canceling/past_due subscription,
  returns 409: `"Cancel your subscription before deleting your
  account."` (Avoids accidentally deleting a paying customer mid-trial.)
- If lifetime, allowed (we anonymize the stripe row at purge time).
- Upserts `user_deletion_requests` with `purge_at = now() + 30 days`.
- Returns `{ status: "pending", purge_at }`.

### `POST /users/me/delete/cancel`

- Updates the pending row to `status='canceled', canceled_at=now()`.
- Returns 404 if no pending row exists.
- Returns `{ status: "canceled" }`.

### `GET /users/me/delete/status`

Returns either:
- `{ status: "none" }` if no row.
- `{ status: "pending", requested_at, purge_at }`.
- `{ status: "canceled", canceled_at }`.
- `{ status: "purged", purged_at }` (shouldn't happen — the user can't
  sign in with their purged account — but included for defense).

## Purge cascade

Executed by a background worker every hour, plus once on server
startup. For each row where `status='pending' AND purge_at <= now()`:

1. **Channels**: `DELETE FROM user_channels WHERE logto_sub = $1`.
2. **Fantasy**: `DELETE FROM yahoo_user_leagues WHERE logto_sub = $1`.
   Orphaned `yahoo_leagues` / `yahoo_standings` / `yahoo_matchups` /
   `yahoo_rosters` rows stay (shared across users if ever; don't
   cascade-delete data that might serve other accounts).
3. **Yahoo tokens**: `DELETE FROM yahoo_users WHERE logto_sub = $1` (or
   equivalent column — need to inspect fantasy schema).
4. **Stripe**: Two cases:
   - If `lifetime=true`, anonymize: set `logto_sub = 'deleted-<uuid>'`,
     clear `updated_at`, keep the row for tax records.
   - Otherwise `DELETE FROM stripe_customers WHERE logto_sub = $1`.
5. **Preferences**: `DELETE FROM user_preferences WHERE logto_sub = $1`.
6. **Logto user**: `DELETE {endpoint}/api/users/{logto_sub}` via M2M.
7. **Mark row**: `UPDATE user_deletion_requests SET status='purged',
   purged_at=now() WHERE logto_sub = $1`.

Wrapped in a DB transaction for steps 1-5. Steps 6 (Logto) and 7 run
after commit so a Logto failure doesn't roll back the local purge — a
manual cleanup path exists if Logto fails (re-run the worker after Logto
recovers; our DB rows are already gone, so the second attempt only
needs to call Logto again and mark the row).

Actually: running logto delete first is safer — if it succeeds we
guarantee the user can't sign in. If it fails we retry without losing
DB state. Let me do that:

1. Logto delete first (outside transaction).
2. DB transaction: delete all local rows.
3. Mark `user_deletion_requests.status='purged'`.

If Logto fails, log the failure and leave the row as `pending` with a
bumped `purge_at = now() + 1h` so it retries on the next worker pass.

## Subscription guard

The `POST /users/me/delete` endpoint refuses when the user has a live
subscription. The rule prevents a user from paying us monthly for a
deleted account, and from losing access immediately (since cancel is
end-of-period, not immediate). UI copy: "Cancel your subscription
before deleting — once canceled, your access continues until the
current period ends, and you can delete immediately after."

If lifetime, skip this check — lifetime revenue is one-time, and
deletion anonymizes the row for Stripe tax records.

## Frontend UX

**Account page (`myscrollr.com/src/routes/account.tsx`):**

1. "Export Your Data" button — calls `GET /users/me/export`, triggers
   browser download. Button shows spinner while the JSON assembles.
2. "Delete Account" button — opens confirm modal.

**Confirm modal:**

- Headline: "Permanently delete your account?"
- Body explains 30-day grace window, what's deleted, what's kept (for
  lifetime: "your purchase record stays, but your personal info is
  anonymized").
- Text input: "Type **DELETE MY ACCOUNT** to confirm."
- Disabled button until text matches exactly.
- Confirm triggers POST. On success, modal shows "Scheduled for purge
  on YYYY-MM-DD" + "Cancel Deletion" button.

**Pending-deletion banner:**

- Inlined in `account.tsx` when `GET /users/me/delete/status` returns
  `pending`. Single block at top: warning color, countdown, "Cancel
  Deletion" button. One-click cancel (no confirm — canceling is safe).

## Tests

- Validator rejects wrong confirm string → 400.
- Active subscription blocks deletion → 409.
- Lifetime user allowed → 200.
- Idempotent: second POST within 30 days returns existing row.
- Cancel only works on pending.
- Purge worker handles: trailing `canceled` rows (no-op), past-due
  `pending` rows (cascade), future-dated pending (skip).
- JSON export omits sensitive fields.

## Risk

- **Accidental mass-delete**: purge worker hits expired rows only. If a
  bug sets `purge_at` in the past for many rows, we purge them. Mitigation: add a minimum `purge_at >= requested_at + 24h` sanity check
  in the worker so any request less than 24h old is skipped even if
  manually written.
- **Logto failure**: logged + row left pending, retried hourly.
- **Stripe webhook race**: cancellation webhook fires after user
  clicked delete → handleSubscriptionDeleted tries to purge their row,
  but the stripe_customers row might already be anonymized. Handler
  uses `WHERE logto_sub = $1`; if row is missing or anonymized, update
  is a no-op. Safe.
