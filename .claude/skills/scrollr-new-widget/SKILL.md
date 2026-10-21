---
name: scrollr-new-widget
description: Use when asked to add a widget, a data source, a new league, a news feed, weather, a new kind of ticker content, or to retire a widget in Scrollr. Routes through the catalog, ingestread, the Rust ingester and every catalog mirror.
---

# Add (or retire) a widget or data source

## Step 1: read before proposing code

Read these and explain to the user how a widget flows from catalog to ticker before proposing code:

- `api/CHANNELS.md`: the full recipe. This skill only routes to it.
- `api/internal/platform/widgets.go`: the catalog authority (`GET /catalog` serves it). Also `api/internal/widgets/catalog.go`.
- `api/internal/ingestread/sources.go`: where read handlers register (`LocalSources`).
- `desktop/src/datawidgets/registry.ts` and `desktop/src/datawidgets/tickerRegistry.ts`: client renderers.

## Step 2: pick the smallest path

- Another league or feed on an existing source: one `WidgetDef` in `api/internal/platform/widgets.go`, then regenerate. Server only, no client release.
- A brand-new source: also a handler in `api/internal/ingestread/`, a renderer in `desktop/src/datawidgets/<source>/` (`ticker.tsx`, `home.tsx`, `view.ts`) and usually a Rust ingester in `channels/<source>/service/`. The ingester runs no migrations; schema changes go in `api/migrations/`.

## Step 3: catalog mirrors

A widget id lives in more than one file. Before finishing, grep the repo for an existing, similar widget's id and update every hit that is not generated, including:

- `desktop/src/catalog.snapshot.json` and `desktop/src/types/api.generated.ts`: generated, never hand-edit (commands in `api/CHANNELS.md`).
- `myscrollr.com/src/lib/catalog.ts`: the hand-kept website catalog.
- `channels/rss/service/configs/feeds.json` for RSS feeds. Check the feed's production health first.
- The support knowledge base is generated (`make kbgen`); regenerate it if CI says it is stale.

Retiring a widget also needs a migration in `api/migrations/` that deletes its `user_widgets` rows, and a grep of the GDPR path and dev scripts for its tables (AGENTS.md, section "Home").

## Step 4: chips

If the widget draws on the ticker, finish with the `scrollr-ticker-change` skill (`docs/CHIP_SPEC.md`).

Run `go -C api test ./...` (in the container, see `docs/LOCAL_SETUP.md`): the drift guards fail when a mirror is missed.
