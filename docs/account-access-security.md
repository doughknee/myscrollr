# Account suspension and live connections

The shared API token validator checks the current Logto user, including suspension,
after verifying the JWT. Deleted or suspended users receive 403; invalid or expired
tokens receive 401. The desktop uses 401 to refresh its token immediately, so a
suspension must remain 403 to preserve reconnect backoff.

Redis shares account decisions across core replicas for at most 15 seconds, with no
sliding expiration. Lookup time is deducted from that lifetime. Concurrent lookups
within a replica share one request. Each cache read has a one-second context and
the authority lookup has a five-second context; Redis honors context timeouts.
Redis failure falls back to a fresh Logto check. Authority failure or a missing
suspension field fails closed with a retryable 503, never a stale allow decision.

Open user and staff streams check account access every five seconds and close at
JWT expiration. With responsive network writes, suspension is enforced within
30 seconds, including lookup delays. A slow or disconnected transport can delay
physical socket teardown; no new request can use an expired cached decision.
This does not revoke a staff role stored in the separate admin_users table;
SCROLLR-341 tracks that independent permission change.

Normal users retain their widgets and feeds. Existing desktop token-refresh and
reconnect behavior remains responsible for renewing an expired stream. No desktop
release or new database migration is needed for account suspension enforcement.

Deployment checks: verify the running core image, a real signed-in account's read
requests and feed delivery, and all four incident accounts' Logto suspension flags.
Do not mint impersonation tokens for incident accounts. Unit tests use locally
signed fixture JWTs and a fake authority to prove 403, 401, 503, and stream closure.

Rollback uses the prior core image through the normal deploy workflow. Rolling
back restores the former JWT-lifetime suspension gap, so keep incident accounts
suspended and their sessions revoked while investigating any rollback.
