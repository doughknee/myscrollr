# Scrollr Unification — Rollout Plan

> Execution plan for the decisions in [VISION.md](./VISION.md). Companion to the charter: the charter is stable, this changes as work lands.
> **Created:** 2026-07-20.

---

## Assumption: zero users (current state)

Scrollr has **no users yet**, so **breaking changes are free** — and *now* is the only moment they'll ever be free. There is **no backward-compat, no dual-speak, no deprecation window, no gated retirement.** Rename outright; reset the database if convenient; delete old names on sight.

The prize for doing this pre-launch: you establish clean names once and never accrue the compat debt that created today's mess. **The moment you ship to real users, this window closes** — see the compat discipline in VISION §6, which activates then.

Because there's no compat to preserve, the phases below are a **sensible work-order**, not release-gated increments. Do them in this order so each builds on a stable base and `main` keeps working; merge as you go or do it on one branch — your call.

---

## Work order at a glance

| Phase | What | Depends on | Size | Notes |
|---|---|---|---|---|
| 1 | Backend package split (D4.5) | — | M | pure internal reorg, one binary |
| 2 | DB schema authority + final names (D4.3 + DB half of D4.4) | — | M | reset DB freely; core owns schema |
| 3 | Server catalog + generic client + rename everywhere (D4.2 + D4.1 + D4.4) | 1, 2 | L | the big one; the rename folds in here |
| 4 | Shared types from Go contract (D4.6) | 3 | S | codegen against final names |
| 5 | Cleanup: dead code + doc rewrite | 3 | M | delete residue; fix the lying docs |

One principle still holds: **structure before names is easier, so build the unified model and name it right in the same pass** (Phase 3) rather than renaming a still-messy model.

---

## Phase 1 — Backend package split (D4.5)

Break the flat `api/core` package (~55 files) into internal Go packages: `widgets`, `billing`, `accounts`, `events` (SSE/CDC), `support`, `discord`, `ingestread`, `platform` (db/redis/auth/sentry). **One binary, no behavior change.** `main.go` wires them together.

**Verify:** tests pass, binary builds, smoke passes. **Why first:** zero-risk warm-up that makes every later backend change readable.

---

## Phase 2 — DB schema authority + final names (D4.3, and the DB half of D4.4)

core-api becomes the single schema owner **and** you use the right names from the start — no two-step, because there's no compat to stage.

- All content-table DDL moves into core's golang-migrate migrations, authored with **final names** (`user_widgets`, `widget_type`, etc.).
- Since data is disposable (content tables re-ingest; user tables ~empty), **reset the database** and let core create everything fresh. No baseline-adopt ceremony, no coordinated rollback — worst case, drop and re-migrate.
- All five ingesters stop running migrations and become pure writers. Rust adopts sqlx compile-time `query!` macros (drift fails the build); fantasy (Go) gets a schema-contract test.
- Delete the version-band convention (`11*/12*/13*/14*`), `set_ignore_missing(true)`, the shared `_sqlx_migrations` juggling, and the `migration_versions.rs` fencing tests.
- **Decided — minimal `common` crate (VISION §7.9):** move the byte-identical Rust chassis (`init.rs`/`log.rs`/`main.rs` skeleton, Sentry/readiness/health wiring) into a shared `channels/common` crate under a new Cargo workspace; per-source `lib.rs`/`database.rs`/`types.rs` stay per-service (chassis only). Do it here while the ingesters are open — most deferrable item if time-constrained.

**Verify:** fresh migrate on a clean DB; ingesters write; CDC flows to SSE.

---

## Phase 3 — Server catalog + generic client + rename everywhere (D4.2 + D4.1 + D4.4)

The heart of the work — unify the model and name it correctly in one pass.

**Server:**
- Extend `widgets.go` into the full catalog authority: `id`, identity (`name`,`color`,`icon`), `kind`, `source`, `category` (cosmetic tag), `requiredTier`, `configSchema`, `order`. Expose `GET /catalog`. Tier limits now come from the catalog → **removes the 4-file tier sync (#3)**.
- Rename the wire outright: `widget_type`, `widgets`, `ticker_enabled`, `/users/me/widgets`. **Delete** the old `channel_type`/`channels`/`visible`/`/channels` names — no alias.
- Confirm predictions/Kalshi is a first-class catalog entry.

**Client (desktop + web):**
- Fetch the catalog; build a `source → renderer` registry; **delete** `desktop/src/datawidgets/` and `marketplace.ts DATA_WIDGETS`. A widget is declared once (server); the client only supplies renderers.
- Replace the `ScrollrTicker.tsx` per-source `if`-ladder with generic dispatch keyed on `source` (**#5**).
- Kill `DataWidget*`/`source`/`Channel*` vocabulary — "widget" everywhere.
- **Constraint 1 — offline fallback:** bundle a cached catalog snapshot; refresh when online, with a staleness policy. *(Still real even with no users — the ticker must run offline.)*
- **Constraint 2 — renderer skew:** *(deprioritized while pre-users; matters once multiple client versions exist)* eventually, skip catalog entries whose renderer a client lacks.

**Verify:** catalog renders; every widget adds/renders/streams; offline fallback works.

---

## Phase 4 — Shared types from the Go contract (D4.6)

Generate TS types from the Go OpenAPI (final names); web + desktop import them. Keep per-platform transport (Tauri HTTP vs browser fetch).

**Verify:** type-check passes both surfaces; generated types match the live contract.

---

## Phase 5 — Cleanup: dead code + docs

- **Dead code (decided — VISION §7.10):** no users to grandfather, so delete all residue outright — `legacyWidgetTypes` + migration `000014–000016` grandfather rows, the deprecated `visible` field, `LEGACY_WIDGET_SOURCES` (news→rss), the route redirect shims (`routeCompat.ts`, `channel.$type`/`ticker`/`settings`), `store.ts`'s v1.0.16 updater-key cleanup, and the stale `.cta.json` scaffold. **Discovery/proxy stays** — it still serves fantasy (a proxied service by decision).
- **Docs (#9):** rewrite `README.md` and `api/CHANNELS.md` to the real post-pivot architecture; add ADR-0002 to the ADR index; fix the marketing architecture page.

---

## What this plan deliberately does NOT do

- No rebuild, no framework swap, no new deployed service (package split stays one binary).
- No DB split — one shared Postgres + the CDC pipeline stay.
- No backward-compat machinery — unnecessary pre-users, and re-introduced only when you have users to protect.
- Ingester `common` crate (#8) is opportunistic, not a blocker.
