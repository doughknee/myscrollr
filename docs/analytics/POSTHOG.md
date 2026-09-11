# PostHog analytics contract

PostHog is used only for the fixed website and desktop measurements below. The
website defaults on only when a fresh local country lookup resolves the request
to the US; every other or unknown location asks first. Signed-in desktop accounts
are enabled by default and can opt out at any time. A saved decline is durable
and never silently changed back to enabled.

## Production configuration

Production capture requires the Scrollr project key, HTTPS ingest host,
non-rotating `POSTHOG_DISTINCT_ID_SALT`, and `POSTHOG_CAPTURE_ENABLED=true`.
Deletion also requires the project ID, HTTPS management host, and a
least-privilege personal API key with person deletion access. Staff and test
accounts belong in `POSTHOG_EXCLUDED_LOGTO_SUBS` and never emit events.

The API image contains DB-IP Country Lite under its CC BY 4.0 license. Update
`DBIP_COUNTRY_RELEASE` and `DBIP_COUNTRY_SHA256` in `api/Dockerfile` together
after DB-IP's monthly release. The build verifies the compressed download before
shipping it. The policy endpoint returns only `default-on` or
`consent-required`, uses `private, no-store`, and fails consent-first when the
database is missing, unreadable, unresolved, or more than 45 days old. The
visitor IP never leaves the API for this lookup.

The endpoint ignores `X-Forwarded-For`. It accepts only the single
`X-Real-IP` value overwritten by ingress-nginx, and only when the TCP peer is
inside the cluster. `k8s/network-policies.yaml` independently limits core-api
ingress to the ingress-nginx namespace.

## Event vocabulary

Website events are `$pageview`, `signup_completed`, and `download_selected`.
Public pageviews contain a path without query or fragment, a same-origin URL
rebuilt from that path, domain-only external referrer, and validated
`utm_source`, `utm_medium`, and `utm_campaign` values. Private account, admin,
callback, invite, support, and public-profile routes are excluded. Download
events may add only `windows`, `macos`, or `linux`.

After consent, PostHog keeps its anonymous distinct ID in first-party local
storage so unique visitors, sessions, and campaign-to-conversion funnels work
across visits. When an eligible visitor signs in, the browser SDK identifies
them with the server's HMAC account pseudonym and merges the prior anonymous
journey. The raw Logto subject and email never enter PostHog. Staff and
configured test accounts remain suppressed. Signup completion is emitted only
when Logto confirms a website account created in the prior 15 minutes.

Desktop events are `desktop_app_opened`, `desktop_app_running`, and
`desktop_feature_configured`. Feature values are limited to sports, markets,
news, fantasy, predictions, and utilities. `desktop_presence` updates a
15-minute Redis presence window and is never sent to PostHog. All desktop
events use the same server HMAC pseudonym family as identified website events.

Every transport explicitly nulls IP collection and disables GeoIP. No email,
token, query string, symbol, team, feed, page content, support text, session
replay, autocapture, performance capture, survey, or unrelated device activity
is accepted.

The API keeps an export mirror of account-linked desktop events: event name,
broad feature, app version, timestamp, and delivery status. The existing
first-party `product_activity_daily` facts remain authoritative for measured
ticker activation and retention; PostHog is for visitor, signup, download, and
directional product funnels.

## Opt-out and deletion

Website decline stops capture immediately and clears the local PostHog
identity. Desktop decline is written server-side before any vendor deletion
request, so new events stop even when PostHog is unavailable. The API requests
bulk deletion of the account pseudonym and its events. Failed deletion requests
remain pending for retry. Account purge follows the same deletion path and
removes the local event mirror immediately.
