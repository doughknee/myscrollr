# Current Session Handoff

## Repo State
- Branch: `main`
- Worktree: clean
- Last commits (most recent first):
  - `<this PR>` — Desktop readability/contrast pass + MCP dev tooling + Yahoo OAuth desktop counterpart
  - `4e6e804` — fix(fantasy): content-negotiate `/yahoo/start` so the desktop OAuth flow works (#155)
  - `4d94862` — feat(desktop): live-preview Display panels for Sports, RSS, Fantasy (v1.0.11) (#154)
- Version: **1.0.11** (`desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`)

## What Just Shipped

Three coherent pieces in one PR:

### 1. Desktop readability / contrast pass

- New design tokens in `desktop/src/style.css`:
  - Brightened muted text tiers (`--color-fg-2/3/4`) for the default dark theme so meaningful text stays readable at 100% UI scale.
  - High-contrast theme tier bumped further.
- New reusable type utilities (use these for any new desktop UI):
  - `text-ui-title` — 14px / 600 / `var(--color-fg)`
  - `text-ui-body` — 13px / `var(--color-fg)`
  - `text-ui-muted` — 13px / `var(--color-fg-2)`
  - `text-ui-meta` — 12px / `var(--color-fg-3)`
  - `text-ui-chip` — 11px / `var(--color-fg-3)`
  - `text-ui-section` — 11px / 600 / uppercase / 0.08em / `var(--color-fg-3)`
- Scoped fallback inside `#desktop-shell` and `#app-shell`:
  - Any legacy `text-[9px]` / `text-[10px]` arbitrary class is silently bumped to 11px / 16px line-height. No need to hand-patch every dense table or chip — they automatically meet the new floor.
- ~25 desktop components migrated from `text-[Npx]` arbitrary sizes and faint `text-fg-*/40` shades to the new utilities and stronger fg tokens. Affected: chips (consolidated, fantasy, fantasy-stat, followed-player, game, rss, trade), settings (display items grid, general, controls, ticker), feeds (finance, rss, sports), managers (rss feed, sports league, finance symbol), Sidebar, TopBar, ScrollrTicker, FreshnessPill, RowSelector, TickerLayoutSummary, PageSection, fantasy ConfigPanel.
- `chipColors.ts` — `textDim` / `textFaint` opacities raised; compact chip base text moved to `text-ui-body`.

**Verified visually via the MCP-driven dev session**: ticker compact view, settings page, fantasy configure page all render cleanly with no layout regressions.

### 2. MCP dev tooling

- New `desktop/src-tauri/tauri.mcp.conf.json` — overlays `app.withGlobalTauri = true` so the MCP bridge can call into the webview.
- `npm run tauri:dev:mcp` updated to pass `--config src-tauri/tauri.mcp.conf.json` alongside the existing `--features dev-mcp-bridge` flag.
- Auto-regenerated Tauri ACL / schema files now include the `mcp-bridge` plugin permissions (`allow-execute-js`, `allow-emit-event`, `allow-list-windows`, etc.) — these are normal regen output from running with the new config.

To use the MCP bridge in a future session:

```sh
cd desktop && npm run tauri:dev:mcp
# WebSocket server listens on localhost:9223
```

Then connect from your MCP-aware client (Claude Code, opencode, etc.) and drive the running app with the standard `webview_*` / `manage_window` / `read_logs` tools.

### 3. Yahoo OAuth desktop counterpart

- Server-side fix already shipped to production via PR #155 (`4e6e804`).
- Desktop side (`desktop/src/channels/fantasy/ConfigPanel.tsx`) now `authFetch`es `/yahoo/start?response=json` with `Accept: application/json` and then `shell::open`s the returned `redirect_url`. The system-browser approach (`shell::open` of the bare endpoint) was 401-ing because external nav can't carry the Bearer header — see PR #155 for full root cause.
- `v1_checklist.md:271` toggled to `[x]`.

This change doesn't ship to users until the next desktop release tag (`desktop-vX.Y.Z`); the website auto-rebuilds via `release: types: [published]` in `.github/workflows/deploy.yml`.

## Verification Run This Session
- `npm run build` — clean (typecheck + vite build, only the pre-existing `style-*.js` chunk-size warning).
- `npm test` — 15 files, 249 tests passing.
- MCP-driven visual check — ticker + settings + fantasy configure all render correctly in the live app.

## Risks / Follow-Ups
- **Bundle size**: the `style-*.js` chunk is ~580 kB minified. Lower-priority code-splitting follow-up still open.
- **Fantasy `.feed` venue plumbing**: `FantasyStatChip` honors `.ticker` venue booleans but `.feed` booleans are still ignored by the Fantasy Feed sub-views. Carried over from the previous handoff.
- **Desktop release**: when ready to cut the next release, the Yahoo desktop counterpart shipped here will be in it. Tag with `desktop-v1.0.12` (or whatever the next version is) — `.github/workflows/desktop-release.yml` does the cross-platform builds and notarization.
- **`tauri.mcp.conf.json` permissions**: dev-only by virtue of being applied via `npm run tauri:dev:mcp`. Production builds (`npm run tauri:build`) don't pull in the MCP bridge plugin (gated by `feature = "dev-mcp-bridge"` + `debug_assertions` in `lib.rs:61`).

## Resume Prompt

```
You're picking up `/Users/doni/code/myscrollr` on `main`. Worktree is clean.
Read `docs/superpowers/handoffs/current.md` first.

Recent significant work:
1. Yahoo OAuth desktop flow fixed end-to-end (PR #155 server-side, PR <this>
   desktop-side). The `/yahoo/start` endpoint content-negotiates JSON when
   `Accept: application/json` is sent.
2. Desktop UI readability pass — new `text-ui-*` utilities live in
   `desktop/src/style.css`. Use them for any new dense text rather than
   `text-[Npx]` arbitrary sizes.
3. MCP dev session is now `npm run tauri:dev:mcp` (uses `tauri.mcp.conf.json`
   to enable `withGlobalTauri`, and the `dev-mcp-bridge` cargo feature).
   WebSocket server on localhost:9223.

No active task. Open backlog in `v1_checklist.md`. Possible next pickups:
- Fantasy Feed venue plumbing (mirror what FantasyStatChip ticker side does)
- Bundle splitting for the 580 kB style chunk
- Cut the next desktop release once you're ready
```
