# Operational Metrics — Design Spec

> **Status:** Design approved, ready for implementation plan.
> **Plan:** `docs/superpowers/plans/2026-05-13-operational-metrics-rollout.md`
> **Companion:** `docs/superpowers/plans/2026-05-12-sentry-rollout.md` (error monitoring — separate concern, executes independently)
> **Privacy posture:** Strictly server-side. Zero per-user data. Compatible with the README's public "no telemetry" promise.

## Why this exists

Scrollr publicly promises "zero telemetry, no analytics, no tracking" (README.md:7, README.md:154). That promise is about **user-facing behavioral data**. It is not — and must not be misread as — a prohibition on **operating the servers we run**.

This spec adds the minimum amount of server-side instrumentation needed to answer:

- Is anything broken? (error rates per service per route)
- Is anything slow? (latency p50/p95/p99 per route)
- Is the load growing? (request rate, ingestion job throughput)
- Are dependencies healthy? (DB pool saturation, Redis command rate, ingestion lag)

It does **not** answer:

- Which users do what. (Out of scope; see `docs/superpowers/specs/2026-05-13-user-understanding-intent.md`.)
- Per-user funnels, retention, or session analytics. (Forbidden by README.md:154.)
- Anything that could be reconstructed back to an individual.

## Privacy invariants (hard requirements)

These are non-negotiable. If a future change would violate any of them, that change is out of scope for this spec and needs its own privacy-policy revision first.

1. **No per-user labels on any metric.** Not user IDs, not hashed user IDs, not email domains, not Logto subs, not session identifiers.
2. **No raw URLs as label values.** Routes are labeled with their **template** (`/users/:id`, not `/users/abc123`). Path parameters never become label values.
3. **No request bodies, response bodies, query strings, or header values** captured as metrics.
4. **No IP addresses.** Not as labels, not as values, not as exemplars.
5. **The `/metrics` endpoint is never exposed to public ingress.** It binds to a separate internal port; the public k8s `Service` exposes only the application port. Cluster-internal `Service` resources expose the metrics port only to the `monitoring` namespace.
6. **Privacy invariants are enforced by an automated test, not by code review alone.** Each service has a test that scrapes its own metrics endpoint and asserts the output contains no labels matching `user|email|sub|token|ip`. The test runs in CI and fails the build if it regresses.

These invariants are restated in `docs/operations/metrics.md` (the operator runbook) and `AGENTS.md` (the agent context).

## Architecture decision: static scrape config (NOT prometheus-operator)

**Decision:** Prometheus is configured via a single static scrape config stored in a Kubernetes `ConfigMap`. We do **NOT** install `prometheus-operator`, and we do **NOT** define `ServiceMonitor` or `PodMonitor` CRDs.

**Why:**

- Scrollr has 8 services to scrape (1 core API + 4 channel APIs + 3 Rust ingestion services). The list changes rarely — adding a service is a multi-week project, not a daily event.
- `prometheus-operator` adds ~200MB of RAM for its controller, a CRD dependency that complicates cluster upgrades, and an extra abstraction layer (CRD → Operator → Prometheus config → scrape).
- Static config is one YAML file. Adding a target is a five-line diff. The audit trail is git history.
- The cost the operator would amortize — auto-discovery of dynamically scaling services — does not apply: Scrollr's services are statically defined in `k8s/*.yaml`.

**What this means for future AI agents and humans:**

- **DO NOT** install `prometheus-operator`.
- **DO NOT** create `ServiceMonitor` or `PodMonitor` resources. If you find yourself reaching for them, you are solving the wrong problem.
- **TO ADD A NEW SCRAPE TARGET:** edit `k8s/monitoring/prometheus-config.yaml`, add a `scrape_configs[]` entry pointing at the service's metrics port, commit, and `kubectl apply`. Prometheus reloads the config automatically (via the `prometheus-config-reloader` sidecar — see the deployment manifest).
- The decision is restated in `k8s/monitoring/prometheus-config.yaml` as a comment at the top of the file, and in the root `AGENTS.md` Observability section. Three independent surfaces.

**When to revisit this decision:** If Scrollr ever has more than ~30 services, or services that scale horizontally with frequently-changing replica counts, the operator becomes worth its cost. That is not the current shape and is not on the roadmap.

## Tech stack

| Component | Library / Tool | Version |
|---|---|---|
| Go service instrumentation | `github.com/prometheus/client_golang/prometheus` + `github.com/prometheus/client_golang/prometheus/promhttp` | `v1.20.x` |
| Fiber → `http.Handler` adapter | `github.com/gofiber/fiber/v2/middleware/adaptor` | already a Fiber transitive dep |
| Rust service instrumentation | `prometheus` crate (the maintained `prometheus = "0.13"`, not the deprecated `prometheus-client`) | `0.13` |
| Rust → axum handler | Manual `axum::routing::get` handler emitting `prometheus::TextEncoder` output | — |
| Scraping | Prometheus (single replica, static config) | `v2.55.x` |
| Visualization | Grafana (single replica, Logto OIDC) | `v11.x` |
| Logto OIDC integration | Grafana's built-in `auth.generic_oauth` | — |

We deliberately do NOT use:
- `opentelemetry-go` / `opentelemetry-rust` — overkill for our scrape model; we want pull-based Prometheus, not push-based OTLP.
- `prometheus-operator`, `kube-prometheus-stack`, or `kube-state-metrics` (beyond what comes with the base Prometheus install).
- Hosted observability (Grafana Cloud, Datadog, Honeycomb). All metrics stay in-house.

## What gets emitted

Three metric families, defined identically across all services (modulo language idiom).

### Family 1: HTTP RED (Rate, Errors, Duration)

Per HTTP route. Emitted by middleware that wraps every request.

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `http_requests_total` | counter | `service`, `route`, `method`, `status_class` | `status_class` is `"2xx"`, `"3xx"`, `"4xx"`, `"5xx"` — never the raw status code (lower cardinality, sufficient for alerting). |
| `http_request_duration_seconds` | histogram | `service`, `route`, `method` | Buckets: `0.005, 0.025, 0.1, 0.5, 2.5, 10`. Six buckets is enough for p50/p95/p99 latency math. |
| `http_requests_in_flight` | gauge | `service` | Incremented on request start, decremented on completion. |

**Critical cardinality rule:** `route` is the **template** path with parameter placeholders intact, never the resolved path.

| Raw URL | Correct `route` label | Wrong (do not emit) |
|---|---|---|
| `/finance` | `/finance` | `/finance` ✓ |
| `/finance/symbols` | `/finance/symbols` | `/finance/symbols` ✓ |
| `/users/abc123/preferences` | `/users/:id/preferences` | `/users/abc123/preferences` ✗ |
| `/account?tab=billing` | `/account` | `/account?tab=billing` ✗ |
| `/u/some-username` | `/u/:username` | `/u/some-username` ✗ |

In Fiber, the template is available via `c.Route().Path`. In axum, it's available via `axum::extract::MatchedPath`. The middleware uses these, not `c.Path()` / `req.uri().path()`.

**Unknown routes (404 handler):** label as `route="<unknown>"` to avoid cardinality explosion from scanners hitting random paths.

### Family 2: Resource metrics

Per service. Most are emitted automatically by the Prometheus default collectors; we just register them.

| Metric | Source | Notes |
|---|---|---|
| `process_resident_memory_bytes` | Go: `prometheus.NewGoCollector`. Rust: manual via `procfs`. | RAM use. Useful for spotting leaks. |
| `process_cpu_seconds_total` | Same as above | CPU use. |
| `process_open_fds` | Default collectors | File descriptor leak detection. |
| `go_goroutines` | Go default collectors (Go services only) | Goroutine leak detection. |
| `pgxpool_connections{state}` | Custom collector wrapping `pgxpool.Stat()`. States: `acquired`, `idle`, `total`, `max`. | DB pool saturation — currently a guessing game; this fixes that. |
| `redis_commands_total{command}` | Go services: custom `redis.Hook` that increments a counter per command type. | Catches Redis hot loops. Label `command` is the Redis command name (`GET`, `SET`, `PUBLISH`), not the key. **Never label by key.** |

### Family 3: Business aggregates (counters only, no per-user labels)

| Metric | Type | Labels | Emitted by |
|---|---|---|---|
| `channel_active_count` | gauge | `channel` (= `finance` / `sports` / `rss` / `fantasy`) | Core API — derived from Redis registration keys (already tracked for service discovery). |
| `channel_registration_age_seconds` | gauge | `channel` | Core API — how stale the registration is. Catches dying channel registrars. |
| `ingestion_jobs_total` | counter | `service`, `job`, `result` (= `success` / `failure`) | Rust services — each ingestion task increments on completion. `job` is the static task name (`twelvedata-ws`, `espn-mlb`, `rss-fetch`), never the dynamic source URL. |
| `ingestion_lag_seconds` | gauge | `service`, `source` | Rust services — wall-clock seconds since the last successful batch per source. `source` is a static identifier (`mlb-scoreboard`, `twelvedata-ws-quotes`), never a per-user feed URL. |
| `cdc_events_dispatched_total` | counter | `topic` | Core API — already-existing CDC PubSub. `topic` is the topic name, never the row payload. |

**Explicitly forbidden labels (privacy invariant 1):** any label whose value depends on a user identifier. The privacy test scrapes the endpoint and asserts no label keys match `user_id`, `email`, `sub`, `sub_hash`, `username`, `token`, `auth`, or any label value that looks like a UUID, email, or Logto sub format.

## Per-service binding model

### Why a second port

The metrics endpoint is exposed on a **second internal-only port** per service, not on the same port as the application.

This is for two reasons:
1. **Privacy by network topology, not by code.** A misconfigured ingress controller cannot accidentally expose a metrics endpoint that doesn't bind to a public port. The protection is enforced by the kernel, not by application logic.
2. **No auth needed in-cluster.** Inside the cluster's network namespace, the metrics port is reachable only by Prometheus (whose pod is in the `monitoring` namespace). NetworkPolicies (optional, future work) can enforce this further. We do not bake a shared-secret auth check into every service's middleware.

### Port assignments

| Service | App port | Metrics port |
|---|---|---|
| Core API (`api/`) | 8080 | **9080** |
| Finance API (`channels/finance/api/`) | 8081 | **9081** |
| Sports API (`channels/sports/api/`) | 8082 | **9082** |
| RSS API (`channels/rss/api/`) | 8083 | **9083** |
| Fantasy API (`channels/fantasy/api/`) | 8084 | **9084** |
| Finance service (`channels/finance/service/`) | 3001 | **9001** |
| Sports service (`channels/sports/service/`) | 3002 | **9002** |
| RSS service (`channels/rss/service/`) | 3004 | **9004** |

The convention: **app port + 1000**. Easy to remember, easy to grep, leaves room.

### Go service binding (Fiber)

The pattern, applied to each of the 5 Go services:

```go
// In main.go, alongside the existing fiberApp setup:

import (
    "net/http"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/collectors"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

// Build a dedicated registry so we don't accidentally expose the default
// global registry (which other libraries may pollute).
metricsRegistry := prometheus.NewRegistry()
metricsRegistry.MustRegister(
    collectors.NewGoCollector(),
    collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
    httpRequestsTotal,
    httpRequestDurationSeconds,
    httpRequestsInFlight,
    // ... custom collectors
)

// Wrap the Fiber app with RED middleware (see below for impl).
fiberApp.Use(metricsMiddleware(httpRequestsTotal, httpRequestDurationSeconds, httpRequestsInFlight))

// Spin up a separate net/http server for /metrics on the second port.
// MUST be in its own goroutine — it blocks.
go func() {
    metricsMux := http.NewServeMux()
    metricsMux.Handle("/metrics", promhttp.HandlerFor(metricsRegistry, promhttp.HandlerOpts{
        EnableOpenMetrics: false, // Prometheus default text format is enough
    }))
    addr := ":" + metricsPort // e.g. ":9081" for finance
    log.Printf("[Metrics] serving on %s", addr)
    if err := http.ListenAndServe(addr, metricsMux); err != nil {
        log.Printf("[Metrics] listener exited: %v", err)
    }
}()
```

**Note: we do NOT use Fiber for the metrics listener.** Reasons:
- Fiber binds its own port; mounting a second route at a different port requires running a second Fiber app, which doubles the framework overhead for serving one handler.
- `net/http` + `promhttp.Handler` is the canonical Prometheus client integration. Every example in the wild assumes it. Diverging hurts maintainability.
- Removing Fiber from the metrics path means a metrics scrape never goes through the security headers, CORS, or rate-limiter middleware on the main app — which is what we want (Prometheus shouldn't be rate-limited).

### Go RED middleware

```go
func metricsMiddleware(reqs *prometheus.CounterVec, dur *prometheus.HistogramVec, inflight *prometheus.GaugeVec) fiber.Handler {
    return func(c *fiber.Ctx) error {
        start := time.Now()
        service := serviceName // injected at app init
        inflight.WithLabelValues(service).Inc()
        defer inflight.WithLabelValues(service).Dec()

        err := c.Next()

        // Route template — NEVER c.Path() (would leak path params)
        route := c.Route().Path
        if route == "" {
            route = "<unknown>"
        }
        method := c.Method()
        status := c.Response().StatusCode()
        statusClass := fmt.Sprintf("%dxx", status/100)

        reqs.WithLabelValues(service, route, method, statusClass).Inc()
        dur.WithLabelValues(service, route, method).Observe(time.Since(start).Seconds())

        return err
    }
}
```

### Rust service binding (axum)

The pattern, applied to each of the 3 Rust services:

```rust
use axum::{routing::get, Router};
use prometheus::{Encoder, Registry, TextEncoder};

// In main.rs (after Sentry init, after the existing app router setup):

let metrics_registry = Registry::new();
// Register custom collectors:
metrics_registry.register(Box::new(http_requests_total.clone())).unwrap();
metrics_registry.register(Box::new(http_request_duration_seconds.clone())).unwrap();
metrics_registry.register(Box::new(ingestion_jobs_total.clone())).unwrap();
metrics_registry.register(Box::new(ingestion_lag_seconds.clone())).unwrap();
// Process collector requires the `process` feature on the `prometheus` crate:
metrics_registry.register(Box::new(prometheus::process_collector::ProcessCollector::for_self())).unwrap();

let metrics_app = Router::new().route(
    "/metrics",
    get({
        let registry = metrics_registry.clone();
        move || async move {
            let mut buf = Vec::new();
            TextEncoder::new()
                .encode(&registry.gather(), &mut buf)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok::<_, (StatusCode, String)>((
                [("content-type", "text/plain; version=0.0.4")],
                buf,
            ))
        }
    }),
);

let metrics_port = std::env::var("METRICS_PORT").unwrap_or_else(|_| "9001".to_string());
let metrics_addr = format!("0.0.0.0:{}", metrics_port);
let metrics_listener = tokio::net::TcpListener::bind(&metrics_addr).await
    .context("bind metrics listener")?;

tokio::spawn(async move {
    if let Err(e) = axum::serve(metrics_listener, metrics_app).await {
        eprintln!("[Metrics] listener exited: {e}");
    }
});
```

Rust services do **not** need RED middleware on their main app — their main app is a `/health` endpoint, not a user-facing API. The Rust services' RED metrics are entirely on the metrics port (process metrics + ingestion metrics).

### What about the marketing site and desktop app?

**Marketing site (`myscrollr.com/`):** statically prerendered via TanStack Start. There is no server runtime to instrument. The static files are served by nginx at the Coolify edge. Nginx-level access logs already exist for operational purposes (request count, error rate) and are out of scope — they are an infrastructure concern, not an application concern.

**Desktop app (`desktop/`):** **Explicitly out of scope.** Client-side metrics, no matter how carefully designed, are analytics — they describe user behavior in the user's app. Forbidden by README.md:154. Sentry already covers crash visibility on the desktop with maximum scrubbing; that is the right boundary.

## Kubernetes deployment shape

### New namespace and resources

A new namespace `monitoring` is created. It contains:

```
k8s/monitoring/
├── namespace.yaml
├── prometheus-config.yaml        # ConfigMap with the scrape config + the "do not use operator" comment
├── prometheus.yaml               # Deployment + Service + PVC + ServiceAccount + RBAC
├── grafana.yaml                  # Deployment + Service + PVC + ServiceAccount
├── grafana-config.yaml           # ConfigMap with grafana.ini (Logto OIDC settings)
├── grafana-datasources.yaml      # ConfigMap with the Prometheus datasource
├── grafana-dashboards.yaml       # ConfigMap with provisioning config
├── grafana-ingress.yaml          # Ingress for grafana.scrollr.relentnet.dev
└── dashboards/                   # JSON dashboard files, mounted into Grafana via ConfigMap
    ├── core-api.json
    ├── channel-apis.json         # One dashboard, four service tabs
    ├── ingestion-services.json   # One dashboard, three service tabs
    ├── cluster-overview.json
    └── ingestion-pipeline.json
```

### Adding the metrics port to existing service manifests

Each existing service `Deployment` + `Service` in `k8s/*.yaml` is updated:

**Deployment changes** (per service):
```yaml
spec:
  template:
    spec:
      containers:
        - name: finance-api
          ports:
            - containerPort: 8081
              name: http
            - containerPort: 9081           # NEW
              name: metrics                 # NEW
          env:
            # existing env vars
            - name: METRICS_PORT             # NEW
              value: "9081"                  # NEW
```

**Service changes:** The existing public-facing `Service` (which the ingress points at) is left untouched. We add a **second `Service`** for metrics, scoped to the `monitoring` namespace via cluster-internal DNS (no NetworkPolicy required for v1 — the metrics port simply isn't in the public `Service`):

```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: finance-api-metrics
  namespace: scrollr
  labels:
    app: finance-api
    scrollr.io/metrics: "true"          # Prometheus uses this for scrape discovery via static config
spec:
  selector:
    app: finance-api
  ports:
    - name: metrics
      port: 9081
      targetPort: 9081
  type: ClusterIP
```

The `scrollr.io/metrics: "true"` label is decorative for human grep; Prometheus uses static targets pointing at `finance-api-metrics.scrollr.svc.cluster.local:9081`, not Kubernetes service discovery (consistent with the "no operator" decision — service discovery would mean kubernetes_sd_configs, which adds RBAC complexity for ~no gain at this scale).

### Prometheus static scrape config (sketch)

`k8s/monitoring/prometheus-config.yaml` contains:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: monitoring
data:
  prometheus.yml: |
    # =====================================================================
    # Prometheus scrape config for Scrollr.
    #
    # ARCHITECTURE DECISION: this is a STATIC scrape config, NOT prometheus-operator.
    # See docs/superpowers/specs/2026-05-13-operational-metrics-design.md for the
    # full rationale. Short version: 8 services, rarely changing, the operator's
    # benefits (auto-discovery for scaling fleets) don't apply here, and the
    # operator costs ~200MB RAM + a CRD dependency we don't want.
    #
    # TO ADD A NEW SERVICE: add a job below pointing at <service>.scrollr.svc:<metrics-port>.
    # DO NOT install prometheus-operator. DO NOT create ServiceMonitor CRDs.
    # =====================================================================
    global:
      scrape_interval: 30s
      scrape_timeout: 10s
      external_labels:
        cluster: scrollr-prod

    scrape_configs:
      - job_name: core-api
        static_configs:
          - targets: ['core-api-metrics.scrollr.svc.cluster.local:9080']
            labels:
              service: scrollr-core-api

      - job_name: finance-api
        static_configs:
          - targets: ['finance-api-metrics.scrollr.svc.cluster.local:9081']
            labels:
              service: scrollr-finance-api

      # ... sports-api, rss-api, fantasy-api, finance-service, sports-service, rss-service
```

A `prometheus-config-reloader` sidecar (the official `quay.io/prometheus-operator/prometheus-config-reloader` image — used standalone, not via the operator) watches the ConfigMap and triggers a Prometheus reload on change. This means adding a scrape target is a `kubectl apply` away from being live, without restarting Prometheus.

### Storage

Prometheus retains 15 days of data on a 20Gi PVC. This is plenty for operational use; longer retention requires either a larger PVC or a remote-write target, both out of scope for v1.

Grafana stores its own state (dashboards-as-JSON, datasources, users, OIDC sessions) on a 1Gi PVC. Dashboards are provisioned from the ConfigMap so they survive Grafana restarts even with state loss.

## Grafana Logto OIDC integration

Grafana's `auth.generic_oauth` provider, pointed at the Logto tenant.

### Logto application registration (manual one-time setup)

In the Logto admin console:
1. Create a new application of type "Traditional Web".
2. Name: `Scrollr Grafana`.
3. Redirect URI: `https://grafana.scrollr.relentnet.dev/login/generic_oauth`.
4. Post-logout redirect URI: `https://grafana.scrollr.relentnet.dev/login`.
5. Copy the Application ID and Application Secret — stored in `k8s/secrets.yaml.template` as `GRAFANA_LOGTO_CLIENT_ID` / `GRAFANA_LOGTO_CLIENT_SECRET`.
6. In Logto → Roles (or whichever Logto org concept you use for admin access), assign the right humans the `grafana-viewer` and/or `grafana-admin` role. Grafana role mapping reads this from the `roles` claim.

### Grafana env vars

`grafana.ini` set via env (preferred for k8s) in `grafana.yaml`:

```yaml
- name: GF_SERVER_ROOT_URL
  value: "https://grafana.scrollr.relentnet.dev"
- name: GF_AUTH_GENERIC_OAUTH_ENABLED
  value: "true"
- name: GF_AUTH_GENERIC_OAUTH_NAME
  value: "Logto"
- name: GF_AUTH_GENERIC_OAUTH_CLIENT_ID
  valueFrom:
    secretKeyRef:
      name: grafana-oidc
      key: client_id
- name: GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      name: grafana-oidc
      key: client_secret
- name: GF_AUTH_GENERIC_OAUTH_SCOPES
  value: "openid profile email roles"
- name: GF_AUTH_GENERIC_OAUTH_AUTH_URL
  value: "https://auth.myscrollr.com/oidc/auth"        # Logto authorization endpoint
- name: GF_AUTH_GENERIC_OAUTH_TOKEN_URL
  value: "https://auth.myscrollr.com/oidc/token"
- name: GF_AUTH_GENERIC_OAUTH_API_URL
  value: "https://auth.myscrollr.com/oidc/me"
- name: GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH
  value: "contains(roles[*], 'grafana-admin') && 'Admin' || contains(roles[*], 'grafana-viewer') && 'Viewer' || 'Viewer'"
- name: GF_AUTH_GENERIC_OAUTH_ALLOW_SIGN_UP
  value: "true"
- name: GF_AUTH_DISABLE_LOGIN_FORM
  value: "true"                                         # Force OIDC — no local accounts
- name: GF_USERS_ALLOW_SIGN_UP
  value: "false"
```

**Confirm the Logto OIDC endpoint URLs before applying.** The placeholder `auth.myscrollr.com` may differ from your actual Logto tenant URL — verify in `myscrollr.com/src/lib/` or the relevant env files.

The `GF_AUTH_DISABLE_LOGIN_FORM=true` setting disables Grafana's built-in local-account login form. **The only way in is Logto.** Bootstrap risk: the very first time Grafana starts, there are no users yet. We address this by:
1. Pre-seeding the admin password via `GF_SECURITY_ADMIN_PASSWORD` for emergencies (escape hatch via `/login?disableExternalLogin=true` — see runbook).
2. After first login via Logto, the admin escape hatch can be left in place (it's k8s-secret-protected) or removed in a follow-up commit.

## Default dashboards (committed JSON)

Five dashboards, all in `k8s/monitoring/dashboards/`:

| Dashboard | Panels | Audience |
|---|---|---|
| **Core API** | Request rate by route, error rate, p95 latency, in-flight requests, DB pool saturation, Redis command rate, CDC events dispatched, channel registrations active. | Primary operator. |
| **Channel APIs** | Same as Core API, but four tabs (finance / sports / rss / fantasy) selectable via a `service` variable. | Primary operator. |
| **Ingestion Services** | Process CPU/memory, ingestion jobs total (success vs. failure), ingestion lag per source, supervised task restarts. Three tabs. | Primary operator. |
| **Cluster Overview** | All-service request rate, all-service error rate, all-service p95 latency, top-5 slowest routes, top-5 hottest routes. | Single-pane glance. |
| **Ingestion Pipeline** | End-to-end view: Rust service → Postgres → CDC → Core API → desktop. Lag at each hop. | Debugging "why is the ticker stale?" |

Dashboards are authored once, committed as JSON, and provisioned via Grafana's `provisioning/dashboards/` mechanism. Editing in the Grafana UI is discouraged — changes there are ephemeral. The intended workflow:

1. Edit a dashboard in the UI.
2. Export it as JSON (Share → Export → Save to file).
3. Commit the JSON to `k8s/monitoring/dashboards/`.
4. `kubectl apply -k k8s/monitoring/` to update the ConfigMap; Grafana picks up the change within ~30s.

## Alerting

**Out of scope for v1.** Alerting requires deciding on a notification channel (PagerDuty, Discord, email, Slack), an SLO definition per service, and a paging policy. Each of those is a real product decision.

For v1, we install Prometheus's bundled Alertmanager **without any rules configured**. Operators monitor dashboards manually. When operational pressure justifies it, a follow-up spec adds alerting rules and routing.

The Alertmanager deployment is left in `k8s/monitoring/` as a stub (empty rules ConfigMap) so the eventual addition is a config change, not a structural one.

## Privacy verification

Each instrumented service gets a test that scrapes its own metrics endpoint and asserts no privacy invariants are violated.

### Go services

`api/core/metrics_privacy_test.go` (and one per channel API):

```go
package core

import (
    "io"
    "net/http"
    "net/http/httptest"
    "regexp"
    "strings"
    "testing"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

// Forbidden label keys — these can never appear in a metric line.
var forbiddenLabelKeys = []string{
    "user_id", "user", "email", "sub", "sub_hash", "username",
    "token", "auth", "ip", "ip_address", "session", "session_id",
}

// Forbidden label-value shapes — heuristic matchers for things that look like PII.
var forbiddenValuePatterns = []*regexp.Regexp{
    regexp.MustCompile(`[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}`),                  // email
    regexp.MustCompile(`\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b`),                      // IPv4
    regexp.MustCompile(`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`), // UUID
    regexp.MustCompile(`\b[a-z]{2,8}_[a-zA-Z0-9]{16,}\b`),                      // Logto sub ("usr_xxxx...")
}

func TestMetricsContainNoPII(t *testing.T) {
    // Exercise the registry with synthetic events that include user-shaped data
    // in places where a careless implementation might leak it.
    httpRequestsTotal.WithLabelValues("test-service", "/users/:id", "GET", "2xx").Inc()
    // ... add more representative-load fixtures

    rr := httptest.NewRecorder()
    promhttp.HandlerFor(metricsRegistry, promhttp.HandlerOpts{}).ServeHTTP(rr, httptest.NewRequest("GET", "/metrics", nil))
    body, _ := io.ReadAll(rr.Body)
    text := string(body)

    for _, key := range forbiddenLabelKeys {
        if strings.Contains(text, key+"=") || strings.Contains(text, key+`="`) {
            t.Errorf("metrics output contains forbidden label key %q. Full output:\n%s", key, text)
        }
    }
    for _, pat := range forbiddenValuePatterns {
        if pat.MatchString(text) {
            t.Errorf("metrics output contains a value matching forbidden pattern %s", pat.String())
        }
    }
}
```

### Rust services

`channels/finance/service/tests/metrics_privacy.rs` (and one per Rust service):

```rust
use regex::Regex;
use std::sync::OnceLock;

static FORBIDDEN_KEYS: &[&str] = &[
    "user_id", "user", "email", "sub", "sub_hash", "username",
    "token", "auth", "ip", "ip_address", "session", "session_id",
];

fn forbidden_value_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}").unwrap(),
            Regex::new(r"\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b").unwrap(),
            Regex::new(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b").unwrap(),
            Regex::new(r"\b[a-z]{2,8}_[a-zA-Z0-9]{16,}\b").unwrap(),
        ]
    })
}

#[tokio::test]
async fn metrics_contain_no_pii() {
    // Build a registry with synthetic load, encode it, check the output.
    // ... (analogous to the Go test)
}
```

These tests run as part of `cargo test` / `go test ./...` and fail the build on regression. They are the primary mechanical enforcement of the privacy invariants — code review is the backup, not the primary control.

## File-by-file impact summary

| File | Action |
|---|---|
| `api/main.go` | Add metrics registry, start metrics listener goroutine, register custom collectors. |
| `api/core/metrics.go` | NEW — collector definitions, RED middleware. |
| `api/core/metrics_privacy_test.go` | NEW — privacy invariant test. |
| `api/core/server.go` | Add `s.App.Use(metricsMiddleware(...))` as first middleware (before existing security-headers middleware so it sees real status codes). |
| `channels/{finance,sports,rss,fantasy}/api/main.go` | Same pattern as core. |
| `channels/{finance,sports,rss,fantasy}/api/metrics.go` | NEW — analogous to `api/core/metrics.go`. Per AGENTS.md's "duplication is intentional" rule, each channel gets its own copy. |
| `channels/{finance,sports,rss,fantasy}/api/metrics_privacy_test.go` | NEW — per-channel privacy test. |
| `channels/{finance,sports,rss}/service/src/main.rs` | Add metrics registry, start metrics listener task. |
| `channels/{finance,sports,rss}/service/src/metrics.rs` | NEW — collector definitions, ingestion-job helpers. |
| `channels/{finance,sports,rss}/service/Cargo.toml` | Add `prometheus = { version = "0.13", features = ["process"] }`. |
| `channels/{finance,sports,rss}/service/tests/metrics_privacy.rs` | NEW — privacy test. |
| `k8s/core-api.yaml` | Add metrics port to Deployment + add `core-api-metrics` Service. |
| `k8s/{finance,sports,rss,fantasy}-api.yaml` | Same pattern. |
| `k8s/{finance,sports,rss}-service.yaml` | Same pattern. |
| `k8s/monitoring/namespace.yaml` | NEW. |
| `k8s/monitoring/prometheus-config.yaml` | NEW — the ConfigMap with the static scrape config and the "do not use operator" comment. |
| `k8s/monitoring/prometheus.yaml` | NEW — Deployment + PVC + ServiceAccount + ClusterRole (read-only, only for scraping; no RBAC for service discovery since we use static targets). |
| `k8s/monitoring/grafana.yaml` | NEW — Deployment + PVC + Service. |
| `k8s/monitoring/grafana-config.yaml` | NEW — ConfigMap with Logto OIDC env. |
| `k8s/monitoring/grafana-datasources.yaml` | NEW — ConfigMap with Prometheus datasource provisioning. |
| `k8s/monitoring/grafana-dashboards.yaml` | NEW — ConfigMap with provisioning config + dashboard JSON files. |
| `k8s/monitoring/grafana-ingress.yaml` | NEW — Ingress for `grafana.scrollr.relentnet.dev` with TLS. |
| `k8s/monitoring/dashboards/*.json` | NEW — five dashboard files. |
| `k8s/secrets.yaml.template` | Add `GRAFANA_LOGTO_CLIENT_ID`, `GRAFANA_LOGTO_CLIENT_SECRET`, `GRAFANA_ADMIN_PASSWORD`. |
| `docs/operations/metrics.md` | NEW — operator runbook. |
| `AGENTS.md` | NEW Observability section. The "static scrape config, not operator" directive is here. |

## Open follow-ups (NOT in this spec)

These are real but separate concerns. Each gets its own spec when prioritized.

- **Alerting rules + Alertmanager routing.** Spec needed once we choose a notification channel.
- **NetworkPolicies** to enforce metrics-port isolation at the network layer (currently relies on Service-port topology).
- **Long-term metrics retention** via Thanos / remote write. Only relevant if we need >15 days of history.
- **Log aggregation** (Loki). Separate observability concern; not metrics.
- **Distributed tracing** (Tempo/Jaeger). Sentry already provides 10% trace sampling for app-level traces; cluster-wide tracing is a much larger commitment.

## Self-review

- ✅ Privacy invariants stated as hard requirements at the top.
- ✅ Static-scrape-config decision documented in three places (spec, YAML comment, AGENTS.md).
- ✅ Per-service code shape concrete enough to implement.
- ✅ Port assignment convention explicit (`app port + 1000`).
- ✅ Privacy verification is enforced by automated tests, not just code review.
- ✅ Marketing site and desktop are explicitly out of scope with reasoning.
- ✅ Alerting deferred with clear reason.
- ✅ No new SDKs on the user-facing surface.
- ✅ Compatible with README.md:154 promise — no per-user data anywhere.
