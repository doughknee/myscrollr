# AGENTS.md

Operational guide for AI coding agents working in this repository.

## Project Overview

MyScrollr aggregates financial market data, sports scores, RSS feeds, and Yahoo Fantasy Sports. Tauri desktop app (primary product), React marketing website, Go gateway API, and independent channel services. Infrastructure: PostgreSQL, Redis, Logto (auth), Sequin (CDC), Stripe (billing). Deployed on DigitalOcean Kubernetes (DOKS) with images stored in DigitalOcean Container Registry (DOCR). See `k8s/` for manifests and `.github/workflows/deploy.yml` for the build-and-deploy pipeline.

## Repository Layout

Monorepo — each component is independently deployable with its own dependencies:

- `api/` — Core API (Go 1.25, Fiber v2). Internal packages under `api/internal/`; `api/core` wires them into one binary
- `myscrollr.com/` — Marketing website + auth/billing (React 19, Vite 7, TanStack Router, Tailwind v4)
- `desktop/` — Tauri v2 desktop app (React 19, Vite 7, TanStack Router + Query, Tailwind v4, Rust backend) — **primary product**
- The finance, sports, rss, and predictions Go APIs were folded into `api/internal/ingestread/` (ADR-0002); fantasy is the one remaining discovered channel service
- `channels/{finance,sports,rss,predictions}/service/` — Rust ingestion services (independent crates, edition 2024; predictions holds the Kalshi credentials and WS sweep)
- `channels/fantasy/api/` — Fantasy Go API (Yahoo OAuth2, Go-native sync, no Rust service)

## Running it locally

**Two commands from a fresh clone.** Everything below assumes you did this.

```sh
make setup   # generate every .env file (once)
make up      # start the whole backend in Docker, wait until healthy
```

`make` on its own prints every command, grouped. `make doctor` diagnoses a
broken machine and names the fix for each problem.

You need **Docker Desktop**, **Node 22+** and **make**. You do **not** need a
Go or Rust toolchain — the backend compiles inside its containers. Do not tell
a user to install Go or Rust to run this project.

| What | Where | Port |
|---|---|---|
| Postgres, Redis | Docker | 5432, 6379 |
| Core API | Docker | **18080** |
| Fantasy API | Docker | 8084 |
| finance / sports / rss ingesters | Docker | 3001 / 3002 / 3004 |
| predictions ingester (opt-in) | Docker | 3005 |
| Marketing site | native — `make web` | 3000 |
| Desktop app | native — `make desktop` | — |

**Core is published on 18080, not 8080.** Steam's CEF debugger claims
localhost:8080 on Windows. Inside the compose network services still reach core
on 8080; anything on the host uses 18080.

**Editing backend code needs no command.** Each container runs a file watcher
against bind-mounted source (`air` for Go, `cargo watch` for Rust), so saving a
`.go` or `.rs` file rebuilds that one service in place. `make rebuild` is only
for dependency changes (`go.mod`, `Cargo.toml`). `make logs svc=core-api` tails
one service; `make down` stops and keeps data; `make reset` wipes it.

Full runbook, including the Windows-specific traps: `docs/LOCAL_SETUP.md`.

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

### Backend (Go and Rust)

**You don't run these by hand.** `make up` builds and runs every backend
service in Docker, and the containers hot-reload on save. There is no
supported native workflow and no host toolchain requirement.

To compile-check or test a specific service without a local toolchain, use its
container: `make shell svc=core-api` then `go build ./...`, or
`make shell svc=rss-service` then `cargo check`.

### Tests

- **TypeScript** (Vitest): All: `npx vitest run`. File: `npx vitest run path/to/file.test.ts`. Single: `npx vitest run -t "test name"`.
- **Go**: All: `go test ./...`. File: `go test ./path/to/pkg`. Single: `go test -run TestName ./path/to/pkg`.
- **Rust**: All: `cargo test`. Single: `cargo test test_name`.

Go integration tests (GDPR purge cascade, Stripe webhook idempotency, fantasy's schema contract) need a real Postgres and gate on `TEST_DATABASE_URL` — they skip when it's unset, so plain `go test ./...` always works without a database. To run them locally, point the variable at a scratch database (the tests apply the repo's migrations and truncate the tables they touch — never use a database with real data):

```sh
TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5432/scrollr_test?sslmode=disable" go test ./...
```

### CI

- `.github/workflows/backend-tests.yml` — three job groups: `go-tests` (api, fantasy), `rust-tests` (the four channel service crates), and `desktop-rust-tests` (`desktop/src-tauri`, added 2026-07-24 — that crate was in no matrix and its 18 tests ran nowhere). Triggers on `api/**`, `channels/**/*.{go,rs}`, and `desktop/src-tauri/**`. The Go and channel jobs get a Postgres 16 service container with `TEST_DATABASE_URL` set, so the integration tests run for real. `desktop-rust-tests` needs no database but does need the webkit dev headers to link, which is why it's its own job.
- `.github/workflows/frontend-tests.yml` — Vitest suites for `myscrollr.com/` and `desktop/` on every push/PR touching them.
- `.github/workflows/desktop-release.yml` — desktop releases. Triggers on push to `main` when `desktop/` changes, or via `workflow_dispatch`. Builds Linux/macOS/Windows via `tauri-action`. Node 22, stable Rust, `npm ci`.
  **A `preflight` job gates the build**: it skips when the version in `tauri.conf.json` already has a *published* release, because `tauri-action` would otherwise upload into it and silently replace the live binaries. So a push to `main` touching `desktop/` usually builds nothing — that's correct, not a failure. To actually cut a release, bump the version.
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
- Core API: internal packages under `api/internal/` (`platform`, `events`, `widgets`, `ingestread`, `accounts`, `billing`, `support`, plus `testsupport` for test helpers) wired by `api/core`. One binary. `platform` is the leaf — package-level `DBPool`/`Rdb` live there; `core` is the only package that imports everything. Widget sources register in `LocalSources` (`api/internal/ingestread/sources.go`).
- Fantasy API: flat `main` package, `App` struct holding deps (`db *pgxpool.Pool`, `rdb *redis.Client`).
- Naming: PascalCase exports, camelCase unexported, short receivers (`s *Server`, `a *App`), `snake_case` JSON tags. Constants are PascalCase, grouped with `=====` comment separators.
- Error handling: `if err != nil` returns. `fmt.Errorf("context: %w", err)` wrapping. `log.Printf("[Context] message: %v", err)` with bracketed prefixes. `log.Fatalf` for startup failures. HTTP errors via `ErrorResponse` struct.
- Registration: fantasy self-registers in Redis with 30s TTL, 20s heartbeat.
- **Keep `api/internal/accounts/extension_auth.go` and `/extension/token` routes** — the desktop app uses these for PKCE auth despite the legacy naming.

## Code Style — Rust

### Ingestion Services (`channels/{name}/service/`)

- Edition 2024. Default `rustfmt`.
- Error handling: `anyhow` exclusively (`anyhow::{Context, Result}`). No custom error types. Use `.context("msg")?`. Avoid `unwrap()`/`panic!` except truly unrecoverable init failures.
- Async: Tokio + tokio-util, Axum HTTP, SQLx Postgres. Shutdown via `CancellationToken` (tokio_util).
- Logging: `log` crate macros. Custom async file logger (`log.rs`) writes to `./logs/`.
- `database.rs` and `log.rs` are copy-pasted across services. Do not extract a shared crate.
- Finance is unique: uses WebSocket (tokio-tungstenite) for TwelveData streaming. Others use HTTP polling.

### Desktop Tauri (`desktop/src-tauri/`)

- Edition 2021 (not 2024). `lib.rs` is the entry point (~280 lines); commands live under `src/commands/`, the Kalshi client under `src/kalshi/`, and the Wayland shims under `src/compositor/`.
- Commands: `#[tauri::command]`, `Result<(), String>` + `.map_err(|e| format!("context: {e}"))`.
- State: custom structs via `app.manage()`. Two windows: `ticker` (always-on-top, 1920x228) and `main` (960x640 default). Close hides instead of destroying.
- MCP bridge plugin: opt-in behind the `dev-mcp-bridge` Cargo feature, dev-only, non-Windows — `#[cfg(all(feature = "dev-mcp-bridge", debug_assertions, not(target_os = "windows")))]`. Release builds never link the crate. Run it with `npm run tauri:dev:mcp`.

## Architecture Rules

(Reshaped by [ADR-0002](docs/adr/0002-consolidate-widget-read-apis.md), July 2026.)

1. **Widget read APIs live in core.** Finance, sports, rss, and predictions are served natively from `api/internal/ingestread/` behind the `localSource` seam (`sources.go`): native routes registered ahead of the dynamic proxy, plus in-process dashboard/health/lifecycle hooks. Adding a data source = a file in `ingestread` + a catalog entry + (usually) a Rust ingester. See `api/CHANNELS.md`.
2. **Ingestion is isolated.** Each source's poller is a separate Rust service with its own schedule, quota blast radius, and rollout cadence (fantasy ingests in-process in Go). Core reaches ingesters only via `INTERNAL_{SOURCE}_URL` health probes, plus the predictions candlesticks pass-through.
3. **Fantasy is the one proxied channel service.** It self-registers in Redis (30s TTL heartbeat), is discovered and proxied dynamically, and trusts the `X-User-Sub` header core injects after JWT validation — it never sees tokens. The HTTP-only contract and module isolation still apply to it.
4. **Topic-based CDC PubSub**: Core maps CDC events to topics in-process and dispatches via Redis PubSub (O(1) per event); every replica fans out to its own SSE clients (ADR-0001).
5. **Desktop is the primary product.** The website serves marketing, auth, and billing only.

## Error Monitoring — Sentry

Every component has Sentry wired in. **Privacy is the hard constraint** — the invariants below are canonical (this section, not any dated doc).

### What's instrumented

| Component | SDK | Project |
|---|---|---|
| `myscrollr.com/` | `@sentry/react` | `scrollr-web` |
| `desktop/` (webview, both windows) | `@sentry/react` | `scrollr-desktop` (tagged `runtime=webview`, `window=ticker|app`) |
| `desktop/src-tauri/` (Rust core) | `sentry@0.42` crate | `scrollr-desktop` (tagged `runtime=rust-core`) |
| `api/` (core Go) | `sentry-go@v0.46` + `sentry-go/fiber` | `scrollr-core-api` |
| `channels/fantasy/api/` | `sentry-go@v0.46` + `sentry-go/fiber` | `scrollr-fantasy-api` (finance/sports/rss/predictions report under `scrollr-core-api` since ADR-0002) |
| `channels/{finance,sports,rss}/service/` | `sentry@0.42` + `sentry-anyhow@0.42` Rust crates | `scrollr-{name}-svc` |
| `channels/predictions/service/` | same wiring as the other ingesters | none yet — `PREDICTIONS_*_SENTRY_DSN` env vars exist but are unset (no Sentry project created) |

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

This section is the whole contract — the rollout plan that used to hold a longer audit checklist was archived material and has been deleted. If a case isn't covered above, treat it as forbidden until someone decides otherwise.

## Database Migrations

**core-api owns every shared table. It is the only thing that migrates.**
(VISION §4.3, landed 2026-07-20.) The four Rust ingesters and the fantasy Go
API are pure writers: they connect and write, and run no migrations at all.

| | |
|---|---|
| Migrations live in | `api/migrations/` — nowhere else |
| Tool | golang-migrate v4, one version line (`schema_migrations_core`) |
| Runs | on core-api startup, in `platform.ConnectDB()` |

`api/migrations/000001_baseline.up.sql` is a squashed baseline covering all
26 tables — core's own plus every content table (`trades`, `games`,
`standings`, `teams`, `markets`, `rss_items`, `tracked_*`, `yahoo_*`). Do not
edit it; write new migrations on top.

### Adding a migration

Create `000NNN_description.up.sql` + `.down.sql` in `api/migrations/`. That's
it — there is no per-service prefix, no `_sqlx_migrations`, no version band.
Adding a column an ingester needs is a core migration, same as any other.

Verify against a scratch database (never one with real data):

```bash
TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5432/scrollr_test?sslmode=disable" go -C api test ./...
```

### Drift guards

Nothing stops a core migration from dropping a column an ingester depends on,
so each writer carries its own guard:

- **Rust ingesters** — sqlx is the intended guard (compile-time `query!`
  macros, so a mismatch fails the build). Not yet adopted; see the deferred
  note in ROLLOUT Phase 2.
- **Fantasy (Go)** — `channels/fantasy/api/schema_contract_test.go` asserts
  every `yahoo_*` column the service reads or writes still exists. Add to it
  when you add a column to a query there.

### Rules

- **Never mix inline SQL and migration files.** All schema changes go through `api/migrations/`.
- **Down migrations** are written for development/testing.
- **Data-only operations** (cleanup, pruning) stay as inline code — they don't need versioning.
- **A schema change that an ingester depends on is still a core migration** — update the ingester's drift guard in the same change.

## Docker & Deployment

Local dev is driven by the root `Makefile` — run `make` for the grouped command list. The whole backend runs in Docker from a single `docker/compose.yml`; each service builds its Dockerfile's `dev` stage, which runs a file watcher (`air` for Go, `cargo watch` for Rust) against bind-mounted source, so editing backend code needs no rebuild. That `dev` stage sits BEFORE the production runtime stage in every Dockerfile on purpose: `deploy.yml` builds with no `--target`, so the last stage is what ships. `make setup` generates every `.env`; `make doctor` diagnoses. The front-ends stay native (`make web`, `make desktop`). See `docs/LOCAL_SETUP.md`. Production uses standalone Dockerfiles built and pushed to DigitalOcean Container Registry (`registry.digitalocean.com/scrollr/*`) by `.github/workflows/deploy.yml`, then rolled out to a DigitalOcean Kubernetes cluster (`scrollr-cluster`) via `kubectl apply -f k8s/`. Secrets live in the `scrollr-secrets` Kubernetes Secret (template in `k8s/secrets.yaml.template`). ConfigMaps in `k8s/configmap-*.yaml` hold non-sensitive runtime config. Ingress + TLS via nginx-ingress + cert-manager.

## Git Workflow

Branch off `main`: `git checkout -b <prefix>/short-description`. PR back into `main`. Squash merge. Trivial fixes commit directly to `main`. Prefixes: `feature/`, `fix/`, `refactor/`, `chore/`.

## Environment

`make setup` generates every `.env` file — do not hand-assemble them, and do not tell a user to copy a root `.env.example` (there isn't one; it was a Coolify-era fossil, deleted 2026-07-24).

Per-component templates that DO exist: `api/`, `channels/{finance,sports,rss,fantasy}/`, `desktop/`, `myscrollr.com/`, `scripts/`. `api/.env.example` documents the 16 vars needed locally; the API reads ~65 in total, but the rest drive production-only integrations that all degrade gracefully when unset.

`ENCRYPTION_KEY` must be **identical** across `api/.env` and every `channels/*/.env` — core encrypts third-party tokens and the channels decrypt them. `make setup` generates one value and writes it everywhere.

Never commit `.env` files. Package manager is **npm** throughout (not pnpm/yarn).
