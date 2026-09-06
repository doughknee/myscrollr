# Catalog redesign — design handoff

Source: Claude Design project `cf74b16c-25bd-4dd9-a27c-a66a40f7a8a2`
("Catalog Final.dc.html"), pulled 2026-09-06. Brandon designed it; this folder
is the versioned copy the implementation is built from. Ships in v1.6.0
after the settings pass (REL-203…209).

| File | What it is |
|---|---|
| `Catalog Final.dc.html` | The reference sheet: six frames of the same prototype (hub, directory, search hit, search miss, free tier at cap, all widgets) plus the **Behavior rules**, **Growth rules** and **Catalog schema additions** cards. Read the three cards first — they are the spec. |
| `Catalog G - Hub Directory.dc.html` | The live prototype the frames import. The `<x-dc>` template is the markup; the `<script data-dc-script>` block is the state machine (hub/dir views, search, aliases, miss card, free-tier cap, rail). |
| `catalog-data.js` | The data the prototype runs on: today's catalog (mirrors `desktop/src/catalog.snapshot.json`) plus a `FUTURE` list of plausible additions used to prove the layout at ~90 widgets, the `group` sub-shelf per widget, and the helpers (`decorate`, `groupBy`, `readableTextOn`). |

`support.js` is the Claude Design runtime (generated, ~70 KB) the `.dc.html`
files load to render standalone; open the project on claude.ai/design to
click through the live prototype, or read the two `.dc.html` files.

## The design in one paragraph

One route, two views. The **hub** is where you arrive: a search hero with
example chips, one tile per kind (count, five logos, "n new", "n added"),
"New this month", and "In your ticker". A tile click or a typed query drops
into the **directory**: a kind rail on the left (with counts and an
"Overview" link back), grouped rows on the right (Football, Soccer, Business…)
with group pills as jump anchors. Zero matches shows a request card and the
closest group instead of an empty state. At the free-tier cap the slot count
rides the sidebar chip, the rail and the hub line.

## What the app does not have yet (from the schema card)

- `group` per widget (sub-shelf inside a category); missing → ungrouped.
- `keywords[]` search aliases ("bitcoin btc eth"), part of the match haystack.
- `added_at` for "new" tags and the New-this-month strip (30-day window).
- `POST /catalog/requests { query }` → count; powers the miss card.

Reused as-is per the design: TopBar, Sidebar, WidgetBar chassis, Segmented,
CatalogCard compact row anatomy, WidgetPanel, SlotPills, tokens, type scale.
