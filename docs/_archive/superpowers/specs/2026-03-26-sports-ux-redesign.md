# Sports Channel UX Redesign

## Goal

Improve the sports channel experience across all 4 surfaces (dashboard, feed, ticker, configure) by adding real team codes from the API, introducing standings/schedule tabs on the feed page, unifying display preferences, and fixing existing bugs.

## Architecture

The sports data pipeline gains a new field (`team_code`) flowing from api-sports.io through Rust ingestion → PostgreSQL → Go API → Desktop. Two new data types (standings, teams) are added with their own polling cadences and storage tables. Display preferences move from per-surface dashboard prefs to unified channel-level config read by all surfaces.

## Tech Stack

- Rust (edition 2024): ingestion service parser changes, new polling loops, new migrations
- Go 1.22 / Fiber v2: new API endpoints, updated structs and queries
- React 19 / TypeScript / Tailwind v4: desktop UI components
- PostgreSQL: new columns, new tables
- Redis: cache keys for new endpoints

---

## 1. Pipeline: Team Codes

### Problem

`abbreviateTeam(name)` does `name.slice(0, 3).toUpperCase()` — "Golden State Warriors" becomes "GOL" instead of "GSW". The api-sports.io API returns a `code` field (3-letter abbreviation) on team objects that we currently ignore in all 11 parsers.

### Changes

**Rust ingestion (`channels/sports/service/`):**

- `database.rs` — Add `code: Option<String>` to `Team` struct
- All 11 parsers in `lib.rs` — Extract `home.get("code").and_then(|c| c.as_str()).map(|s| s.to_string())` alongside existing `name` and `logo` extraction
- New migration `YYYYMMDDHHMMSS_add_team_code.up.sql`:
  ```sql
  ALTER TABLE games ADD COLUMN IF NOT EXISTS home_team_code VARCHAR(10);
  ALTER TABLE games ADD COLUMN IF NOT EXISTS away_team_code VARCHAR(10);
  ```
- Down migration drops both columns
- Update `upsert_game` query in `database.rs` to include `home_team_code` and `away_team_code` in both INSERT and ON CONFLICT UPDATE

**Go API (`channels/sports/api/`):**

- `models.go` — Add `HomeTeamCode string` and `AwayTeamCode string` with `json:"home_team_code"` and `json:"away_team_code"` tags
- `sports.go` — Update both `queryGames` and `queryGamesByLeagues` SQL to include `COALESCE(home_team_code, '')` and `COALESCE(away_team_code, '')` in SELECT, and update the `Scan` calls

**Desktop (`desktop/src/`):**

- `types/index.ts` — Add `home_team_code: string` and `away_team_code: string` to `Game` interface
- `utils/gameHelpers.ts` — Update `abbreviateTeam` to accept optional code: `export function displayTeamCode(code: string, name: string): string { return code || name.slice(0, 3).toUpperCase(); }` — rename function to clarify intent
- All consumers: replace `abbreviateTeam(game.home_team_name)` with `displayTeamCode(game.home_team_code, game.home_team_name)`

---

## 2. Standings & Teams Data

### New Tables

**`standings` table** (in sports service database):

```sql
CREATE TABLE IF NOT EXISTS standings (
    id             SERIAL PRIMARY KEY,
    league         VARCHAR(50) NOT NULL,
    team_name      VARCHAR(100) NOT NULL,
    team_code      VARCHAR(10),
    team_logo      VARCHAR(500),
    rank           INTEGER,
    wins           INTEGER NOT NULL DEFAULT 0,
    losses         INTEGER NOT NULL DEFAULT 0,
    draws          INTEGER NOT NULL DEFAULT 0,
    points         INTEGER,
    games_played   INTEGER NOT NULL DEFAULT 0,
    goal_diff      INTEGER,
    description    VARCHAR(200),
    form           VARCHAR(20),
    group_name     VARCHAR(100),
    season         VARCHAR(20),
    updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(league, team_name, season)
);
```

**`teams` table** (in sports service database):

```sql
CREATE TABLE IF NOT EXISTS teams (
    id             SERIAL PRIMARY KEY,
    league         VARCHAR(50) NOT NULL,
    external_id    INTEGER NOT NULL,
    name           VARCHAR(100) NOT NULL,
    code           VARCHAR(10),
    logo           VARCHAR(500),
    country        VARCHAR(100),
    season         VARCHAR(20),
    updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(league, external_id, season)
);
```

### New Polling

**Standings poll** — runs once daily (every 24 hours):
- For each enabled league: `GET /{sport}/standings?league={id}&season={season}`
- Football uses `/standings` endpoint; other sports may use `/standings` or `/games` with group param
- Parse response, upsert into `standings` table
- ~21 API calls/day (1 per league), negligible budget impact
- Cleanup: delete standings from previous seasons

**Teams poll** — runs once on startup, then weekly:
- For each enabled league: `GET /{sport}/teams?league={id}&season={season}`
- Parse response, upsert into `teams` table
- ~21 API calls total per run
- Provides authoritative team codes as a fallback when game-level codes are missing

### CDC

Standings and teams tables do NOT need CDC/Sequin integration. They are fetched via TanStack Query with long `staleTime` (1 hour for standings, 24 hours for teams). Only the `games` table uses CDC for real-time score updates.

### New Go API Endpoints

**`GET /sports/standings?league={name}`**
- Returns standings for a specific league
- Redis cache: `cache:sports:standings:{league}`, TTL 1 hour
- Response: `{ "standings": [...] }`

**`GET /sports/teams?league={name}`**
- Returns team roster for a specific league
- Redis cache: `cache:sports:teams:{league}`, TTL 24 hours
- Response: `{ "teams": [...] }`

### Route Registration

Both new endpoints must be added to:
- `channels/sports/api/main.go` — route definitions (alongside existing `/sports`, `/sports/leagues`, etc.)
- `channels/sports/api/main.go` — `registrationPayload` routes array (so the core gateway discovers and proxies them)
- `channels/sports/api/manifest.json` — add to the routes list for manifest-based discovery

---

## 3. Dashboard Card

### Current State

`SportsSummary.tsx` (423 lines) — featured game + compact chips, 6 dashboard prefs, `surface-3` CSS var undefined.

### Changes

- Replace `abbreviateTeam()` with `displayTeamCode()` in both `PrimaryGame` and `CompactChip`
- Remove dashboard-specific preferences (`SportsCardPrefs` type from `dashboardPrefs.ts`, `SPORTS_SCHEMA` used by `CardEditor`) — replaced by unified channel prefs
- Read `showUpcoming`, `showFinal`, `showLogos` from channel config via `useShell()` or prop
- Fix `bg-surface-3/*` usages — define `--color-surface-3` in `style.css` (used by 13 places across 6 files, not just sports)
- Remove sports-specific `CardEditor` schema/toggle buttons from the dashboard card header (the generic `CardEditor` component renders per-channel preference toggles via schema — remove the sports schema entry)
- Drop `showTimer`, `compact`, and `stats` preferences entirely — timer is always shown when available, compact/comfort is the global ticker setting, stats footer is removed
- Filter games based on unified prefs before rendering

### Layout (unchanged conceptually)

Featured game card + compact overflow chips per league. The visual structure stays the same — only the data source for preferences changes and team codes improve.

---

## 4. Feed Page

### Current State

`FeedTab.tsx` (128 lines) — single list of games grouped by league. No tabs, no standings.

### Changes

**New tabbed layout** — 3 tabs within the feed page:

**Scores tab** (default):
- The existing `mode` prop (compact/comfort from `FeedTabProps`) is preserved — it controls information density on the scores tab just as it does today. Compact = single-column dense rows. Comfort = 2-column card grid.
- 2-column responsive card grid in comfort mode (`grid-cols-1 sm:grid-cols-2`)
- Each card: team code (bold, 14px mono) + full name (dimmed, 11px) + logo + score + status badge
- Live games: accent left border + pulsing dot
- Final games: winner team code bolded, loser dimmed
- Pre-game: "vs" instead of score, countdown timer
- Filtered by `showUpcoming` and `showFinal` channel prefs

**Schedule tab**:
- Pre-game entries grouped by date headers (Today, Tomorrow, "Mon Mar 30", etc.)
- Each entry: home code vs away code, logos, start time, venue (if available)
- Sorted by `start_time ASC`
- No CDC needed — uses same game data filtered to `state === "pre"`

**Standings tab**:
- League selector dropdown (populated from user's subscribed leagues)
- W-L-D table per league:
  - Columns: Rank | Logo | Team (code + name) | W | L | D | Pts | GD | GP
  - Rows sorted by rank
  - Highlight user's teams (if identifiable by config)
- Data from new `GET /sports/standings?league=` endpoint
- TanStack Query with `staleTime: 1 hour`

### New Files

- `desktop/src/channels/sports/ScoresTab.tsx` — refactored from current FeedTab game rendering
- `desktop/src/channels/sports/ScheduleTab.tsx` — pre-game list with date grouping
- `desktop/src/channels/sports/StandingsTab.tsx` — standings table component
- `FeedTab.tsx` becomes the tab container

### Data Fetching

- Scores + Schedule: same `useScrollrCDC<Game>` data, filtered differently per tab
- Standings: new `useQuery` with `standingsOptions(league)` in `desktop/src/api/queries.ts`

---

## 5. Ticker Chip

### Changes

- Replace `abbreviateTeam(game.home_team_name)` with `displayTeamCode(game.home_team_code, game.home_team_name)` in `GameChip.tsx`
- Add `home_team_code` and `away_team_code` to the memo comparator (lines 177-194) to prevent unnecessary re-renders
- When `showLogos` is false, hide the `ChipLogo` components (currently always rendered)
- No other layout changes — existing design (flash, engagement ordering, close-game borders, pulsing dots) is solid
- Respects unified `showUpcoming`, `showFinal`, `showLogos` prefs for filtering (prefs passed as props from `ScrollrTicker`)

---

## 6. Configure Page

### Current State

`SportsConfigPanel.tsx` (149 lines) — thin wrapper around `SetupBrowser` catalog.

### Changes

- Keep `SetupBrowser` for league selection (top section)
- Add "Display" section below catalog with 3 toggle switches:
  - **Show upcoming games** (default: true)
  - **Show final scores** (default: true)
  - **Show team logos** (default: true)
- Toggles stored in sports channel config JSONB: `{ leagues: [...], showUpcoming: true, showFinal: true, showLogos: true }`
- **Config write strategy**: The current `useChannelConfig` hook and Go API's `UpdateChannel` both do full config column replacement (`config = $N`), not JSONB merge. This means writing `{ display: {...} }` would delete `leagues` and vice versa. To fix this, create a `useSportsConfig()` hook that reads the full current config, merges the changed field locally, and writes the complete object atomically: `{ leagues: [...], display: { showUpcoming: true, showFinal: true, showLogos: true } }`. The hook wraps `useChannelConfig<SportsConfig>("sports", "config")` where `SportsConfig = { leagues: string[]; display: SportsDisplayPrefs }` and always writes the full shape. This avoids any core API changes and is self-contained to the sports channel.
- Remove all dashboard-specific preference infrastructure (`SportsCardPrefs` type, `SPORTS_SCHEMA` in `dashboardPrefs.ts`, sports section in `CardEditor`)

---

## 7. Shared Component Cleanup

### Consolidate TeamLogo

Three duplicate implementations:
- `SportsSummary.tsx:67-79` — `TeamLogo` with `onError` + fallback
- `GameItem.tsx:23-34` — `TeamLogo` with `onError` + fallback
- `GameChip.tsx:9-20` — `ChipLogo` with `onError` + fallback

Consolidate into one shared component:
- `desktop/src/components/TeamLogo.tsx` — accepts `src`, `alt`, `size` (sm/md/lg), `className`
- All three files import from the shared component

### Fix State Helper Usage

- `FeedTab.tsx` lines 65-67, 73-78 — replace inline `g.state === "in_progress" || g.state === "in"` with `isLive(g)` from `gameHelpers.ts`

### Fix CSS Variable

- Define `--color-surface-3` in `desktop/src/style.css` under both dark and light themes — this fixes 13 usages across 6 files (not just `SportsSummary.tsx`). Value should be between `surface-hover` and `surface` in the darkness scale. In Tailwind v4, the existing color tokens (`surface`, `surface-hover`, `edge`, etc.) are defined as CSS custom properties under `@theme` in `style.css` — add `--color-surface-3` to the same `@theme` block so opacity modifiers like `bg-surface-3/30` work correctly.

---

## 8. Unified Preferences Architecture

### Current Architecture

```
dashboardPrefs.ts → SportsCardPrefs → stored in localStorage via useDashboardPrefs
                                     → only read by SportsSummary.tsx
```

### New Architecture

```
channel config JSONB → { leagues: [...], display: { showUpcoming: true, showFinal: true, showLogos: true } }
                     → stored server-side in user_channels.config
                     → read by: SportsSummary, FeedTab (all tabs), GameChip (ticker), ScrollrTicker
                     → written by: SportsConfigPanel via useSportsConfig() (reads full config, merges, writes atomically)
```

### How Surfaces Access Prefs

- Dashboard (`SportsSummary`): receives channel config from `ShellDataContext.channels`
- Feed (`FeedTab`): receives channel config from route params / channel context
- Ticker (`GameChip`/`ScrollrTicker`): receives via dashboard response (already includes channel configs)
- Configure (`SportsConfigPanel`): reads/writes via `useChannelConfig`

---

## 9. What Is NOT In Scope

- Player statistics or player pages (deferred to v1.1)
- Server-side tier enforcement on item counts (separate v1 track)
- Custom alerts or notifications
- Historical game data beyond the cleanup window
- Game detail page or external link navigation
- Dark/light theme color audit for `--color-live` (minor, cosmetic)

---

## 10. Error Handling

- **Missing team codes**: `displayTeamCode()` falls back to `name.slice(0, 3).toUpperCase()` when code is empty/missing
- **Standings fetch failure**: Show "Could not load standings" error state with retry button
- **Teams fetch failure**: Non-blocking — team codes in games are the primary source, teams table is supplementary
- **Empty standings**: "No standings available for {league}" message
- **Missing leagues in standings**: League selector only shows leagues that have standings data

---

## 11. Testing

- **Pipeline**: Verify team codes flow end-to-end by checking a known game (e.g., NBA game with team codes "LAL" and "BOS")
- **Standings**: Verify daily poll populates data, verify cache invalidation works
- **Unified prefs**: Toggle each pref in configure, verify it affects all 3 other surfaces
- **Fallback**: Remove team codes from a game record, verify `displayTeamCode` falls back to slice
- **Cross-platform**: Verify layout at different window sizes (960x640 default, smaller/larger)
