# Operational Metrics Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design spec:** `docs/superpowers/specs/2026-05-13-operational-metrics-design.md` — read this first; it explains *why*, this plan explains *how*.

**Goal:** Add Prometheus-format operational metrics to every Scrollr backend service (1 core Go API + 4 channel Go APIs + 3 Rust ingestion services = 8 services) and deploy a single-replica Prometheus + Grafana stack in-cluster, with Logto OIDC auth on Grafana.

**Privacy posture:** Strictly server-side metrics. Zero per-user data. Enforced by automated tests in CI. Compatible with the README.md:154 "no telemetry" promise.

**Architecture decisions (locked from the spec — do not revisit during implementation):**
1. **Static scrape config**, NOT prometheus-operator. Adding a service = editing one YAML file.
2. **Second internal-only port per service** (app port + 1000). Metrics never reach public ingress.
3. **Per-service code duplication** (each channel gets its own `metrics.go` copy). Matches AGENTS.md's "channel isolation is absolute" rule.
4. **Logto OIDC for Grafana auth**, with local-account login disabled.

**Sequencing:**
- Task 1 — Land the Prometheus client library across all Go services with a minimal "hello world" metric, end-to-end smoke testable.
- Tasks 2-3 — Full Core API instrumentation (template for everything else).
- Tasks 4-7 — Apply pattern to 4 channel Go APIs (parallelizable).
- Tasks 8-10 — Apply pattern to 3 Rust services (parallelizable).
- Task 11 — Update k8s manifests to expose metrics ports.
- Task 12 — Deploy Prometheus.
- Task 13 — Deploy Grafana + Logto OIDC.
- Task 14 — Commit default dashboards.
- Task 15 — Privacy verification tests pass in CI.
- Task 16 — Runbook + AGENTS.md updates.

---

## Task 1: Add Prometheus client to Core API with a smoke-test metric

**Files:**
- Modify: `api/go.mod`
- Modify: `api/main.go`
- Create: `api/core/metrics.go`

**Rationale:** Get the end-to-end story working on one service before touching the other seven. If anything in the Fiber-adapter or second-port plumbing is wrong, find it here.

- [ ] **Step 1: Add the dependency**

```bash
cd api && go get github.com/prometheus/client_golang@v1.20.5 && go mod tidy
```

Verify `api/go.sum` updates. Run `go build -o /tmp/scrollr_api ./...` to confirm the build still compiles.

- [ ] **Step 2: Create `api/core/metrics.go`**

```go
package core

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// MetricsRegistry is the dedicated registry for this service.
// We intentionally do NOT use the default global registry — that registry
// can be polluted by transitive dependencies, and the privacy test depends
// on knowing exactly what is exposed.
var MetricsRegistry = prometheus.NewRegistry()

var (
	HTTPRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total HTTP requests, labeled by service, route template, method, and status class.",
		},
		[]string{"service", "route", "method", "status_class"},
	)

	HTTPRequestDurationSeconds = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request duration in seconds, labeled by service, route template, and method.",
			Buckets: []float64{0.005, 0.025, 0.1, 0.5, 2.5, 10},
		},
		[]string{"service", "route", "method"},
	)

	HTTPRequestsInFlight = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "http_requests_in_flight",
			Help: "Current in-flight HTTP requests, labeled by service.",
		},
		[]string{"service"},
	)
)

// RegisterDefaults registers default collectors and the RED metrics with MetricsRegistry.
// Call exactly once during process startup, before StartMetricsServer.
func RegisterDefaults() {
	MetricsRegistry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		HTTPRequestsTotal,
		HTTPRequestDurationSeconds,
		HTTPRequestsInFlight,
	)
}

// StartMetricsServer launches the metrics HTTP listener on its own port
// in a background goroutine. The listener is intentionally separate from
// the main Fiber app: metrics never traverse the public ingress.
//
// ARCHITECTURE NOTE: see docs/superpowers/specs/2026-05-13-operational-metrics-design.md
// for why this is net/http (not Fiber) and why it's on a separate port.
func StartMetricsServer(port string) {
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.HandlerFor(MetricsRegistry, promhttp.HandlerOpts{
			EnableOpenMetrics: false,
		}))
		addr := ":" + port
		log.Printf("[Metrics] serving on %s", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			log.Printf("[Metrics] listener exited: %v", err)
		}
	}()
}

// MetricsMiddleware returns Fiber middleware that records HTTP RED metrics
// for every request. It MUST be registered as the first middleware (before
// security headers, CORS, rate limiters) so it sees the real response status.
//
// Critical: this uses c.Route().Path (the template) as the "route" label,
// NEVER c.Path() (which would leak path parameter values like user IDs into
// labels and blow out cardinality + violate privacy invariants).
func MetricsMiddleware(serviceName string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()
		HTTPRequestsInFlight.WithLabelValues(serviceName).Inc()
		defer HTTPRequestsInFlight.WithLabelValues(serviceName).Dec()

		err := c.Next()

		route := c.Route().Path
		if route == "" {
			route = "<unknown>"
		}
		method := c.Method()
		status := c.Response().StatusCode()
		statusClass := fmt.Sprintf("%dxx", status/100)

		HTTPRequestsTotal.WithLabelValues(serviceName, route, method, statusClass).Inc()
		HTTPRequestDurationSeconds.WithLabelValues(serviceName, route, method).Observe(time.Since(start).Seconds())

		return err
	}
}
```

- [ ] **Step 3: Wire init into `api/main.go`**

In `api/main.go`, after `godotenv.Load()` and after `core.ConnectDB()` (so DB-init failures are still observable in logs without metrics), add:

```go
// Operational metrics — see docs/superpowers/specs/2026-05-13-operational-metrics-design.md
core.RegisterDefaults()
metricsPort := os.Getenv("METRICS_PORT")
if metricsPort == "" {
	metricsPort = "9080"
}
core.StartMetricsServer(metricsPort)
```

Then in `api/core/server.go`, inside `setupMiddleware()`, register the RED middleware as the **first** `s.App.Use(...)` call (before the existing security headers block):

```go
func (s *Server) setupMiddleware() {
	// RED metrics — must be first so it sees real status codes from later middleware.
	s.App.Use(MetricsMiddleware("scrollr-core-api"))

	// Security Headers (existing code below)
	s.App.Use(func(c *fiber.Ctx) error {
		// ... existing code
	})
	// ... rest unchanged
}
```

- [ ] **Step 4: Smoke-test locally**

```bash
cd api && METRICS_PORT=9080 go run . &
sleep 2
curl -sf http://localhost:8080/health > /dev/null    # generate one request
curl -sf http://localhost:9080/metrics | head -30
```

Expected: the second `curl` returns Prometheus text-format output including `http_requests_total{...}` with at least one entry, plus `go_goroutines`, `process_resident_memory_bytes`, etc.

Verify the route label is the template:
```bash
curl -sf http://localhost:9080/metrics | grep http_requests_total
```

Expected to see lines like:
```
http_requests_total{method="GET",route="/health",service="scrollr-core-api",status_class="2xx"} 1
```

NOT `route="/health/some-path-param"` if your test endpoint had a param.

- [ ] **Step 5: Kill the server, commit**

```bash
pkill scrollr_api 2>/dev/null
cd api && git add go.mod go.sum main.go core/metrics.go core/server.go
git commit -m "feat(api): add Prometheus metrics on dedicated internal port (9080)"
```

---

## Task 2: Add custom collectors for DB pool and Redis to Core API

**Files:**
- Modify: `api/core/metrics.go`
- Modify: `api/core/database.go`
- Modify: `api/core/redis.go`

**Rationale:** RED + default collectors get us 80% of the value. The remaining 20% — "is the DB pool saturated?" and "is Redis getting hammered?" — needs custom collectors.

- [ ] **Step 1: Add pgxpool collector**

In `api/core/metrics.go`, add:

```go
var (
	PgxPoolConnections = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "pgxpool_connections",
			Help: "PostgreSQL connection pool stats, labeled by service and state.",
		},
		[]string{"service", "state"},
	)
)

// Update RegisterDefaults to include it:
//   MetricsRegistry.MustRegister(... PgxPoolConnections ...)

// UpdatePgxPoolStats samples the pool and writes to the gauge. Call this
// from a periodic goroutine (every 10s is fine).
func UpdatePgxPoolStats(serviceName string, pool interface {
	Stat() *pgxpool.Stat
}) {
	stat := pool.Stat()
	PgxPoolConnections.WithLabelValues(serviceName, "acquired").Set(float64(stat.AcquiredConns()))
	PgxPoolConnections.WithLabelValues(serviceName, "idle").Set(float64(stat.IdleConns()))
	PgxPoolConnections.WithLabelValues(serviceName, "total").Set(float64(stat.TotalConns()))
	PgxPoolConnections.WithLabelValues(serviceName, "max").Set(float64(stat.MaxConns()))
}
```

Add the `import "github.com/jackc/pgx/v5/pgxpool"` import — `metrics.go` may not need it elsewhere, but this signature does.

- [ ] **Step 2: Start the periodic sampler from `database.go`**

In `api/core/database.go`, after `DBPool` is successfully assigned, spawn:

```go
go func() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if DBPool != nil {
			UpdatePgxPoolStats("scrollr-core-api", DBPool)
		}
	}
}()
```

- [ ] **Step 3: Add Redis command counter via redis.Hook**

In `api/core/metrics.go`, add:

```go
var RedisCommandsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "redis_commands_total",
		Help: "Total Redis commands executed, labeled by service and command name.",
	},
	[]string{"service", "command"},
)
```

Add to `RegisterDefaults`.

In `api/core/redis.go`, add a `redis.Hook` implementation that increments the counter on each command. Find where the `*redis.Client` is constructed and add:

```go
type metricsHook struct {
	serviceName string
}

func (h metricsHook) DialHook(next redis.DialHook) redis.DialHook                       { return next }
func (h metricsHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook { return next }

func (h metricsHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		// cmd.Name() is the static command name ("get", "set", "publish")
		// NEVER cmd.Args() (would leak keys, which may contain user IDs)
		RedisCommandsTotal.WithLabelValues(h.serviceName, strings.ToUpper(cmd.Name())).Inc()
		return next(ctx, cmd)
	}
}

// After Rdb is constructed:
Rdb.AddHook(metricsHook{serviceName: "scrollr-core-api"})
```

The critical privacy property: **we label by command name, never by key or argument.** A label like `command="GET"` is operational data. A label like `key="user:abc123:prefs"` would be per-user data and is forbidden.

- [ ] **Step 4: Build, smoke-test, commit**

```bash
cd api && go build -o /tmp/scrollr_api . && /tmp/scrollr_api &
sleep 2
curl -sf http://localhost:9080/metrics | grep -E '^(pgxpool|redis_commands)'
```

Expected: at least one `pgxpool_connections{state="..."}` line and (once any Redis traffic flows) `redis_commands_total{command="..."}` lines.

```bash
pkill scrollr_api 2>/dev/null
cd api && git add core/metrics.go core/database.go core/redis.go
git commit -m "feat(api): expose pgxpool + Redis command metrics"
```

---

## Task 3: Add privacy verification test to Core API

**Files:**
- Create: `api/core/metrics_privacy_test.go`

**Rationale:** Code review alone is not enough to enforce the privacy invariants. The test runs on every CI build and fails if a regression sneaks a user-shaped label into the output.

- [ ] **Step 1: Create the test**

Create `api/core/metrics_privacy_test.go`:

```go
package core

import (
	"io"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Forbidden label keys — these can never appear in a metric line.
// Append-only; never remove an entry without a privacy review.
var forbiddenLabelKeys = []string{
	"user_id", "user", "email", "sub", "sub_hash", "username",
	"token", "auth", "ip", "ip_address", "session", "session_id",
}

// Forbidden value patterns — heuristic matchers for things that look like PII
// even when the label key was renamed to evade the key check.
var forbiddenValuePatterns = []*regexp.Regexp{
	regexp.MustCompile(`[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}`),                                  // email
	regexp.MustCompile(`\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b`),                                      // IPv4
	regexp.MustCompile(`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`),     // UUID
}

func TestMetricsContainNoPII(t *testing.T) {
	// Pre-register defaults if the package init hasn't.
	// (RegisterDefaults uses MustRegister which panics on duplicate registration,
	// so we tolerate that for test-isolation purposes.)
	defer func() { _ = recover() }()
	RegisterDefaults()

	// Synthesize representative load. Use route templates — the middleware
	// would normally do this; we're testing the registry output, not the middleware.
	HTTPRequestsTotal.WithLabelValues("scrollr-core-api", "/users/:id", "GET", "2xx").Inc()
	HTTPRequestsTotal.WithLabelValues("scrollr-core-api", "/account", "POST", "4xx").Inc()
	HTTPRequestDurationSeconds.WithLabelValues("scrollr-core-api", "/users/:id", "GET").Observe(0.05)
	PgxPoolConnections.WithLabelValues("scrollr-core-api", "acquired").Set(3)
	RedisCommandsTotal.WithLabelValues("scrollr-core-api", "GET").Inc()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/metrics", nil)
	promhttp.HandlerFor(MetricsRegistry, promhttp.HandlerOpts{}).ServeHTTP(rr, req)
	body, _ := io.ReadAll(rr.Body)
	text := string(body)

	for _, key := range forbiddenLabelKeys {
		// Match label key as a token, not a substring (avoid false positives
		// like "username" matching "user").
		needle := key + "="
		if strings.Contains(text, needle) {
			t.Errorf("metrics output contains forbidden label key %q.\n\nFull output:\n%s", key, text)
		}
	}

	for _, pat := range forbiddenValuePatterns {
		if loc := pat.FindStringIndex(text); loc != nil {
			start := loc[0] - 60
			if start < 0 {
				start = 0
			}
			end := loc[1] + 60
			if end > len(text) {
				end = len(text)
			}
			t.Errorf("metrics output contains a value matching forbidden pattern %s\n\nContext:\n%s", pat.String(), text[start:end])
		}
	}
}
```

- [ ] **Step 2: Run the test**

```bash
cd api && go test ./core/ -run TestMetricsContainNoPII -v
```

Expected: PASS. If it fails, the metrics layer is leaking PII and must be fixed before proceeding.

- [ ] **Step 3: Commit**

```bash
cd api && git add core/metrics_privacy_test.go
git commit -m "test(api): assert metrics endpoint contains no PII (privacy invariant enforcement)"
```

---

## Task 4-7: Apply the pattern to each channel Go API

**Per channel** (`finance`, `sports`, `rss`, `fantasy`):
- Modify: `channels/<name>/api/go.mod`
- Modify: `channels/<name>/api/main.go`
- Create: `channels/<name>/api/metrics.go`
- Create: `channels/<name>/api/metrics_privacy_test.go`

**Rationale:** AGENTS.md explicitly says module isolation is absolute and code duplication between channels is intentional. We replicate the Core API pattern into each channel — not extract a shared library.

**These tasks are parallelizable.** A subagent runner can dispatch all four in parallel; each operates on its own module.

- [ ] **Step 1 (per channel): Add the dependency**

```bash
cd channels/<name>/api && go get github.com/prometheus/client_golang@v1.20.5 && go mod tidy
```

- [ ] **Step 2 (per channel): Create `metrics.go`**

Copy `api/core/metrics.go` to `channels/<name>/api/metrics.go`. Then adapt:
- Change `package core` to `package main`.
- Remove the `MetricsRegistry` export prefix if needed (channel APIs use a flat package, so unexported names like `metricsRegistry` are conventional).
- Replace the service name `"scrollr-core-api"` references with `"scrollr-<name>-api"` (e.g. `"scrollr-finance-api"`).

Specifically the file ends up structured as:

```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

var metricsRegistry = prometheus.NewRegistry()

var (
	httpRequestsTotal           = /* same as core */
	httpRequestDurationSeconds  = /* same as core */
	httpRequestsInFlight        = /* same as core */
	pgxPoolConnections          = /* same as core */
	redisCommandsTotal          = /* same as core */
)

func registerMetricDefaults() { /* same body */ }
func startMetricsServer(port string) { /* same body */ }
func metricsMiddleware(serviceName string) fiber.Handler { /* same body */ }
func updatePgxPoolStats(serviceName string, pool *pgxpool.Pool) { /* same body */ }

type redisMetricsHook struct{ serviceName string }
// ... hook methods
```

- [ ] **Step 3 (per channel): Wire into `main.go`**

After `godotenv.Load()` and after the DB pool is ready:

```go
registerMetricDefaults()
metricsPort := os.Getenv("METRICS_PORT")
if metricsPort == "" {
	metricsPort = "9081"  // finance=9081, sports=9082, rss=9083, fantasy=9084
}
startMetricsServer(metricsPort)
```

After `fiberApp := fiber.New(...)`, before any other `fiberApp.Use(...)`:

```go
fiberApp.Use(metricsMiddleware("scrollr-<name>-api"))
```

After the DB pool is assigned to `app.db` (or wherever the `App` struct holds it):

```go
go func() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if app.db != nil {
			updatePgxPoolStats("scrollr-<name>-api", app.db)
		}
	}
}()
```

After the Redis client is assigned:

```go
app.rdb.AddHook(redisMetricsHook{serviceName: "scrollr-<name>-api"})
```

- [ ] **Step 4 (per channel): Copy the privacy test**

Copy `api/core/metrics_privacy_test.go` to `channels/<name>/api/metrics_privacy_test.go`. Adapt:
- `package core` → `package main`.
- Change capitalized identifiers (`MetricsRegistry`, `HTTPRequestsTotal`, etc.) to the lowercase channel-package equivalents (`metricsRegistry`, `httpRequestsTotal`).
- Replace service name string.

- [ ] **Step 5 (per channel): Build and test**

```bash
cd channels/<name>/api && go build -o /tmp/<name>_api . && go test ./...
```

Expected: build succeeds, privacy test passes.

- [ ] **Step 6 (per channel): Commit**

```bash
cd channels/<name>/api && git add go.mod go.sum main.go metrics.go metrics_privacy_test.go
git commit -m "feat(<name>-api): add Prometheus metrics on internal port (90XX)"
```

Replace `90XX` with the actual port (9081/9082/9083/9084).

**Four separate commits, one per channel.** Keeps history per-service clean.

---

## Task 8-10: Apply pattern to each Rust ingestion service

**Per service** (`finance`, `sports`, `rss`):
- Modify: `channels/<name>/service/Cargo.toml`
- Modify: `channels/<name>/service/src/main.rs`
- Create: `channels/<name>/service/src/metrics.rs`
- Create: `channels/<name>/service/tests/metrics_privacy.rs`

**These tasks are parallelizable.**

- [ ] **Step 1 (per service): Add the dependency**

In `channels/<name>/service/Cargo.toml`:

```toml
prometheus = { version = "0.13", features = ["process"] }
regex = "1"  # for the privacy test only — gated behind [dev-dependencies] if you want to avoid the runtime cost
```

Actually, put `regex` under `[dev-dependencies]` since it's only used by the privacy test:

```toml
[dev-dependencies]
regex = "1"
```

Confirm with `cd channels/<name>/service && cargo check`.

- [ ] **Step 2 (per service): Create `src/metrics.rs`**

```rust
use prometheus::{
    register_counter_vec_with_registry, register_gauge_vec_with_registry,
    register_histogram_vec_with_registry, CounterVec, Encoder, GaugeVec, HistogramVec,
    Registry, TextEncoder,
};
use std::sync::OnceLock;

/// The dedicated registry. We do NOT use the default global registry —
/// it can be polluted by transitive dependencies, and the privacy test
/// depends on knowing exactly what's exposed.
pub fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::new)
}

pub fn ingestion_jobs_total() -> &'static CounterVec {
    static M: OnceLock<CounterVec> = OnceLock::new();
    M.get_or_init(|| {
        register_counter_vec_with_registry!(
            "ingestion_jobs_total",
            "Total ingestion jobs completed, labeled by service, job name, and result.",
            &["service", "job", "result"],
            registry()
        )
        .expect("register ingestion_jobs_total")
    })
}

pub fn ingestion_lag_seconds() -> &'static GaugeVec {
    static M: OnceLock<GaugeVec> = OnceLock::new();
    M.get_or_init(|| {
        register_gauge_vec_with_registry!(
            "ingestion_lag_seconds",
            "Seconds since the last successful ingestion per source.",
            &["service", "source"],
            registry()
        )
        .expect("register ingestion_lag_seconds")
    })
}

pub fn http_request_duration_seconds() -> &'static HistogramVec {
    static M: OnceLock<HistogramVec> = OnceLock::new();
    M.get_or_init(|| {
        register_histogram_vec_with_registry!(
            prometheus::HistogramOpts::new(
                "http_request_duration_seconds",
                "HTTP request duration in seconds (health/ready endpoint only).",
            )
            .buckets(vec![0.005, 0.025, 0.1, 0.5, 2.5, 10.0]),
            &["service", "route", "method"],
            registry()
        )
        .expect("register http_request_duration_seconds")
    })
}

/// Register the default process collector once.
pub fn register_defaults() {
    let collector = prometheus::process_collector::ProcessCollector::for_self();
    registry()
        .register(Box::new(collector))
        .expect("register process collector");
    // Touch each metric to ensure it's registered.
    let _ = ingestion_jobs_total();
    let _ = ingestion_lag_seconds();
    let _ = http_request_duration_seconds();
}

/// Encode the current state of the registry as Prometheus text format.
pub fn encode() -> Result<Vec<u8>, prometheus::Error> {
    let mut buf = Vec::new();
    let encoder = TextEncoder::new();
    encoder.encode(&registry().gather(), &mut buf)?;
    Ok(buf)
}
```

Add `pub mod metrics;` to whichever module file is appropriate (`channels/<name>/service/src/lib.rs` if it exists; otherwise declare in `main.rs`).

- [ ] **Step 3 (per service): Wire metrics into `main.rs`**

Add an HTTP listener for `/metrics` on a separate port. Add to imports:

```rust
use axum::{http::StatusCode, response::IntoResponse, routing::get, Router};
```

After the existing `Router::new()` for `/health`, **before** `axum::serve(...)`, build and bind a second listener:

```rust
// Operational metrics — see docs/superpowers/specs/2026-05-13-operational-metrics-design.md
finance_service::metrics::register_defaults();  // adjust crate name per service

let metrics_app = Router::new().route(
    "/metrics",
    get(|| async {
        match finance_service::metrics::encode() {
            Ok(buf) => (
                [("content-type", "text/plain; version=0.0.4")],
                buf,
            )
                .into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        }
    }),
);

let metrics_port = std::env::var("METRICS_PORT").unwrap_or_else(|_| "9001".to_string());
let metrics_addr = format!("0.0.0.0:{}", metrics_port);
let metrics_listener = tokio::net::TcpListener::bind(&metrics_addr)
    .await
    .expect("bind metrics listener");
println!("[Metrics] serving on {}", metrics_addr);

tokio::spawn(async move {
    if let Err(e) = axum::serve(metrics_listener, metrics_app).await {
        eprintln!("[Metrics] listener exited: {e}");
    }
});
```

Per-service default port: finance=9001, sports=9002, rss=9004.

Replace `finance_service` with the actual crate name (`sports_service`, `rss_service`).

- [ ] **Step 4 (per service): Instrument the ingestion supervisor**

Find the ingestion task wrapper (likely `init::spawn_supervised` per AGENTS.md). After the task completes:

```rust
use crate::metrics::ingestion_jobs_total;

// On success path:
ingestion_jobs_total()
    .with_label_values(&["scrollr-finance-svc", "twelvedata-ws", "success"])
    .inc();

// On failure path (existing log line):
ingestion_jobs_total()
    .with_label_values(&["scrollr-finance-svc", "twelvedata-ws", "failure"])
    .inc();
```

The `job` label is a **static string per task** (e.g. `"twelvedata-ws"`, `"espn-mlb-scoreboard"`, `"rss-fetch"`) — never a dynamic URL or user identifier.

For `ingestion_lag_seconds`: wherever the existing health-payload code records "last successful batch timestamp", also call:

```rust
ingestion_lag_seconds()
    .with_label_values(&["scrollr-finance-svc", "twelvedata-ws-quotes"])
    .set(0.0); // on success
```

And periodically (every 10s, e.g. in the readiness-bridge loop) update the lag based on `now - last_batch_time`.

- [ ] **Step 5 (per service): Create privacy test**

`channels/<name>/service/tests/metrics_privacy.rs`:

```rust
use regex::Regex;

const FORBIDDEN_KEYS: &[&str] = &[
    "user_id", "user", "email", "sub", "sub_hash", "username",
    "token", "auth", "ip", "ip_address", "session", "session_id",
];

fn forbidden_value_patterns() -> Vec<Regex> {
    vec![
        Regex::new(r"[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}").unwrap(),
        Regex::new(r"\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b").unwrap(),
        Regex::new(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b").unwrap(),
    ]
}

#[test]
fn metrics_endpoint_contains_no_pii() {
    finance_service::metrics::register_defaults();

    // Synthesize representative load.
    finance_service::metrics::ingestion_jobs_total()
        .with_label_values(&["scrollr-finance-svc", "twelvedata-ws", "success"])
        .inc();
    finance_service::metrics::ingestion_lag_seconds()
        .with_label_values(&["scrollr-finance-svc", "twelvedata-ws-quotes"])
        .set(1.5);

    let buf = finance_service::metrics::encode().expect("encode metrics");
    let text = String::from_utf8(buf).expect("metrics output is UTF-8");

    for key in FORBIDDEN_KEYS {
        let needle = format!("{key}=");
        assert!(
            !text.contains(&needle),
            "metrics output contains forbidden label key {key:?}\n\nFull output:\n{text}"
        );
    }

    for pat in forbidden_value_patterns() {
        assert!(
            !pat.is_match(&text),
            "metrics output contains a value matching forbidden pattern {pat}\n\nFull output:\n{text}"
        );
    }
}
```

Replace `finance_service` with the appropriate crate name.

- [ ] **Step 6 (per service): Build and test**

```bash
cd channels/<name>/service && cargo build --release && cargo test
```

Expected: build succeeds (warnings okay), all tests pass.

- [ ] **Step 7 (per service): Commit**

```bash
cd channels/<name>/service && git add Cargo.toml Cargo.lock src/main.rs src/metrics.rs tests/metrics_privacy.rs
git commit -m "feat(<name>-service): add Prometheus metrics on internal port (900X)"
```

Three separate commits, one per Rust service.

---

## Task 11: Update k8s deployments to expose metrics ports

**Files:**
- Modify: `k8s/core-api.yaml`
- Modify: `k8s/finance-api.yaml`
- Modify: `k8s/sports-api.yaml`
- Modify: `k8s/rss-api.yaml`
- Modify: `k8s/fantasy-api.yaml`
- Modify: `k8s/finance-service.yaml`
- Modify: `k8s/sports-service.yaml`
- Modify: `k8s/rss-service.yaml`

**Rationale:** The application code now listens on a second port. Kubernetes needs to know about it, and Prometheus needs a Service to scrape.

- [ ] **Step 1: Add metrics port + env to each Deployment**

For each of the 8 service manifests, edit the container spec. Example for `k8s/finance-api.yaml`:

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
            # ... existing env vars
            - name: METRICS_PORT             # NEW
              value: "9081"                  # NEW
```

Use the port table:

| File | App port | Metrics port |
|---|---|---|
| `k8s/core-api.yaml` | 8080 | 9080 |
| `k8s/finance-api.yaml` | 8081 | 9081 |
| `k8s/sports-api.yaml` | 8082 | 9082 |
| `k8s/rss-api.yaml` | 8083 | 9083 |
| `k8s/fantasy-api.yaml` | 8084 | 9084 |
| `k8s/finance-service.yaml` | 3001 | 9001 |
| `k8s/sports-service.yaml` | 3002 | 9002 |
| `k8s/rss-service.yaml` | 3004 | 9004 |

- [ ] **Step 2: Add a metrics-only Service per app**

After the existing `Service` block (or appended at the bottom of the same file, separated by `---`), add:

```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: finance-api-metrics
  namespace: scrollr
  labels:
    app: finance-api
    scrollr.io/metrics: "true"
spec:
  selector:
    app: finance-api
  ports:
    - name: metrics
      port: 9081
      targetPort: 9081
  type: ClusterIP
```

Repeat for all 8 services. The metrics Service is NOT exposed by any Ingress — it's only reachable inside the cluster.

**Critical: do NOT add the metrics port to the existing public-facing Service.** Keep them as separate Service resources so the topology enforces privacy.

- [ ] **Step 3: Build & push new images**

Each service's container image needs to be rebuilt with the metrics code. This is normally handled by the CI pipeline / Coolify; if doing manually:

```bash
# Per service:
cd api && docker build -t registry.digitalocean.com/scrollr/core-api:metrics-rollout .
docker push registry.digitalocean.com/scrollr/core-api:metrics-rollout
```

Update the `image:` tag in each Deployment to point at the new tag (or use `:latest` if that's the existing convention).

- [ ] **Step 4: Apply**

```bash
kubectl apply -f k8s/core-api.yaml -f k8s/finance-api.yaml -f k8s/sports-api.yaml -f k8s/rss-api.yaml -f k8s/fantasy-api.yaml -f k8s/finance-service.yaml -f k8s/sports-service.yaml -f k8s/rss-service.yaml
```

Verify rollouts complete:

```bash
kubectl -n scrollr rollout status deploy/core-api
# ... per service
```

Verify the metrics Services exist:

```bash
kubectl -n scrollr get svc | grep metrics
```

Expected: 8 services named `<service>-api-metrics` / `<service>-service-metrics`.

- [ ] **Step 5: Smoke-test scraping from inside the cluster**

```bash
kubectl -n scrollr run curl-test --rm -it --image=curlimages/curl --restart=Never -- \
  curl -sf http://finance-api-metrics.scrollr.svc.cluster.local:9081/metrics | head -20
```

Expected: Prometheus-format output. If you get connection refused, the metrics listener isn't running — check pod logs.

- [ ] **Step 6: Commit**

```bash
git add k8s/*.yaml
git commit -m "feat(k8s): expose internal metrics ports for all 8 backend services"
```

---

## Task 12: Deploy Prometheus

**Files:**
- Create: `k8s/monitoring/namespace.yaml`
- Create: `k8s/monitoring/prometheus-config.yaml`
- Create: `k8s/monitoring/prometheus.yaml`

- [ ] **Step 1: Create namespace**

`k8s/monitoring/namespace.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: monitoring
  labels:
    name: monitoring
```

- [ ] **Step 2: Create the scrape config ConfigMap**

`k8s/monitoring/prometheus-config.yaml`:

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
    # ARCHITECTURE DECISION: this is a STATIC scrape config, NOT
    # prometheus-operator. See docs/superpowers/specs/2026-05-13-operational-
    # metrics-design.md for the full rationale.
    #
    # Short version: 8 services, rarely changing. The operator's benefits
    # (auto-discovery for horizontally-scaling fleets) don't apply at this
    # scale. The operator would cost ~200MB RAM + a CRD dependency that
    # complicates cluster upgrades. Static config is one YAML file.
    #
    # TO ADD A NEW SERVICE: add a job below pointing at
    # <service>.scrollr.svc.cluster.local:<metrics-port>.
    #
    # DO NOT install prometheus-operator. DO NOT create ServiceMonitor or
    # PodMonitor CRDs. The convention is documented in AGENTS.md so future
    # AI sessions inherit it.
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

      - job_name: sports-api
        static_configs:
          - targets: ['sports-api-metrics.scrollr.svc.cluster.local:9082']
            labels:
              service: scrollr-sports-api

      - job_name: rss-api
        static_configs:
          - targets: ['rss-api-metrics.scrollr.svc.cluster.local:9083']
            labels:
              service: scrollr-rss-api

      - job_name: fantasy-api
        static_configs:
          - targets: ['fantasy-api-metrics.scrollr.svc.cluster.local:9084']
            labels:
              service: scrollr-fantasy-api

      - job_name: finance-service
        static_configs:
          - targets: ['finance-service-metrics.scrollr.svc.cluster.local:9001']
            labels:
              service: scrollr-finance-svc

      - job_name: sports-service
        static_configs:
          - targets: ['sports-service-metrics.scrollr.svc.cluster.local:9002']
            labels:
              service: scrollr-sports-svc

      - job_name: rss-service
        static_configs:
          - targets: ['rss-service-metrics.scrollr.svc.cluster.local:9004']
            labels:
              service: scrollr-rss-svc
```

- [ ] **Step 3: Create Prometheus Deployment + PVC**

`k8s/monitoring/prometheus.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: prometheus-data
  namespace: monitoring
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 20Gi
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: prometheus
  namespace: monitoring
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prometheus
  namespace: monitoring
  labels:
    app: prometheus
spec:
  replicas: 1
  strategy:
    type: Recreate  # one PVC, one pod at a time
  selector:
    matchLabels:
      app: prometheus
  template:
    metadata:
      labels:
        app: prometheus
    spec:
      serviceAccountName: prometheus
      containers:
        - name: prometheus
          image: prom/prometheus:v2.55.0
          args:
            - --config.file=/etc/prometheus/prometheus.yml
            - --storage.tsdb.path=/prometheus
            - --storage.tsdb.retention.time=15d
            - --web.console.libraries=/usr/share/prometheus/console_libraries
            - --web.console.templates=/usr/share/prometheus/consoles
            - --web.enable-lifecycle  # enables POST /-/reload for config-reloader
          ports:
            - containerPort: 9090
              name: web
          volumeMounts:
            - name: config
              mountPath: /etc/prometheus
            - name: data
              mountPath: /prometheus
          resources:
            requests:
              cpu: 100m
              memory: 512Mi
            limits:
              cpu: 500m
              memory: 1Gi
          livenessProbe:
            httpGet:
              path: /-/healthy
              port: 9090
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /-/ready
              port: 9090
            initialDelaySeconds: 10
            periodSeconds: 10
        - name: config-reloader
          image: quay.io/prometheus-operator/prometheus-config-reloader:v0.78.0
          args:
            - --reload-url=http://localhost:9090/-/reload
            - --watched-dir=/etc/prometheus
          volumeMounts:
            - name: config
              mountPath: /etc/prometheus
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              cpu: 50m
              memory: 64Mi
      volumes:
        - name: config
          configMap:
            name: prometheus-config
        - name: data
          persistentVolumeClaim:
            claimName: prometheus-data
---
apiVersion: v1
kind: Service
metadata:
  name: prometheus
  namespace: monitoring
spec:
  selector:
    app: prometheus
  ports:
    - port: 9090
      targetPort: 9090
      name: web
  type: ClusterIP
```

**Note on the config-reloader sidecar:** despite living in the `prometheus-operator` org on quay.io, this image is a **standalone binary** that watches a directory and POSTs to a reload URL. Using it does NOT require installing the operator or any CRDs. This is consistent with our static-scrape-config decision.

- [ ] **Step 4: Apply and verify**

```bash
kubectl apply -f k8s/monitoring/namespace.yaml
kubectl apply -f k8s/monitoring/prometheus-config.yaml
kubectl apply -f k8s/monitoring/prometheus.yaml
kubectl -n monitoring rollout status deploy/prometheus
```

Port-forward to verify:

```bash
kubectl -n monitoring port-forward svc/prometheus 9090:9090 &
sleep 2
curl -sf http://localhost:9090/api/v1/targets | python3 -c "import sys, json; data = json.load(sys.stdin); [print(t['labels']['service'], t['health']) for t in data['data']['activeTargets']]"
```

Expected: 8 targets, all `up`. If any are `down`, the metrics listener in that service isn't running (check pod logs) or the metrics Service is misconfigured (check `kubectl get endpoints`).

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add k8s/monitoring/namespace.yaml k8s/monitoring/prometheus-config.yaml k8s/monitoring/prometheus.yaml
git commit -m "feat(k8s): deploy Prometheus with static scrape config (no operator)"
```

---

## Task 13: Deploy Grafana with Logto OIDC

**Files:**
- Create: `k8s/monitoring/grafana-config.yaml`
- Create: `k8s/monitoring/grafana-datasources.yaml`
- Create: `k8s/monitoring/grafana.yaml`
- Create: `k8s/monitoring/grafana-ingress.yaml`
- Modify: `k8s/secrets.yaml.template`

- [ ] **Step 1: Register Grafana as a Logto application (manual user task)**

In the Logto admin console:
1. Applications → Create application → Type: "Traditional Web".
2. Name: `Scrollr Grafana`.
3. Redirect URI: `https://grafana.scrollr.relentnet.dev/login/generic_oauth`.
4. Post-logout redirect URI: `https://grafana.scrollr.relentnet.dev/login`.
5. Save. Copy the Application ID (client_id) and Application Secret (client_secret).
6. If using Logto roles for RBAC: create `grafana-admin` and `grafana-viewer` roles, assign humans accordingly. Ensure the `roles` claim is included in the ID token (Logto → Sign-in experience → Sign-in flow → Custom claims, OR via API scope).

**Confirm the Logto OIDC endpoint URLs** by checking `myscrollr.com/.env` or similar. Common shapes:
- `https://auth.myscrollr.com/oidc/auth`
- `https://<tenant>.logto.app/oidc/auth`

The plan below assumes `https://auth.myscrollr.com` — change if different.

- [ ] **Step 2: Add secrets**

Append to `k8s/secrets.yaml.template`:

```yaml
  # Grafana OIDC (Logto)
  GRAFANA_LOGTO_CLIENT_ID: ""
  GRAFANA_LOGTO_CLIENT_SECRET: ""
  GRAFANA_ADMIN_PASSWORD: ""  # emergency escape hatch only
```

Then (out-of-band, not committed) create the actual Secret in the cluster:

```bash
kubectl -n monitoring create secret generic grafana-oidc \
  --from-literal=client_id="<from-logto>" \
  --from-literal=client_secret="<from-logto>" \
  --from-literal=admin_password="$(openssl rand -hex 32)"
```

- [ ] **Step 3: Create the datasources ConfigMap**

`k8s/monitoring/grafana-datasources.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: monitoring
data:
  datasources.yaml: |
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://prometheus.monitoring.svc.cluster.local:9090
        isDefault: true
        editable: false
```

- [ ] **Step 4: Create the dashboard provisioning ConfigMap**

`k8s/monitoring/grafana-dashboards.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboards-config
  namespace: monitoring
data:
  dashboards.yaml: |
    apiVersion: 1
    providers:
      - name: scrollr
        folder: Scrollr
        type: file
        disableDeletion: true
        editable: true
        options:
          path: /var/lib/grafana/dashboards
```

Dashboard JSON files will be added in Task 14 via a second ConfigMap mounted alongside.

- [ ] **Step 5: Create the Grafana Deployment**

`k8s/monitoring/grafana.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: grafana-data
  namespace: monitoring
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
  namespace: monitoring
  labels:
    app: grafana
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: grafana
  template:
    metadata:
      labels:
        app: grafana
    spec:
      securityContext:
        fsGroup: 472
        runAsUser: 472
        runAsGroup: 472
      containers:
        - name: grafana
          image: grafana/grafana:11.3.0
          ports:
            - containerPort: 3000
              name: web
          env:
            - name: GF_SERVER_ROOT_URL
              value: "https://grafana.scrollr.relentnet.dev"
            - name: GF_SECURITY_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: grafana-oidc
                  key: admin_password
            - name: GF_USERS_ALLOW_SIGN_UP
              value: "false"
            - name: GF_AUTH_DISABLE_LOGIN_FORM
              value: "true"
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
              value: "https://auth.myscrollr.com/oidc/auth"
            - name: GF_AUTH_GENERIC_OAUTH_TOKEN_URL
              value: "https://auth.myscrollr.com/oidc/token"
            - name: GF_AUTH_GENERIC_OAUTH_API_URL
              value: "https://auth.myscrollr.com/oidc/me"
            - name: GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH
              value: "contains(roles[*], 'grafana-admin') && 'Admin' || contains(roles[*], 'grafana-viewer') && 'Viewer' || 'Viewer'"
            - name: GF_AUTH_GENERIC_OAUTH_ALLOW_SIGN_UP
              value: "true"
          volumeMounts:
            - name: data
              mountPath: /var/lib/grafana
            - name: datasources
              mountPath: /etc/grafana/provisioning/datasources
            - name: dashboards-config
              mountPath: /etc/grafana/provisioning/dashboards
            - name: dashboards
              mountPath: /var/lib/grafana/dashboards
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: grafana-data
        - name: datasources
          configMap:
            name: grafana-datasources
        - name: dashboards-config
          configMap:
            name: grafana-dashboards-config
        - name: dashboards
          configMap:
            name: grafana-dashboards
            optional: true  # will be created in Task 14
---
apiVersion: v1
kind: Service
metadata:
  name: grafana
  namespace: monitoring
spec:
  selector:
    app: grafana
  ports:
    - port: 3000
      targetPort: 3000
      name: web
  type: ClusterIP
```

- [ ] **Step 6: Create the Ingress**

`k8s/monitoring/grafana-ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: grafana
  namespace: monitoring
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod  # confirm name matches k8s/cert-manager.yaml
    nginx.ingress.kubernetes.io/proxy-body-size: "32m"
spec:
  ingressClassName: nginx  # confirm matches existing ingress class
  tls:
    - hosts:
        - grafana.scrollr.relentnet.dev
      secretName: grafana-tls
  rules:
    - host: grafana.scrollr.relentnet.dev
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: grafana
                port:
                  number: 3000
```

Confirm `ingressClassName` and `cert-manager.io/cluster-issuer` values match the conventions in `k8s/ingress.yaml` and `k8s/cert-manager.yaml`.

- [ ] **Step 7: Apply and verify**

```bash
kubectl apply -f k8s/monitoring/grafana-datasources.yaml \
              -f k8s/monitoring/grafana-dashboards.yaml \
              -f k8s/monitoring/grafana.yaml \
              -f k8s/monitoring/grafana-ingress.yaml
kubectl -n monitoring rollout status deploy/grafana
```

DNS-permitting, navigate to `https://grafana.scrollr.relentnet.dev`. You should see the Grafana login page with a "Sign in with Logto" button (and no local password form).

Sign in via Logto. Verify the Prometheus datasource is visible under Configuration → Data sources.

If sign-in fails: check the redirect URI matches exactly (including trailing slashes), and check Grafana pod logs for OAuth error messages.

**Emergency access:** if OIDC is broken and you need in, `kubectl -n monitoring port-forward svc/grafana 3000:3000` and go to `http://localhost:3000/login?disableExternalLogin=true` — log in as `admin` with the password from the `grafana-oidc` secret's `admin_password` key.

- [ ] **Step 8: Commit**

```bash
git add k8s/monitoring/grafana-config.yaml k8s/monitoring/grafana-datasources.yaml k8s/monitoring/grafana-dashboards.yaml k8s/monitoring/grafana.yaml k8s/monitoring/grafana-ingress.yaml k8s/secrets.yaml.template
git commit -m "feat(k8s): deploy Grafana with Logto OIDC auth"
```

---

## Task 14: Commit default dashboards

**Files:**
- Create: `k8s/monitoring/dashboards/core-api.json`
- Create: `k8s/monitoring/dashboards/channel-apis.json`
- Create: `k8s/monitoring/dashboards/ingestion-services.json`
- Create: `k8s/monitoring/dashboards/cluster-overview.json`
- Create: `k8s/monitoring/dashboards/ingestion-pipeline.json`
- Create: `k8s/monitoring/grafana-dashboards-content.yaml`

**Rationale:** Dashboards must be version-controlled, not edited in the UI. We commit JSON files and provision them via ConfigMap.

- [ ] **Step 1: Author dashboards via the Grafana UI**

This step is unavoidably manual the first time. With Grafana running and Prometheus collecting data:

1. Open Grafana → Create dashboard → Add panel.
2. For each dashboard listed in the spec (5 total), build the panels described.
3. Each panel uses PromQL queries against the labels we emit. Examples:
   - Request rate per route: `sum by (route) (rate(http_requests_total{service="scrollr-core-api"}[5m]))`
   - p95 latency: `histogram_quantile(0.95, sum by (route, le) (rate(http_request_duration_seconds_bucket{service="scrollr-core-api"}[5m])))`
   - Error rate: `sum by (route) (rate(http_requests_total{service="scrollr-core-api",status_class=~"5xx"}[5m])) / sum by (route) (rate(http_requests_total{service="scrollr-core-api"}[5m]))`
   - DB pool saturation: `pgxpool_connections{state="acquired"} / pgxpool_connections{state="max"}`
   - Ingestion lag: `ingestion_lag_seconds`
4. Save the dashboard with a clear name.

The spec lists 5 dashboards with their panel sets:
- **Core API** — Request rate by route, error rate, p95 latency, in-flight, DB pool, Redis commands, CDC events, channel registrations.
- **Channel APIs** — same panels, with a `service` template variable (values: scrollr-finance-api, scrollr-sports-api, scrollr-rss-api, scrollr-fantasy-api).
- **Ingestion Services** — process CPU/memory, ingestion_jobs_total by result, ingestion_lag_seconds by source, with a `service` template variable.
- **Cluster Overview** — all-service request rate, all-service error rate, all-service p95 latency, top-5 slowest routes, top-5 hottest routes.
- **Ingestion Pipeline** — end-to-end view with lag at each hop.

- [ ] **Step 2: Export each dashboard as JSON**

For each dashboard: Share → Export → "Export for sharing externally" — save as `k8s/monitoring/dashboards/<name>.json`.

The "Export for sharing externally" option resolves the datasource UID variable to `${DS_PROMETHEUS}`, making the JSON portable across Grafana instances.

- [ ] **Step 3: Create the dashboards ConfigMap**

Because ConfigMap data values have a 1MB limit and dashboards can be large, package each dashboard file individually. Use `kustomize` or a generation script:

```bash
kubectl create configmap grafana-dashboards \
  --namespace=monitoring \
  --from-file=k8s/monitoring/dashboards/ \
  --dry-run=client -o yaml > k8s/monitoring/grafana-dashboards-content.yaml
```

This creates a ConfigMap with each `.json` file as a separate key.

- [ ] **Step 4: Apply and verify provisioning**

```bash
kubectl apply -f k8s/monitoring/grafana-dashboards-content.yaml
kubectl -n monitoring rollout restart deploy/grafana
kubectl -n monitoring rollout status deploy/grafana
```

Wait for Grafana to restart, then browse to `https://grafana.scrollr.relentnet.dev/dashboards`. The five dashboards should appear under the "Scrollr" folder.

- [ ] **Step 5: Commit**

```bash
git add k8s/monitoring/dashboards/ k8s/monitoring/grafana-dashboards-content.yaml
git commit -m "feat(k8s): commit default Grafana dashboards (core, channels, ingestion, cluster, pipeline)"
```

---

## Task 15: Verify privacy invariants in CI

**Files:** None (verification only — the tests were created in Tasks 3, 4-7, 8-10)

**Rationale:** Confirm the privacy tests we wrote actually run in CI and would catch a regression.

- [ ] **Step 1: Run all privacy tests locally**

```bash
# Go services
for dir in api channels/finance/api channels/sports/api channels/rss/api channels/fantasy/api; do
  echo "--- $dir ---"
  (cd $dir && go test ./... -run TestMetricsContainNoPII -v) || exit 1
done

# Rust services
for svc in finance sports rss; do
  echo "--- channels/$svc/service ---"
  (cd channels/$svc/service && cargo test --test metrics_privacy) || exit 1
done
```

Expected: all pass.

- [ ] **Step 2: Verify CI runs them**

Check `.github/workflows/` for an existing backend-tests workflow. If it doesn't exist (per AGENTS.md, currently only desktop-release.yml exists), the privacy tests still pass locally but won't gate merges. Note this as a follow-up.

If a backend test workflow exists, confirm it runs `go test ./...` and `cargo test` against the affected modules.

- [ ] **Step 3: Simulate a regression**

To prove the test would catch a real issue, temporarily add a forbidden label in one service:

```go
// In api/core/metrics.go, temporarily add:
HTTPRequestsTotal.WithLabelValues("scrollr-core-api", "/users/abc-uuid-1234-5678-9012-345678901234", "GET", "2xx").Inc()
```

Run `go test ./core/`. Expected: FAIL with a clear error message.

Revert the change. Re-run. Expected: PASS.

- [ ] **Step 4: Commit (only if workflow changes were needed)**

If you had to add a backend-tests workflow, commit it. Otherwise, this task has no commit.

---

## Task 16: Runbook + AGENTS.md update

**Files:**
- Create: `docs/operations/metrics.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Create the operator runbook**

Create `docs/operations/metrics.md`:

```markdown
# Operational Metrics — Operator Runbook

This document is for humans operating Scrollr's production environment. For the design rationale, see [the design spec](../superpowers/specs/2026-05-13-operational-metrics-design.md). For agent rules, see [AGENTS.md](../../AGENTS.md) Observability section.

## Quick reference

| What | Where |
|---|---|
| Grafana | https://grafana.scrollr.relentnet.dev — sign in with Logto |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus 9090:9090` then http://localhost:9090 |
| Metrics endpoint per service | `<service>-metrics.scrollr.svc.cluster.local:<app-port + 1000>/metrics` |

## Port assignments

| Service | App port | Metrics port |
|---|---|---|
| core-api | 8080 | 9080 |
| finance-api | 8081 | 9081 |
| sports-api | 8082 | 9082 |
| rss-api | 8083 | 9083 |
| fantasy-api | 8084 | 9084 |
| finance-service | 3001 | 9001 |
| sports-service | 3002 | 9002 |
| rss-service | 3004 | 9004 |

Convention: **app port + 1000**.

## Adding a new service

1. Add Prometheus client to the new service following the pattern in `api/core/metrics.go` (Go) or `channels/finance/service/src/metrics.rs` (Rust).
2. Pick a metrics port: `<app-port> + 1000`.
3. Add the metrics port + env var to the service's k8s Deployment.
4. Add a `<service>-metrics` Service in the `scrollr` namespace (NOT in the main Service — keep public and internal topology separated).
5. Add a scrape config entry to `k8s/monitoring/prometheus-config.yaml`. Prometheus reloads automatically.
6. Copy the privacy verification test pattern into the new service.

**DO NOT** install prometheus-operator. **DO NOT** create ServiceMonitor or PodMonitor CRDs. This is a deliberate architectural decision — see the design spec.

## Privacy invariants

- No per-user labels on any metric. Not even hashed.
- Route labels are templates (`/users/:id`), never resolved paths.
- No bodies, no headers (other than user-agent at the proxy layer), no query strings.
- Metrics ports are never exposed to public ingress.
- All four are enforced by `*_privacy_test.{go,rs}` in each service.

## Sign-in to Grafana

Grafana uses Logto OIDC. To grant a human access:

1. Add them to the appropriate Logto role (`grafana-admin` or `grafana-viewer`).
2. They sign in at https://grafana.scrollr.relentnet.dev — Grafana auto-creates the user on first login.

Emergency access (OIDC down):
```bash
kubectl -n monitoring port-forward svc/grafana 3000:3000
# Browse to http://localhost:3000/login?disableExternalLogin=true
# User: admin
# Password: kubectl -n monitoring get secret grafana-oidc -o jsonpath='{.data.admin_password}' | base64 -d
```

## Editing dashboards

Dashboards are provisioned from `k8s/monitoring/dashboards/*.json`. UI edits are ephemeral — they survive page reloads but not Grafana restarts.

To make a change permanent:
1. Edit in the UI.
2. Share → Export → "Export for sharing externally" → save the JSON.
3. Replace the corresponding file in `k8s/monitoring/dashboards/`.
4. Regenerate the ConfigMap: `kubectl create configmap grafana-dashboards --namespace=monitoring --from-file=k8s/monitoring/dashboards/ --dry-run=client -o yaml > k8s/monitoring/grafana-dashboards-content.yaml`.
5. `kubectl apply -f k8s/monitoring/grafana-dashboards-content.yaml`.
6. Restart Grafana: `kubectl -n monitoring rollout restart deploy/grafana`.

## Common issues

**Target down in Prometheus:**
- `kubectl -n scrollr get endpoints <service>-metrics` — verify the endpoint exists.
- `kubectl -n scrollr logs deploy/<service>` — look for `[Metrics] serving on :PORT`. If absent, the metrics listener didn't start.

**Grafana can't load data:**
- Verify the Prometheus datasource: Configuration → Data sources → Prometheus → Test.
- If it fails with a DNS error, the Prometheus Service is missing or the namespace is wrong.

**Privacy test failures:**
- Read the test output — it includes the full metrics body with the offending content highlighted.
- The fix is almost always one of: (1) a label using a raw value instead of a template/static name; (2) a new label added without a privacy review.

## Alerting

There is none yet. This is intentional. When operational pressure justifies it, a separate spec will add Alertmanager rules.
```

- [ ] **Step 2: Update root `AGENTS.md`**

Add a new section under "Architecture Rules" (around line 200, before "Database Migrations"):

```markdown
## Observability

Every backend service exposes Prometheus metrics on a separate internal-only port (`<app-port> + 1000`). The full design is in [`docs/superpowers/specs/2026-05-13-operational-metrics-design.md`](docs/superpowers/specs/2026-05-13-operational-metrics-design.md); the operator runbook is in [`docs/operations/metrics.md`](docs/operations/metrics.md).

### Hard rules

- **Static scrape config, not prometheus-operator.** `k8s/monitoring/prometheus-config.yaml` is the single source of truth for scrape targets. DO NOT install `prometheus-operator`. DO NOT create `ServiceMonitor` or `PodMonitor` CRDs. To add a new scrape target, add a `scrape_configs[]` entry to the ConfigMap and `kubectl apply` — Prometheus reloads automatically.
- **No per-user data in metrics.** Labels are static (route templates, command names, job names), never values that depend on a user. The README's "no telemetry" promise applies here.
- **Metrics ports are never on the public Service.** They live on a separate `<service>-metrics` Service in the `scrollr` namespace.
- **Privacy is enforced by tests.** Every service has a `metrics_privacy_test.{go,rs}` that scrapes its own endpoint and asserts no PII. Don't disable these tests; if one fails, the metrics layer is leaking and must be fixed.

### Adding metrics in a new service

Follow the pattern in `api/core/metrics.go` (Go) or `channels/finance/service/src/metrics.rs` (Rust). Each channel/service gets its own copy — per AGENTS.md's "channel isolation is absolute" rule, do not extract a shared metrics library.

### Grafana

Sign-in is Logto OIDC. Local-account login is disabled. Dashboards are committed JSON in `k8s/monitoring/dashboards/` — UI edits are ephemeral; commit the JSON to persist.
```

- [ ] **Step 3: Commit**

```bash
git add docs/operations/metrics.md AGENTS.md
git commit -m "docs(metrics): operator runbook + AGENTS.md observability section"
```

---

## Self-Review Checklist (post-implementation)

- [ ] All 8 backend services expose `/metrics` on their dedicated internal port.
- [ ] Prometheus scrapes all 8 targets — `up{job=~".+"}` returns `1` for every job.
- [ ] Grafana loads, Logto sign-in works, all five dashboards display data.
- [ ] All privacy tests pass locally and (if CI exists) in CI.
- [ ] `kubectl get pods -n monitoring` shows `prometheus` and `grafana` both `Running`.
- [ ] No `ServiceMonitor` or `PodMonitor` CRDs exist in the cluster.
- [ ] No `prometheus-operator` deployment exists in any namespace.
- [ ] `AGENTS.md` Observability section is in place.
- [ ] `docs/operations/metrics.md` is in place.
- [ ] The static-scrape-config decision is documented in three places: the design spec, `prometheus-config.yaml`'s top comment, and `AGENTS.md`.
- [ ] No public Ingress resource points at port 9080–9084 or 9001–9004 on any backend service.
- [ ] `kubectl -n scrollr get svc | grep metrics` shows 8 metrics-only Services.
- [ ] The Sentry rollout (`2026-05-12-sentry-rollout.md`) is unaffected — these are independent concerns.

---

## Out of scope (separate specs when prioritized)

- Alertmanager rules and on-call routing.
- NetworkPolicies enforcing metrics-port isolation at the network layer.
- Long-term metrics retention via remote_write (Thanos, Mimir, Grafana Cloud).
- Log aggregation (Loki).
- Distributed tracing (Tempo, Jaeger).
- Anything client-side (desktop or marketing site) — explicitly forbidden by privacy posture.
