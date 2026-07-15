# ADR-0002: Consolidate widget read APIs into core-api; retire dynamic discovery for first-party sources

**Status:** Accepted
**Date:** 2026-07-15
**Deciders:** Brandon Harris

## Context

The backend was designed around an open "channels" model: core-api has
zero channel-specific code, discovers channel services at runtime via
Redis (`channel:*` keys, 30s TTL heartbeat), and proxies their routes
dynamically with an HTTP-only contract (AGENTS.md Architecture Rules
1–3). That design anticipated channels as a growth surface —
potentially many, potentially third-party.

The product has since moved to a **fixed, first-party widget catalog**
(v1.1.0 slot model, per-item widget rows via migrations 000014–000016).
Widgets are the user-facing unit; every widget id resolves back to one
of five coarse sources (`DataSourceForWidget`, `api/core/widgets.go`).
Sources are added by writing code, not by plugging in a service — the
dynamic-discovery flexibility is provisioned but unused.

What the five Go channel APIs actually are today (July 2026 audit):

- **finance, sports, predictions, rss** are stateless read layers over
  the *same shared Postgres* core uses. They do no external ingestion
  (that lives in their Rust `channels/<name>/service/` siblings), hold
  no state beyond Redis caches, and never talk to each other. Unique
  business logic: finance ~48%, predictions ~55%, sports ~65%, rss
  ~70%; the rest is a copy-pasted frame (`main.go` registration
  skeleton, `sentry.go`, `helpers.go`, health/scrubbing tests —
  roughly 750–800 lines per service, ~95% identical).
- **fantasy** is different in kind: an ingestion engine (Yahoo OAuth,
  40-concurrent background sync loop, token rotation, own migration
  lineage), >90% unique code, real crash/quota blast radius.

Costs the current shape imposes:

1. **Drift in copy-pasted safety code.** The per-service frame has
   already diverged: rss hardened `ProxyInternalHealth`
   (`io.LimitReader`, ctx, error returns) and the other copies didn't
   (REL-8); the copied `health_test.go` carries a copy-paste bug
   (finance/rss/predictions headers name `INTERNAL_SPORTS_URL`);
   `sentry.go` — privacy-critical scrubbing — is byte-identical ×5
   except one tag, so every fix must be hand-synced five times.
2. **Dead machinery.** Every service registers `POST /internal/cdc`
   and maintains per-item subscriber-set fan-out, but nothing calls it
   — core has routed CDC in-process since the Sequin-webhook design
   (`handlers_webhook.go` → `topicForRecord` → Redis pub/sub → SSE).
   Subscriber sets are dual-maintained (core writes coarse sets only
   predictions reads; sports league sets are written by both core and
   the sports service).
3. **Operational surface.** Four extra deployments, four go.mods, four
   images in the deploy matrix, per-pair NetworkPolicies, per-service
   Sentry projects, and a proxy hop on every widget request — for
   services whose combined resource requests are smaller than one
   core-api pod.
4. **Cost of adding a widget source.** Today: a new Go module, k8s
   manifests, DSNs, compose entries, network policies, deploy-matrix
   rows. The product direction (more widget types) pays this tax each
   time.

Constraints: solo maintainer; desktop app is the product and must not
change; the Rust ingesters' isolation is genuinely valuable (quota
lockouts, websockets, long rollouts) and must be preserved; core-api
already runs 2 replicas with a PDB (ADR-0001) and its request/limit
headroom comfortably covers the four services' read traffic.

## Decision

Adopt **Option B**: fold the four thin Go read APIs (finance, sports,
predictions, rss) into core-api as internal packages, keeping their
public route shapes byte-identical. Keep fantasy-api as a separate
service (the discovery/dynamic-proxy path remains, shrunk to one
registrant). Keep all four Rust ingesters as separate deployments,
health-probed directly by core via the existing `INTERNAL_<NAME>_URL`
pattern. Delete the dead `/internal/cdc` handlers and, after a
consumer audit, the dead subscriber-set maintenance.

This supersedes AGENTS.md Architecture Rules 1–3 for first-party
sources. The new rules: core serves first-party widget sources
directly; ingestion stays in isolated per-source services (Rust, or Go
in fantasy's case); fantasy remains the only proxied channel service.

## Options Considered

### Option A: Status quo (keep five services, live with duplication)

| Dimension | Assessment |
|-----------|------------|
| Complexity | None now; recurring drift cost forever |
| Cost | 4 extra workloads + proxy hop + 5× frame maintenance |
| Scalability | Fine — services are idle-cheap |
| Team familiarity | High |

**Pros:** zero migration risk; per-service Sentry separation stays.
**Cons:** the drift has already produced a real defect class (REL-8);
every future widget source pays the full service-pair tax; dead CDC
machinery keeps confusing changes. Rejected — the recurring cost is
real and the flexibility it buys is unused.

### Option B: Fold read APIs into core-api (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — mechanical package moves, ~4 PRs, no schema or client changes |
| Cost | Removes 4 workloads, 4 go.mods, 4 images; core absorbs trivial read load |
| Scalability | Better — reads ride core's 2-replica HA + PDB instead of 1-replica services |
| Team familiarity | High — same Fiber/pgx/Redis idioms, same repo |

**Pros:** duplication resolved by deletion rather than a shared
library; widget requests lose a proxy hop; adding a source becomes "a
Go package + optionally a Rust poller"; dead machinery gets deleted
with confidence because the seams are gone.
**Cons:** a panic in widget-read code now recycles a core-api pod
(mitigated: 2 replicas, PDB, sentryfiber panic recovery, and these
paths are simple reads); per-source Sentry projects collapse into
`scrollr-core-api` (mitigated: keep a `source` tag); any widget code
change redeploys core (acceptable at this scale).

### Option C: Keep services, extract a shared internal Go module for the frame

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low-medium — go.work or a versioned internal module |
| Cost | Keeps all 13 workloads and the proxy hop |
| Scalability | Unchanged |
| Team familiarity | Medium |

**Pros:** ends the drift without touching topology.
**Cons:** solves the smallest problem (frame drift) while keeping the
largest (operational surface, dead machinery, per-source service tax).
Reasonable fallback if Option B stalls, not the destination. Rejected.

### Option D: One consolidated "widgets-api" service beside core

| Dimension | Assessment |
|-----------|------------|
| Complexity | Same code motion as B plus a new service to operate |
| Cost | Removes 3 workloads instead of 4; keeps the proxy hop |
| Scalability | Needs its own replicas/PDB story |
| Team familiarity | High |

**Pros:** keeps widget reads out of core's blast radius.
**Cons:** blast-radius isolation is not worth a permanent extra
service for stateless reads that share core's DB anyway; it recreates
the discovery/proxy dependency B removes. Rejected.

## Trade-off Analysis

The decisive observation mirrors ADR-0001: the "blocker" (channel
isolation as an absolute rule) was protecting a future — third-party
or rapidly multiplying channels — that the widget pivot removed. What
remains behind the rule is four near-identical read layers whose
isolation delivers no data isolation (shared Postgres, shared Redis),
no failure isolation that matters (they are stateless; core is the
gateway either way), and negative maintenance isolation (drift in
copied safety code). The isolation that *does* deliver — ingestion in
separate processes with independent rollout deadlines and quota blast
radius — is untouched by this decision. Fantasy sits on the ingestion
side of that line, so it stays a service.

## Consequences

- Workloads 13 → 9; Go modules 6 → 2 (`api`, `channels/fantasy/api`).
- Public API is unchanged: `/finance/*`, `/sports/*`, `/rss/*`,
  `/predictions/*` keep identical shapes; the desktop app and website
  need zero changes.
- Redis discovery and the dynamic proxy remain in place for fantasy
  only. If fantasy is ever absorbed or retired, they go with it.
- core-api needs the `INTERNAL_{FINANCE,SPORTS,RSS,PREDICTIONS}_URL`
  env vars (health probes + predictions candlestick proxy) — moved
  from `channels-config` entries consumed by the retired services.
- The rss janitor becomes a core background task (same 6h cadence);
  it is the one component with cross-user write behavior, so it moves
  last and keeps its transaction shape.
- Sentry: widget-read errors report to `scrollr-core-api` tagged
  `source=<name>`; the four `scrollr-<name>-api` projects are retired.
  The scrubbing test consolidates to one copy (plus fantasy's).
- AGENTS.md Architecture Rules and the marketing site's architecture
  page (`myscrollr.com/src/routes/architecture.tsx`, which still shows
  `/internal/cdc`) must be rewritten to match.
- Revisit triggers: if a widget source ever needs third-party
  authorship, independent scaling, or write-heavy behavior, split it
  back out — the package boundary keeps that cheap.

## Action Items

1. [x] Audit consumers of every Redis subscriber set
   (`finance:subscribers:*`, `sports:subscribers:league:*`,
   `rss:subscribers:*`, `channel:subscribers:*`,
   `predictions:subscribers:all`) across core, the Go services, and
   the Rust ingesters, and of `/internal/cdc`. Anything the Rust
   pollers read to scope their polling must survive the migration
   with identical write semantics. Document findings before PR 2.
   **Done 2026-07-15 — see Appendix A. Verdict: the entire
   subscriber-set subsystem is write-only; every reader is dead.**
2. [ ] PR: fold finance-api into core (pilot — smallest, 48% unique).
   Package under `api/core/` (or `api/widgets/finance`), register
   routes directly, port tests, add `INTERNAL_FINANCE_URL` to core's
   env, remove the finance-api deployment/matrix/policy entries.
3. [ ] PR: fold sports-api and predictions-api the same way
   (predictions keeps its candlestick pass-through as a plain HTTP
   call from core).
4. [ ] PR: fold rss-api, moving the janitor as a core background task
   with its existing transaction and cadence.
5. [ ] PR: decommission — delete dead `/internal/cdc` handlers and
   verified-dead subscriber-set writes, drop the four k8s manifests
   and deploy-matrix rows, prune NetworkPolicies and
   `channels-config`, shrink discovery docs to fantasy-only, update
   AGENTS.md and the architecture page, retire the four Sentry
   projects.
6. [ ] Verify in-cluster after each fold: route parity (diff JSON
   responses old vs new path), SSE topic delivery for the moved
   source, dashboards, and `production-readiness.sh` green.

## Appendix A — Subscriber-set / CDC consumer audit (2026-07-15, REL-10)

Method: grep-verified every Redis set verb (`SMembers`, `SAdd`, `SRem`,
`SCard`, `SIsMember`, `SScan`, `SRandMember`) across `api/`,
`channels/*/api/`, and `channels/*/service/`, plus every reference to
`internal/cdc`, then resolved each hit to its enclosing function.

**The decisive fact: no Rust service has a redis dependency at all**
(no redis crate in any `channels/*/service/Cargo.toml`; the only
"redis" mentions in Rust source are doc comments). Pollers scope their
work from Postgres `tracked_*` tables. Nothing outside the Go code can
read these sets.

| Key / endpoint | Writers (all on live code paths) | Readers | Verdict |
|---|---|---|---|
| `channel:subscribers:{source}` | core `channels.go` CRUD/prune (:106–:214, :737); predictions-api `onSyncSubscriptions` | predictions `handleInternalCDC` only — dead | delete writes + readers |
| `sports:subscribers:league:{L}` | core `AddSubscriberMulti` (:122, :153) **and** sports-api `onChannelUpdated` (dual-maintained) | sports `handleInternalCDC` — dead | delete both writers + reader |
| `finance:subscribers:{symbol}` | finance-api `onSyncSubscriptions` | finance `handleInternalCDC` — dead | delete |
| `rss:subscribers:{url}` | rss-api lifecycle handlers | rss `handleInternalCDC` — dead | delete |
| `predictions:subscribers:all` | predictions-api `onSyncSubscriptions` | predictions `handleInternalCDC` — dead | delete |
| `fantasy:league_users:{key}` | fantasy `AddLeagueSubscriber` on Yahoo import/remove | fantasy `handleInternalCDC` — dead; core SSE reads the `yahoo_user_leagues` **table** instead (`events.go:631`) | delete (fantasy stays a service — its own small PR) |
| `POST /internal/cdc` (all 5 services) | — | **zero callers** repo-wide (core routes CDC in-process via `handlers_webhook.go` → `topicForRecord`) | delete handlers + route registrations |

Every `GetSubscribers`/`SMembers` call in the five services lives
inside `handleInternalCDC`; core itself has zero set reads. SSE topic
subscription reads `user_channels.config` (and `yahoo_user_leagues`
for fantasy) directly — it never touches these sets.

**One live behavior rides the lifecycle contract:** the handlers also
invalidate per-user dashboard caches (e.g. rss `onChannelDeleted` DELs
`CacheKeyRSSPrefix+user`). The folds must keep cache invalidation as
an in-process call; everything else in the lifecycle → subscriber-set
machinery (core `redis.go` subscriber helpers, `channels.go`
`SyncChannelSubscriptions`/add/remove, service helpers and handlers)
is deletable.

Residual risk: an out-of-repo consumer (ops script, manual redis
query) can't be grepped for — but the sets carry a 7-day TTL and are
ephemeral membership caches, so nothing durable can depend on them.
