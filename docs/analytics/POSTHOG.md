# PostHog analytics contract

PostHog is optional and consent-gated. The website and desktop app treat no
decision as **off**. Declining remains off; enabling starts collection from that
point forward and never replays earlier activity.

## Activation gate

This PR does not enable collection. Production activation requires all of:

- the Scrollr PostHog project key and ID plus HTTPS ingest and management hosts;
- a dedicated, non-rotating `POSTHOG_DISTINCT_ID_SALT`;
- a least-privilege personal API key with `person:write` for deletion;
- `POSTHOG_EXCLUDED_LOGTO_SUBS` containing any production test accounts;
- `POSTHOG_CAPTURE_ENABLED=true` on the API and the two website `VITE_POSTHOG_*`
  build variables;
- a privacy/cookie review for the actual countries served; and
- one local-sink verification proving that no forbidden property crosses the
  boundary.

If any server setting is absent, desktop capture is inert. Website code is inert
unless both public build variables exist and the visitor explicitly accepts.

## Event vocabulary

Website: `$pageview`, `signup_completed`, and
`download_selected`. Signup completion is emitted only after the authenticated
API verifies that Logto created the account for the website application in the
last 15 minutes and that it is not a staff or configured test account. Pageviews
contain only a path without query or fragment.
Private account, callback, invite, support, staff, and public-profile routes are
excluded. Download events may contain only `surface` and one of `windows`,
`macos`, or `linux`.

Website events explicitly null IP and disable GeoIP. Each event uses a fresh
random identifier; a pending sign-in keeps one identifier only until signup
verification. Browser browsing
is therefore not linked across events or to an account. SDK identity persistence
is memory-only, and all authenticated browsing is suppressed.

Desktop: `desktop_app_opened`, `desktop_app_running`, and
`desktop_feature_configured`. Feature values are limited to sports, markets, news,
fantasy, predictions, and utilities. `desktop_presence` updates a 15-minute
Redis presence window and is never sent to PostHog. Presence means recently
seen, not attention.

Desktop distinct IDs are HMAC pseudonyms derived from the authenticated account.
They are pseudonymous, not anonymous. Requests explicitly null IP collection.
No email, token, URL, query, symbol, team, feed, content, support text, or
unrelated device activity is accepted by the endpoint.

The API keeps an export mirror of account-linked desktop events: fixed event
name, broad feature category, app version, timestamp, and delivery status. It is
included in the account export. Desktop opt-out removes it after PostHog accepts
the deletion request; account purge removes it immediately and retains only the
minimal remote-deletion tombstone.

The existing first-party `product_activity_daily` facts remain the authoritative
source for measured ticker activation and retention. PostHog is for directional
funnels and exploration; website visitor totals are estimates.

## Opt-out and deletion

Website decline calls the SDK opt-out and reset functions and stops immediately;
previous fixed-field website observations have no durable browser or account
identifier to export or target for deletion. Desktop decline is stored server-side before a deletion request is made, so new
events stop even if PostHog is unavailable. The API bulk-deletes the pseudonymous
person and all prior events; PostHog processes deletion asynchronously. Failed
requests remain `pending` and must be retried before production activation.
Account purge uses the same deletion path. Session replay, autocapture, automatic
pageviews, performance capture, surveys, and person profiles are disabled.
