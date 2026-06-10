# ADR-0001: Scaling core-api SSE delivery past one replica

**Status:** Proposed
**Date:** 2026-06-10
**Deciders:** Brandon Harris

## Context

core-api runs as a single replica (`k8s/core-api.yaml` `replicas: 1`).
That makes it a single point of failure for the whole API surface, and
every deploy briefly drops all traffic — including the long-lived SSE
streams that Ultimate-tier desktop clients hold open against
`GET /events`.

The June 2026 hardening campaign flagged "in-process SSE hub state" as
the blocker for scaling out. A code audit shows the situation is
better than that framing suggests. The delivery path is:

```
Sequin ──POST /webhooks/sequin──▶ any replica
  └─ routeCDCRecord → PublishToTopic → Redis PUBLISH (cdc:…)
Redis pub/sub ──▶ EVERY replica PSUBSCRIBEs cdc:finance:*, cdc:sports:*,
                  cdc:rss:*, cdc:fantasy:*, cdc:core:user:*
  └─ each replica fans out IN-PROCESS to its own local SSE connections
```

(`handlers_webhook.go:85-165`, `events.go:132-193`, `redis.go:38-40`)

Because the transport between "webhook ingest" and "fan-out" is
already Redis pub/sub, replicas are independent for *delivery*: a
client connects to exactly one replica, that replica registers it
(`events.go:306-318`), loads its topic subscriptions from the DB
(`subscribeUserToTopics`, `events.go:399-430`), and receives every
CDC event via Redis. A reconnect (client retries after 3 s) can land
on any replica and rebuilds all state from the DB there. **No sticky
sessions are required for correctness.**

What actually breaks at `replicas > 1`:

1. **Stale topic subscriptions on channel config change (the real
   bug).** When a user edits their channels, the CRUD handler calls
   `UpdateUserTopicSubscriptions` (`channels.go:116`, `channels.go:143`)
   — on the replica that served the HTTP request. That function no-ops
   unless the user has an SSE connection *on that same replica*
   (`events.go:343-346`). With two replicas, a config POST handled by
   replica A while the user's stream lives on replica B leaves B's
   registry stale: newly added symbols/feeds/leagues never stream, and
   removed ones keep streaming, until the client happens to reconnect.

2. **Rate limits multiply.** The Fiber limiter middleware
   (`server.go:136-169`) keeps counters in process memory, so N
   replicas give abusers N× the configured budget. `/events` itself is
   exempt (`server.go:118`), so this is a general hardening concern,
   not an SSE-specific one.

3. **Per-event work multiplies (acceptable).** Every replica receives
   every CDC event (pattern subscription) and the dispatching replica
   invalidates the user's Redis caches (`events.go:221-232`,
   `redis.go:90-116`). Cache invalidation is idempotent DELs; the
   duplicated decode/lookup work is trivial at current volume
   (~40 writes/s peak from trades).

Non-issues confirmed during the audit: JWKS verification, Stripe
webhook idempotency (DB+Redis), channel discovery (Redis-polled),
singleflight groups, and the osTicket proxy are all either stateless
or shared-store backed. Slow-client handling (`trySend` drop,
`events.go:50-57`) and dispatch backpressure (`dispatchCh`, 4096) are
per-replica by design and scale naturally.

Constraints: small team, no appetite for a large rewrite; Redis and
the gateway-only NetworkPolicies are already in place; CDC is an
optimization layer — polling `/dashboard` remains the canonical
fallback, so brief SSE gaps are not user-visible outages.

## Decision

Adopt **Option B**: keep the in-process hub and Redis pub/sub
delivery, add a Redis control signal so *all* replicas refresh a
user's subscriptions on channel changes, move rate-limiter state to
Redis, then raise `replicas` to 2.

## Options Considered

### Option A: Stay at one replica

| Dimension | Assessment |
|-----------|------------|
| Complexity | None |
| Cost | None |
| Scalability | None — SPOF remains, deploys drop streams |
| Team familiarity | N/A |

**Pros:** zero work; current scale fits comfortably in one pod.
**Cons:** every deploy is a micro-outage for the entire API; node
failure takes the API down until reschedule; the flagged risk stays
on the books.

### Option B: Redis control channel + shared rate limits, then replicas: 2 (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — ~2 small PRs of Go, no new infra |
| Cost | One extra pod (100m/128Mi requests) |
| Scalability | Linear for SSE delivery; Redis pub/sub fan-out is the eventual ceiling, far away at current volume |
| Team familiarity | High — same Redis pub/sub pattern already used for CDC |

Mechanism: after a channel config write, publish a small control
message (e.g. topic `sse:ctl:resubscribe`, payload = logto sub) via
the existing `PublishRaw`. Every replica's `listenToTopics` loop
handles it by calling the existing `UpdateUserTopicSubscriptions`
locally — replicas without that user's connection no-op exactly as
today. The direct in-process call becomes redundant and is removed
(the publishing replica receives its own message). Rate limiting
switches the Fiber limiter to Redis-backed storage.

**Pros:** fixes the one real correctness bug with the codebase's own
idioms; no sticky sessions, no client changes, no new infrastructure;
HA and zero-drop deploys (rolling update + 3 s client retry).
**Cons:** subscription refresh becomes eventually consistent (one
pub/sub hop + DB reload, tens of ms — invisible next to the current
behavior); every replica still decodes every CDC event.

### Option C: Sticky sessions, keep everything in-process

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — ingress affinity config, but subtle failure modes |
| Cost | One extra pod |
| Scalability | Poor — affinity skews load; doesn't actually fix the bug |
| Team familiarity | Low |

**Cons (disqualifying):** cookie-based nginx affinity doesn't help —
the SSE stream comes from the desktop app and channel-config writes
can come from other surfaces, so there is no shared cookie jar
guaranteeing the POST lands on the connection-holding replica. The
stale-subscription bug survives. Rejected.

### Option D: Externalize the hub (registry and connection state in Redis, per-connection streams)

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — rewrite of events.go/registry.go, new delivery semantics |
| Cost | Higher Redis load, more moving parts |
| Scalability | Best on paper |
| Team familiarity | Low |

**Cons:** solves problems we don't have. The per-replica registry is
not a correctness problem once subscription *changes* propagate; the
audit found no need for cross-replica connection awareness. Revisit
only if Redis pub/sub fan-out volume (every replica × every event)
becomes measurable. Rejected for now.

## Trade-off Analysis

The decisive observation is that Option B's "blocker" was never the
hub itself — it was one function's locality assumption
(`events.go:343`). Fixing that through the already-proven Redis
pub/sub path costs ~30 lines and makes the remaining hub state
(connections, dispatch queues, buffers) *correctly* per-replica
rather than accidentally so. Options C and D both spend significantly
more complexity to avoid a fix that is small, idiomatic, and testable.
The rate-limiter change is independent and worth doing regardless.

## Consequences

- Deploys stop dropping the API: rolling update with `maxUnavailable: 0`
  keeps one replica serving while the other cycles; SSE clients ride
  through on their 3 s retry.
- Subscription updates become eventually consistent across replicas
  (previously synchronous in-process). The window is milliseconds and
  the polling fallback already papers over larger gaps.
- Per-replica observability gets more important: `ClientCount()` is
  now per-pod; any dashboarding should sum across pods.
- Redis becomes a harder dependency for SSE control flow (it already
  is for delivery; no new failure mode, but worth stating).
- Revisit triggers: if Ultimate-tier concurrent connections grow to
  the point where every-replica-decodes-everything shows up in CPU
  profiles, revisit Option D's sharded subscription model.

## Action Items

1. [ ] PR: publish `sse:ctl:resubscribe` control message from channel
   CRUD paths (`channels.go:116`, `channels.go:143`); handle it in
   `listenToTopics`; drop the local-only call; unit test with
   miniredis (the harness in `main_test.go` already wires a hub +
   miniredis).
2. [ ] PR: switch Fiber limiter storage to Redis (or explicitly
   document the N× budget if deferred).
3. [ ] PR: `k8s/core-api.yaml` — `replicas: 2`, add a
   PodDisruptionBudget (`minAvailable: 1`), set rolling-update
   `maxUnavailable: 0`.
4. [ ] Verify in-cluster: SSE stream against pod A, channel-config
   POST forced to pod B, confirm the stream picks up the new topic
   without reconnect.
5. [ ] Update `docs/cdc-runbook.md` architecture diagram to show N
   replicas each subscribing to Redis.
