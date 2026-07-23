# Sprint 3 — Backend Tier Enforcement

**Date:** 2026-04-18
**Branch:** `feature/sprint-3-tier-enforcement`
**Status:** Spec → Build

## Problem

The v1.0 launch audit flagged this as a **BLOCKER**: tier limits are
enforced only in the desktop frontend. A user can bypass every cap with
three lines of fetch:

```js
await fetch('/users/me/channels/finance', {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ config: { symbols: [...10_000 tickers...] } })
})
```

Once accepted, the Rust ingestion service picks up the config from the
DB and starts subscribing to every symbol. That's a direct route to
blowing out our TwelveData / Yahoo / api-sports budgets on a single
free account.

## Scope

**In scope (Sprint 3):**

1. Server-side validation of channel config on `POST /users/me/channels`
   and `PUT /users/me/channels/:type`.
2. Auto-prune of oversized configs on subscription downgrade webhook so
   a tier change doesn't leave a user silently over-limit.

**Out of scope (deferred):**

- Fantasy league count (goes through `channels/fantasy/api` import flow,
  not `/users/me/channels`). Track separately.
- Defense-in-depth caps in the Rust services. The Go API is the only
  write path to `user_channels.config`; capping in Rust adds no real
  defence if the Go API is compromised, but it doubles the maintenance
  surface. Skip for now.
- Per-user API-call budgets (TwelveData / Yahoo). These would matter if
  the concern were *churn* (user constantly adds/removes symbols to
  rack up a bill). Current threat model is *static overconfiguration*,
  which config-shape enforcement solves at the root.

## Config shapes

The Go API inspects channel config in JSONB. Shapes:

| Channel | Shape | Cap field |
|---------|-------|-----------|
| `finance` | `{ symbols: string[] }` | `Symbols` |
| `sports` | `{ leagues: string[] }` | `Leagues` |
| `rss` | `{ feeds: [{ name, url, is_custom? }, ...] }` | `Feeds` (total), `CustomFeeds` (where `is_custom === true`) |
| `fantasy` | Not stored in user_channels.config (deferred) | — |

## Validator contract

```go
// ValidateChannelConfig returns nil if the config fits within the caps
// for the given tier, or a *TierLimitError describing exactly which cap
// was breached (for a helpful 400 response).
func ValidateChannelConfig(tier, channelType string, config map[string]any) error
```

`TierLimitError` structure:

```go
type TierLimitError struct {
    Tier        string
    ChannelType string
    Field       string // "symbols" | "feeds" | "custom_feeds" | "leagues"
    Limit       int
    Got         int
}

func (e *TierLimitError) Error() string
```

The handler converts this to HTTP 403 with a body the UI can parse:

```json
{
  "status": "tier_limit_exceeded",
  "error": "Your tier allows 5 symbols; you tried to save 10.",
  "detail": {
    "tier": "free",
    "channel": "finance",
    "field": "symbols",
    "limit": 5,
    "got": 10
  }
}
```

## Handler wiring

`CreateChannel` and `UpdateChannel` both call the validator after
`BodyParser` and before DB write. `CreateChannel` only validates if
`req.Config` is non-nil (empty-config creates are fine — they end up as
`{}` which is zero items). `UpdateChannel` only validates if
`req.Config != nil` (partial updates that only flip `enabled`/`visible`
shouldn't re-check caps).

Tier resolution uses the existing `tierFromRoles(GetUserRoles(c))`.

## Auto-prune on downgrade

`handleSubscriptionUpdated` in `stripe_webhook.go` already removes and
re-assigns Logto roles after a plan change. We piggy-back there:

1. After the new role is assigned, look up the user's DB tier string.
2. Iterate `user_channels` for that `logto_sub`.
3. For each over-limit config, trim the oversized array to the new cap
   and `UPDATE` the row.
4. For RSS, trim custom feeds first (they're the scarcer resource) then
   non-custom.
5. Log every prune at `[Webhook] pruned <channel> <field>: N → cap`.

We do **not** notify the user in-app yet — v1.0 ships with a log-only
prune. A banner is a v1.1 polish.

We also do **not** invalidate the user's dashboard cache from the
webhook (that path already invalidates on role change via a separate
code path).

## Backwards compatibility

Users already configured over-limit (shouldn't exist per frontend
gating, but edge cases) can't save anything without dropping under the
cap first. They'll see the 403 error with a clear message. Existing DB
rows are untouched until they edit or downgrade.

## Tests

`api/core/tier_limits_test.go` gains:

- Table test covering each (tier × channel × field) boundary: exactly
  at limit accepted, one over rejected.
- `free` tier rejecting `custom_feeds > 0`.
- `super_user` accepting any size.
- Unknown tier → treated as `free` (defensive default).
- Unknown channel type → validation skipped (new channels register
  dynamically; tier_limits.go doesn't know about them until we extend
  the switch — not an error).

## Risk

- **Paid customer configures 26 symbols at Uplink**: frontend gate
  prevents this; if they somehow bypass (direct API), they get a clear
  403 instead of silent runaway usage.
- **Trial user at Ultimate drops back to free**: auto-prune trims their
  200 symbols to 5, their 50 feeds to 1. We log the prunes for
  investigation if support is contacted. Acceptable for v1.0 given the
  alternative is a $500 TwelveData invoice.
- **Webhook race** (subscription.updated fires twice): idempotent —
  trimming already-at-cap rows is a no-op.
