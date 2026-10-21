---
name: scrollr-admin-page
description: Use when asked to add or change an admin console page, tile, report, chart or staff-only view in the Scrollr website, or its admin API endpoint.
---

# Add an admin console page or tile

## Step 1: read before proposing code

Read these and explain to the user how an existing page loads its data and how the route is protected before proposing code:

- `myscrollr.com/src/components/admin/ui.tsx`: `useReport` and `Loaded` (slow hint, Cancel, Retry, kept data), `PageFrame`, `Card`, `Section`.
- `myscrollr.com/src/components/admin/OverviewPage.tsx`: a finished page to copy the shape of.
- `myscrollr.com/src/lib/overviewVerdicts.ts`: the locked verdict rules.
- `api/internal/admin/auth.go` and `api/internal/admin/handlers_overview.go`: the access check and a handler.
- `api/core/server.go`: where admin routes are wired.

## Recipe

1. Route: `myscrollr.com/src/routes/admin.<page>.tsx`. Never edit `myscrollr.com/src/routeTree.gen.ts`.
2. Page component in `myscrollr.com/src/components/admin/`. Load data with `useReport` and render with `Loaded`; do not hand-roll loading and error states.
3. Handler in `api/internal/admin/handlers_<page>.go` with a test, and the route in `api/core/server.go`. Slow routes log `[Admin]` timing through `api/core/admin_timing.go`.
4. Staff access is the `admin_users` table, never the `super_user` tier.
5. Check the period and freshness contracts of the report you extend before inventing new ones.

## Rules

- A verdict may restate a fact, never judge a trend. Noisy verdicts teach staff to ignore the honest ones.
- A zero previous period is not comparable; say so rather than showing a percentage.
- Website code style (no semicolons, single quotes, `@/` alias, named exports) is in `AGENTS.md`.
- Check with `npm run check`, `npm run build` and `npx vitest run` in `myscrollr.com/`, and `go -C api test ./internal/admin/...`.
