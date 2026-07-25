# Widgets, sources, and the surviving channel seam

> Rewritten 2026-07-21. The previous version described an open "channel
> platform": per-channel Go packages under `api/channels/`, a browser-
> extension layer, a `myscrollr.com/src/channels/` config layer, and a
> four-step guide to adding a channel. None of that exists. It was already
> wrong when ADR-0002 folded the read APIs into core, and the widget
> unification finished the job.

## The model

One user-facing primitive, one price lever:

```
Source  (invisible plumbing: finance, sports, rss, predictions, fantasy)
   └─ Widget   (the ONLY thing a user picks: "NFL", "Crypto", "BBC News")
        └─ costs exactly 1 slot
```

A **widget** is what the user adds, sees, and pays a slot for. A **source**
is which ingester feeds it and which renderer draws it — routing, never a
grouping the user perceives. `category` is a cosmetic filter tag on a
widget, deliberately independent of its source.

**A widget is data-backed iff it has a source.** One with a source gets a
`user_widgets` row and a CDC feed; one without (clock, weather, …) lives in
desktop preferences. There is no separate `kind` field — it existed, carried
exactly this fact, and meant two things to keep in sync plus a third name
for the same idea (the cosmetic `utility` category). Ask
`IsUtilityWidgetType(id)` server-side or `isUtilityWidget(id)` in the
client.

Full reasoning in [`../docs/VISION.md`](../docs/VISION.md); this is the
practical version.

## The catalog is the authority

`api/internal/platform/widgets.go` holds every widget — id, name,
description, source, category, color, logo, default config, required
tier, and copy. `GET /catalog` serves it. Both clients fetch it and render
generically.

So **adding a widget that reuses an existing renderer is a server-only
change**: add an entry, ship core, and it appears in the desktop Library
with no client release. Another sports league or news feed costs one struct
literal.

Two artifacts ride along, both generated and both guarded by a Go test:

- `desktop/src/catalog.snapshot.json` — build-time snapshot so the ticker
  works offline and on first run. **Never hand-edit.**
- `desktop/src/types/api.generated.ts` — the wire types, from the Go
  structs (`go -C api run ./cmd/gents`).

## Adding a widget

**Reusing an existing source** (another league, another feed) — server only:

1. Add a `WidgetDef` to the `catalog` slice in
   `api/internal/platform/widgets.go`.
2. Regenerate the snapshot and types:
   ```sh
   go -C api test ./internal/widgets -run TestCatalogSnapshot -update
   go -C api run ./cmd/gents
   ```
3. `go -C api test ./...` — the drift guards check both.

**A brand-new source** additionally needs:

4. A feed renderer `desktop/src/datawidgets/<source>/` exporting a `FeedTab`
   and a `view.ts`.
5. A ticker renderer `desktop/src/datawidgets/<source>/ticker.tsx`
   implementing `TickerSource`, registered in
   `desktop/src/datawidgets/tickerRegistry.ts`. The ticker dispatches
   generically on source — there is no per-source branching to edit.
6. A Home preview `desktop/src/datawidgets/<source>/home.tsx` exporting
   `HomeRows`, wired into the manifest in that source's `FeedTab.tsx`
   (REL-63). `HomeRows` is **required** — tsc will ask for it. Optional
   alongside it: `normalizeHome` (if the dashboard payload isn't a bare
   array), `homeGroups` (filter chips), `homeGroupLabel` (if the group key
   isn't human-readable). Like the ticker, `routes/feed.tsx` dispatches
   generically and never names a source.
7. Read handlers in `api/internal/ingestread/`, registered in the
   `LocalSources` map so `/health` and `/dashboard` include them.
8. Usually a Rust ingester under `channels/<source>/service/` that writes
   rows. It runs no migrations — see below.

## Schema

**core-api owns every shared table and is the only thing that migrates**
(`api/migrations/`). The four Rust ingesters and the fantasy Go API are
pure writers. No per-service migration directory, no version band, no
`_sqlx_migrations` coordination. Details in AGENTS.md → "Database
Migrations".

## What "channel" still means

The word survives in exactly one place, legitimately: **service discovery
and the dynamic proxy**.

- `api/internal/platform/discovery.go` — services register in Redis under
  `channel:*` with a 30s TTL heartbeat.
- `api/core/proxy.go` — core proxies their declared routes.

Today this serves **fantasy only**, which stays a separately deployed
service because of its Yahoo OAuth + sync loop. `ChannelInfo`,
`ChannelRoute` and `channel_lifecycle` name *that* concept — a discovered
backend service — not a widget. They are not legacy and should not be
renamed to "widget".

Everything else that once used this path (finance, sports, rss,
predictions) was folded into core by
[ADR-0002](../docs/adr/0002-consolidate-widget-read-apis.md) and is served
in-process behind the `LocalSources` seam.

## The realtime path

Unchanged, and load-bearing:

```
external API → ingester → shared Postgres
   → Sequin CDC → POST /webhooks/sequin (core)
   → Redis pub/sub (cdc:*) → every core replica fans out in-process
   → SSE → ticker window
```

Per-replica fan-out is [ADR-0001](../docs/adr/0001-sse-multi-replica.md).

One trap: a client merging CDC records reads **raw Postgres column names**,
so a column rename has to be chased into
`desktop/src/hooks/useDashboardCDC.ts` by hand. No type check covers it —
this bit us during the `visible` → `ticker_enabled` rename.

## Key files

| Path | What |
|---|---|
| `api/internal/platform/widgets.go` | The widget catalog — the authority |
| `api/internal/widgets/catalog.go` | `GET /catalog` |
| `api/internal/widgets/widgets.go` | Widget CRUD (`/users/me/widgets`) |
| `api/internal/ingestread/sources.go` | `LocalSources` seam: health, dashboard, lifecycle |
| `api/internal/platform/discovery.go` | Redis service discovery (fantasy) |
| `api/core/proxy.go` | Dynamic proxy for discovered services |
| `api/internal/events/` | SSE hub, topic registry, CDC webhook |
| `api/cmd/gents/` | TS wire-type generator |
| `desktop/src/marketplace.ts` | Client view over the fetched catalog |
| `desktop/src/datawidgets/registry.ts` | source → feed renderer |
| `desktop/src/datawidgets/tickerRegistry.ts` | source → ticker renderer |
| `desktop/src/datawidgets/<source>/home.tsx` | source → Home preview renderer |
