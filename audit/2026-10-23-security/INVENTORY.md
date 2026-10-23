# Scrollr security hardening inventory — 23 October 2026

Scope: security only, after the Maxxspace SSRF incident. Preserve customer feeds, signup and login. P0 blocks shipping; P1 requires prompt remediation; P2 is defense in depth. Audit with source and disposable fixtures; production reads only, no attack traffic or real account deletion. Prior reports remain intact.

## Runtime and surfaces

- Go 1.25/Fiber core (`api/core/server.go`): public feed/events/catalog/status/profile; account preferences/widgets/export/deletion; billing; GitHub connection; staff administration, analytics and support actions.
- React 19/Vite/TanStack static website (`myscrollr.com/src/routes`, Dockerfile): marketing, account/auth callback/invite, checkout and staff console. Logto auth and bearer API requests.
- React/Tauri desktop (`desktop/src`, `desktop/src-tauri`): shared ticker and main window, signed updater, PKCE, native HTTP and SSE. Commands: auth, diagnostics, GPU, open_external, sse, system_info, window and Windows appbar; compositor process integrations in compositor/*.rs. Dev command bus must remain dev-only.
- Rust ingestion (`channels/{rss,finance,sports}/service/src`): user RSS HTTP fetching, finance WebSockets and sports polling. Core `ingestread` owns authorization and feed registration.
- PostgreSQL, Redis, Sequin CDC, Logto external auth, DOKS/DOCR (`k8s`, `.github/workflows`). Core startup owns migrations. Services independently deployed.

## Sensitive inputs and integrations

- JWT/account access: platform/auth.go, accounts/access.go, accounts/extension_auth.go, accounts/logto_admin.go; admin membership admin/auth.go and handlers_admins.go.
- Payments: billing/billing.go and stripe_webhook.go; inbound /webhooks/stripe.
- Inbound /webhooks/sequin, /webhooks/osticket/thread-message, /webhooks/discord/interactions, /webhooks/github/{pr-closed,release-published}; corresponding events, support, and core handlers.
- Bearer link support approvals (/support/send,edit,skip), internal support search/digest, /ops/release finish/status, public support/business lead endpoints; verify each handler-level authorization.
- GitHub OAuth callback/connect and data requests: githubapp/githubapp.go, board.go, prs.go.
- Logto management and token endpoints: accounts/*.go. Stripe fixed SDK endpoint. Support outbound osTicket, Discord, Linear, Anthropic: support/{support,discord,linear,ai_triage,ai_known_issues,support_drafts,shipped_followup}.go.
- PostHog consent/relay/query: accounts/posthog_analytics.go, posthog_query.go. Sentry telemetry privacy enforced by scrubber tests; never emit credentials, customer data, bodies or IPs.
- RSS destination validation and DNS/redirect handling: platform URL validation plus RSS Rust network implementation. Metadata egress policy already added.
- Long-running: SSE events/admin support streams, cache warmers, RSS janitor/account deletion grace scheduler, ingester polling; examine revocation on existing connections.

## Existing known work

- SCROLLR-369 suspended-account enforcement and JWT stream expiry deployed; SCROLLR-370 CAPTCHA and custom-feed quotas deployed; SCROLLR-371 account-scoped feed export/purge deployed without deleting shared targets.
- SCROLLR-341 pending concurrent last-admin revocation and admin membership stream revalidation. Prior source-only evidence in audit/2026-10-20/SECURITY.md.
- DigitalOcean investigation of potentially exposed worker observability credentials remains unresolved; current source fixes cannot establish historic non-access.

## Audit split

- API review: auth/authorization, account isolation, callbacks/webhooks, injection, SSRF and support integration boundaries; report API.md.
- Desktop/web review: capabilities, IPC table, CSP, injection, secret storage, native endpoint restrictions; report CLIENTS.md.
- Main: current dependency audits, production configuration/least privilege, triage and safe remediation. Do not print secret values or inspect customer content.
