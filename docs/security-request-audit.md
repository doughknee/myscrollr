# Security request evidence

SCROLLR-393 stores security-relevant **core API** requests in the existing PostgreSQL database, independent of pod log rotation. It records successful admin/account/token/support/webhook operations and rejected/error requests. Successful public feed reads are excluded. This does not replace Logto's own authentication events, capture traffic rejected before core, or collect the separate osTicket site's direct requests.

Rows aggregate by UTC hour, registered route pattern, bounded HTTP method, status, salted account hash and a daily keyed source-address hash. Concrete path parameters, query strings, bodies, tokens, cookies, email addresses, raw IPs and user agents are never included. Account hashes use the existing salt; do not rotate it. Source hashes use HMAC with a separate domain and UTC day, allowing same-day correlation without retaining raw addresses. Shared networks can share a source hash; this is not proof of identity. Failed authentication has no trusted account attribution.

Retention is 30 days, pruned at startup and daily by the existing usage maintenance loop (up to one additional day before scheduled cleanup). Access is restricted to existing database operators; no public/admin API exposes other users' rows. Account export includes that account's activity without source hashes; account purge deletes its rows. Audit writes share the purge lock and skip already-purged accounts, including requests authorized before deletion completed.

Storage is bounded to 10,000 new anonymous and 10,000 new authenticated aggregate keys per UTC day, with existing keys continuing to accumulate counts. There is no new paid service. Each process allows two concurrent audit writes, with a 150 ms deadline. Audit failure never blocks signup, feeds or support. A bounded `[SecurityAudit]` warning reports skipped writes or the daily budget being reached, at most once a minute. Such warnings mean incomplete evidence and must be included in any incident assessment. This is not a lossless access log and does not recover the missing historical evidence.

Verification: `TestSecurityAuditDurabilityPrivacyAndPurgeBoundary` writes through HTTP middleware and reads using an independent Postgres connection, checks redaction and post-purge suppression, and checks a public feed while audit storage is locked. The real account-purge integration test checks the new table too. `TestAuditFailureAndFullSlotsDoNotBlockNormalRoutes` checks service availability with no database and saturated audit slots.

Operator read-back (database access only):

```sql
SELECT hour, method, endpoint, status, sum(requests) AS requests
FROM security_request_audit
WHERE hour >= now() - interval '24 hours'
GROUP BY hour, method, endpoint, status ORDER BY hour;
```

Rollback: restore the prior core image if necessary. Migration 000033 is additive and can remain in place; do not drop incident evidence during an image rollback. The previous image ignores the new table. Logto signup configuration, feed ownership and ingestion configuration are unchanged.
