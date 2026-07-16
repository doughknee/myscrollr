# AGENTS.md

Operational guide for AI coding agents working in this repository.

## Project Overview

MyScrollr aggregates financial market data, sports scores, RSS feeds, and Yahoo Fantasy Sports. Tauri desktop app (primary product), React marketing website, Go gateway API, and independent channel services. Infrastructure: PostgreSQL, Redis, Logto (auth), Sequin (CDC), Stripe (billing). Deployed on DigitalOcean Kubernetes (DOKS) with images stored in DigitalOcean Container Registry (DOCR). See `k8s/` for manifests and `.github/workflows/deploy.yml` for the build-and-deploy pipeline.

## Repository Layout

Monorepo — each component is independently deployable with its own dependencies:

- `api/` — Core gateway API (Go 1.25, Fiber v2, sub-package `core/`)
- `myscrollr.com/` — Marketing website + auth/billing (React 19, Vite 7, TanStack Router, Tailwind v4)
- `desktop/` — Tauri v2 desktop app (React 19, Vite 7, TanStack Router + Query, Tailwind v4, Rust backend) — **primary product**
- The finance, sports, rss, and predictions Go APIs were folded into `api/core/{finance,sports,rss,predictions}.go` (ADR-0002); fantasy is the one remaining channel Go API
- `channels/{finance,sports,rss,predictions}/service/` — Rust ingestion services (independent crates, edition 2024; predictions holds the Kalshi credentials and WS sweep)
- `channels/fantasy/api/` — Fantasy Go API (Yahoo OAuth2, Go-native sync, no Rust service)

## Build, Lint, Test Commands

### Website (`myscrollr.com/`)

```sh
npm run dev          # Vite dev server on port 3000
npm run build        # vite build && tsc (includes type-checking)
npm run check        # prettier --write . && eslint --fix (run before committing)
npm run lint         # eslint (no flags — pass your own, e.g. npm run lint -- --fix)
npm run format       # prettier (no flags — e.g. npm run format -- --write .)
```

### Desktop (`desktop/`)

```sh
npm run dev          # Vite frontend only on port 5174
npm run build        # vite build && tsc --noEmit (includes type-checking)
npm run tauri:dev    # Full Tauri dev (Vite + Rust backend)
npm run tauri:build  # Production build (native binary)
```

### Go APIs (`api/` and `channels/{name}/api/`)

```sh
go build -o scrollr_api && ./scrollr_api   # Core: port 8080
go build -o fantasy_api && ./fantasy_api   # fantasy=8084 (finance/sports/rss/predictions live in core)
```

### Rust Services (`channels/{finance,sports,rss,predictions}/service/`)

```sh
cargo build --release && cargo run   # finance=3001, sports=3002, rss=3004, predictions=3005
```

### Tests

- **TypeScript** (Vitest): All: `npx vitest run`. File: `npx vitest run path/to/file.test.ts`. Single: `npx vitest run -t "test name"`.
- **Go**: All: `go test ./...`. File: `go test ./path/to/pkg`. Single: `go test -run TestName ./path/to/pkg`.
- **Rust**: All: `cargo test`. Single: `cargo test test_name`.

Go integration tests in `api/core` (GDPR purge cascade, Stripe webhook idempotency) need a real Postgres and gate on `TEST_DATABASE_URL` — they skip when it's unset, so plain `go test ./...` always works without a database. To run them locally, point the variable at a scratch database (the tests apply the repo's migrations and truncate the tables they touch — never use a database with real data):

```sh
TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5432/scrollr_test?sslmode=disable" go test ./core
```

### CI

- `.github/workflows/backend-tests.yml` — Go + Rust tests on every push/PR touching `api/` or `channels/`. The Go jobs get a Postgres 16 service container with `TEST_DATABASE_URL` set, so the `api/core` integration tests run for real in CI.
- `.github/workflows/frontend-tests.yml` — Vitest suites for `myscrollr.com/` and `desktop/` on every push/PR touching them.
- `.github/workflows/desktop-release.yml` — desktop releases. Triggers on push to `main` when `desktop/` changes, or via `workflow_dispatch`. Builds Linux/macOS/Windows via `tauri-action`. Node 22, stable Rust, `npm ci`.
- `.github/workflows/deploy.yml` — builds and deploys the API, channels, and website to production on push to `main`.

## Code Style — TypeScript

Two sub-projects with divergent conventions:

| | Website (`myscrollr.com/`) | Desktop (`desktop/`) |
|---|---|---|
| Semicolons | No | Yes |
| Quotes | Single | Double |
| Formatter | Prettier (`semi: false, singleQuote: true, trailingComma: 'all'`) | None |
| Linter | ESLint (`@tanstack/eslint-config` flat config) | None |
| `noUnusedLocals` | Yes | No |
| `noUnusedParameters` | Yes | No |
| Path alias `@/` | Yes (`./src/*`) | **No** — use relative `../` imports |
| Conditional classes | Template literals | `clsx` |
| Data fetching | None (static marketing site) | TanStack Query |
| Component exports | Named only | Default (`export default function C()`) |

**Shared rules:**

- Strict mode. Target ES2022. `verbatimModuleSyntax: true` — always use `import type` for type-only imports.
- Function components with named exports. Hooks as named function exports (`export function useX()`).
- No barrel files. Never edit `src/routeTree.gen.ts` (auto-generated by TanStack Router).
- Import order: 1) React/framework 2) third-party 3) internal modules 4) relative imports 5) `import type` last.

**Website-specific**: No default exports except route modules (`export const Route = createFileRoute(...)`). Tailwind v4 zero-config via `@tailwindcss/vite` — no `tailwind.config.*`. Dark mode via `.dark` class on `<html>`. Self-hosted fonts via `@font-face`. Also enables `noUncheckedSideEffectImports`.

### Website rendering: TanStack Start static prerender

The marketing site is **statically prerendered** via `@tanstack/react-start` in static mode. The build emits `dist/client/` (shipped) and `dist/server/` (Node SSR bundle, not shipped). The Dockerfile copies only `dist/client/`.

- **Marketing routes** (`/`, `/channels`, `/download`, `/uplink`, `/uplink/lifetime`, `/business`, `/architecture`, `/support`, `/legal`) emit `dist/client/<route>/index.html` at build time with full per-route `<title>`, meta, OpenGraph, Twitter card, canonical, and JSON-LD scripts.
- **Auth/dynamic routes** (`/account`, `/callback`, `/invite`, `/status`, `/u/$username`) are excluded from prerender. They fall back to the SPA shell via nginx `try_files $uri $uri/ /index.html;`.
- **Per-route head**: every route uses `Route.head: () => seo({...})` from `src/lib/seo.ts`. Do NOT use `useEffect` to set `document.title` or meta tags — they will be ignored by social-preview crawlers. The `usePageMeta` hook has been removed; do not reintroduce it.
- **Structured data** lives in `src/lib/structured-data.ts` (Organization, WebSite, SoftwareApplication, productOffers, faqPage, breadcrumbs). Add new schemas there.
- **OpenGraph images** are 1200×630 PNGs in `public/og/`. Regenerate with `npm run og-images` (requires Playwright + Chromium binary).
- **Sitemap** is auto-generated by `scripts/generate-sitemap.mjs` as part of `prebuild`. Edit the `ROUTES` array there, not `public/sitemap.xml` directly.
- **Postbuild check** (`scripts/check-prerender.mjs`) asserts every marketing route prerenders with title, single canonical, and the expected JSON-LD count. Fails the build on regression.
- **SPA shell**: `dist/client/_shell.html` is the SPA fallback shell, rendered from the synthetic `/tss-spa-shell` maskPath so it can't collide with the home prerender (`dist/client/index.html`). The postbuild `check-prerender.mjs` guard fails the build if the home prerender goes missing.

### Website SSR safety

Components are rendered at build time in a Node environment. Any module-scope access to `window`, `document`, `localStorage`, or `navigator` will crash the prerender step. Wrap such access in `typeof window !== 'undefined'` checks or move into `useEffect` / event handlers. Decorative randomness must use `src/lib/seededRandom.ts` (Mulberry32) — `Math.random()` at module scope or render time causes hydration mismatches.

**Desktop-specific**: Multi-page build: two HTML entry points (`index.html` for ticker, `app.html` for main window). Dark mode via `data-theme` attribute (dark is default). Tailwind uses `@source` directives and `@utility` custom utilities. Google Fonts CDN. Root route (`__root.tsx`) contains the entire app shell, state management, and context provider.

## Code Style — Go

- `gofmt` formatting. No custom linter. Go 1.25 across all modules.
- All use Fiber v2, pgx v5, go-redis v9.
- Two Go modules: `api/` (core, incl. the folded widget sources) and `channels/fantasy/api/`. No shared packages between them — fantasy keeps the HTTP-only contract (ADR-0002 retired the old five-module duplication rule).
- Core API: `core/` sub-package, package-level vars (`DBPool`, `Rdb`), `Server` struct. Widget sources register in `localSources` (`api/core/sources.go`).
- Fantasy API: flat `main` package, `App` struct holding deps (`db *pgxpool.Pool`, `rdb *redis.Client`).
- Naming: PascalCase exports, camelCase unexported, short receivers (`s *Server`, `a *App`), `snake_case` JSON tags. Constants are PascalCase, grouped with `=====` comment separators.
- Error handling: `if err != nil` returns. `fmt.Errorf("context: %w", err)` wrapping. `log.Printf("[Context] message: %v", err)` with bracketed prefixes. `log.Fatalf` for startup failures. HTTP errors via `ErrorResponse` struct.
- Registration: fantasy self-registers in Redis with 30s TTL, 20s heartbeat.
- **Keep `api/core/extension_auth.go` and `/extension/token` routes** — the desktop app uses these for PKCE auth despite the legacy naming.

## Code Style — Rust

### Ingestion Services (`channels/{name}/service/`)

- Edition 2024. Default `rustfmt`.
- Error handling: `anyhow` exclusively (`anyhow::{Context, Result}`). No custom error types. Use `.context("msg")?`. Avoid `unwrap()`/`panic!` except truly unrecoverable init failures.
- Async: Tokio + tokio-util, Axum HTTP, SQLx Postgres. Shutdown via `CancellationToken` (tokio_util).
- Logging: `log` crate macros. Custom async file logger (`log.rs`) writes to `./logs/`.
- `database.rs` and `log.rs` are copy-pasted across services. Do not extract a shared crate.
- Finance is unique: uses WebSocket (tokio-tungstenite) for TwelveData streaming. Others use HTTP polling.

### Desktop Tauri (`desktop/src-tauri/`)

- Edition 2021 (not 2024). `lib.rs` is the main entry point (~1200 lines).
- Commands: `#[tauri::command]`, `Result<(), String>` + `.map_err(|e| format!("context: {e}"))`.
- State: custom structs via `app.manage()`. Two windows: `ticker` (always-on-top, 1920x228) and `main` (960x640 default). Close hides instead of destroying.
- MCP bridge plugin: dev-only, non-Windows (`#[cfg(all(debug_assertions, not(target_os = "windows")))]`).

## Architecture Rules

(Reshaped by [ADR-0002](docs/adr/0002-consolidate-widget-read-apis.md), July 2026.)

1. **Widget read APIs live in core.** Finance, sports, rss, and predictions are served natively by `api/core/{finance,sports,rss,predictions}.go` behind the `localSource` seam (`api/core/sources.go`): native routes registered ahead of the dynamic proxy, plus in-process dashboard/health/lifecycle hooks. Adding a data source = a Go package in core + (usually) a Rust ingester.
2. **Ingestion is isolated.** Each source's poller is a separate Rust service with its own schedule, quota blast radius, and rollout cadence (fantasy ingests in-process in Go). Core reaches ingesters only via `INTERNAL_{SOURCE}_URL` health probes, plus the predictions candlesticks pass-through.
3. **Fantasy is the one proxied channel service.** It self-registers in Redis (30s TTL heartbeat), is discovered and proxied dynamically, and trusts the `X-User-Sub` header core injects after JWT validation — it never sees tokens. The HTTP-only contract and module isolation still apply to it.
4. **Topic-based CDC PubSub**: Core maps CDC events to topics in-process and dispatches via Redis PubSub (O(1) per event); every replica fans out to its own SSE clients (ADR-0001).
5. **Desktop is the primary product.** The website serves marketing, auth, and billing only.

## Error Monitoring — Sentry

Every component has Sentry wired in. **Privacy is the hard constraint** — see [`docs/superpowers/plans/2026-05-12-sentry-rollout.md`](docs/superpowers/plans/2026-05-12-sentry-rollout.md) for the full plan and the privacy audit checklist.

### What's instrumented

| Component | SDK | Project |
|---|---|---|
| `myscrollr.com/` | `@sentry/react` | `scrollr-web` |
| `desktop/` (webview, both windows) | `@sentry/react` | `scrollr-desktop` (tagged `runtime=webview`, `window=ticker|app`) |
| `desktop/src-tauri/` (Rust core) | `sentry@0.42` crate | `scrollr-desktop` (tagged `runtime=rust-core`) |
| `api/` (core Go) | `sentry-go@v0.46` + `sentry-go/fiber` | `scrollr-core-api` |
| `channels/fantasy/api/` | `sentry-go@v0.46` + `sentry-go/fiber` | `scrollr-fantasy-api` (finance/sports/rss/predictions report under `scrollr-core-api` since ADR-0002) |
| `channels/{finance,sports,rss}/service/` | `sentry@0.42` + `sentry-anyhow@0.42` Rust crates | `scrollr-{name}-svc` |
| `channels/predictions/{api,service}/` | same wiring as the other channels | none yet — `PREDICTIONS_*_SENTRY_DSN` env vars exist but are unset (no Sentry project created) |

### Adding a new error capture site

**JS (React):**
```ts
import * as Sentry from '@sentry/react'

try {
  await doSomething()
} catch (err) {
  Sentry.captureException(err, { tags: { feature: 'checkout' } })
}
```

**Go (Fiber):** panics are auto-captured by `sentryfiber`. For non-panic errors:
```go
hub := sentryfiber.GetHubFromContext(c)
if hub != nil {
    hub.CaptureException(err)
}
```

**Rust:** use `sentry_anyhow::capture_anyhow(&e)` for `anyhow::Error`. For custom error types that don't impl `Into<anyhow::Error>`, use `sentry::capture_message(&fmt::format!("..."), sentry::Level::Error)`.

### Forbidden patterns

- **Never** call `Sentry.replayIntegration()` or `Sentry.feedbackIntegration()`.
- **Never** add tokens, emails, IPs, or request bodies to a Sentry event. Format strings like `fmt.Errorf("token %s: %w", token, err)` are forbidden — wrap with `%w` only.
- **Never** propagate trace headers to third-party services (Stripe, Logto, Yahoo, TwelveData, ESPN, RSS sources). The default `tracePropagationTargets` covers this; don't widen it.
- **Never** rotate `SENTRY_USER_SALT` — existing hashes would un-cluster all historical events.
- **Never** use `#[tokio::main]` in Rust services. Sentry must initialize before the Tokio runtime starts. Use `fn main() -> Result<()>` that inits Sentry, builds the runtime manually, and calls `runtime.block_on(run_service())`.

### Privacy enforcement

Each Go service ships a `sentry_scrubbing_test.go` that constructs a worst-case event (auth headers, OAuth code/state, refresh token in body, IP/email/username) and asserts the scrubber strips it all. If that test ever fails, the integration is leaking — do NOT deploy.

When in doubt, run the audit checklist in the rollout plan.

## Database Migrations

All systems use formal migrations. Inline `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` blocks have been replaced.

| System | Tool | Driver |
|--------|------|--------|
| Core API (`api/`) | golang-migrate v4 | postgres |
| Fantasy API (`channels/fantasy/api/`) | golang-migrate v4 | postgres |
| Finance service (`channels/finance/service/`) | sqlx::migrate | postgres |
| Sports service (`channels/sports/service/`) | sqlx::migrate | postgres |
| RSS service (`channels/rss/service/`) | sqlx::migrate | postgres |

**Migrations run on startup** — no manual steps or CI scripts required. A failed migration calls `log.Fatalf` / propagates the error, preventing the app from serving traffic with a half-applied schema.

### Go APIs (golang-migrate)

Migration files live in `{module}/migrations/` with naming convention `000NNN_description.up.sql` / `000NNN_description.down.sql`. The migrator is initialized in `ConnectDB()` (Core) and `main()` (Fantasy):

```go
m, err := migrate.New("file://migrations", databaseURL)
if err != nil { log.Fatalf("create migrator: %v", err) }
if err := m.Up(); err != nil && err != migrate.ErrNoChange {
    m.Close()
    log.Fatalf("migration failed: %v", err)
}
m.Close()
```

### Rust Services (sqlx::migrate)

All three Rust services share a single PostgreSQL database and a single `_sqlx_migrations` table (sqlx 0.8.x has no API to rename the migration table). To keep their versions from colliding, each service owns a **numeric version prefix**:

| Service | Version prefix | Filename pattern |
|---|---|---|
| `channels/finance/service/` | `11*` | `110000000001_initial.up.sql`, `110000000002_add_name_category.up.sql`, … |
| `channels/sports/service/` | `12*` | `120000000001_initial.up.sql`, `120000000002_add_columns.up.sql`, … |
| `channels/rss/service/` | `20250601*` (legacy) → `13*` (new) | Existing rows stay; new rss migrations use `130000000001_*` and up. |

The migrator is run inside `initialize_pool()`:

```rust
fn migrator() -> sqlx::migrate::Migrator {
    let mut m = sqlx::migrate!("./migrations");
    m.set_ignore_missing(true);
    m
}

// inside initialize_pool():
let m = migrator();
if let Err(err) = m.run(&pool).await {
    eprintln!("[DB] Migration failure: {err}");
    eprintln!("[DB] Underlying error chain: {err:?}");
    return Err(anyhow::Error::new(err).context("Failed to run migrations. No automatic recovery — inspect _sqlx_migrations"));
}
```

**`set_ignore_missing(true)` is required** because all three services share the `_sqlx_migrations` table. Without it, each service errors out with `VersionMissing` when it sees rows for other services' version prefixes (e.g. finance seeing sports' `12*` rows). The flag only tolerates versions recorded in the DB that have no matching local file; it does NOT suppress `VersionMismatch` (checksum drift on a row whose file *is* on disk), so the 3-day silent-failure mode from April 2026 stays fixed. See PRs #106 and #107.

Each service has a `tests/migration_versions.rs` that asserts every on-disk migration falls inside its assigned numeric range. This runs as part of `cargo test` and fails the build if someone accidentally copy-pastes a filename across services.

### Adding a New Migration

**Go**: Create `000NNN_description.up.sql` and `000NNN_description.down.sql` in the module's `migrations/` directory. Test with `migrate -path migrations -database "$DATABASE_URL" up` locally, then commit.

**Rust**: Create `<prefix>NNNNNNNNNN_description.up.sql` and `.down.sql` in the crate's `migrations/` directory, using your service's numeric prefix (`11*` for finance, `12*` for sports, `13*` for new rss). Sequence numbers must increase. Run `cargo test` — the `migration_versions.rs` test will reject any version outside your service's range.

### Rules

- **Never mix inline SQL and migration files.** All schema changes go through migrations.
- **Initial migration uses `CREATE TABLE IF NOT EXISTS`** for idempotency — existing tables are preserved, new ones are created.
- **Catch-up migrations** use `ADD COLUMN IF NOT EXISTS` / `DO $$` blocks to handle existing deployments safely.
- **Down migrations** are written for development/testing. Down migrations that drop tables are documented but rarely needed in production.
- **Data-only operations** (e.g., cleanup, pruning) stay as inline code — they don't need versioning.
- **Coordinated changes** that touch both a Go API and a Rust service need matching migrations in both systems.

## Docker & Deployment

Local dev is driven by the root `Makefile`: `docker-compose.local.yml` runs infra only (Postgres + Redis) for native backend work; `docker-compose.dev.yml` includes it and adds the full containerized backend (see `LOCAL_SETUP.md`). The per-channel `docker-compose.yml` files are legacy standalone artifacts not wired to the Makefile. Production uses standalone Dockerfiles built and pushed to DigitalOcean Container Registry (`registry.digitalocean.com/scrollr/*`) by `.github/workflows/deploy.yml`, then rolled out to a DigitalOcean Kubernetes cluster (`scrollr-cluster`) via `kubectl apply -f k8s/`. Secrets live in the `scrollr-secrets` Kubernetes Secret (template in `k8s/secrets.yaml.template`). ConfigMaps in `k8s/configmap-*.yaml` hold non-sensitive runtime config. Ingress + TLS via nginx-ingress + cert-manager.

## Git Workflow

Branch off `main`: `git checkout -b <prefix>/short-description`. PR back into `main`. Squash merge. Trivial fixes commit directly to `main`. Prefixes: `feature/`, `fix/`, `refactor/`, `chore/`.

## Environment

Copy `.env.example` to `.env`. Frontend env in `myscrollr.com/.env` and `desktop/.env` (both use `VITE_API_URL`). Never commit `.env` files. Package manager is **npm** throughout (not pnpm/yarn).
