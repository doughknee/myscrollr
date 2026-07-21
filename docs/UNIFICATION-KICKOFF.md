# Scrollr Unification — Execution Kickoff

> Paste-and-go instructions to execute the unification refactor. The plan is **fixed** — see [VISION.md](./VISION.md) (charter) and [ROLLOUT.md](./ROLLOUT.md) (phases). Do not redesign it. Delete this file in Phase 5 when the refactor is done.

You are executing a planned, pre-approved refactor of the Scrollr codebase. The plan already exists and is the source of truth.

## 1. Read first (completely, before any change)

- `docs/VISION.md` — charter: what Scrollr is, the target model, the 10 locked decisions, and the non-negotiables.
- `docs/ROLLOUT.md` — the 5-phase execution plan, in order.

## 2. Branch first

You are starting on `main`. **Immediately create a working branch and switch to it — never commit to `main`:**

```
git checkout -b scrollr-unification
```

Do all work on that branch.

## 3. Hard context

- **Scrollr has ZERO users.** Breaking changes are free — make **NO** backward-compat shims, **NO** dual-speak, **NO** deprecation windows. Rename outright, delete old names, reset the DB if convenient (data is disposable / re-ingestable).
- **Non-negotiables (VISION §6):** desktop is the product; **ZERO telemetry — never add analytics/tracking**; slots-only monetization; keep the CDC→Redis→SSE pipeline working; **DISCOVERY/PROXY STAYS (it serves fantasy) — do not delete it.**
- This repo runs **"ponytail"**: the laziest change that works, no speculative abstractions. The shared Rust `common` crate is **chassis only** — per-source ingest logic stays per-service.

## 4. Execution protocol — Phases 1→5 from ROLLOUT.md, strictly in order

For each phase:

1. Implement the phase per ROLLOUT.md, minimal diffs.
2. **Verify GREEN before proceeding:**
   - **Go** → `go build ./...` + `go test ./...` in `api/` (and `channels/fantasy/api/`)
   - **Rust** → `cargo build` + `cargo test` in each touched `channels/*/service`
   - **TS** → build + tests in `desktop/` and `myscrollr.com/` (`tsc --noEmit` + vitest)
   - **DB/integration** → bring up the local stack per `LOCAL_SETUP.md` (`make up`), run migrations, smoke `scripts/smoke/production-readiness.sh` where relevant.
3. If green, **commit** with a phase-tagged message (e.g. `refactor(unify): Phase 1 — split core into internal packages`). If you **cannot** make it green, **STOP and report** exactly what's blocking — do not proceed onto a broken base.

## 5. Phase anchors (details in ROLLOUT.md)

- **P1** — Split the flat `api/core` package into internal Go packages; one binary; no behavior change.
- **P2** — core becomes the single DB schema authority with **final** names (`user_widgets`, `widget_type`); ingesters stop migrating → pure writers; extract the minimal Rust `common` crate (chassis only); reset the DB.
- **P3 (biggest)** — Server-authoritative catalog (`api/core/widgets.go` → full catalog + `GET /catalog`); clients fetch it + a generic `source→renderer` registry; **delete** `desktop/src/datawidgets/` and `marketplace.ts DATA_WIDGETS`; replace the `ScrollrTicker.tsx` per-source if-ladder with generic dispatch; rename everything to "widget" (kill channel/datawidget/source); keep the offline catalog fallback. **Verify predictions/Kalshi is a first-class catalog entry before names freeze.**
- **P4** — Generate TS types from the Go OpenAPI; both clients import them; keep per-platform transport.
- **P5** — Delete all legacy residue (VISION §7 decision 10); rewrite `README.md` + `api/CHANNELS.md` to the real post-pivot architecture; add ADR-0002 to the index; delete this kickoff file.

## 6. When done or blocked

Summarize, per phase, what shipped, what's verified, and anything needing a live environment or human judgment. **Be honest — never claim green without running the checks.** This is a large multi-language refactor; completing every phase in one run is unlikely — stopping cleanly at a real blocker is the correct outcome, not a failure.
