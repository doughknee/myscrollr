# Scrollr Unification — Execution Log

> **This is a completed record, not a plan.** All five phases shipped in
> v1.1.10; nothing here is outstanding work. Kept as the execution log for the
> repo's largest refactor — what landed, and where the plan's premises turned
> out to be wrong.
>
> For current guidance read [VISION.md](./VISION.md) (the charter, still live)
> and `docs/adr/`. Anything below that reads like an instruction has already
> been carried out.
>
> **Created:** 2026-07-20. **Completed:** 2026-07-21 (v1.1.10).

---

## Assumption at the time: zero users

Scrollr has **no users yet**, so **breaking changes are free** — and *now* is the only moment they'll ever be free. There is **no backward-compat, no dual-speak, no deprecation window, no gated retirement.** Rename outright; reset the database if convenient; delete old names on sight.

The prize for doing this pre-launch: you establish clean names once and never accrue the compat debt that created today's mess. **The moment you ship to real users, this window closes** — see the compat discipline in VISION §6, which activates then.

Because there's no compat to preserve, the phases below are a **sensible work-order**, not release-gated increments. Do them in this order so each builds on a stable base and `main` keeps working; merge as you go or do it on one branch — your call.

---

## Status (updated 2026-07-20)

| Phase | State |
|---|---|
| 1 — backend package split | ✅ **done** — `api/core` split into 8 internal packages + core wiring, acyclic, one binary |
| 2 — DB schema authority + final names | ✅ **done** — one squashed baseline in `api/migrations`, ingesters are pure writers, `user_widgets`/`widget_type` |
| 3 — server catalog + generic client + rename | ✅ **done** — catalog, generic client, and the wire rename all landed |
| 4 — shared TS types | ✅ **done** — `api/cmd/gents` generates them from the Go structs; a Go test pins both clients to it |
| 5 — cleanup + docs | ✅ **done** — residue deleted, README/CHANNELS.md/AGENTS.md rewritten, ADR index updated, kickoff deleted |

**All five phases are complete.** What follows is the record of how, including
the places the plan's premises turned out to be wrong.

### Phase 3 — what landed

- **3a, server catalog.** `GET /catalog` is the single authority. It now carries all
  35 shipped widgets with full identity (name, description, category, color, logo,
  default config, tier, about/usage, order) — the server previously enumerated 11.
  The pre-split coarse types (`finance`/`sports`/`rss`/`fantasy`/`news`) are gone.
- **3b, desktop renders from it.** `marketplace.ts DATA_WIDGETS` is deleted;
  `marketplace.ts` is a view over the catalog. Every exported helper kept its
  signature, so ~110 call sites were untouched. `catalog.snapshot.json` is the
  offline fallback (constraint 1), generated from the server and pinned to it by a
  Go drift-guard test. `useCatalog()` refreshes via `useSyncExternalStore`.
- **3c, generic ticker dispatch (#5).** The per-source ladder in `ScrollrTicker` is
  replaced by a `source → renderer` registry; each source owns
  `datawidgets/{source}/ticker.tsx`, and chip building is now unit-testable
  (6 new tests covering what could not be reached before).
  *(Correction, 2026-07-21: this said "981 → 606 lines". ScrollrTicker.tsx is
  668. Net production LOC across the unification rose rather than fell — the
  win was coherence, not size.)*

- **3d, the wire rename.** `channel_type` → `widget_type`, dashboard/overview
  `channels` → `widgets`, `visible` deleted in favour of `ticker_enabled` (they
  were dual-emitted), and `/users/me/channels` removed with no alias. Migration
  `000002` renames the DB column plus the sequence/PK/constraint that Postgres
  left carrying `user_channels_*` names.

  Two lessons worth keeping. First, renaming the **TypeScript types first** turned
  every stale read into a compile error — the only way to catch a JSON-wire rename,
  since a missed one compiles cleanly and fails at runtime. Second, that still
  isn't sufficient: `useDashboardCDC` reads *raw Postgres replication records*,
  where no type applies, and it had two silent bugs (filtering CDC events on
  `table_name === "user_channels"`, and reading `cdc.record.visible`). Anything
  reading raw CDC payloads has to be checked by hand.

### Phase 4 — deviation from the plan, on purpose

This phase says "generate TS types from the Go OpenAPI". **There is no OpenAPI
spec** — the api module has a swaggo header on `main()` and zero handler
annotations, so the premise was wrong. Producing one would mean adding the
dependency and annotating ~50 handlers to describe shapes the Go structs already
define exactly.

`api/cmd/gents` reads the same source of truth directly and emits
`api.generated.ts` into both clients, with a Go test pinning them to it. That
delivers §4.6's stated purpose ("types generated from the Go contract so web and
desktop cannot drift... no monorepo tooling required") with no new dependency and
no intermediate document to keep current. Revisit if anything other than the two
TS clients ever needs the contract.

Two properties worth preserving if this is ever rewritten:

- **A type with a custom `MarshalJSON` is refused, not emitted.** Struct tags stop
  describing the JSON there, so generating from them would silently lie. `Widget`
  carried exactly that hazard until the wire rename removed its dual-emit.
- **A Go named string type with constants becomes a union** (`WidgetKind` →
  `"data" | "utility"`), so the clients keep the exhaustiveness Go has.

Adopting the contract immediately found three lies in the hand-written types,
including four optimistic-update hooks still writing a `channels` key after the
Phase 3d rename — silent, because TypeScript's excess-property check does not
apply through a spread. There is now a source-text test for that specific blind
spot in `desktop/src/hooks/optimisticDashboard.test.ts`.

### Phase 5 — what landed

Most of §7.10's delete-list had already fallen out of earlier phases. What was
left: `routeCompat.ts` and the `/channel/$type`, `/ticker`, `/settings` redirect
shims; `store.ts`'s v1.0.16 updater-key cleanup; `.cta.json`.

The shims were replaced by `isMountable()`, which checks a persisted route
against the router's own route ids rather than a hand-kept redirect table — it
covers every dead path, not just the enumerated ones, and cannot go stale.
Deleting them exposed a live break: the tray menu still navigated to `/ticker`
through an untyped store key.

`README.md` and `api/CHANNELS.md` described an architecture two ADRs out of
date — per-channel Go APIs, a browser-extension layer, per-crate sqlx
migrations, "no shared source libraries". Both rewritten; `AGENTS.md` repointed
at the internal packages.

**Left alone deliberately:** the marketing site's public `/channels` URL.
Renaming a public route is not a doc fix, and the link text already reads
"Browse widgets".

### Phase 3 — what remains

The two deliberate carve-outs from the rename (`ChannelInfo`/`ChannelRoute`/
`channel_lifecycle`, and the marketing site's public `/channels` URL) plus the
deferred `datawidget` naming now live in **[VISION §4.4](./VISION.md#44-one-vocabulary-widget-everywhere-rename-outright--pre-users)**,
so the guardrail sits with the charter rather than at the end of a completed
plan. `GetValidChannelTypes` was on this list until 2026-07-21; it is gone —
not renamed, deleted. Its only callers were the widget create/update
validators, which had no business asking a service registry what a widget is.

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

Break the flat `api/core` package (~55 files) into internal Go packages: `widgets`, `billing`, `accounts`, `events` (SSE/CDC), `support`, `ingestread`, `platform` (db/redis/auth/sentry). *(As built there is no separate `discord` package — the Discord surface lives inside `support`.)* **One binary, no behavior change.** `main.go` wires them together.

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

  *(Correction, 2026-07-21: backlog #3 is NOT resolved. All four copies still
  exist and are still hand-synced — `tier_limits.go`, `tier_limits.json`,
  `desktop/src/tierLimits.ts`, `myscrollr.com/src/lib/fallbackTierLimits.ts`.
  It cannot work as written either: `required_tier` answers "which plan unlocks
  this widget", while the synced numbers are `max_widgets` — "how many slots
  does this plan get". Different questions, so the catalog cannot subsume the
  table. Closing #3 needs the server to be the only source of the numbers, not
  the catalog to absorb them.)*
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
