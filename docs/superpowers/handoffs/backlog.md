## Backlog

### In Progress
- (none)

### Pending
- [ ] Apply Finance live-preview pattern to Sports / RSS / Fantasy Display tabs. They currently use the shared `DisplayItemsGrid` (column-headers-as-bulk-toggles, minimal cells) but lack a per-channel preview surface like Finance's `FeedPreview` + `TickerPreview`. Each needs its own sample card shape (Sports: GameItem, RSS: feed row, Fantasy: matchup card).
- [ ] Onboarding pre-enable defaults: spec says new accounts should default `tickerEnabled: true` so the ticker self-demonstrates after first source add. Verify this is wired in `preferences.ts` defaults — check `DEFAULT_TICKER.showTicker`.
- [ ] Filter-layer cleanup: `Channel.ticker_enabled` server flag should derive from row membership client-side. Currently dual-tracked. Spec says deferred to follow-up.
- [ ] Optional: switch macOS notarization to API-key auth (`APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_ID`) instead of Apple-ID + app-specific password.
- [ ] Optional: split notarize into its own retryable job after the main build.

### Done
- [x] **IA refactor v1.0.10 shipped** — PR #153, merged to main as `8622750`. 30 commits squashed. 66 files changed (+5598/-4234).
- [x] TopBar with brand mark + Spotify-style forward/back + page-identity breadcrumb dropdown. Replaces fragmented sidebar logo / control strip / page header layout.
- [x] PageLayout chassis with `noContentPadding` and `fillHeight` options.
- [x] PageContext — routes publish title/subtitle/menuItems; last breadcrumb segment becomes a dropdown.
- [x] OverflowMenu (floating-ui) — accessible dropdown used as the breadcrumb dropdown across every primary route.
- [x] Unified configure managers: `SymbolManager` (Finance), `LeagueManager` (Sports), `FeedManager` (RSS). Replaced two-pane catalog+watchlist split. ~3000 lines deleted.
- [x] Finance `DisplayPanel` with live preview (Feed row + Ticker chip). New prefs: `feedDensity`, `tickerDirectionMarker`.
- [x] Shared `DisplayItemsGrid` — column-headers-as-bulk-toggles, minimal cells, shared grid template. Used by Sports/RSS/Fantasy.
- [x] Settings + Catalog ditch in-page tab bands; use breadcrumb dropdowns.
- [x] Animation polish: motion-studio springs, `active:scale` press feedback, `layoutId` for active-state indicators (sidebar nav, page tabs, breadcrumb chevrons).
- [x] Bug fixes rolled in: toast unstyled flash, theme default `dark`→`system`, stale router redirects, wizard removed (replaced with hero card on empty Home).
- [x] Source-page Feed view renders flush (`noContentPadding=true` on `feed` tab); Configure/Display keep padded narrow column.
- [x] Home page padding cleaned: nested-card on ticker preview removed, dangling `mb-6` margins → unified `space-y-5`.
- [x] Diagnosed run #25578604859 — macos-14 runner lost network mid-poll on notarytool (`NSURLErrorDomain -1009`).
- [x] Added `timeout-minutes: 25` to the desktop-release build job.
- [x] Reverted the broken `notarize` workflow_dispatch toggle (Tauri bundler gates on env-var *presence*, not value).
- [x] Verified `Scrollr.app` + `Scrollr_*.dmg` notarization end-to-end (`spctl --assess` → accepted, `xcrun stapler validate` → worked).
- [x] Added `Notarize and staple DMG` step to close the unnotarized-DMG-container gap.
