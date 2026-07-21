# Scrollr — Unified Vision

> A charter for making Scrollr **coherent**, not rebuilt. Reality sections are audited fact (5-subsystem audit, 2026-07-20). Target sections are decisions taken collaboratively; each is dated in the Decision Log (§7).
> **Last updated:** 2026-07-20.

---

## 1. What Scrollr is

> **A pinned, always-on-top desktop ticker for the things you actually care about.** Live finance quotes, sports scores, fantasy matchups, prediction markets, and news stream into a compact bar floating over whatever you're working on. You pick **widgets** from a catalog; you pay for **how many you can run at once (slots)**. Multi-monitor aware. **Zero ads. Zero telemetry.**

Three load-bearing commitments, true at every layer:

1. **The desktop app is the product** (Tauri v2 + React). The website is *marketing, auth, and billing only*.
2. **No telemetry, ever** — a public promise, enforced by per-service Sentry-scrubbing tests that block deploy.
3. **One user-facing primitive (the widget), one price lever (the slot).** Every widget costs exactly one slot; a plan card's headline is a widget count.

---

## 2. The verdict: unify, don't rebuild

The audit asked one question: *is this spaghetti that should be rebuilt?* **No.** The incoherence is real but it is the **un-swept residue of two deliberate, correct simplifications** that shipped in behavior and never finished their rename/cleanup:

- **ADR-0002** collapsed an open, dynamically-discovered "channel platform" into a **fixed first-party widget catalog** served from one gateway (11→7 workloads).
- **The 2026-06-30 widget/slot pivot** collapsed two primitives (server "channels" + client "widgets") and a 7-dimension price model into **one primitive, one price lever**, and made realtime universal.

Both are ~90% executed. What remains is a clean new model wearing the old model's names. The proof: **one concept carries up to six names** — `channel_type` (wire/DB), `Widget` (Go), `DataWidget`/`source` (desktop), `Channel` (web), "service" (ingesters), `slot` (billing). The canonical answer already exists in the code and specs — *"widget," priced by "slots"* — the code just hasn't fully arrived. Rebuilding would throw away a working Tauri app, a working CDC/SSE pipeline, and every production bug fix to re-solve a naming problem. **We finish the migration instead.**

---

## 3. What Scrollr is today (audited reality)

### 3.1 The stack

| Layer | Tech | Role |
|---|---|---|
| **Desktop** | Tauri v2 (Rust) + React 19 + TanStack | The product. Two windows: the always-on-top `ticker`, and a `main` settings/catalog app. |
| **Website** | React 19 + TanStack Start (SSG) | Marketing, pricing, Logto auth, Stripe billing, account portal. *Not* where widgets are configured. |
| **Core API** | Go 1.25 + Fiber — one module, one flat `core` package | The only JWT validator. Serves finance/sports/rss/predictions reads natively; SSE hub; billing; accounts; **+ support desk + Discord bot**. |
| **Ingesters** | 4× Rust (finance, sports, rss, predictions) + 1× Go (fantasy) | Poll/stream external APIs, write rows into shared Postgres. |
| **Stores** | Postgres + Redis (shared) | Widget content + user data; CDC pub/sub + caches. |
| **Infra** | DigitalOcean k8s, **7 Deployments** | core-api ×2 · website ×2 · fantasy-api · finance/sports/rss/predictions-service. |

### 3.2 The pipeline (works — preserve it)

```
external API → Rust/Go ingester → shared Postgres
   → Sequin CDC → POST /webhooks/sequin (core)
   → Redis pub/sub (cdc:*) → every core replica fans out in-process
   → SSE or polling → ticker window (via cross-window store broadcast)
```

### 3.3 The domain model as designed (canonical, correct — the code implements it)

```
Data Source  (invisible: finance, sports, rss, fantasy, predictions)
   └─ Widget   (the ONLY user-facing primitive: "MLB", "Crypto", "Clock")
        ├─ kind: data (CDC-backed) | utility (local-only)
        └─ costs 1 Slot

   SUPERSEDED 2026-07-21 (commit 2403940): the `kind` field is deleted.
   A widget is data-backed iff it HAS a source, so `source` already carried
   the distinction and `kind` was a second copy of it that could drift.
   Verified across all 35 entries: 29 data all have a source, 6 utilities
   have none, zero disagreements. Ask isUtilityWidget() / IsUtilityWidgetType().
   └─ Catalog / Library  (browse · add · remove · configure)
   └─ Ticker             (the floating bar; also a direct-manipulation surface)
```

The model is right. Everything *around* it still speaks the pre-pivot language — that's the entire job.

---

## 4. The target: a unified Scrollr

Six decisions, taken together, form one coherent design. Each resolves specific backlog items (§5).

### 4.1 The widget is the atom; source is invisible plumbing

The user's atom is the **widget** — *stocks, crypto, NFL, NHL, MLS, news*. "Finance"/"sports" are **data sources**: which ingester/CDC topic feeds a widget. Source is a **field on a widget — never a folder, a name, a type, or a grouping the user perceives.**

A widget is one self-contained thing that owns its identity:

| Field | Purpose | User-visible? |
|---|---|---|
| `id` + identity (`name`, `color`, `icon`) | The widget's own identity ("NFL") — not borrowed from a source | Yes |
| ~~`kind` = `data` \| `utility`~~ | *Deleted 2026-07-21 — derived from `source` instead; see the note in §3* | — |
| `source` | Which ingester/CDC topic feeds it (data only). Pure routing. | **No** |
| `category` *(tag)* | Cosmetic catalog filter/find. **Independent of `source`** ("Trending", "US Markets"). No behavioral effect. | Filter only |
| `config` schema + defaults | Per-widget settings | Yes |
| cost | Always exactly 1 slot | Yes |

Rendering stays shared by source-family under the hood (one "finance" renderer serves stocks + crypto) — but that reuse is an implementation detail keyed off `source`, *not* a user-facing grouping. This is how the ticker's per-source `if`-ladder becomes generic without losing shared chip code.

**Fixes today's leak:** the client is organized into 5 *source* folders (`desktop/src/datawidgets/`), not ~30 widget folders; per-widget identity is *synthesized* by spreading a coarse source manifest and overriding id/name (`marketplace.ts widgetManifest()`); storage records the source-prefixed id and reverse-maps it (`DataSourceForWidget()`).

### 4.2 The widget catalog is server-authoritative

core-api owns the **one** catalog (id, identity, `kind`, `source`, `category`, tier, config-schema, order). Web and desktop **fetch** it and render generically; the client keeps only a small `source → renderer` registry. Deletes `marketplace.ts DATA_WIDGETS` and the web's parallel catalog — a widget is declared once.

- **Payoff:** adding a sports league that reuses the sports renderer is a **metadata-only server change** — zero client release.
- **Two mandatory constraints:**
  1. **Offline / first-run fallback** — the ticker must work offline, so the client bundles a cached catalog snapshot and refreshes when online. *(calibration knob: needs a real staleness policy, not "fetch once".)*
  2. **Renderer-version skew** — a catalog entry may name a renderer an older client lacks; the client must **gracefully skip** unknown widgets (never crash), and entries carry a min-client hint.

### 4.3 One database schema authority: core owns all

core-api is the single owner of **all** shared schema — its own tables *and* every content table (`trades`, `games`, `standings`, `teams`, `markets`, `rss_items`, `yahoo_*`, `tracked_*`). One migration tool (golang-migrate), one version line.

- **Schema authority ≠ service boundary.** All five ingesters (fantasy included) stay independent deployed services and become **pure writers** — none runs migrations.
- **Drift guard, nearly free** — Rust ingesters adopt sqlx compile-time `query!` macros so a schema mismatch **fails the build**. *Gap:* fantasy (Go) needs a schema-contract integration test.
- **Deletes** the per-ingester migration folders, the version-band convention (`11*/12*/13*/14*`), `set_ignore_missing(true)`, the shared `_sqlx_migrations` juggling, the fencing tests, and the dual-tool split. *The coordination overhead vanishes because there's nothing left to coordinate.* Relaxes the `COALESCE`-everywhere defensive style.
- **Transition = reorg, not data migration** (tables already exist in prod): baseline current schema into core's history (adopt, don't re-`CREATE`); remove ingester startup-migrations in one coordinated release; core must own before ingesters stop — ship with a tested rollback.

### 4.4 One vocabulary: "widget" everywhere (rename outright — pre-users)

Kill "channel"/"datawidget"/"source" as vocabulary across **every** layer: client folders/types, Go internals, wire fields, DB (`user_channels`→`user_widgets`, `channel_type`→`widget_type`), routes, and docs.

**With zero users (current state), this is a straight rename — no compat seam, no dual-speak, no deprecation window.** Rename every layer in one pass and delete the old names. This is the ideal moment: breaking changes are free now and never again once you launch, so cashing this in pre-launch is exactly how you avoid ever needing the compat machinery that shipped shims never got retired.

*(If this ever slips past first launch, the server would instead **dual-speak** old↔new names — `channel_type`↔`widget_type`, `channels`↔`widgets`, `visible`↔`ticker_enabled`, `/channels` alias — until `MIN_DESKTOP_VERSION` advances. Avoid needing that by renaming now.)*

It's the largest *mechanical* effort in the plan, but no longer a risky one.

### 4.5 Backend package boundaries (one binary)

Break the flat `core` package (~55 files) into internal Go packages along real seams: `widgets`, `billing`, `accounts`, `events`, `support`, `discord`, `ingest-read`. **Same binary, same deployment** — this is legibility and blast-radius, not a new workload (keeps ADR-0002's consolidation). The package boundary makes a future service-extraction cheap *if* support/Discord ever earn it.

### 4.6 Shared types from the Go contract

Codegen TS types from the Go API's OpenAPI contract so web and desktop **cannot drift** on the wire shape. Keep **per-platform transport** — desktop over the Tauri HTTP plugin, web over browser fetch are genuinely different, and a shared client would fight that. Server is the authority (consistent with §4.2/§4.3); no monorepo tooling required.

---

## 5. Unification backlog (audited, mapped to decisions)

| # | Incoherence | Resolved by |
|---|---|---|
| 1 | One concept, up to 6 names | §4.4 (rename) + §4.1 (model) |
| 2 | No single owner of the shared DB *(the one deep seam)* | ✅ §4.3 |
| 3 | Tier limits hand-synced across 4 files | ❌ **NOT resolved** — see note below |
| 4 | Web & desktop = 2 implementations of 1 product | §4.2 (catalog) + §4.6 (types) |
| 5 | Registry is a facade at the ticker (`ScrollrTicker.tsx` if-ladder) | §4.1 (generic renderer by source) |
| 6 | 3 widget-definition layers on the client | §4.1 + §4.2 |
| 7 | Split hook seams (add/remove unified, toggle/configure split) | §4.1 (one widget model) |
| 8 | Ingesters: no shared framework (4 copy-paste Rust forks) | ✅ §7.9 (minimal `common` crate, chassis only) |
| 9 | Docs actively lie (`README.md`, `api/CHANNELS.md` describe pre-pivot arch) | *open — see §8* |
| 10 | Retained-but-dead (coarse-row residue, dual wire fields; *discovery/proxy stays — serves fantasy*) | ✅ §7.10 (delete residue outright) |
| 11 | `api/` monolith (support + Discord ~4k LOC in product API) | ✅ §4.5 |

> **Backlog #3 correction (2026-07-21).** Marked resolved above; it is not.
> All four copies still exist and are still hand-synced: `tier_limits.go`,
> `tier_limits.json`, `desktop/src/tierLimits.ts`, and
> `myscrollr.com/src/lib/fallbackTierLimits.ts`. The plan cannot work as
> written, either: `required_tier` answers *"which plan unlocks this widget"*
> while the synced numbers are `max_widgets`, *"how many slots does this plan
> get"*. Two different questions, so putting tiers in the catalog does not
> subsume the table. Closing #3 means making the server the only source of
> those numbers and having both clients fetch them.

---

## 6. Non-negotiables (the spine — no decision may break these)

- Desktop is the product; website stays marketing/auth/billing only.
- Zero telemetry (public promise + enforced by tests).
- Slots-only monetization; one price lever.
- **Wire-compat — *activates at first real user, suspended until then.*** Scrollr currently has **no users**, so breaking changes are free and should be taken now to establish clean names. Once you ship to real users, this becomes a hard rule: every rename/contract change goes behind a compat seam, never a breaking change (`MIN_DESKTOP_VERSION` gates retirement).
- The CDC → Redis → SSE realtime pipeline works and is replica-safe; keep it.

---

## 7. Decision log

*All 2026-07-20.*

1. **Scope: unify in place, not rebuild.** The incoherence is two unfinished migrations, not spaghetti (§2).
2. **The widget is the atom; source is invisible plumbing.** Full lineup kept; source demoted to a routing field (§4.1).
3. **`category` is a cosmetic filter tag, orthogonal to `source`** — findability only, no behavior (§4.1).
4. **Server-authoritative widget catalog** — one catalog in core; clients fetch + render generically; offline fallback + skip unknown renderers (§4.2).
5. **Core owns all database schema** — single authority; five ingesters become pure writers; sqlx compile-time drift guard; fantasy folded in (§4.3).
6. **Full rename to "widget" everywhere**, wire/DB included. Pre-users → straight rename, no compat seam (§4.4). *(Refined 2026-07-20: no users yet, so the dual-speak window is unnecessary — cash the breaking change in now.)*
7. **Backend: split the flat package into internal packages, one binary** — not a separate service (§4.5).
8. **Shared TS types generated from the Go contract; transports stay per-platform** (§4.6).
9. **Ingesters share a minimal `common` crate (backlog #8).** Extract only the byte-identical chassis (`init.rs`/`log.rs`/`main.rs` skeleton, Sentry/readiness/health wiring) into `channels/common` under a Cargo workspace; per-source ingest logic (`lib.rs`/`database.rs`/`types.rs`) stays per-service — sharing it would be the wrong abstraction. Opportunistic in Phase 2; the most deferrable item.
10. **Delete all legacy/grandfather residue (backlog #10).** Zero users → nothing to grandfather: remove `legacyWidgetTypes`/coarse-row support, the deprecated `visible` dual field, `LEGACY_WIDGET_SOURCES` (news→rss), the route redirect shims, the `store.ts` v1.0.16 cleanup, and the stale `.cta.json`. **Discovery/proxy stays — it serves fantasy.** Lands in Phase 3 + Phase 5.

---

## 8. Open items — execution only

**All design decisions are settled (§7 — ten decisions).** What remains is execution plus one verification; no open forks:

- **Rollout plan → [ROLLOUT.md](./ROLLOUT.md)** — detailed there. **Pre-users, so no backward-compat machinery** (no dual-speak, no gated retirement); the phases are a sensible work-order, not compat-gated releases. Summary order: ① backend package split → ② DB schema authority + final names (reset DB freely) → ③ server catalog + generic client + rename everywhere → ④ shared-types codegen → ⑤ cleanup (dead code + doc rewrite).
- **Docs rewrite (backlog #9)** — not a decision, just work: rewrite `README.md` + `api/CHANNELS.md` to the post-pivot architecture, add ADR-0002 to the ADR index, fix the marketing architecture page. Lands in Phase 5.
- **Verify before names freeze:** confirm predictions/Kalshi is a fully first-class catalog entry — it was absent from `api/CHANNELS.md` and carries demo-mode + dev bridges. Check during Phase 3.

*No unresolved decisions remain — see §7 (10 decisions) and [ROLLOUT.md](./ROLLOUT.md).*
