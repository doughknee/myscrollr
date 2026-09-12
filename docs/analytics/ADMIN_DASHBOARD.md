# Admin dashboard — metric definitions and sources

The staff Overview (`/admin`) and Analytics (`/admin/analytics`) answer a fixed
set of questions. This file is the contract behind every number on them: what
each metric means, which source it is read from, how far back it reaches, and
what it deliberately does not claim. `docs/analytics/POSTHOG.md` remains the
PostHog collection contract; this file covers the first-party measurements and
the reporting rules. (SCROLLR-210)

## Time contract

One selector, shared by every historical card: **24h / 7d / 30d / Lifetime**,
default 7d. Every period is a rolling window `[start, end)` where `end` is the
report cutoff, one `now` taken once per request and echoed back as
`generated_at`, and `start = end − length`. 24h is the last 24 hours, never
"today since midnight".

* Finite periods are compared with the immediately preceding equal-length
  window `[start − length, start)`. Lifetime has no comparison.
* A comparison is only rendered when the previous window is fully inside the
  measurement's coverage and its denominator is not zero; otherwise the API
  returns the previous value with `comparable: false` and a reason.
* Chart buckets are aligned to `start` (hourly for 24h, daily for 7d/30d,
  daily for Lifetime) and clipped to `[start, end)`. They never expand the
  range: the first and last bucket are partial and labelled as such.
* Period-wide unique users are computed as `count(DISTINCT account)` over the
  window, never by summing daily uniques.

"Now" metrics — the registered-account total, live desktop presence, the
current paying-customer total and plan mix, and current support status totals
— do not depend on the selector and are labelled "current".

Missing data is `available: false` with a note, never zero. Partial history is
returned with `coverage.from` and `coverage.partial: true`.

## Staff exclusion

`GET/PUT /admin/settings` holds one server-backed key,
`exclude_staff_from_analytics` (default **on**). When on, accounts in
`admin_users` (pinned by sub) and the `POSTHOG_EXCLUDED_LOGTO_SUBS` list are
removed from: registered-account totals and growth, desktop presence and usage
(live and historical), widget analytics, and identified website analytics where
the data carries `is_internal`. It never changes payments, fees, refunds,
earnings, or operational support totals, and it never changes a user's own
analytics consent. Test and synthetic traffic is excluded regardless of the
toggle: the `POSTHOG_EXCLUDED_LOGTO_SUBS` accounts are never enrolled, so they
never write a presence, widget or daily-activity fact, and the audience report
drops them before counting.

Staff desktop measurements are collected under the same consent as everyone
else's, stored with `internal = true`, and hidden by the toggle. The flag is
derived at write time from the enrollment row **or** membership of
`admin_users`, so an account made staff after enrolling is internal from its
next check-in. Measurements suppressed before this change (staff daily
activity facts, identified staff website sessions) were never stored and
cannot be restored by the toggle. One exception is stated on the page: peak
concurrency is sampled from customers only, whatever the setting.

## Desktop presence

### Reporting

The Rust core of the desktop app owns one **presence reporter** per process
(`desktop/src-tauri/src/presence.rs`). It runs while the app runs — including
with every ticker hidden and the main window closed to the tray — and stops on
quit. Each ticker window reports its own screen state to it through the
`report_screen_state` command whenever the rendered set changes; the main window
hands it the API base once through `configure_presence` (disabled in demo
builds). On every tick the reporter reads the signed-in token and the **Share
usage analytics** decision straight from the app store, so it never keeps a
token and never sends for an account that turned the setting off. Debug builds
(`tauri dev`) do not report unless `SCROLLR_PRESENCE_DEV=1` is set, so local
development never lands in production presence.

Every ~30 s the reporter `POST`s `/users/me/presence` with:

| field | meaning |
|---|---|
| `session_id` | random 128-bit id (32 hex characters) minted at app launch; never persisted, never derived from hardware |
| `seq` | monotonically increasing per session |
| `session` | `unlocked` / `locked` / `unknown` (Windows: `WM_WTSSESSION_CHANGE`) |
| `input` | `recent` / `idle` / `unknown` (Windows: `GetLastInputInfo`; idle = no input for 5 minutes) |
| `display` | `awake` / `asleep` / `unknown` (Windows: `GUID_CONSOLE_DISPLAY_STATE`) |
| `ticker` | `disabled` / `shown` / `hidden` — the Show ticker preference and whether any ticker window is visible |
| `screens[]` | one entry per ticker window: `{ screen, shown, widgets[] }`; `widgets` is the set of catalog widget types currently rendered on that screen |
| `ended` | `true` on quit and on system suspend |

Version and OS come from the request's `User-Agent` (`Scrollr/1.6.7 (windows)`),
which the desktop sets on every API call — the same provenance the Versions
page already relies on. Nothing in the payload names a symbol, team, feed URL,
title or custom configuration; widget types are catalog ids (`sports_nfl`,
`news_bbc` — a catalog feed is named by its id, a custom feed only ever as
`rss_custom`), validated against the server catalog, and anything else is
dropped.

Windows signals (`desktop/src-tauri/src/presence_win.rs`): lock/unlock from
`WM_WTSSESSION_CHANGE` on a hidden window registered with
`WTSRegisterSessionNotification` (connect/disconnect reasons are ignored; the
session starts `unlocked` because Windows exposes only the transitions);
display on/off/dimmed from a `GUID_CONSOLE_DISPLAY_STATE` power-setting
callback; suspend/resume from a suspend-resume callback — suspend sends the
`ended` check-in within 2 s and resume lets the loop start a fresh interval
(the server credits nothing across the gap); idle from `GetLastInputInfo`,
which is the time since the last keyboard or mouse event and nothing about
the event. Quit (`RunEvent::ExitRequested`) sends `ended` the same way. If the
stored token has expired or the server answers 401, the reporter asks the main
window to refresh it and skips that tick; nothing is sent unauthenticated.

On macOS and Linux the session, input and display dimensions report `unknown`
in this release. They are not interpreted as unlocked or awake. Sleep on those
platforms is not reported; the session expires naturally.

The server accepts a check-in only for an account with usage analytics enabled
(`product_analytics_enrollments`), the same enrollment that governs the daily
activity facts; opting out deletes every presence and widget row for the
account (cascade), as does account deletion.

### Live headline

Live state lives in Redis: one key per `(account, session)` with a 90 s TTL and
a sorted index scored by last check-in. The Overview strip reads every
non-expired session and reports:

* **active users** — distinct accounts with at least one current session (the
  app is running and reported within 90 s; this is presence, not attention).
* **with ticker(s)** — of those, accounts with at least one screen `shown`
  while the session is not `locked` and the display is not `asleep`.
* **screens** — the number of `shown` screens across all current sessions.
  Two ticker windows on one computer are two screens; two computers are two
  sessions and their screens add.

`ended: true` credits the final interval, drops the session from the live index
and leaves a tombstone under its key for the expiry, so a check-in of that
session still in flight when the app quit is rejected as stale instead of
resurrecting it. A stale check-in can never overwrite a newer session because
sessions are keyed individually and the previous state is read under the
account's lock.

### Duration and history

Durations are credited at check-in time from the interval between the previous
and the current check-in of the same session, using the **state that held at
the start of the interval**. An interval longer than 90 s is an unexplained gap
and credits nothing. Intervals are split at UTC hour boundaries and written to:

* `presence_session_hourly (logto_sub, session_id, hour, os, app_version, internal, running_seconds, ticker_seconds, screen_seconds, max_shown_screens)` — per session (per computer).
* `presence_account_hourly (logto_sub, hour, internal, running_seconds, ticker_seconds)` — per account, where overlapping sessions are counted once through a per-account watermark (`presence_watermarks`).
* `presence_widget_hourly (logto_sub, session_id, screen, hour, widget_type, screen_seconds)` and `presence_widget_account_hourly (logto_sub, hour, widget_type, user_seconds)` — per displayed widget type.
* `presence_concurrency_minute (minute, users, ticker_users, screens)` — a 1-minute sample of the live index, upserted with `GREATEST` so two API replicas agree.
* `presence_accounts (logto_sub, first_seen_day, internal)` — the cohort anchor.

Rules: ticker-shown time requires the screen `shown`, the session not
`locked` and the display not `asleep`; idle input does not disqualify anything.
App-running time requires only a current session. Retention is 90 days of
hourly rows and 90 days of minute samples; cohort anchors are kept.

Reported metrics:

| metric | definition |
|---|---|
| Unique app-running users | `count(DISTINCT logto_sub)` over `presence_account_hourly` in the window |
| App-running user-hours | `sum(running_seconds)/3600` over `presence_account_hourly` |
| Ticker-shown user-hours | `sum(ticker_seconds)/3600` over `presence_account_hourly` |
| Ticker screen-hours | `sum(screen_seconds)/3600` over `presence_session_hourly` |
| Peak concurrent users | `max(users)` over `presence_concurrency_minute`, 1-minute samples; customers only regardless of the staff toggle (the page says so when the toggle is off); unavailable under an OS, version or plan filter |
| Single vs multi-screen | sessions in the window by `max_shown_screens` |
| Retention D1/D7/D30 | accounts whose `first_seen_day` is old enough, returning on exactly that day; a cohort is eligible only when its return day is yesterday or earlier and no older than 89 days (the first day the 90-day prune leaves whole); immature cohorts are unavailable, not zero |

The legacy daily facts (`product_activity_daily`, "30 continuous seconds of a
visible ticker with an enabled widget") stay as a separately labelled series.
They are never merged with the presence series.

### Widget types

* **Configured** — a `user_widgets` row exists (server) or a local utility is added.
* **Enabled** — configured and both `enabled` and `ticker_enabled`.
* **Displayed** — measured on a screen by the reporter. A widget waiting its
  turn in rotation is not displayed.

Per type in the window: unique users, share of measured ticker users,
displayed user-hours (deduplicated across screens and computers), screen-hours,
repeat users (active on ≥ 2 UTC days, only for windows ≥ 7d), additions and
removals (`presence_widget_changes`, written by the server-side widget
create/delete handlers for enrolled accounts — local utilities are not
covered), and the change versus the preceding equal period. Filters: OS and
app version (from the session rows), current plan (joined at query time and
labelled as current). Additions and removals honour the plan filter but carry
no OS or version, so under those filters they are unavailable rather than
unfiltered. Every percentage carries its sample count.

## Registered users

* **Total** — Logto's user count minus excluded staff and test subs when the
  toggle is on. Logto is the system of record; `user_preferences` is not.
* **New** — accounts whose Logto `createdAt` falls in the rolling window,
  paged from the Management API (100 per page, cached 5 minutes). Compared
  with the preceding window.
* **Lifetime registrations** — only accounts that still exist. Purged accounts
  (`user_deletion_requests.status = 'purged'`) are counted and disclosed as
  the gap; history before local deletion tracking is unknown.

## Website

PostHog HogQL queries through `POSTHOG_API_HOST` with the personal API key
(needs `query:read`). Unique visitors are `count(DISTINCT person_id)` over
`$pageview` in `[start, end)`; pageviews are `count()`. Breakdowns: top paths,
referring domains and campaigns as the website already records them. A person
is a browser profile merged on sign-in; it is not guaranteed to be one human.
Collection started 2026-09-11; earlier windows are partial and say so.

## Paying customers and earnings

**Paying customer** — a `stripe_customers` row with `lifetime = true`, or
`plan <> 'free'` and `status = 'active'` (`billing.PayingWhere`). Trials
(`trialing`), overdue (`past_due`) and canceling (`canceling`, entitled until
the period ends) are reported as their own rows and are not paying. Rows with
`status = 'canceled'` have lost access. Overview, Support and Revenue all use
this one predicate.

**Plan mix** — plan name split into tier (uplink / pro / ultimate) and interval
(monthly / annual); lifetime is its own access type.

**Net earnings** — from Stripe balance transactions in `[start, end)` by
transaction `created` time: `sum(net)` of customer payments (`charge`,
`payment`) plus refunds (`refund`, `payment_refund`; negative) plus refund
reversals (`refund_failure`) plus dispute adjustments (`adjustment`, including
the dispute fee) plus standalone Stripe fees (`stripe_fee`, `tax_fee`,
`stripe_fx_fee`). `net` is `amount − fee`, so fees are subtracted exactly
once. Payouts, transfers, top-ups, reserves and balance holds are movements of
funds and are excluded; any transaction type outside the classified list is
reported separately as unclassified and left out of the total. Amounts are
grouped by currency and never converted. Lifetime coverage starts at the
account's earliest balance transaction, which is shown.

**New paying customers** — Stripe customers whose first successful charge with
a positive amount falls in the window, over the complete charge history.
Renewals, upgrades and repeat purchases do not count again; a trial or a
zero-value invoice is not a payment.

## Support

Buckets are computed over the whole queue (no row cap) with the queue's own
classification:

* **Needs attention** — pipeline group `needs_you`.
* **Waiting on customer** — group `waiting`.
* **Completed** — group `handled`, split into closed (`support_cases.status = 'closed'`) and dismissed (skipped draft).

Total is the sum. Paying-customer counts are an overlay using the shared
predicate through the verified account association (`account_source =
'authenticated'`); email-only contacts are unknown, never inferred.

Historical measures use retained timestamps only: created per day
(`opened_at`), completed per day (`closed_at`), first response time (first
`sent` message after the first `user` message), completion time
(`closed_at − opened_at`). Backlog on a past day is estimated from those two
timestamps and labelled as an estimate; reopenings are not reconstructable.
