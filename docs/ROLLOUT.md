# Scrollr Unification — Rollout Plan

> Execution plan for the decisions in [VISION.md](./VISION.md). Companion to the charter: the charter is stable, this changes as work lands.
> **Created:** 2026-07-20.

---

## Assumption: zero users (current state)

Scrollr has **no users yet**, so **breaking changes are free** — and *now* is the only moment they'll ever be free. There is **no backward-compat, no dual-speak, no deprecation window, no gated retirement.** Rename outright; reset the database if convenient; delete old names on sight.

The prize for doing this pre-launch: you establish clean names once and never accrue the compat debt that created today's mess. **The moment you ship to real users, this window closes** — see the compat discipline in VISION §6, which activates then.

Because there's no compat to preserve, the phases below are a **sensible work-order**, not release-gated increments. Do them in this order so each builds on a stable base and `main` keeps working; merge as you go or do it on one branch — your call.

---

## Status (updated 2026-07-20)

| Phase | State |
|---|---|
| 1 — backend package split | ✅ **done** — `api/core` split into 8 internal packages + core wiring, acyclic, one binary |
| 2 — DB schema authority + final names | ✅ **done** — one squashed baseline in `api/migrations`, ingesters are pure writers, `user_widgets`/`widget_type` |
| 3 — server catalog + generic client + rename | 🟡 **partly done** — catalog + generic client landed; **the wire/vocabulary rename has not** (see below) |
| 4 — shared TS types | ⬜ not started (blocked on Phase 3's rename — codegen should run against final names) |
| 5 — cleanup + docs | ⬜ not started (AGENTS.md "Database Migrations" already rewritten, since Phase 2 made it actively wrong) |

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
  `datawidgets/{source}/ticker.tsx`. 981 → 606 lines, and chip building is now
  unit-testable (6 new tests covering what could not be reached before).

### Phase 3 — what remains: the wire + vocabulary rename

This is the whole of ROLLOUT's "rename the wire outright" bullet, and it is
deliberately **not** half-done — it only works as one atomic change across server
and client:

- **Server:** `channel_type` → `widget_type`, `channels` → `widgets` in the
  dashboard payload, drop the `visible`/`ticker_enabled` duplicate, and delete the
  `/users/me/channels` routes in favour of `/users/me/widgets` (no alias).
- **Clients:** ~150 `channel_type` references across desktop and web, plus
  `DataWidget*`/`Channel*` type and folder vocabulary.

Do it by renaming the **TypeScript types first** (`DataWidgetRow.channel_type` →
`widget_type`), so every read becomes a compile error until fixed — otherwise a
missed rename compiles cleanly and only fails at runtime, which the type checker
cannot catch for a JSON wire.

Note that `DATA_WIDGETS` being gone removes one of the two sides that used to drift,
so the rename is now a smaller job than the raw reference count suggests.

**Deferred out of Phase 2, with reasons:**

- **sqlx compile-time `query!` macros** (the Rust drift guard). Converting every
  call site needs a live database at build time or committed `.sqlx` offline data
  plus CI work to regenerate it. The schema consolidation stands without it;
  fantasy's `schema_contract_test.go` is the pattern to copy if you want a guard
  sooner and cheaper.
- **The shared Rust `common` crate** (§7.9). Measured: `init.rs` is byte-identical
  across all four services (297 lines × 4). `log.rs` is same-length but differs
  (service name). `main.rs` genuinely differs per service (308–437 lines) and is
  *not* shareable. So the real prize is ~900 duplicate lines, against a Cargo
  workspace plus reworked build contexts for four deployed services. Still
  opportunistic, as this plan always said.

**Phase 3 findings from the pre-work survey — read these first:**

1. **The server catalog is missing 12 of the 29 shipped widgets.** `api/internal/platform/widgets.go`
   enumerates 11 data widgets; `desktop/src/marketplace.ts DATA_WIDGETS` has 29 ids.
   The extra 12 (8 sports leagues: `sports_ncaaf`, `sports_ncaab`, `sports_premierleague`,
   `sports_laliga`, `sports_mls`, `sports_championsleague`, `sports_ufc`, `sports_afl`;
   and the per-feed news split: `news_bbc`, `news_npr`, … `rss_custom`) are valid only
   via the *prefix* rules (`sports_` → sports, `news_` → rss), so they work but the
   server has no label/identity for them. **The server catalog must absorb all 29
   with identity (name, color, icon, category, tier, order) before any client can
   fetch it** — that transcription is the bulk of Phase 3's server half.
2. **Kalshi/predictions IS first-class** (the §8 item to verify before names freeze).
   It is a real entry in both the server registry and desktop `DATA_WIDGETS`, with a
   full renderer set under `desktop/src/datawidgets/predictions/`. Its demo bridges
   (`KALSHI_ENV=demo`, `VITE_DEMO`, `serve_bridge.rs`, `kalshi_probe.rs`) are dev-only
   binaries and do not make it second-class. **No blocker to freezing names.**
3. **The web has no parallel widget catalog to delete.** §4.2 says to delete "the
   web's parallel catalog"; in fact `myscrollr.com` contains zero widget ids — its
   "widget" mentions are marketing copy in landing/FAQ/support components. This is
   consistent with the charter (website = marketing/auth/billing only). Scope Phase 3's
   client work to desktop, plus the wire rename where the web calls the API.
4. **"Delete `desktop/src/datawidgets/`" needs re-reading.** That tree is ~16k lines and
   is almost entirely *renderers* (`FeedTab.tsx`, `view.ts`, per-source components) —
   exactly what §4.1 says to keep as the `source → renderer` registry. What actually
   gets deleted is the widget-*definition* layer: `datawidgets/registry.ts` (23 lines,
   a build-time `import.meta.glob`) and `marketplace.ts DATA_WIDGETS` (~230 lines).

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
