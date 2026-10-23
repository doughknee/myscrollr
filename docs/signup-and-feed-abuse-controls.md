# Signup and custom-feed abuse controls

## Signup

Logto's existing sign-in experience uses a managed Cloudflare Turnstile widget
for auth.myscrollr.com. Provider keys belong in Logto, never source control.
Keep the existing username/password and verified secondary-email settings.
Do not block disposable providers, plus addressing, shared IPs, or entire email
domains without evidence and a false-positive recovery process. CAPTCHA raises
the cost of automation; it does not replace RSS destination validation or egress
restrictions.

Before enabling a replacement provider, verify the hostname and keys, briefly
enable CAPTCHA, and test both missing and invalid tokens. Logto may accept
interaction initialization and password verification-record creation without a
token; registration identification must return `session.captcha_required`, and
an invalid token must return `session.captcha_failed`. Do not mistake successful
initialization for successful account creation. Verify the actual browser flow
as well. Social providers and passkeys have their own Logto behavior.

22 October 2026 verification: owner observed Turnstile work and confirmed existing
account sign-in reached the account page in a private window. Negative registration
checks passed. Completing a fresh account through secondary email verification
was not tested. CAPTCHA is enabled; signup fields and verification requirements
were not changed.

## Feed writes

The incident review found at most three saved custom feeds per account and ten
URLs in an individual widget configuration. The limits leave normal use headroom:

- At most 50 saved custom feeds per account and 50 URLs per widget request.
- At most 60 custom-feed config writes per minute, across replicas and IPs.
- At most 100 new custom-feed additions in a 24-hour window. Removing and readding
  a URL consumes another addition; editing an already-saved feed does not.
- Curated-only widgets and visibility/enabled toggles do not consume custom-feed
  budgets. Existing users at a cap can still edit their saved feeds.

Redis applies both budgets atomically. Windows begin on the first accepted write
or addition and do not extend on subsequent requests. A 429 response includes
Retry-After. Redis failure rejects custom-feed writes with retryable 503;
already-ingested reads, curated widgets, and removals keep their existing behavior.
Failed downstream saves may consume budget conservatively, but cannot create
polling targets: widget settings and target rows commit in one database transaction.
An account-level advisory lock serializes concurrent additions. Existing disabled
targets remain disabled when readded.

The saved-feed cap includes feeds retained in the My Feeds catalog even if removed
from a widget. Use the existing custom-feed removal action to free a slot.

## Audit and alerts

Core stores RSS rejections in rss_security_events as hourly counts with first and
last timestamps, a salted account hash, and a fixed reason. No URL, query string,
email, IP, token, or request body is recorded there. The fifth rejection for an
account/reason/hour emits a warning into the existing Sentry project tagged
`feature=rss-abuse`. Sentry routing remains the project's configured alert routing.
Without SENTRY_USER_SALT, counts are anonymous and combined; never rotate that salt.

The existing RSS janitor prunes rows older than 30 days every six hours. Associated
counts are included in the account data export and removed by account purge.
Logto retains its own registration/sign-in audit records; this change does not
extend or backfill that retention. These records establish observed activity,
not proof that an attacker never accessed data outside the retained evidence.

## Deployment and rollback

Migration 000032 adds only the audit table. Verify healthy core replicas, an active
account, feed delivery, and no spike in retryable auth/feed errors after rollout.
Run cap/concurrency, burst, normal-edit, toggle, starter-widget, transaction rollback,
and privacy tests against scratch PostgreSQL. Never use customer data for those tests.

The previous core image can run with the additional table still present; do not
drop the table in production as an image rollback step. Rolling back the code
removes these feed limits. Turnstile is a separate Logto setting: disable only its
CAPTCHA policy if a confirmed challenge failure blocks legitimate signups, preserving
the provider configuration and email verification. Recheck the normal flow afterward.
