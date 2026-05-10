# Current Session Handoff

## Repo State

- Repo: `/Users/doni/code/myscrollr` (single monorepo)
- Branch: `main`
- Worktree: **dirty** — see "Uncommitted Work" below. Nothing in this session was committed.
- HEAD: `bc92917` — `chore: session handoff — multi-monitor spec landed, implementation queued for next session`
- 3 commits ahead of `origin/main` (none from this session): `bc92917`, `7a90cc1`, `3f076ac`. Push at your discretion.
- Desktop version: **1.0.12** (unchanged)

## What This Session Was

Marketing screenshot pass for `myscrollr.com`. The previous session's queued work (ticker monitor picker) was **not** touched. This session pivoted to replacing hero product shots and adding a new "CustomizationShowcase" landing-page section. It got **stuck before completion** on a Tauri MCP screenshot error and never reached commit.

## Uncommitted Work (on disk, not staged)

**Modified — landing page wiring**
- `myscrollr.com/src/routes/index.tsx` — imports & renders `<CustomizationShowcase />` between `ChannelsShowcase` and `BenefitsSection`
- `myscrollr.com/src/components/landing/HeroProductShowcase.tsx` — richer, more specific alt text per channel (sports / finance / news / fantasy)

**Modified — hero screenshots replaced**
- `myscrollr.com/public/screenshots/hero/{sports,finance,news,fantasy}-{light,dark}@{1x,2x}.webp` (16 files total)

**Untracked — new files**
- `myscrollr.com/src/components/landing/CustomizationShowcase.tsx` (200 lines) — new landing section with two cards (`style` and `catalog`)
- `myscrollr.com/public/screenshots/customization/{style,catalog}-{light,dark}@{1x,2x}.webp` (8 files)
- `desktop/screenshots/` — 12 raw PNG captures (`01-hero-home.png` through `12-configure-weather.png`) + `README.md`. These are source material; not all are wired into the marketing site yet. Intended audience: README + future docs + marketing reuse.

**Saved test image (not in repo)**
- `~/Desktop/scrollr-test-screenshot.png` — 1920×1280 PNG, ~322 KB. The "good" reference capture taken after zoom was reset to 1.0. Use this as the visual baseline for what a clean hero shot should look like.

## Why This Session Stopped

The MCP returned: `messages.13.content.6.image.source.base64.data: At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels`. The conversation accumulated multiple Retina-scale captures and one of them tripped the per-image cap inside a many-image request. Cannot edit prior messages from inside a running session, so the chat is unrecoverable. Hence this handoff.

## Open Questions Left Unanswered

These were posed to the user just before the error and are still open:

1. **POLLING vs LIVE indicator** — top-right badge shows POLLING in current captures. Marketing wants LIVE. Decision: get the app into a live data state before re-capturing, OR accept POLLING as honest.
2. **`Collapse` label cutoff** — bottom of the home capture clipped by ~half a row. Either resize the Tauri window taller (~640 → 680 logical) or accept the crop.
3. **Bottom padding** — the deployed hero shots (already on disk) have ~20–60px of empty space below content. The fresh test shot does not. The deployed shots may need re-capture with the corrected zoom (1.0) and new window size.
4. **Fantasy league name "Stanton Again A Fuck League"** — present in current Fantasy hero. Must be renamed in Yahoo OR cropped out before any of this ships publicly. The other league ("Scrollr League") in the same screenshot is publication-safe.
5. **Fantasy hero — Roster vs Overview** — current shot is Roster (with INJURY WATCH panel). User considered switching to Overview (matchup card view) for a less data-heavy first impression. No decision.

## Lessons / Gotchas From This Session (DO NOT RE-LEARN)

1. **MCP screenshot images must stay ≤2000px on every dimension when going into a many-image request.** Always pass `maxWidth: 1600` (or smaller) on `webview_screenshot`. Even safer: pass `filePath` to write to disk and only `Read` the file when reasoning about it. Ignoring this kills the chat with no recovery.

2. **Tauri zoom carries across capture sessions.** Earlier MCP runs left the webview at a non-1.0 zoom, which is why the deployed hero shots have phantom bottom padding. **Always run `webview.setZoom(1.0)` (or equivalent) before the first capture in a session.**

3. **macOS DPR=2.** A 960×640 logical viewport captures as 1920×1280 native. Both are under 2000 individually, but other captures (full-window with chrome, retina at higher logical sizes) can exceed it.

4. **Window inner height ≠ what you set.** After a zoom reset, requesting 960×640 produced an inner of 960×612 — the always-on-top ticker overlay subtracts from the main window's available area. Plan capture crops accordingly.

5. **The `desktop/screenshots/` capture flow is documented in `desktop/screenshots/README.md`.** It uses a two-tool hybrid: Tauri MCP (`webview_execute_js` for navigation/state prep) + macOS `screencapture -l <windowID>` for native chrome capture. Window IDs come from a Swift one-liner against `CGWindowListCopyWindowInfo`. Reuse this approach; do NOT reinvent.

6. **macOS title-bar chrome follows SYSTEM appearance, not the app's `data-theme`.** The traffic-light buttons and the window background behind the rounded corners are drawn by the OS. So a "dark hero shot" needs **both** the in-app theme set to dark **and** the macOS system in Dark Mode — otherwise you get light traffic lights on a dark UI and the screenshot looks broken. You cannot flip the system theme programmatically; you must ASK the user to switch in System Settings → Appearance, then verify with `defaults read -g AppleInterfaceStyle` (outputs `Dark` when dark, empty when light). Recommended order: do all light shots in one pass, then ask for the switch and do all dark shots in one pass.

6. **Finance source page hits the error boundary.** Documented in `desktop/screenshots/README.md`. Not blocking marketing since the Home page Finance section works fine, but worth investigating before the v1 release.

## Carried Forward From Previous Sessions (DO NOT RE-LEARN, STILL LIVE)

These stay relevant — read the previous handoff body if you need detail:

- `desktop-release.yml` triggers on push to main with `desktop/**` paths (NOT on tag).
- TanStack Router uses memory history; webview URL bar is decorative.
- MCP bridge is opt-in via `npm run tauri:dev:mcp`. WebSocket on `localhost:9223`.
- `/dashboard` returns `data.fantasy = { leagues: [...] }`, NOT a flat array.
- Yahoo player_keys are global; pass `preferLeagueKey` for per-league chips.
- `gameEngagement` MUST NOT depend on `Date.now()`.
- DO NOT undo: `text-ui-*` migration, FantasyStatChip comfort mode in DisplayPanel, `accent` prop on FollowedPlayerChip, `preferLeagueKey` on `findPlayerByKey`, `normalizeChannelData` in feed.tsx, state-only `gameEngagement`.

## Active Backlog Item — STILL PENDING

The previous session queued **the ticker monitor picker** (spec at `docs/superpowers/specs/2026-05-10-ticker-monitor-picker-design.md`, committed `7a90cc1`). **Untouched this session.** Still the next architectural item once marketing-screenshot work is closed out.

## Next Best Action

The user has two distinct tracks open:

- **Track A — finish marketing screenshots** (this session's work). Decide the open questions above, re-capture as needed (with the gotchas applied), `npm run check` + `npm run build` in `myscrollr.com/`, then commit.
- **Track B — implement the ticker monitor picker** (previous session's work). Spec is reviewed and approved.

Default recommendation: **finish Track A first** (it's nearly done, has uncommitted code on disk, and was the user's most recent active intent). Then return to Track B.

```
You're picking up `/Users/doni/code/myscrollr` on `main`. Worktree is DIRTY — there is uncommitted screenshot work on disk that the previous session got partway through before crashing on a Tauri MCP image-size error.

**Read first**:
  - docs/superpowers/handoffs/current.md  (full session context — start here)
  - desktop/screenshots/README.md         (the screenshot capture workflow)

**State**:
  - HEAD = bc92917, 3 commits ahead of origin/main (all from prior sessions; push at your discretion)
  - Desktop is at v1.0.12; cross-platform installers staged as a draft GitHub release
  - Worktree is dirty:
      • myscrollr.com/src/routes/index.tsx                              (renders new section)
      • myscrollr.com/src/components/landing/HeroProductShowcase.tsx    (richer alt text)
      • myscrollr.com/public/screenshots/hero/{sports,finance,news,fantasy}-{light,dark}@{1x,2x}.webp  (16 replaced)
      • myscrollr.com/public/screenshots/customization/{style,catalog}-{light,dark}@{1x,2x}.webp        (8 new, untracked)
      • myscrollr.com/src/components/landing/CustomizationShowcase.tsx                                  (new, untracked, 200 lines)
      • desktop/screenshots/                                                                            (12 PNGs + README, untracked)
  - There is a "good" reference test capture at ~/Desktop/scrollr-test-screenshot.png (1920×1280 PNG, 322 KB). Use it as the visual baseline.

**Active task**: Finish the marketing-screenshot pass and commit.

**Open decisions the user needs to settle FIRST** (do not start re-capturing until these are answered):
  1. POLLING vs LIVE indicator — get the app into a live data state, or accept POLLING?
  2. The Collapse label cutoff at the bottom of the home capture — make the Tauri window taller, or accept crop?
  3. The deployed hero shots (already on disk) appear to have ~20–60px of phantom bottom padding because the previous capture session had non-1.0 zoom. Re-capture all of them, or only the home one?
  4. The Fantasy league "Stanton Again A Fuck League" name MUST be renamed in Yahoo OR cropped out before any public ship. The other league in the same screenshot ("Scrollr League") is publication-safe.
  5. Fantasy hero — Roster (current, with INJURY WATCH panel) vs Overview (matchup card view, less data-heavy)?

Ask the user these questions verbatim. Don't capture anything until they answer.

**Workflow**:
  1. Settle the 5 open decisions above with the user.
  2. Re-capture only the screenshots that need it.
  3. cd myscrollr.com && npm run check && npm run build (must pass; index.tsx and HeroProductShowcase.tsx already modified, plus the new CustomizationShowcase.tsx is referenced).
  4. git add the website changes + the new screenshots + the desktop/screenshots/ directory + README.
  5. Commit. Suggested message: `feat(website): refreshed hero screenshots + new CustomizationShowcase landing section`.
  6. Decide whether to push the 3 prior unpushed commits with this one.

**MCP screenshot rules** (DO NOT re-learn — this is what crashed last session):
  - Always pass `maxWidth: 1600` on every webview_screenshot call. Larger captures (>2000px any dimension) WILL kill the chat in a many-image request.
  - SAFER: pass `filePath` to write screenshots to disk and Read them back only when needed.
  - ALWAYS call webview.setZoom(1.0) before the first capture in a session. Earlier MCP runs left zoom at non-1.0, which is why the deployed hero shots have phantom bottom padding.
  - macOS DPR is 2: a 960×640 logical viewport captures at 1920×1280 native (under 2000 on both axes — OK).
  - The always-on-top ticker overlay subtracts ~28 logical px from the main window's available height. Plan crops accordingly.

**Theme / title-bar matching** (CRITICAL — the title-bar chrome follows macOS system appearance, NOT the app's data-theme):
  - The Tauri webview honors its in-app `data-theme` attribute, but the macOS native title bar (traffic lights, window background behind the rounded corners) follows the **system** appearance.
  - Therefore, before capturing **dark-themed** shots, the user's macOS must be in Dark Mode. Otherwise you get a light title bar on a dark UI — looks broken.
  - Same for **light-themed** shots — system must be in Light Mode.
  - **You CANNOT change the user's system appearance programmatically.** You must explicitly ASK the user to switch.
  - Workflow per capture batch:
      1. Check the current system appearance with: `defaults read -g AppleInterfaceStyle 2>/dev/null` — outputs `Dark` if dark, empty/error if light.
      2. Determine which theme the next batch of captures needs (look at the filename: `*-dark@*.webp` → needs dark system; `*-light@*.webp` → needs light system).
      3. If they don't match, STOP and ask the user verbatim: "I need to capture {dark|light} shots next. Your macOS is currently in {Dark|Light} Mode. Please switch to {Dark|Light} Mode (System Settings → Appearance), then tell me when it's done."
      4. Wait for explicit confirmation. Re-check `defaults read -g AppleInterfaceStyle` to verify before proceeding.
      5. Also flip the in-app theme (Tauri webview) to match — that's the `data-theme` attribute on `<html>`, set via the app's theme toggle or directly via JS.
  - Recommended capture order to minimize switches: do ALL light shots in one pass (system in Light Mode), then ALL dark shots in one pass (system in Dark Mode). Don't interleave.

**Capture workflow** (documented in desktop/screenshots/README.md, reuse it — do NOT reinvent):
  - Two-tool hybrid: Tauri MCP for state prep + JS-driven navigation, macOS `screencapture -l <windowID>` for native chrome.
  - Window IDs from a Swift one-liner against CGWindowListCopyWindowInfo (see README).
  - User is running `npm run tauri:dev:mcp` in the background; connect with mcp_Tauri_driver_session({action: "start", port: 9223}).

**Carried forward from earlier sessions (DO NOT undo, DO NOT re-learn)**:
  - desktop-release.yml triggers on push to main with desktop/** paths (not on tag).
  - TanStack Router uses memory history; webview URL bar is decorative.
  - /dashboard returns data.fantasy = { leagues: [...] }, not a flat array.
  - Yahoo player_keys are global; pass preferLeagueKey for per-league chips.
  - gameEngagement MUST NOT depend on Date.now() — state-only buckets only.
  - DO NOT undo text-ui-* migration, FantasyStatChip comfort mode preview, accent prop on FollowedPlayerChip, preferLeagueKey on findPlayerByKey, normalizeChannelData in feed.tsx, state-only gameEngagement.

**Backlog item still pending after this**: ticker monitor picker (spec at docs/superpowers/specs/2026-05-10-ticker-monitor-picker-design.md, committed 7a90cc1). The previous session queued it for implementation; this marketing-screenshot pivot pushed it. Once Track A ships, return to it.

**Environmental**:
  - User's dev MCP session may still be running on port 9223. Check first.
  - GitHub `gh` CLI is authenticated.
  - One stale stranger PR open (#104, "Feature/favorite team selection" from Enanimate, 5 weeks old, almost certainly conflicts). Don't touch unless asked.

**First concrete action**:
  Read docs/superpowers/handoffs/current.md and desktop/screenshots/README.md, then ask the user the 5 open decisions verbatim. Do NOT capture or commit anything until those are answered.
```
