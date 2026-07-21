# Scrollr Unification — Rollout Plan

> Execution plan for the decisions in [VISION.md](./VISION.md). Companion to the charter: the charter is stable, this changes as phases land.
> **Guiding rule:** every phase is independently shippable, independently reversible, and preserves the §6 non-negotiables — above all **wire-compat for shipped desktop clients** (`MIN_DESKTOP_VERSION` = 1.1.0).
> **Created:** 2026-07-20.

---

## Sequencing at a glance

| Phase | What | Depends on | Size | Risk | User-visible? |
|---|---|---|---|---|---|
| 0 | Guardrails: pin the current contract | — | S | — | no |
| 1 | Backend package split (D4.5) | 0 | M | low | no |
| 2 | DB schema authority, **current names** (D4.3) | 0 | M | **med** (deploy ordering) | no |
| 3 | Server catalog + generic client (D4.2 + D4.1) | 1,2 | L | med | yes (desktop bump) |
| 4 | Full rename, dual-speak wire (D4.4) | 3 | L | **high** (shipped clients) | yes (desktop bump) |
| 5 | Shared types from Go contract (D4.6) | 4 | S | low | no |
| 6 | Retire compat + final doc sweep (gated) | 4, update-gate | M | med | no |

**Two hard principles baked into the order:**
- **Separate *ownership* from *renaming*.** Phase 2 makes core own the schema under the *current* names; Phase 4 renames. Never do both to one table in one step.
- **Structure before rename.** Unify the model (Phase 3) *then* rename it (Phase 4) — you rename fewer, cleaner things, and the riskiest wire change ships last, onto a stable base.

---

## Phase 0 — Guardrails

**Goal:** make the current behavior a fixture so every later phase can prove it didn't break anything.

- Add contract tests pinning the **current wire shape**: snapshot responses for `/users/me/channels`, `/dashboard`, `/events` frames, and each `/{source}` + `/{source}/public` endpoint (finance/sports/rss/predictions).
- Confirm `scripts/smoke/production-readiness.sh` exercises the add-widget → dashboard → SSE path end to end.
- These snapshots are what Phase 4's dual-speak is verified against.

**Verify:** tests green on `main`. **Rollback:** n/a (additive).

---

## Phase 1 — Backend package split (D4.5)

**Goal:** break the flat `api/core` package (~55 files) into internal packages along real seams. Pure legibility; **one binary**, no wire/DB/client change.

- Introduce packages: `widgets`, `billing`, `accounts`, `events` (SSE/CDC), `support`, `discord`, `ingestread` (the folded finance/sports/rss/predictions read layers), `platform` (db/redis/auth/sentry plumbing).
- Move files; adjust imports; no behavior change. `main.go` wires the packages together.

**Verify:** all tests pass, binary builds, smoke passes, response snapshots (Phase 0) unchanged. **Rollback:** trivial (revert the reorg commit). **Why first:** zero-risk warm-up that makes every later backend change readable.

---

## Phase 2 — DB schema authority, current names (D4.3)

**Goal:** core becomes the single schema owner. Ingesters stop migrating. **No renames yet.**

- Baseline: capture the current prod schema of all content tables (`trades`, `tracked_symbols`, `games`, `standings`, `teams`, `tracked_leagues`, `markets`, `tracked_markets`, `rss_items`, `tracked_feeds`, `yahoo_*`) into core's golang-migrate history as **adopt/no-op** migrations (`CREATE TABLE IF NOT EXISTS`-safe; do **not** re-create live tables).
- Remove startup migrations from all five ingesters (`sqlx::migrate!` in the 4 Rust services; golang-migrate in fantasy).
- Rust ingesters adopt sqlx compile-time `query!` macros → schema drift fails the build. Fantasy (Go) gets a schema-contract integration test.
- Delete the version-band convention (`11*/12*/13*/14*`), `set_ignore_missing(true)`, shared `_sqlx_migrations` juggling, and the `migration_versions.rs` fencing tests.
- *Opportunistic (backlog #8):* while in the ingesters, extract the byte-identical `init.rs`/`log.rs`/`main.rs` chassis into a shared Rust `common` crate.

**Deploy ordering (the risk):** ship as **one coordinated release** — core's baseline migrations must be applied (and confirmed no-op against live schema) *before* ingesters stop migrating. **Rollback:** re-enable ingester migrations; core baseline is no-op so it leaves data untouched. **Verify:** run migrations against a prod-clone; confirm ingesters still write; CDC still flows to SSE.

---

## Phase 3 — Server-authoritative catalog + generic client (D4.2 + D4.1)

**Goal:** one catalog in core; clients fetch and render generically. The widget becomes the true atom. **Still wire-compatible** (`channel_type` unchanged).

**Server:**
- Extend `widgets.go` into the full catalog authority: `id`, identity (`name`,`color`,`icon`), `kind`, `source`, `category` (cosmetic tag), `requiredTier`, `configSchema`, `order`.
- Expose `GET /catalog`. Tier requirements now come *from* the catalog → **removes the 4-file tier-limit sync (#3)**.
- Confirm predictions/Kalshi is a fully first-class catalog entry here (VISION §8 flag) — *before names freeze in Phase 4.*

**Client (desktop + web):**
- Fetch the catalog; build a `source → renderer` registry; delete `desktop/src/datawidgets/` tree and `marketplace.ts DATA_WIDGETS`. A widget is declared once (server); the client only supplies renderers.
- Replace the `ScrollrTicker.tsx` per-source `if`-ladder with generic dispatch keyed on `source` (**backlog #5**).
- **Constraint 1 — offline fallback:** bundle a cached catalog snapshot; refresh when online, with a staleness policy.
- **Constraint 2 — renderer skew:** gracefully skip catalog entries whose renderer this client version lacks (never crash); honor a min-client hint.

**Verify:** catalog renders identically to today; offline fallback works; all existing widgets add/render/stream. **Rollback:** client falls back to bundled catalog; server `/catalog` is additive. **Ships as a desktop version bump** — older clients keep their built-in catalog (they don't call `/catalog`), so they're unaffected.

---

## Phase 4 — Full rename, dual-speak wire (D4.4)

**Goal:** "widget" everywhere — client, Go, wire, DB, docs — without breaking shipped 1.1.x clients.

**Order within the phase (backward-compatible first):**
1. **Server dual-speak, shipped first.** Accept **both** inbound name sets; emit **both** in responses (extend the existing `visible`/`ticker_enabled` dual-emit pattern): `channel_type`↔`widget_type`, `channels`↔`widgets`, `visible`↔`ticker_enabled`. Add canonical `/users/me/widgets`; keep `/users/me/channels` as an alias.
2. **DB rename** as a core-owned migration (now that core owns schema): `user_channels`→`user_widgets`, `channel_type`→`widget_type`. The dual-speak layer maps old wire ↔ new columns.
3. **Rename Go internals** (`Widget` already; drop `channel` vars, `DataSourceForWidget` stays but on clean names).
4. **Clients switch to new wire** (new desktop version + web) — kill `DataWidget*`/`source`/`Channel*` vocabulary.
5. **Docs** updated to new vocabulary (partial #9).

**Verify:** replay Phase 0 snapshots — a simulated **old-wire** client and a **new-wire** client both succeed against the dual-speak server. **Rollback:** dual-speak is symmetric; revert clients without touching the server. **This is the delicate phase** — server ships and soaks before clients switch.

---

## Phase 5 — Shared types from the Go contract (D4.6)

**Goal:** web and desktop can't drift on the wire shape.

- Generate TS types from the Go OpenAPI (now emitting **final** names). Web + desktop import the generated types; keep per-platform transport (Tauri HTTP vs browser fetch).
- *(Optional earlier start:* codegen can run against the current contract in Phase 3 purely as a drift-guard, then regenerate here once names settle.)*

**Verify:** type-check passes both surfaces; generated types match the live contract. **Rollback:** drop the generated import, revert to hand types.

---

## Phase 6 — Retire compat + final doc sweep (gated on the update gate)

**Goal:** delete the scaffolding once old clients are gone.

- **The lever, not telemetry:** raise `MIN_DESKTOP_VERSION` past the last old-wire desktop version. The existing update gate **forces** old clients to update, so you don't need analytics to know they're gone — after a conservative soak, they can't run without updating.
- Then delete: the dual-speak emission, the `/channels` alias, the deprecated `visible` field, and the coarse-row/legacy-type residue (`legacyWidgetTypes`, migration `000014–000016` grandfather rows) — **backlog #10**.
- **Final doc sweep (#9):** rewrite `README.md` and `api/CHANNELS.md` to the real post-pivot architecture; add ADR-0002 to the ADR index; fix the marketing architecture page.

**Note — discovery/proxy stays.** It still serves fantasy (a proxied service by decision). It retires only if fantasy is ever absorbed — out of scope here.

**Verify:** nothing speaks old wire; smoke passes; a fresh install works. **Rollback:** the compat deletion is the only irreversible step — gate it behind confirmed adoption of the forced-update version.

---

## What this plan deliberately does NOT do

- No rebuild, no framework swap, no new deployed service (package split stays one binary).
- No DB split — one shared Postgres + the CDC pipeline stay.
- No touching the realtime pipeline beyond names.
- Ingester `common` crate (#8) is opportunistic in Phase 2, not a blocker; skip if it fights the schedule.
