# Handoff: Yahoo Fantasy Widget Redesign + Ticker Chips

## Overview

A redesign of Scrollr's Yahoo Fantasy widget (desktop app) and its ticker chips. Two workstreams:

1. **App widget** — the four feed views (Overview, Matchup, Standings, Roster) rebuilt points-first, plus a new in-feed Account panel with ticker controls.
2. **Ticker** — a new chip model ("smart league chip" + lifecycle-based "moment chips"), a new chip visual ("spine chip"), and a 3-position simplicity dial (Essential / Standard / Everything) replacing the ~10 per-item venue toggles.

Target codebase: the `myscrollr` monorepo, `desktop/` app (Tauri v2 + React 19 + Tailwind v4). All views live under `desktop/src/datawidgets/fantasy/`; chips under `desktop/src/components/chips/`.

## About the Design Files

The `.dc.html` files in this bundle are **design references created in HTML** — interactive prototypes showing intended look and behavior, NOT production code. Open them in a browser directly (keep `support.js` and `PlayerTable.dc.html` in the same folder). The task is to **recreate these designs inside the existing desktop app** using its established patterns: Tailwind v4 tokens from `desktop/src/style.css`, the widget-bar kit (`components/widget-bar/`), the settings kit (`components/settings/SettingsControls.tsx`), the feed-card recipe (`components/feedCard.ts`), and `chipColors.ts` / `chipBaseClasses` for ticker chips.

The prototypes hardcode hex values from the **scrollr-light** palette. In implementation, always use the CSS tokens (below) so all 20 theme palettes keep working.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and copy are final for the scrollr-light theme. Recreate pixel-perfectly via tokens. Fonts: Plus Jakarta Sans (UI) + IBM Plex Mono (numerals/labels) — already the app's `--font-sans` / `--font-mono`. Note the app floors 9–10px arbitrary text at 11px (`style.css`); the prototypes bake that in.

## Files

| File | What it shows |
|---|---|
| `Fantasy Widget - Redesign.dc.html` | THE deliverable. All 5 app surfaces, interactive: tab bar switches views; Week/Today toggle works; Account pill opens the Account panel; ticker dial updates the live preview. Tweakable props: `tab`, `tickerMode`, `showBench`. |
| `PlayerTable.dc.html` | Shared stat-table component used by the redesign (roster tables). |
| `Fantasy Widget - Current.dc.html` | Pixel-faithful recreation of the CURRENT app (baseline for diffing, built from repo source + demo fixture). |
| `Spine Chip Spec.dc.html` | **Build-ready ticker chip spec**: anatomy, 5-state matrix × 2 densities, moment chips, rails, implementation notes. |
| `Ticker Chip Refinements.dc.html` | The 3 explored chip directions (1a/1b/1c). 1b "Spine" won — reference only. |
| `Fantasy Ticker Chips.dc.html` | The chip *mechanics* spec: smart chip states, moment lifecycles, week narrative, modes dial. Chip visuals here predate the spine skin — read mechanics from this file, visuals from the Spine spec. |

Demo data throughout comes from `desktop/fixtures/serve-fantasy-demo.mjs` (Week 12, "The Sunday Money League"), extended with: De'Von Achane live in-game (Q3 8:42, 8.3 pts), K/DST slots, and recomputed totals (157.9–165.0, proj 163.8–165.0, win 24%).

---

## Screens / Views

### 1. Matchup (redesigned — `MatchupView.tsx`, `MatchupHero.tsx`)

Replaces the two side-by-side raw-stat tables with **position-vs-position slot rows**.

- **Hero** (existing `MatchupHero`, 3 additions): under each team name, a yet-to-play line — user side shows `● ACHANE IN PLAY` (live red `#ff4757`, pulsing 5px dot, mono 11px uppercase), opponent shows `ALL PLAYERS FINAL` (fg-4). Win-prob caption gains actionable copy: `YOU 24% · NEED 7.2 MORE FROM ACHANE`. Projected total for user is emphasized (`600`, fg-2).
- **Week/Today picker** (existing control, now above the head-to-head card): Today greys Thursday players (pts `—`, status `Played Thu`), swaps totals row to today's banked (145.5–146.9), relabels `TODAY (EASTERN)`.
- **Insight chips** — 3-up grid, 8px gap. Card: radius 8, border `edge/40`, bg `base-150/40`, padding 10×12. Contents: 32px monogram avatar, mono 11px uppercase fg-4 label (`TOP SCORER` / `IN THE GAME` / `BEST ON BENCH`), name 12px/600, right-aligned mono 14px/700 value + 11px fg-4 sub. Values: Hurts 28.1 (up-green), Achane 8.3 (live, `#16a34a`, flashing), Addison 9.2 (`+2.2 over K. Walker`). Sources: `findTopScorer` / `findTopBench` in `playerStats.ts`.
- **Head-to-head card** — radius 8, border `edge/40`, white. Grid per row: `minmax(0,1fr) 64px 48px 64px minmax(0,1fr)`, padding 8×12, hairline top borders (`edge/20`). Header row (bg `surface-2`, border-b `edge/40`): team names mono 11px uppercase (user side gets `· YOU` in accent). Ten rows: QB, WR, WR, RB, RB, TE, W/R/T ×2, K, DEF.
  - **Player cell** (mirrored for opponent): 28px monogram avatar; name 12px/600 fg; line 2: `PHI · QB · <status>` 11px fg-4 — status is `Final` (fg-4), `Final · Thu`, `Sun 8:20 PM` (fg-2 600), or `Q3 8:42` (live red 600); line 3: compact stat line 11px fg-3, e.g. `261 pass yds · 2 pass TD · 1 INT · 47 rush yds · 1 rush TD`. Pending players: `Yet to play`.
  - **Points cell**: mono 14px/700 tabular; slot leader `#1a1b2e`, trailer fg-3, unplayed `—` fg-4; live player green `#16a34a` with a 6s background flash (`ptsFlash` keyframe: 8% peak `rgba(34,197,94,.22)`). Below: `proj 21.4` mono 11px fg-4.
  - **Slot pill** center: existing pill idiom (rounded-full, border `edge/50`, bg `surface-2`, mono 8px uppercase).
  - **Totals footer** (bg `base-150/60`): `SCORED · PROJ 163.8` / big mono 13px totals / `TOT` / mirrored.
- **Bench & IR card** below (subdued: border `edge/30`, bg `base-150/40`): same row grid, header note `14.2 pts left on your bench · 17.7 on theirs`. Unmatched sides render empty.

### 2. Overview (rebuilt — `OverviewView.tsx`)

Mission control. The duplicated hero and thin "Other leagues" tiles are REMOVED.

- **Weekly scorecard** (kept): flame tile, `1W · 0L · 2 live`, `418.7 pts · 394.9 against · 3 injured roster spots · ● 1 in play · 2 yet to play`, green medal right.
- **ON THE FIELD strip** — cross-league, the marketing hero. Label row: mono 11px uppercase fg-3 + `1 live · 2 upcoming · across all leagues` fg-4. 3-up grid of player cards (radius 8): live card white bg + border `live/35`; upcoming cards `base-150/40` + `edge/40`. Card: 28px avatar, name 12px/600, sub `MIA · RB — Sunday Money` 11px fg-4; right: mono 14px/700 points (live: green + flash; upcoming: fg-3 projection) over status (`Q3 8:42` red 600 / `proj · Sun 8:20 PM` fg-4).
- **YOUR LEAGUES** — ONE uniform card component, live leagues first, primary league same card at `grid-column: span 2`. Card (radius 10, white, padding 14; live border `live/35`, else `edge/50`; clickable → that league's Matchup): header (🏈, mono meta `FOOTBALL · WEEK 12 · PRIMARY`, name 12px/600, LIVE/FINAL pill); score grid `1fr auto 1fr` — team names 12px/600 with You badge + mono rank/record (`#2 · 8-3`) under each, center mono 22px/700 score + proj line; win bar (5px track `#f0f2f8`, green fill) + `YOU 24% / 76% OPP` labels (hidden when final); footer (hairline top): left `Top: Jalen Hurts 28.1` fg-3, right urgency — `Achane in play · need 7.2` (red 600) / `2 yet to play · one-score game` (amber `#f59e0b` 600) / `Won by 33.5` (green 600).

### 3. Standings (`StandingsView.tsx`)

Unchanged except: **new PA column** (points against, fg-3, right-aligned, 60px) between PF and Streak, in both the column header and rows.

### 4. Roster (`RosterView.tsx`, `PlayerStatsTable.tsx`)

Points-first tables; existing anatomy (sticky player column, slot pill, injury badges, injury-watch card) kept.

- New columns lead the stat table: **PTS** (mono 11px/700 fg; live green + flash), **PROJ** (fg-3), **GAME** (status text; live red 600, upcoming fg-2 600, else fg-4). Then the raw stat columns as today.
- **New position-type tables**: `Kickers` (cols: FG 0-19 / 20-29 / 30-39 / 40-49 / 50+ / PAT) and `Defense / Special Teams` (Sack / Int / Fum Rec / Ret TD / Pts Allow / Safety) — matching the existing `groupByPositionType` pattern (`O`/`K`/`D` labels already exist).
- Counts row: `10 starters · 4 bench/IR · 1 in play (red) · ⚠ 2 injured`.
- Week/Today picker shared with Matchup (same behavior).

### 5. Account panel (in-feed, via the bar's Account pill — extends `ConnectedView.tsx`)

Max-width 760, centered, 20px section gap. Built from the settings kit (`SettingsGroup` cards: radius 12, border `edge/55`, bg `surface-raised`, `shadow-soft-sm`; rows px-16 py-12, hairline `fg/7` dividers).

- **YAHOO ACCOUNT** card: connection row (32px `#6001d2` "Y" tile, `doni@yahoo.com` 13px/500, `● Connected · synced 2 minutes ago` 12px fg-4 with green dot, ghost `Sync now` button) + display rows: Imported leagues 3 / Active this season 3 / Live right now `● 2 leagues` (mono, live red, pulsing).
- **YOUR LEAGUES** card: filter pills in the group label row (All 3 / Active 3 / Past 0 — active pill accent/15). League rows: 🏈, name 13px/600 + `PRIMARY` badge (accent pill) + live dot, meta mono 11px fg-3 `Football · 8 teams · 2025`; right: 28px star icon-button (primary = filled, indigo `#6366f1` at 15% bg / 40% border — the fantasy widget hex) and eye icon-button (ghost). Footer row: `Add more leagues` + ghost `Find leagues`.
- **TICKER** card (the control story):
  1. **Preview — right now**: a live mini-rail (bg `surface-2`, radius 8, min-height 36, `flex-wrap` so larger modes wrap rather than clip) rendering the actual spine chips the current mode would emit. Caption right updates: `3 chips · one per league` → `5 chips · + live moments` → `9 chips · everything, always`.
  2. **What shows on the ticker** row: segmented dial `Essential | Standard | Everything` (settings-kit segmented: recessed track `base-250/50`, selected pill raised with inset `fg/20` ring). Desc: "One setting — the rail adapts through the week on its own."
  3. **Followed players** row: `Always on the rail — Hurts, Chase` + ghost `Manage · 2`. Followed players are independent of the dial.
  4. **Advanced — ticker items** (badge `EVERYTHING ONLY`; whole block at 45% opacity + pointer-events none unless mode = Everything). Desc: "The feed always shows everything — these only control what joins the ticker." Six rows, each label 12px fg-2 + a standard **toggle** (34×20, accent when on): Matchup score ✓, Win probability ✓, Projected points ✗, Top 3 scorers ✗, Worst starter ✗, Injury report ✓. NOTE: deliberately toggles, not Off/Feed/Ticker segments — feed content is never gated.
- **DANGER ZONE** (settings-kit danger tone: border `error/25`, bg `error/3`, red label): `Disconnect Yahoo` row + error-tone `Disconnect` button.

### 6. Ticker chips (see `Spine Chip Spec.dc.html` — authoritative)

**Model** (replaces additive venue toggles in `ticker.tsx`):
- **Smart league chip** — one per enabled league, always present, adapts to `matchup.status`: `preevent` → PROJ tag + projected score + kickoff + record; `midevent` → live score + game clock context; `postevent` → result + margin + record/seed.
- **Moment chips** — enter/leave the rail on lifecycle: *in-play* (kickoff → final whistle), *breaking injury* (only when status is new/changed this week), *bench regret* (Mon–Wed after the week closes), *followed players* (permanent, user opt-in, unchanged).
- **Modes**: Essential (default; smart chips only), Standard (+ live moments), Everything (all current venues; unlocks Advanced per-item toggles). Maps onto `FantasyDisplayPrefs` as a preset layer over the existing per-item prefs.

**Spine chip visual** (extends `chipBaseClasses` in `chipColors.ts` — keep PURPLE color set):
- Chip gains `relative overflow-hidden`. New `<ChipSpine>` child: absolute, 2px, bottom inset-x-0; track `rgba(fg-3, .15)` always present; fill = `estimateWinProbability()` — pre-game at 35% opacity, live full + 2s `spineGlow` opacity pulse (1 → .55), final 100% width in up/down color. Player chips: fill = `player_points / projected`, clamped.
- Hero score 15px bold tabular (13px compact), your team always left; final tints only your number (opponent stays fg-3).
- Lead caret ▲ (up) / ▼ (down), 11px, renders only while live.
- State tag: `PROJ` (textDim) / `Q3` (live) / `FINAL` + `W`/`L` (up/down, 700).
- Context line (comfort row 2 only, 10px uppercase textFaint): pre = `first kick 1:00 PM · 8-3`; live = flashing `Achane +8.3 · need 7.2`; final = `W by 2.4 · 9-3 · 2nd seed`.
- Chips are `flex-shrink:0` on the rail — never compress.
- Reduced motion: pulse/glow disable under `prefers-reduced-motion`; flash falls back to a static green tint (the app is already motion-free in `#app-shell`; the ticker window has its own motion rules).

## Screenshots

`screenshots/` — viewport captures of the prototypes (light theme): `01-app` Matchup · `02-app` Overview · `03-app` Standings · `04-app` Roster · `05-app` Account · `06-app` Account with the ticker dial on Everything · `01–03-chips` Spine chip spec (anatomy, state matrix, rails). The .dc.html files remain the source of truth — screenshots are cropped to the viewport.

## Interactions & Behavior

- Tab bar (existing Segmented) switches views; picking one persists as default (existing behavior). Account pill toggles the Account panel and shows the accent-active pill state; opening any tab closes it.
- Week/Today: one shared state for Matchup + Roster.
- Ticker dial: updates preview immediately; Advanced block animates nothing (app is motion-free) — it just changes opacity.
- Animations (ticker window only): `scrollrPulse` 1.3–2s opacity loop on live dots; `ptsFlash` 6s background flash on live points; `spineGlow` 2s on live spine fills.
- League cards on Overview click through to that league's Matchup.

## State Management

- `fantasySubTab` gains `account` (or reuse the existing `accountOpen` boolean in `FeedTab`).
- `statsWindow: 'week' | 'today'` lifted so Matchup + Roster share it.
- New pref: `tickerMode: 'essential' | 'standard' | 'everything'` in `FantasyDisplayPrefs`; Essential/Standard are presets computed at chip-build time in `ticker.tsx`; Everything reads the existing per-item prefs (now booleans meaning "on ticker").
- Moment-chip lifecycles need: injury-status change tracking (store last-seen status per player_key; chip shows while `changedThisWeek`), and week-phase detection (pre/live/post from matchup status; bench regret shows in `postevent` until the next week's `preevent`).

## Data Requirements (flag for backend)

Everything except one item is already in `MyLeaguesResponse`:
- Per-player fantasy points: `player_points` ✓; projections: `proj` per player ✓ (fixture) — confirm API exposes per-player projected points for NFL.
- Win probability: `estimateWinProbability()` in `types.ts` ✓.
- **NEW: per-player game state** (`Q3 8:42` / `Sun 8:20 PM` / `Final · Thu`) is NOT in the Yahoo payload. Needs a join against the sports service's NFL game data (team abbr → game clock/kickoff) or a fantasy-service enrichment. Everything degrades gracefully without it (fall back to today's `—` behavior), but the live treatments depend on it.
- K/DST stat lines: available from Yahoo when leagues roster them; the demo point values in the prototypes are asserted from standard Yahoo scoring, not computed.

## Design Tokens (scrollr-light hex → token)

| Prototype hex | Token |
|---|---|
| `#ffffff` / `#f6f7fb` / `#f0f2f8` / `#fcfcfc` | `surface` / `surface-2`, `base-150` / `surface-3` / `surface-raised` |
| `rgba(213,215,226,x)` | `edge` at opacity x |
| `#1a1b2e` / `#4a4a5a` / `#7a7a8a` / `#a0a0b0` | `fg` / `fg-2` / `fg-3` / `fg-4` |
| `#34d399` | `accent` / `primary` |
| `#22c55e`, `#16a34a` / `#ef4444` | `up` (16a34a = up on tinted bg) / `down`, `error` |
| `#ff4757` | `live` |
| `#fbbf24`, `#f59e0b` | `warn`, amber-500 (Q status) |
| `#a855f7` | `accent-purple` (fantasy chips) |
| `#6366f1` | fantasy widget hex (`fantasyDataWidget.hex`) |
| `#6001d2` | Yahoo brand purple (account tile only) |

Spacing: 4/6/8/12/16/20px steps; radii: 3–4 (chips/badges), 6–8 (controls/cards), 10–12 (panels); type: 10/11/12/13/15/22/30px with mono for all numerals + uppercase labels (letter-spacing 0.05–0.08em).

## Assets

None. Avatars/crests are generated monograms (`hueOf(name)` → `hsl(h 34% 30%)` players, `hsl(h 58% 44%)` team tiles — same functions as `serve-fantasy-demo.mjs`). Icons are lucide (already in the app); the prototypes inline them only because the sandbox blocks CDNs.
