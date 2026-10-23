# API and ingestion security review

Scope: Go API and Rust ingestion, source-only validation with disposable-fixture reproduction recipes. No production requests, account changes, secret inspection, or issue-tracker mutations. Applying the app-audit security lens. Client/IPC, dependency audits and deployment configuration are assigned to other reviewers; SCROLLR-341 admin revocation is separately owned.

Status: scoped review complete against baseline `3988d00c78592bdf330dffa084af2f67bbd3157a` and the working tree observed during the review. The main agent is independently changing account/admin code, so API-01 describes the baseline defect and must be reconciled with that remediation before issue creation. No production exploit or historic access is established by this report.

## Findings

### API-01 — P1: Self-service email changes bypass verification trusted by staff bootstrap

- Evidence: `api/internal/accounts/handlers_account.go:207` accepts the caller's requested email; `:264-273` sends it directly as `primaryEmail` using the privileged Logto Management API. No email challenge, verification record, or recent reauthentication exists on this path. `api/internal/accounts/logto_admin.go:510-526` returns that field as a supposedly verified address. `api/internal/admin/auth.go:109-127` claims an unpinned staff row using that address.
- Impact: an authenticated account can adopt an unused allowlisted staff address and claim its pending admin row without controlling that mailbox. Already pinned staff rows and addresses already occupied in Logto are protected by their separate uniqueness/pinning checks; this review did not inspect live allowlist rows. Independently, arbitrary addresses become trusted support/account identities.
- Safe verification: use a fake Logto server accepting the existing profile PATCH and returning the patched primaryEmail, a scratch admin_users row with that address and NULL logto_sub, then execute RequireAdmin as the fixture account. Assert the attack is denied after remediation. Do not attempt against production.
- Small fix: stop direct primaryEmail mutation until the new address is verified through Logto's supported verification flow, and bind staff bootstrap only to independently verified identities.

### API-02 — P1: Approval token verification accepts an empty signing key

- Evidence: `api/internal/support/handlers_support_approval.go:54` rejects empty keys when signing, but `:71-80` verifies using `supportApprovalSecret()` without the equivalent guard; the helper returns empty bytes when both configured secrets are absent (`:43-49`). Expiry is also optional at `:91`.
- Impact: in a deployment missing both secrets, unauthenticated callers can compute an HMAC with an empty key for a chosen numeric draft ID and use the public approval/edit routes to inspect a draft, send a reply or skip it. Missing configuration must disable these routes, not expose them. Current production secret configuration was not inspected.
- Safe verification: clear both environment values in a disposable test, construct a fixture token using HMAC-SHA256 with an empty key, and verify that verifyApprovalToken currently accepts it without any database or outbound request.
- Small fix: reject absent signing keys and missing/expired expiry before accepting any approval token.

### API-03 — P1: GET approval links perform irreversible support actions

- Evidence: `api/core/server.go:325` and `:327` register GET send/skip routes; `api/internal/support/handlers_support_approval.go:131-137` dispatches them directly to `handleApprovalAction`, whose send branch at `:243-255` changes state and sends the customer reply without a confirmation POST.
- Impact: an email security scanner, browser prefetcher or preview that follows the partner's signed URL can approve/send an AI draft or skip it without a human decision. The HMAC authenticates possession of the link, not an intentional approval.
- Safe verification: with a pending scratch draft and stubbed sendApprovedReply, a single GET of a generated send URL records a decision and invokes the send stub.
- Small fix: make GET render a confirmation page and require an explicit POST with the signed action token to execute send/skip.

### API-04 — P1: Failed billing revocations are permanently acknowledged

- Evidence: `api/internal/billing/stripe_webhook.go:57-66` inserts the event ID before processing and returns success for any subsequent delivery. The event handlers return no error and `:97` always acknowledges success. In particular `:306-313` only logs failed paid-role removal. Database lookup/update failures at `:269-300` are also not retryable through the webhook.
- Impact: one transient Logto/database failure during cancellation can leave paid access active indefinitely; Stripe's retry/manual redelivery is skipped because the event is already recorded. This is a durable authorization-state failure, not a signature bypass.
- Safe verification: use a scratch event row and a fake Logto server that fails its first role removal, deliver the same signed fixture twice, and assert the second delivery retries removal. Current source unconditionally skips it. No billing event was sent during this audit.
- Small fix: use processing/completed state with a recoverable claim/lease, propagate handler errors as retryable non-2xx responses, and mark complete only after idempotent side effects succeed. Fail closed on inability to claim the event.

### API-05 — P1: Finance fetch errors log API keys; RSS logs private feed URLs

- Evidence: `channels/finance/service/src/lib.rs:234-237` and `:268-271` place `apikey` in URLs and propagate unredacted reqwest errors; callers log those errors at `:167`, `:206` and `channels/finance/service/src/websocket.rs:449`. The installed reqwest 0.12.28 `src/error.rs:267-268` includes its URL in Display and explicitly provides `without_url`. Separately, `channels/rss/service/src/lib.rs:98-112` logs full custom feed URLs on recovery/failure/quarantine.
- Impact: normal transport failures can place the production market-data API key into application logs. Private RSS URLs can carry subscriber/query tokens, which are likewise written verbatim. No actual logs or keys were inspected, so historic disclosure is not established.
- Safe verification: against a closed loopback port and a synthetic `apikey=AUDIT_SENTINEL`, format the returned reqwest error and confirm it contains the sentinel; then assert the remediated log event does not. For RSS use a synthetic URL with a token query and exercise the error logger. These fixture executions remain to be added.
- Small fix: strip URLs from request/body errors before wrapping/logging, and log a stable feed ID/hash or sanitized origin rather than full RSS URL/name. Keep error class/status for diagnosis.

### API-06 — P1: Discord support actions have no caller authorization boundary (deployment exposure UNCERTAIN)

- Evidence: `api/internal/support/handlers_discord_interactions.go:139-158` validates the Discord signature, then dispatches commands/buttons/modals without checking configured guild, member identity or role. Slash commands include case/search and pause/resume (`:916-930`). `api/internal/support/discord.go:721-725` registers no `default_member_permissions` restriction. [Discord's documentation](https://support-apps.discord.com/hc/en-us/articles/26501864012951-Moderating-Apps-on-Discord) says server app commands are available to members/channels by default; server overrides can restrict them.
- Impact: any guild member allowed to invoke these commands can reach customer case details and support operational controls, even without Scrollr staff access. Signature verification only establishes that Discord delivered the request. Actual guild membership and command permission overrides were not inspected; production exploitability remains UNCERTAIN.
- Safe verification: submit a fixture interaction signed with a test Ed25519 key, containing an unapproved member/guild and a harmless stubbed case command; assert rejection before database/action dispatch. Test approved staff separately. Do not invoke real Discord actions.
- Small fix: enforce configured guild plus an explicit staff member/role allowlist for every command/button/modal, fail closed when absent, and register restrictive default command permissions. Keep Discord-side restrictions as defense in depth.

### API-07 — P1: Cross-customer support messages enter untrusted AI conversations (exfiltration UNCERTAIN)

- Evidence: `api/internal/support/support_cases.go:324-344` retrieves prior user messages and sent replies by similarity with no account filter. `api/internal/support/ai_context.go:257-266` includes their raw text in the prompt, used at `api/internal/support/ai_triage.go:588`. The ticket body is attacker-controlled. Anti-copy prompt text and a substring injection list (`api/internal/support/disposition.go:82`, `:269`) are the only relevant content defenses; auto-send is enabled by default at `:335-340` and `api/internal/support/autosend.go:242` sends model-generated replies.
- Impact: another customer's message content is available to a model answering an untrusted requester, and can enter an automatically sent answer if the model copies or follows a crafted ticket. This audit establishes the data-flow violation; it did not demonstrate model exfiltration or inspect real messages. Exploit reliability is UNCERTAIN.
- Safe verification: seed two synthetic accounts/cases, with a unique harmless sentinel in the first customer's message; inspect the second customer's generated prompt to prove cross-account inclusion. A separate offline/model fixture can evaluate disclosure without sending customer replies. Neither was executed here.
- Small fix: use vetted, anonymized knowledge-base examples or same-account history only. Do not place unrelated private messages in attacker-triggered model context; human approval and substring filters are insufficient substitutes for data isolation.

### API-08 — P1: Invite password reset trusts a fuzzy email search result

- Evidence: `api/internal/accounts/invite.go:296` uses `search.primaryEmail` without an exact search mode. The response omits primaryEmail from its decoded shape (`:315-318`) and blindly returns the first user (`:326-330`). After checking the one-time token against the supplied email (`:102`), the handler changes the found user's password (`:138`). [Logto's documented default search mode is `like`](https://docs.logto.io/user-management/advanced-user-search), including SQL-style wildcard patterns.
- Impact: an invite holder with a wildcard-bearing valid email (for example an underscore in its local part) can match another eligible account and reset that account if it is returned first. The role check applies to the found account, not the token email. Current provider version/result ordering and ability to obtain such an invite were not verified, so real-world exploitability is UNCERTAIN; the missing identity comparison is confirmed.
- Safe verification: fake Logto returns a valid token for `a_ice@example.test` and a first search result for `alice@example.test` with the eligible role. Verify no password PATCH may target that mismatching ID. Also test correct exact match and multiple results.
- Small fix: request `mode.primaryEmail=exact`, decode primaryEmail, require case-insensitive exact equality to the token-bound address, and reject ambiguity before any password/profile mutation.

### API-09 — P2: Signed Discord mutations have unlimited replay lifetime

- Evidence: `api/internal/support/discord.go:1121-1150` explicitly omits timestamp-age validation; the request dispatcher has no interaction-ID deduplication. A valid historical signed pause/resume or regeneration interaction still dispatches.
- Impact: anyone obtaining a signed interaction can replay it later to repeat operational changes. The signature cannot be forged; captured-request access is a prerequisite, so this is lower priority than missing caller authorization. Draft send CAS protects some duplicate-send paths but does not protect policy mutations.
- Safe verification: with a test signing key, sign a fixture timestamp far in the past and call verifyDiscordSignature; current function accepts it. Repeated signed fixture IDs should not execute a stubbed mutation twice.
- Small fix: enforce a bounded timestamp window and shared interaction-ID deduplication; accommodate expected retries by returning the prior acknowledgement, not rerunning effects.

## Coverage and limits

| Surface | Review result |
| --- | --- |
| Account/authentication | JWT signature/expiry, subject, configured issuer/audience and suspended-account gate inspected. Profile identity and invite-target findings above. Missing issuer/audience config weakens claim validation; configuration validation belongs to main's deployment review. Desktop PKCE token proxy uses fixed Logto endpoint/client ID and forwards code verifier; no request-controlled fetch URL found. |
| Account isolation | Widget/preference/export/purge/custom-feed operations use authenticated subject. Custom-feed ownership and recent shared-target preservation checked. Public RSS feed selects curated feeds. No additional direct cross-account SQL authorization bypass established. Staff/SSE concurrency changes remain SCROLLR-341 owner's responsibility. |
| Webhooks | Stripe signature verified before parsing/processing, but retry defect API-04. Sequin and osTicket shared secrets fail closed; Sequin dispatches CDC updates, osTicket dedupes thread entries with persistence checks. GitHub Action PR/release hooks require the configured constant-time shared secret before work. Discord Ed25519 verifies before dispatch but API-06/API-09 remain. |
| Webhook delivery caveat | GitHub PR-close at `api/core/handlers_github_webhook.go:120` starts an unpersisted goroutine and acknowledges before completion; `:183-187` sends no explicit idempotency key to the external reply plugin. Duplicate delivery/restart behavior needs a disposable plugin fixture before claiming idempotency. The external plugin implementation is outside this checkout review. |
| Support and operations | Internal support search/digest and release operations require configured shared keys; approval bearer links use HMAC plus database decision CAS, with API-02/API-03. Admin support HTTP routes have both JWT and staff guards. AI private context/automatic-send boundary is API-07. No live messages or replies used. |
| Injection | SQL interpolations inspected in API paths use fixed clauses/placeholders; public user strings are bound parameters. Support approval HTML uses escaping and normal support rendering helpers. No server-side shell/eval execution of requester input found in reviewed paths. Client HTML/Markdown rendering is the other reviewer's scope. |
| RSS SSRF | Current Rust fetcher validates schemes, credentials, literals and redirect destinations; resolver rejects mixed/private address sets and returns the same sockets to the connector, proxies disabled. API create/update paths call RSS config validation. No new SSRF bypass established. HTTP feeds are intentionally supported and remain transport-tamperable; no TLS verification disabling found in the RSS client. |
| Other outbound services | GitHub OAuth/data uses fixed HTTPS API/Web bases, single-use Redis state and encrypted server-side tokens; state-less install-update path only clears cache/installation bookkeeping, not credentials. Stripe uses SDK endpoint. Linear, Anthropic, Discord, TwelveData and API-Sports/MLB use fixed HTTPS defaults or server configuration; Logto, osTicket and PostHog destinations come from server config. No request-controlled arbitrary network destination found outside RSS. Deployment URL/TLS choices delegated to main. |
| Secrets | GitHub tokens use AES-GCM with nonces and reject missing encryption key. Credential-bearing errors/URLs are API-05. Secret-history scan, runtime config, client bundling/storage and ecosystem audits delegated; no real secrets inspected. |

This was source review, not an adversarial runtime test or a comprehensive proof of absence. The safe reproduction recipes above are proposed regression tests and were not executed in this audit pass. It does not establish whether the Maxxspace accounts accessed credentials/customer information; that remains the separate incident forensics work. No code, tests, production state or issue tracker changed by this reviewer.

## Findings by severity

| Severity | Findings | Qualification |
| --- | --- | --- |
| P0 | None established | Does not establish production safety or resolve historic incident exposure. |
| P1 | API-01 identity verification; API-02 empty approval key; API-03 GET approval actions; API-04 failed revocations; API-05 credential logging | API-01 remediation concurrently owned by main; API-02 depends on absent configuration. |
| P1 | API-06 Discord caller authorization; API-07 cross-customer AI context; API-08 invite search identity | Concrete source defects/data flows; production exposure or exploit reliability explicitly UNCERTAIN. |
| P2 | API-09 Discord replay lifetime | Requires access to a previously signed request. |
