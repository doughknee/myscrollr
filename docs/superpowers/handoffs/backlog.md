## Backlog

### In Progress
- [ ] **Marketing screenshot pass for myscrollr.com.** Partial — uncommitted work on disk. New `CustomizationShowcase` component + 16 replaced hero shots + 8 new customization shots + 12 raw PNGs in `desktop/screenshots/`. Got stuck on a Tauri MCP image-size error before completion. Five open decisions block re-capture: POLLING-vs-LIVE indicator, Collapse-label cutoff, phantom bottom padding on deployed shots, Fantasy league name profanity, Fantasy hero Roster-vs-Overview. See `docs/superpowers/handoffs/current.md` for the full list.
- [ ] **Ticker monitor picker** — design phase complete, untouched this session. Spec at `docs/superpowers/specs/2026-05-10-ticker-monitor-picker-design.md` (committed `7a90cc1`). Single-monitor selection with stable-fingerprint identity and primary fallback. ~80–120 LOC across 7 files (Rust commands + JS settings UI + prefs schema + tests). Schema (`tickerMonitorId: string | null`) extends to `tickerMonitorIds: string[]` later if/when one-ticker-per-monitor (Approach A) becomes worth the bigger investment. Compositor adapters need no changes — Hyprland / Sway / KDE/KWin already accept absolute cross-monitor coords.

### Pending
- [ ] **Publish the `desktop-v1.0.12` draft release on GitHub.** `desktop-release.yml` auto-built and staged the cross-platform installers as a draft when the version-bump PR (#159) merged into main. The remaining step is to visit GitHub Releases and click "Publish release" on the v1.0.12 draft. That fires `deploy.yml`'s `release: types: [published]` hook to rebuild the marketing site. Note: v1.0.10 and v1.0.11 are also still drafts — same workflow needed if you want them published too, though v1.0.12 supersedes both.
- [ ] **One-ticker-per-monitor (Approach A, deferred).** Eventual extension of the monitor picker: simultaneously show identical-content tickers on every selected monitor, with hot-plug auto-reconciliation. Requires dynamic window lifecycle in Rust, a 5s reconciliation poll, and a multi-select settings UI. ~200–300 LOC. Wait until users actually ask. Schema migration is additive — `tickerMonitorId: string | null` → `tickerMonitorIds: string[]`.
- [ ] **Triage open PR #104** ("Feature/favorite team selection" by Enanimate). 5 weeks old, no description, +521/-164 across 13 files, `mergeStateStatus: UNKNOWN`. Almost certainly conflicts with recent Fantasy/Sports work. Either rebase + review, or close.
- [ ] **Fantasy Feed-side venue plumbing.** All 14 fantasy venue toggles' `.ticker` boolean is honored by `FantasyStatChip` via `shouldShowOnTicker`. The `.feed` boolean is currently a no-op — `MatchupHero`, `OverviewView`, `StandingsView`, `RosterView` ignore it. PR #158's helper text now says "Display items currently affect the Ticker only". Touch each Feed sub-view with `shouldShowOnFeed(dp.{key})` reads, hide the corresponding visual when false. Pattern: see venue-gate idiom in `FantasyStatChip` and `ScrollrTicker`.
- [ ] **Bundle-size code-splitting.** `style-*.js` chunk is ~580kb minified, has been a footnote since v1.0.10. Identify dominant contributors (likely Fantasy roster table + lucide-icons), split via `manualChunks` in `desktop/vite.config.ts`. Desktop ships native binaries so this is comfort, not necessity, but would shave perceived startup time.
- [ ] **Investigate Finance source page error boundary.** During this session's screenshot pass, the Finance source page hit the error boundary ("Something went wrong"). Home page Finance section works fine. Documented in `desktop/screenshots/README.md`. Worth investigating before any public release.
- [ ] **Stale F1 race data on dashboard.** During PR #162 instrumentation, observed F1 races at `state: "pre"` with `start_time` ~28 days in the past (e.g. Bahrain 2026-04-12) still in the dashboard payload. They sort with all other pre-games (engagement = 60). Either filter at the channel-service ingestion layer or in `selectSportsForTicker` (drop `pre` games whose `start_time` is in the past). Minor; no regression vs prior behavior.
- [ ] Onboarding pre-enable defaults: spec says new accounts should default `tickerEnabled: true` so the ticker self-demonstrates after first source add. Verify wiring in `preferences.ts` defaults — check `DEFAULT_TICKER.showTicker`.
- [ ] Filter-layer cleanup: `Channel.ticker_enabled` server flag should derive from row membership client-side. Currently dual-tracked. Spec says deferred to follow-up.
- [ ] Optional: switch macOS notarization to API-key auth (`APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_ID`) instead of Apple-ID + app-specific password.
- [ ] Optional: split notarize into its own retryable job after the main build.

### Done

#### Desktop v1.0.12 stack — shipped 2026-05-10

- [x] **Sports ticker stable-sort fix** — PR #162, `4eecc71`. `gameEngagement` is now state-only; `Date.now()` removed. Continuous time priority moved to `start_time` tie-break in `selectSportsForTicker`. **Verified before/after with MCP-driven instrumentation: 68 transform jumps in 2 minutes → 0**. New regression tests: stability under simulated time drift, full-pipeline order-stability under clock advance, per-state tie-break behavior. 250 tests pass.
- [x] **Fantasy player-stat chip width trim** — PR #161, `a8b8ad5`. When `FollowedPlayerChip` has an `accent`, bottom row shows short uppercase label ("Top scorer" / "Worst starter" / "Bench leader" / "Injured") instead of verbose `OwnerTeam · LeagueName · NFL Team Full Name`. Width drops 40-50%. Legacy user-followed path unchanged.
- [x] **Fantasy player-stats split into individual ticker chips** — PR #160, `d1190e7`. Top-3 starters / worst / bench / injuries each spawn standalone `FollowedPlayerChip`s with accent badges (`↑` `↓` `BN` `🚨`). New `desktop/src/channels/fantasy/playerStats.ts` houses shared selection helpers. Yahoo player_keys are GLOBAL — `findPlayerByKey` got an optional `preferLeagueKey` constraint to attribute chips to the right league; ScrollrTicker passes it for every per-league chip.
- [x] **Desktop v1.0.12 version bump** — PR #159, `25c4a02`. `package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock` from 1.0.11 → 1.0.12. Git tag `desktop-v1.0.12` NOT yet pushed.
- [x] **Fantasy Display preview rebuild** — PR #158, `7d21ae8`. Dropped the dishonest Feed preview (which didn't react to any toggle) and the clipped Ticker rail-mode preview (which was 838px wide in a 340px surface, hiding the entire left half of the chip). Single full-width comfort-mode preview that genuinely reacts to toggles. Defensive `overflow-x-auto` on PreviewSurface for future chip growth.
- [x] **Fantasy Configure scroll + Home leagues display** — PR #157, `096a773`. ConfigPanel got the canonical `h-full flex flex-col` + `flex-1 min-h-0 overflow-y-auto` scroll-panel idiom matching Finance/Sports/RSS Managers. `normalizeChannelData(type, raw)` helper in `feed.tsx` unwraps the `data.fantasy = { leagues: [...] }` dashboard payload at the Home loop and `ChannelSection`. Verified live: Home now shows imported Fantasy leagues, Disconnect Yahoo button reachable at default 960×640.
- [x] **Desktop readability pass + MCP dev tooling + Yahoo desktop counterpart** — PR #156, `4ff0d77`. Three coherent pieces: (a) new `text-ui-*` utilities in `style.css`, brightened muted text tiers, scoped 9/10px → 11px fallback inside `#desktop-shell` / `#app-shell`, ~25 component migrations; (b) `tauri.mcp.conf.json` + `npm run tauri:dev:mcp` script + auto-regenerated Tauri ACL/schemas with the `mcp-bridge` plugin permissions; (c) `ConfigPanel.tsx` calling `authFetch('/yahoo/start?response=json')` then `shell::open` on the returned URL.
- [x] **Yahoo OAuth `/yahoo/start` content negotiation** — PR #155, `4e6e804`. Server fix already deployed to production via the K8s `deploy.yml` workflow. `Accept: application/json` (or `?response=json`) returns 200 `{"redirect_url"}`. Otherwise unchanged 307 redirect. Closes the v1 checklist item that pre-flagged this exact failure mode.

#### Earlier work

- [x] **Live-preview Display panels v1.0.11 shipped** — PR #154, merged to main as `4d94862`. Sports / RSS / Fantasy Display tabs got side-by-side Feed + Ticker previews matching the Finance reference. Bonus: `GameChip` now honors `showTimer` (default true, fully backward compatible).
- [x] **IA refactor v1.0.10 shipped** — PR #153, merged to main as `8622750`. 30 commits squashed. 66 files changed (+5598/-4234).
- [x] TopBar with brand mark + Spotify-style forward/back + page-identity breadcrumb dropdown.
- [x] PageLayout chassis with `noContentPadding` and `fillHeight` options.
- [x] PageContext — routes publish title/subtitle/menuItems; last breadcrumb segment becomes a dropdown.
- [x] OverflowMenu (floating-ui) — accessible dropdown used as the breadcrumb dropdown across every primary route.
- [x] Unified configure managers: `SymbolManager` (Finance), `LeagueManager` (Sports), `FeedManager` (RSS).
- [x] Finance `DisplayPanel` with live preview. New prefs: `feedDensity`, `tickerDirectionMarker`.
- [x] Shared `DisplayItemsGrid` — column-headers-as-bulk-toggles, minimal cells, shared grid template. Used by Sports/RSS/Fantasy.
- [x] Settings + Catalog ditch in-page tab bands; use breadcrumb dropdowns.
- [x] Animation polish: motion-studio springs, `active:scale` press feedback, `layoutId` for active-state indicators.
- [x] Source-page Feed view renders flush; Configure/Display keep padded narrow column.
- [x] Diagnosed run #25578604859 — macos-14 runner lost network mid-poll on notarytool.
- [x] Added `timeout-minutes: 25` to the desktop-release build job.
- [x] Reverted the broken `notarize` workflow_dispatch toggle.
- [x] Verified `Scrollr.app` + `Scrollr_*.dmg` notarization end-to-end.
- [x] Added `Notarize and staple DMG` step to close the unnotarized-DMG-container gap.
