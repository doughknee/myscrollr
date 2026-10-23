# Scrollr security hardening — 23 October 2026

## Verified production protections

- Server release: [server-2026.10.23.2](https://github.com/doughknee/myscrollr/releases/tag/server-2026.10.23.2).
- [Deployment 39918055314](https://github.com/doughknee/myscrollr/actions/runs/39918055314) passed production readiness; all five application deployments were pinned to the reviewed security revision and ready.
- Staff membership changes revalidate authority; revoked staff lose open support streams. Profile email writes are blocked until verified mailbox changes are implemented; display-name updates remain supported.
- Account invitations require an exact, unique primary-email identity match.
- Support approval links use confirmation POST requests, expiring single-use tokens, and fail closed without a signing key. Discord support actions require configured app/guild identity plus Administrator or Manage Server permission.
- Support draft generation no longer retrieves or renders other customers' raw case histories. Website error reports omit request/navigation breadcrumbs and tracing.
- Production application pods no longer mount Kubernetes service-account tokens. Link-local metadata access is blocked; live core-to-ingester readiness requests still succeeded.
- Finance request failures remove provider URLs before logging. Embedded Motion dependency credentials were removed from current desktop and promotional dependency files, and private installation suppresses credential-bearing output.
- Dependency and committed-secret checks now run on relevant pull requests and main commits. No recurring external scheduler was created.

## User data and availability checks

Read-only comparison preserved all 129 RSS target records, the complete URL fingerprint, all 24 custom-feed ownership records and the one target shared by multiple users. All four incident accounts remain suspended. No customer feeds were deleted by this hardening batch. Of the enabled sources, 123 had succeeded within 15 minutes. Three curated sources became enabled during the service restart, consistent with its existing curated-feed startup seeding.

All service health checks were healthy. Public feed, website and auth discovery returned 200. Anonymous protected API routes returned 401/403. The existing signed-in account page loaded its profile and plan without browser console errors. Fresh signup was not repeated; the earlier human Turnstile/login check passed before this batch.

## Desktop release

[Desktop 1.7.2](https://github.com/doughknee/myscrollr/releases/tag/desktop-v1.7.2) is published from reviewed commit 631d7826. PR #518 aligned the updater Rust/JavaScript versions and added a regression test. All platform builds and final publishing/signature jobs passed in [release workflow 39991274744](https://github.com/doughknee/myscrollr/actions/runs/39991274744). Every updater entry was independently verified against the release public key. The Windows application and both installers have valid Authenticode signatures and timestamps from the same signer. macOS app and DMG notarization passed. The public latest.json serves the exact verified 1.7.2 manifest with all nine platform entries preserved from 1.7.1. Users must update to receive desktop protections.

## Remaining risks and owner actions

1. **Urgent: rotate the API-Sports credential (SCROLLR-386).** A key in old git history matches the currently configured production key. Dashboard access is needed to coordinate replacement and verify sports ingestion. Historical disclosure creates provider quota/subscription abuse risk; it is not proof of customer-data access.
2. **Rotate the Motion+ download token (SCROLLR-376).** Removing it from current files does not revoke copies in git history. Use provider controls; do not paste replacements into chat.
3. **DigitalOcean investigation remains unresolved (SCROLLR-368).** The support session expired, so no new provider finding was verified this turn. Current application fixes cannot prove that no historical secrets or customer data were accessed.
4. **Tracked follow-ups:** verified email changes (377), reliable Stripe failed-event retries (381), desktop credential storage/permissions/CSP (383), upstream Windows updater ZIP advisories (385), signed Discord request replay-window enforcement (387), and per-service secret/runtime permission isolation (388).
5. **Dependency exceptions:** Windows updater ZIP advisories remain because a compatible upstream fix is unavailable; updater signatures are checked before extraction. Optional Rust rsa/rkyv packages are excluded from compiled graphs with CI assertions. Website development-only advisories remain; production npm audits have zero reported advisories.

## Validation and limits

Full Go race tests against disposable PostgreSQL, Rust schema/error-path tests, website and desktop unit tests, frontend builds, a clean embedded-ticker Docker build, signed Discord authorization regressions, private installer redaction checks and network-policy validation passed. The broad PR passed all 26 checks; the updater correction passed all 24 checks. Post-merge backend CI later failed only because the newly published server release made generated support release notes stale. PR #519 removed the desktop-only refresh restriction (SCROLLR-389); the support refresh completed successfully after desktop publication. The generated knowledge-base commit 92e869db passed backend CI and deployment 39994511900; website refresh 39994437162 and a manual server-tag refresh 39994726841 also passed. Final live health, nonempty public feed, download page version 1.7.2 and all four suspended accounts were rechecked successfully. Gitleaks scanned the tracked snapshot and 1,655 reachable commits with redacted output; detector coverage is not exhaustive.

This is a source, dependency and configuration audit with bounded production checks, not a guarantee of security or an independent penetration test. No live customer messages or destructive attack probes were sent. Native installer behavior on users' physical machines and historical non-exfiltration are not verified.
