# Contributing to Scrollr

Thanks for taking the time — Scrollr is better with outside eyes and
outside hands.

This document covers what to expect when you open an issue or send a
pull request. If you just want to run the project locally, the [root
`README.md`](./README.md) has the fastest path.

## Before you start

- Please read the [Code of Conduct](./CODE_OF_CONDUCT.md) and the
  [Security Policy](./SECURITY.md).
- Scrollr is released under the **GNU Affero General Public License v3
  or later** (AGPL-3.0-or-later). By contributing, you agree that your
  work will be distributed under that same license.
- Scrollr is a paid product **and** open source. The desktop app,
  server, and ingestion services live in this repo; the paid tiers are
  Stripe-gated. Both facts are intentional — please don't open PRs that
  remove tier enforcement, strip the "unsigned binary" install notices,
  or change billing logic without discussion first.

## Repository layout

| Path | Purpose |
|---|---|
| `api/` | Core gateway API (Go / Fiber). The only service that validates JWTs; everything else trusts its `X-User-Sub` header. |
| `channels/{finance,sports,rss,predictions}/service/` | Rust ingestion services (independent crates, edition 2024). Pure writers — they run no migrations and serve no app traffic; core reads their tables directly (ADR-0002). |
| `channels/fantasy/api/` | The one remaining separate service (Go). Stays separate for its Yahoo OAuth session and sync loop; core proxies to it. |
| `myscrollr.com/` | Marketing site, legal hub, billing portal (React + Vite + TanStack Router). |
| `desktop/` | Tauri v2 desktop app — the primary product. React frontend in `desktop/src/`, Rust backend in `desktop/src-tauri/`. |
| `k8s/` | Kubernetes manifests, applied to DOKS by `.github/workflows/deploy.yml`. |
| `docs/_archive/superpowers/` | Historical design specs/plans, one per shipped feature. Archived, not maintained — trust the code and `AGENTS.md` over it. |
| `scripts/` | Dev + ops shell tooling: local-stack helpers, Kalshi key pull, smoke tests. |

`AGENTS.md` at the root has the full commands cheatsheet (build, test,
ports).

## What we welcome

- Bug reports with clear reproduction steps.
- Documentation improvements (typos, clearer wording, missing docs).
- New widgets — see `api/CHANNELS.md`. Reusing an existing source is a
  server-only change: one entry in the catalog, no client release.
- Test coverage. `go test ./...` runs in the two Go modules (`api/`,
  `channels/fantasy/api/`) and `cargo test` in each Rust crate — there is no
  workspace at the root for either. Vitest is the target for TS.
- Accessibility and i18n improvements.

## What we probably won't merge

- Architectural rewrites or framework swaps without prior discussion.
- Feature flags or toggles that bypass tier enforcement.
- Changes to billing, Stripe webhook handling, or invite tokens
  without a clear threat-model review — these are load-bearing for
  revenue and account security.
- Analytics, tracking pixels, or telemetry of any kind — "zero
  telemetry" is a public product promise (see the Privacy Policy).
- Dependencies under licenses incompatible with AGPL-3.0-or-later.

When in doubt, **open an issue first** and check with a maintainer
before spending serious time.

## Bug reports

Good bug reports contain:

1. What you expected to happen.
2. What actually happened.
3. A minimal reproduction (exact commands, exact request, exact
   response if relevant).
4. Your environment — OS, Scrollr version, which widget is involved.
5. Relevant log snippets (scrub any tokens first).

Template:

```
### Summary
One sentence.

### Reproduction
1. ...
2. ...

### Expected
...

### Actual
...

### Environment
- OS:
- Scrollr desktop version:
- Widget(s) involved:
```

## Feature requests

Open an issue tagged `feature-request`. Explain the user problem
first, the proposed solution second. "Nice to have" features are
welcome but low priority — we triage them against the published
roadmap and tier lineup.

## Pull requests

1. **Branch off `main`**. We squash-merge, so commit history on the
   branch can be messy.
2. **Keep PRs focused.** One fix per PR. If you want to bundle related
   changes, say so in the description.
3. **Match the existing code style.** Each language has its own
   conventions documented in `AGENTS.md`:
   - TypeScript (website vs desktop): semis/quotes differ per
     sub-project. Follow the existing file.
   - Go: `gofmt`, `go vet`, existing package-level patterns.
   - Rust: `cargo fmt`, `cargo clippy`. We use `anyhow` for errors in
     services.
4. **Write for the reader.** Comments explain *why*, not *what*. If a
   block needs a comment to explain what it does, the code probably
   needs to be clearer.
5. **Run the checks you have:**
   - `npm run build` in `myscrollr.com/` or `desktop/` for TS.
   - `go build ./... && go vet ./... && go test ./...` for Go modules.
   - `cargo check && cargo test` for Rust crates.
6. **Update the docs.** If you change a public endpoint or env var,
   update the relevant `.env.example` and any AGENTS.md section.
7. **Fill in the PR description** — what changed, why, how to test.
   Link the issue it closes.

### Commit message style

We follow a loose conventional-commit style:

```
<type>(<scope>): <short summary>

<wrapped body explaining context, decisions, tradeoffs>
```

Types we use: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`,
`build`, `ci`. Scope is usually a package (`billing`, `fantasy`,
`desktop`, `channels`, etc.).

Body paragraphs are wrapped at ~72 chars and explain the *why*. Bullet
lists are fine.

### Review

A maintainer will review within a few days. Expect comments; expect to
iterate. Once approved:

- Rebase if conflicts appear.
- Squash-merge is the default.
- If the PR changes public API shapes, we may tag it for a release
  note before merging.

## Running the project locally

See the [root `README.md`](./README.md) for the quick path. Full
per-service commands are in `AGENTS.md`. In short:

```sh
cp .env.example .env                            # fill in real values
npm install                                     # from website / desktop dirs
go build ./... && go test ./...                 # from api/ or channels/fantasy/api/
cargo test                                      # from each Rust service
```

You'll need Logto, Stripe, and Yahoo developer accounts to exercise
the full stack. For purely backend work, `make up` at the root brings up
Postgres, Redis, core and the ingesters. See LOCAL_SETUP.md.

## Getting help

- **Bug / question about the code**: open a GitHub issue.
- **Security**: [security@myscrollr.com](mailto:security@myscrollr.com)
  (see `SECURITY.md`).
- **Conduct concerns**:
  [conduct@myscrollr.com](mailto:conduct@myscrollr.com) (see
  `CODE_OF_CONDUCT.md`).
- **Billing / subscription questions as a customer**: use the in-app
  support form rather than GitHub issues.

Thanks for reading this far. Now go write something.
