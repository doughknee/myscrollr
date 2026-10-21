---
name: scrollr-ticker-change
description: Use when asked to change anything on the Scrollr ticker bar - a chip, a page cell, the edge zone, the page engine, ticker layout, spacing, width, or what a ticker item shows. Requires reading the chip spec in full first.
---

# Change a chip, page cell or the page engine

## Step 1: read before proposing code

Read `docs/CHIP_SPEC.md` **in full** (the exact contract: geometry, reservations, palette fields, page and visit rules, rotation rules, traps) and explain to the user the rules that apply to this change before proposing code. `docs/CHIP_DESIGN.md` is the short human version.

## Step 2: find the code

- Chips: `desktop/src/components/chips/`
- Page cells, edge zone, page engine: `desktop/src/components/pages/` (`pagePlan.ts`, `EdgeZone.tsx`, `PagedBar.tsx`)
- Per-widget ticker items: `desktop/src/datawidgets/*/ticker.tsx`

This code is shared by every host (desktop app, website bar, web mode). Change it here, never in a copy.

## Step 3: follow the recipe

- Page cell: build recipe 12A and review checklist 13A in `docs/CHIP_SPEC.md`.
- Chip: build recipe 12B and review checklist 13B.
- Go through the checklist item by item at the end and say which items you checked.

## Step 4: verify

Verify in web mode, not the Tauri app: `make setup DEV_API=remote`, then `cd desktop && npm run web` (see `docs/LOCAL_SETUP.md`). Use real fixtures, including long names and busy and quiet cases. Run `npm run build` and `npx vitest run` in `desktop/`. Put screenshots in the PR.

## Do not

- Add selection settings to the ticker. It is for glancing; reading belongs in the feed.
- Edit `docs/CHIP_DESIGN.md` casually: it feeds the support knowledge base, so a change needs `make kbgen`.
