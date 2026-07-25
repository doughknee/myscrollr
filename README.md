# Scrollr

**A pinned, always-on-top ticker for the things you actually care about.**

Live market quotes, fantasy matchups, game scores, and RSS feeds —
streaming into a compact bar that floats on top of whatever you're
working on. Multi-monitor aware. Zero ads. Zero telemetry.

![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)
![Desktop](https://img.shields.io/badge/desktop-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
[![Status](https://img.shields.io/badge/status-live-brightgreen)](https://myscrollr.com/status)

![Scrollr home view — live feed across Finance, Sports, and Fantasy](./docs/images/scrollr-home.png)

- **Marketing site** — <https://myscrollr.com>
- **Desktop download** — <https://myscrollr.com/download>
- **Pricing / plans** — <https://myscrollr.com/uplink>
- **Status** — <https://myscrollr.com/status>

## What it looks like

Pick the sources you care about — each gets a focused view, and the
pinned ticker streams the same data across the top of your screen.

| | |
|---|---|
| ![Sports — live scores, schedules, and standings across MLB, NBA, NHL, NFL, F1](./docs/images/scrollr-sports.png) | ![Finance — 30+ tracked symbols with live quotes and movement](./docs/images/scrollr-finance.png) |
| **Sports.** Scores, schedules, and standings across MLB, NBA, NHL, NFL, and F1, all live. | **Finance.** Stocks, ETFs, and crypto with live quotes from TwelveData. |
| ![Fantasy — Yahoo Fantasy matchups, standings, and roster injuries](./docs/images/scrollr-fantasy.png) | ![News — Hacker News and your custom RSS feeds, categorized and deduped](./docs/images/scrollr-news.png) |
| **Fantasy.** Yahoo Fantasy matchups, weekly scoring, roster injuries — across every league you play. | **News.** Hacker News plus any RSS/Atom feed you throw at it. Categorized, deduped, sorted. |

## What's in this repo

Scrollr is a monorepo. The desktop app is the product; everything else
exists to feed it.

| Path | Service | Stack |
|---|---|---|
| [`desktop/`](./desktop/) | Desktop app (the primary product) | Tauri v2 + React 19 + Vite 7 |
| [`myscrollr.com/`](./myscrollr.com/) | Marketing, auth, billing — *not* where widgets are configured | React 19 + Vite 7 + TanStack Start (static prerender) |
| [`api/`](./api/) | Core API: widget catalog, reads, SSE, billing, accounts, support | Go 1.25 + Fiber v2 + Postgres + Redis |
| [`channels/finance/`](./channels/finance/) | Market-data ingester (TwelveData) | Rust |
| [`channels/sports/`](./channels/sports/) | Scores + schedules ingester (api-sports.io) | Rust |
| [`channels/rss/`](./channels/rss/) | RSS/Atom ingester | Rust |
| [`channels/predictions/`](./channels/predictions/) | Prediction-market ingester (Kalshi) | Rust |
| [`channels/fantasy/`](./channels/fantasy/) | Yahoo Fantasy (OAuth + sync) | Go |
| [`k8s/`](./k8s/) | Production manifests | Kubernetes on DigitalOcean |
| [`scripts/`](./scripts/) | Dev + ops tooling: `make` helpers, smoke tests, osTicket plugin | Node, Shell, PHP |
| [`docs/`](./docs/) | Charter, ADRs, roadmap, runbooks — [indexed here](./docs/README.md) | Markdown |

## How it fits together

```
┌──────────────────┐       ┌──────────────────┐
│  desktop app     │       │  myscrollr.com   │
│  (Tauri + React) │       │  (React + Vite)  │
└────────┬─────────┘       └────────┬─────────┘
         │                          │
         │   JWTs via Logto         │
         ▼                          ▼
   ┌─────────────────────────────────────────┐
   │  Core API  (api/ · Go · Fiber)          │  ← only JWT validator
   │  GET /catalog        the widget catalog │  ← owns every shared table
   │  /users/me/widgets   widget CRUD        │
   │  /dashboard /events  reads + SSE        │
   │  /checkout           billing            │
   │  finance · sports · rss · predictions   │  ← served in-process
   └──┬───────────────────────────────┬──────┘
      │ writes                        │ proxied, X-User-Sub
      │                               ▼
      │                            Fantasy (Go)
      │                            Yahoo OAuth + sync
      ▼
   shared Postgres  ◀── Rust ingesters: finance · sports · rss · predictions
      │                 (pure writers — they run no migrations)
      └── Sequin CDC → Redis pub/sub → SSE → ticker
```

- **Core API is the only service that validates JWTs**, and the only
  thing that migrates the database. The ingesters are pure writers.
- **The widget catalog is server-authoritative.** `GET /catalog` is the
  single definition of what widgets exist. The desktop fetches it and
  renders generically, so adding a widget that reuses an existing renderer
  is a server-only change — no client release. The marketing site does not
  fetch it; its widget counts are hardcoded and updated by hand.
- **Only fantasy is still a proxied service.** Finance, sports, rss and
  predictions were folded into core by
  [ADR-0002](./docs/adr/0002-consolidate-widget-read-apis.md); Redis
  service discovery survives for fantasy alone.
- **Data flows back via CDC.** Sequin streams Postgres changes to Redis
  topics; every core replica fans them out to connected desktops over
  SSE ([ADR-0001](./docs/adr/0001-sse-multi-replica.md)).

Read [`api/CHANNELS.md`](./api/CHANNELS.md) for the widget/source model
and how to add one.

## Quick start — just run the desktop app

Head to <https://myscrollr.com/download> and grab the build for your
OS. Macs and PCs will flag it as "from an unidentified developer" until
code signing lands in v1.0.1 — the download page explains how to allow
it.

## Quick start — local development

```sh
make setup   # generate every .env file (once)
make up      # start the whole backend in Docker
make dev     # ...and open the site + desktop app
```

`make` on its own lists every command, grouped.

You need **Docker Desktop**, **Node 22+** and **make** — that's it. No Go
or Rust toolchain: the backend compiles inside its containers, and editing
a `.go` or `.rs` file hot-reloads that service in place rather than
requiring a rebuild. `make doctor` checks your machine and names the fix
for anything missing.

The two front-ends run natively (a GUI window can't live in a Linux
container). Full topology, ports and troubleshooting:
[`docs/LOCAL_SETUP.md`](./docs/LOCAL_SETUP.md).

## Testing

```sh
make check   # both TypeScript suites — the ones that run without a toolchain
```

- **TypeScript**: `npm test` in `myscrollr.com/` and `desktop/`, or
  `npm run build` for a `tsc` typecheck.
- **Go and Rust**: no host toolchain is required to *run* this project, so
  the backend suites run in CI. To run them locally, use the containers the
  stack already builds — `make shell svc=core-api` then `go test ./...`, or
  `make shell svc=rss-service` then `cargo test`. Installing Go or Rust on
  the host also works, but nothing here needs it.

Integration tests (GDPR purge cascade, Stripe webhook idempotency,
fantasy's schema contract) need a real Postgres and skip without it, so
`go test ./...` is always safe. To run them, point `TEST_DATABASE_URL` at a
scratch database — never one with real data:

```sh
TEST_DATABASE_URL="postgres://scrollr:scrollr@postgres:5432/scrollr?sslmode=disable" go test ./...
```

CI runs all of it: `.github/workflows/backend-tests.yml` covers Go
(`api`, fantasy), the four Rust ingesters, and `desktop/src-tauri`;
`frontend-tests.yml` runs both Vitest suites;
`desktop-release.yml` builds and releases desktop binaries — though a
preflight job skips the build unless the version in `tauri.conf.json` is
unreleased; `deploy.yml` ships the API and website to production.

## Conventions

- **The server is the authority; clients are projections.** The widget
  catalog, the database schema, and the TS wire types all have exactly
  one definition in `api/`. Every client copy is pinned by a test that
  fails CI on drift — but they differ in how they're produced:
  `desktop/src/types/api.generated.ts` and `catalog.snapshot.json` are
  **generated** (`api/cmd/gents`, and `go test ./internal/widgets -update`),
  so change the Go and regenerate. `desktop/src/tierLimits.ts` is a
  **hand-kept mirror** — there is no generator; edit it and the Go map
  together, as its header comment lists.
- **No analytics, tracking pixels, or telemetry.** This is a public
  product promise, documented in the Privacy Policy. Don't add them.
- **Only core migrates.** All schema lives in `api/migrations/`; the
  ingesters are pure writers. A failed migration crashes the container.
- **Rollbacks via rolling forward.** We prefer forward-only migrations
  once deployed; the schema is additive wherever possible.
- **Ingesters stay independent.** Each Rust service owns its polling and
  parsing; that duplication is intentional. What's shared is the schema
  and the wire contract, not ingest logic.
- **Package manager is npm.** Not pnpm, not yarn.

Per-service style (semis, quotes, path aliases) varies — see
[`AGENTS.md`](./AGENTS.md) for the exact rules in each tree.

## Documentation

**[`docs/README.md`](./docs/README.md) indexes every doc in the repo** and says
which ones win when they disagree. The essentials:

- [`AGENTS.md`](./AGENTS.md) — the one-page cheatsheet: commands, ports,
  conventions, per-language rules.
- [`docs/VISION.md`](./docs/VISION.md) — the charter: what Scrollr is,
  the widget/slot model, and the ten decisions behind the current
  architecture. Start here to understand *why*.
- [`docs/ROLLOUT.md`](./docs/ROLLOUT.md) — how that charter was
  executed, phase by phase, including the deviations and why.
- [`api/CHANNELS.md`](./api/CHANNELS.md) — the widget/source model and
  how to add one.
- [`docs/adr/`](./docs/adr/) — numbered architecture decision records.
- [`docs/LOCAL_SETUP.md`](./docs/LOCAL_SETUP.md) — the local stack topology.
- [`CONTRIBUTING.md`](./.github/CONTRIBUTING.md) — how to report issues, how
  to send PRs, what we do and don't merge.
- [`CODE_OF_CONDUCT.md`](./.github/CODE_OF_CONDUCT.md) — community rules.
- [`SECURITY.md`](./.github/SECURITY.md) — vulnerability reporting.

## License

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).
See [`LICENSE`](./LICENSE).

If you run a modified copy of Scrollr as a network service for others,
AGPL requires you to offer users of that service access to your
modified source under the same license. This is by design — Scrollr
is a SaaS-style product, and the AGPL is what keeps it open even when
operated remotely.

## Contributing

See [`CONTRIBUTING.md`](./.github/CONTRIBUTING.md). Before your first PR,
please read the [`CODE_OF_CONDUCT.md`](./.github/CODE_OF_CONDUCT.md) and the
[`SECURITY.md`](./.github/SECURITY.md).

## Credits

- Built by Brandon Ruth and the Scrollr contributors.
- Desktop app powered by [Tauri](https://tauri.app).
- Market data from [TwelveData](https://twelvedata.com).
- Sports data from [api-sports.io](https://api-sports.io).
- Fantasy data from [Yahoo Fantasy Sports API](https://developer.yahoo.com/fantasysports/).
- Auth by [Logto](https://logto.io).
- Billing by [Stripe](https://stripe.com).
- Prediction markets from [Kalshi](https://kalshi.com).
- Infrastructure on [DigitalOcean](https://digitalocean.com) Kubernetes.
