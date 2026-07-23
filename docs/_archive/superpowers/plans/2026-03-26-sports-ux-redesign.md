# Sports UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team codes, standings, schedule tabs, unified display prefs, and shared components across the sports channel's 4 surfaces (dashboard, feed, ticker, configure).

**Architecture:** Data flows bottom-up: Rust parsers extract new `code` field → PostgreSQL migration adds columns → Go API includes codes in queries/response → Desktop UI consumes codes and new endpoints. Standings + teams get parallel Rust polling loops and Go endpoints. Display preferences move from localStorage to channel config JSONB. Three duplicate `TeamLogo` components consolidate into one shared component.

**Tech Stack:** Rust (edition 2024, sqlx, reqwest, serde), Go 1.22 (Fiber v2, pgx v5, go-redis v9), React 19, TypeScript, TanStack Query, Tailwind v4, Tauri v2.

---

## File Structure

### New Files
| Path | Responsibility |
|------|---------------|
| `channels/sports/service/migrations/YYYYMMDDHHMMSS_add_team_code.up.sql` | Add `home_team_code`/`away_team_code` to games |
| `channels/sports/service/migrations/YYYYMMDDHHMMSS_add_team_code.down.sql` | Drop team code columns |
| `channels/sports/service/migrations/YYYYMMDDHHMMSS_add_standings_teams.up.sql` | Create standings + teams tables |
| `channels/sports/service/migrations/YYYYMMDDHHMMSS_add_standings_teams.down.sql` | Drop standings + teams tables |
| `desktop/src/components/TeamLogo.tsx` | Shared logo component with onError fallback |
| `desktop/src/channels/sports/ScoresTab.tsx` | Game cards (refactored from FeedTab game rendering) |
| `desktop/src/channels/sports/ScheduleTab.tsx` | Pre-game list with date grouping |
| `desktop/src/channels/sports/StandingsTab.tsx` | W-L-D table per league |
| `desktop/src/hooks/useSportsConfig.ts` | Atomic config read/merge/write hook |

### Modified Files
| Path | What Changes |
|------|-------------|
| `channels/sports/service/src/database.rs` | Add `code` to `Team` struct, update `upsert_game`, add standings/teams upsert + query fns |
| `channels/sports/service/src/lib.rs` | Extract `code` in all 11 parsers, add standings/teams poll loops |
| `channels/sports/service/src/main.rs` | Spawn standings + teams poll loops |
| `channels/sports/api/models.go` | Add `HomeTeamCode`/`AwayTeamCode` to `Game`, add `Standing` + `TeamInfo` structs |
| `channels/sports/api/sports.go` | Update SQL queries + Scan, add standings/teams handlers |
| `channels/sports/api/main.go` | Register new routes + registration payload |
| `channels/sports/manifest.json` | Add new routes to manifest |
| `desktop/src/types/index.ts` | Add `home_team_code`/`away_team_code` to `Game` |
| `desktop/src/utils/gameHelpers.ts` | Replace `abbreviateTeam` with `displayTeamCode` |
| `desktop/src/channels/sports/GameItem.tsx` | Use shared `TeamLogo`, use `displayTeamCode` |
| `desktop/src/channels/sports/FeedTab.tsx` | Tabbed layout (Scores/Schedule/Standings) |
| `desktop/src/components/chips/GameChip.tsx` | Use shared `TeamLogo`/`ChipLogo` from shared, use `displayTeamCode`, respect `showLogos` |
| `desktop/src/components/dashboard/SportsSummary.tsx` | Use shared `TeamLogo`, use `displayTeamCode`, read unified prefs, remove `SportsCardPrefs` usage |
| `desktop/src/channels/SportsConfigPanel.tsx` | Add display toggles, use `useSportsConfig` |
| `desktop/src/components/dashboard/dashboardPrefs.ts` | Remove `SportsCardPrefs` + `SPORTS_SCHEMA` |
| `desktop/src/api/queries.ts` | Add standings + teams query options |
| `desktop/src/style.css` | Add `--color-surface-3` to `@theme` |

---

## Task 1: Shared Component Cleanup + CSS Fix

**Why first:** Removes duplication before new code is built on top. Everything else imports from these.

**Files:**
- Create: `desktop/src/components/TeamLogo.tsx`
- Modify: `desktop/src/style.css:10-12` (add `--color-surface-3` to `@theme`)
- Modify: `desktop/src/channels/sports/GameItem.tsx` (replace inline `TeamLogo`)
- Modify: `desktop/src/components/chips/GameChip.tsx` (replace inline `ChipLogo`)
- Modify: `desktop/src/components/dashboard/SportsSummary.tsx` (replace inline `TeamLogo`)

- [ ] **Step 1: Create shared TeamLogo component**

Create `desktop/src/components/TeamLogo.tsx`:

```tsx
import { useState } from "react";
import { clsx } from "clsx";

const SIZES = {
  xs: "w-3 h-3",
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
  lg: "w-5 h-5",
} as const;

interface TeamLogoProps {
  src: string;
  alt: string;
  size?: keyof typeof SIZES;
  className?: string;
}

export default function TeamLogo({ src, alt, size = "md", className }: TeamLogoProps) {
  const [err, setErr] = useState(false);
  if (err || !src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={clsx(SIZES[size], "object-contain shrink-0", className)}
      loading="lazy"
      onError={() => setErr(true)}
    />
  );
}
```

- [ ] **Step 2: Add `--color-surface-3` to CSS theme**

In `desktop/src/style.css`, add to the `@theme` block (after line 10 `--color-surface-hover`):

```css
--color-surface-3: #1e1e2c;
```

And in the light theme block (after `--color-surface-hover: #eef0f6`):

```css
--color-surface-3: #f0f2f8;
```

- [ ] **Step 3: Replace GameItem's inline TeamLogo**

In `desktop/src/channels/sports/GameItem.tsx`:
- Remove the local `TeamLogo` function (lines 23-34)
- Add import: `import TeamLogo from "../../components/TeamLogo";`
- Replace all `<TeamLogo src={...} alt={...} size="w-4 h-4" />` with `<TeamLogo src={...} alt={...} size="md" />`
- Replace `size="w-5 h-5"` with `size="lg"`

- [ ] **Step 4: Replace GameChip's inline ChipLogo**

In `desktop/src/components/chips/GameChip.tsx`:
- Remove the local `ChipLogo` function (lines 9-20)
- Add import: `import TeamLogo from "../TeamLogo";`
- Replace `<ChipLogo src={...} alt={...} size="w-3 h-3" />` with `<TeamLogo src={...} alt={...} size="xs" />`
- Replace `size="w-3.5 h-3.5"` with `<TeamLogo ... size="sm" />`

- [ ] **Step 5: Replace SportsSummary's inline TeamLogo**

In `desktop/src/components/dashboard/SportsSummary.tsx`:
- Remove the local `TeamLogo` function (lines 67-79)
- Add import: `import TeamLogo from "../TeamLogo";`
- Replace usage with `<TeamLogo src={...} alt={...} size="md" />`

- [ ] **Step 6: Fix inline state checks in FeedTab**

In `desktop/src/channels/sports/FeedTab.tsx`:
- Add import: `import { isLive } from "../../utils/gameHelpers";`
- Replace `a.state === "in_progress" || a.state === "in"` (lines 65-67, 73-78) with `isLive(a)` / `isLive(g)`

- [ ] **Step 7: Verify and commit**

```bash
cd desktop && npx tsc --noEmit
git add -A && git commit -m "refactor: consolidate TeamLogo, add surface-3 CSS, fix inline state checks"
```

---

## Task 2: Team Codes — Rust Pipeline

**Files:**
- Create: `channels/sports/service/migrations/20260326120000_add_team_code.up.sql`
- Create: `channels/sports/service/migrations/20260326120000_add_team_code.down.sql`
- Modify: `channels/sports/service/src/database.rs` (Team struct + upsert)
- Modify: `channels/sports/service/src/lib.rs` (all 11 parsers)

- [ ] **Step 1: Create migration files**

`channels/sports/service/migrations/20260326120000_add_team_code.up.sql`:
```sql
ALTER TABLE games ADD COLUMN IF NOT EXISTS home_team_code VARCHAR(10);
ALTER TABLE games ADD COLUMN IF NOT EXISTS away_team_code VARCHAR(10);
```

`channels/sports/service/migrations/20260326120000_add_team_code.down.sql`:
```sql
ALTER TABLE games DROP COLUMN IF EXISTS home_team_code;
ALTER TABLE games DROP COLUMN IF EXISTS away_team_code;
```

- [ ] **Step 2: Add `code` to `Team` struct**

In `channels/sports/service/src/database.rs`, update the `Team` struct:

```rust
#[derive(Debug)]
pub struct Team {
    pub name: String,
    pub logo: Option<String>,
    pub score: Option<i32>,
    pub code: Option<String>,
}
```

- [ ] **Step 3: Update `upsert_game` query**

In `database.rs`, update the `upsert_game` function's SQL and bindings:

INSERT columns — add `home_team_code, away_team_code` after `home_team_score` and `away_team_score` respectively.

VALUES — add `$19, $20` (shifting existing params means renumbering — the new total is 20 params).

ON CONFLICT UPDATE — add:
```sql
home_team_code = EXCLUDED.home_team_code,
away_team_code = EXCLUDED.away_team_code,
```

Add bindings:
```rust
.bind(game.home_team.code)  // after home_team.score
.bind(game.away_team.code)  // after away_team.score
```

**Important:** The current query has 18 params ($1-$18). After adding 2 team code columns, you need 20 params. Restructure the INSERT to:
```
league, sport, external_game_id, link,
home_team_name, home_team_logo, home_team_score, home_team_code,
away_team_name, away_team_logo, away_team_score, away_team_code,
start_time, short_detail, state,
status_short, status_long, timer, venue, season
```

With VALUES `$1` through `$20` and corresponding `.bind()` calls in order.

- [ ] **Step 4: Update all 11 parsers to extract `code`**

In every parser function in `lib.rs`, add code extraction in the `Team` construction. The pattern is identical for all team sports:

```rust
home_team: Team {
    name: home.get("name").and_then(|n| n.as_str())?.to_string(),
    logo: home.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
    score: home_score,
    code: home.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
},
away_team: Team {
    name: away.get("name").and_then(|n| n.as_str())?.to_string(),
    logo: away.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
    score: away_score,
    code: away.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
},
```

**Special cases:**
- **Formula 1** (`parse_f1_race`): F1 uses race name / circuit name as team fields. Set `code: None` for both.
- **MMA** (`parse_mma_fight`): Uses `fighters.first/second`. Set `code: None` for both (fighters don't have team codes).

**Parsers to update (11 total):**
1. `parse_football_fixture` (~line 486)
2. `parse_american_football_game` (~line 543)
3. `parse_basketball_game` (~line 604)
4. `parse_hockey_game` (~line 660)
5. `parse_baseball_game` (~line 720)
6. `parse_f1_race` (~line 780) — `code: None`
7. `parse_rugby_game` (~line 840)
8. `parse_handball_game` (~line 900)
9. `parse_volleyball_game` (~line 950)
10. `parse_afl_game` (~line 1010)
11. `parse_mma_fight` (~line 1070) — `code: None`

- [ ] **Step 5: Verify Rust compiles**

```bash
cd channels/sports/service && cargo check
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(sports): add team code extraction to Rust pipeline + migration"
```

---

## Task 3: Team Codes — Go API + Desktop Type

**Files:**
- Modify: `channels/sports/api/models.go`
- Modify: `channels/sports/api/sports.go`
- Modify: `desktop/src/types/index.ts`
- Modify: `desktop/src/utils/gameHelpers.ts`

- [ ] **Step 1: Update Go `Game` struct**

In `channels/sports/api/models.go`, add after `HomeTeamScore` / `AwayTeamScore`:

```go
HomeTeamCode  string    `json:"home_team_code"`
AwayTeamCode  string    `json:"away_team_code"`
```

(No `omitempty` — empty string is fine for missing codes.)

- [ ] **Step 2: Update both SQL query functions**

In `channels/sports/api/sports.go`, update both `queryGames` (line 376) and `queryGamesByLeagues` (line 415):

Add to SELECT list after the score columns:
```sql
COALESCE(home_team_code, ''), COALESCE(away_team_code, ''),
```

Update the `Scan` call to include the new fields. The scan order must match SELECT order. Add `&g.HomeTeamCode` and `&g.AwayTeamCode` after `&g.HomeTeamScore` and `&g.AwayTeamScore` respectively:

```go
rows.Scan(
    &g.ID, &g.League, &g.Sport, &g.ExternalGameID, &g.Link,
    &g.HomeTeamName, &g.HomeTeamLogo, &g.HomeTeamScore, &g.HomeTeamCode,
    &g.AwayTeamName, &g.AwayTeamLogo, &g.AwayTeamScore, &g.AwayTeamCode,
    &g.StartTime, &g.ShortDetail, &g.State,
    &g.StatusShort, &g.StatusLong, &g.Timer, &g.Venue, &g.Season,
)
```

- [ ] **Step 3: Update Desktop Game type**

In `desktop/src/types/index.ts`, add after `home_team_score` / `away_team_score`:

```ts
home_team_code: string;
away_team_code: string;
```

- [ ] **Step 4: Replace `abbreviateTeam` with `displayTeamCode`**

In `desktop/src/utils/gameHelpers.ts`, replace:

```ts
/** Abbreviate a team name to 3 uppercase characters (e.g. "Lakers" → "LAK"). */
export function abbreviateTeam(name: string): string {
  return name.slice(0, 3).toUpperCase();
}
```

With:

```ts
/** Display a team code, falling back to first 3 chars of name if code is missing. */
export function displayTeamCode(code: string, name: string): string {
  return code || name.slice(0, 3).toUpperCase();
}
```

- [ ] **Step 5: Update all consumers of `abbreviateTeam`**

Search for all usages of `abbreviateTeam` across the desktop codebase and replace:

- `GameItem.tsx`: `abbreviateTeam(game.home_team_name)` → `displayTeamCode(game.home_team_code, game.home_team_name)` (and same for away)
- `GameChip.tsx`: Same pattern
- `SportsSummary.tsx`: Same pattern (in CompactChip and anywhere team names are abbreviated)

Update imports from `import { ..., abbreviateTeam } from ...` to `import { ..., displayTeamCode } from ...`.

- [ ] **Step 6: Update memo comparators**

In `GameItem.tsx`, add `game.home_team_code` and `game.away_team_code` to the memo comparator.

In `GameChip.tsx`, add the same to its memo comparator.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd desktop && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(sports): team codes through Go API + Desktop (type + helpers + consumers)"
```

---

## Task 4: Standings & Teams — Rust Pipeline

**Files:**
- Create: `channels/sports/service/migrations/20260326130000_add_standings_teams.up.sql`
- Create: `channels/sports/service/migrations/20260326130000_add_standings_teams.down.sql`
- Modify: `channels/sports/service/src/database.rs` (new structs + upsert/query fns)
- Modify: `channels/sports/service/src/lib.rs` (new poll loops + parsers)
- Modify: `channels/sports/service/src/main.rs` (spawn new poll loops)

- [ ] **Step 1: Create standings + teams migration**

`channels/sports/service/migrations/20260326130000_add_standings_teams.up.sql`:
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

Down migration:
```sql
DROP TABLE IF EXISTS standings;
DROP TABLE IF EXISTS teams;
```

- [ ] **Step 2: Add Rust structs + database functions**

In `database.rs`, add:

```rust
// =============================================================================
// Standings
// =============================================================================

#[derive(Debug)]
pub struct StandingData {
    pub league: String,
    pub team_name: String,
    pub team_code: Option<String>,
    pub team_logo: Option<String>,
    pub rank: Option<i32>,
    pub wins: i32,
    pub losses: i32,
    pub draws: i32,
    pub points: Option<i32>,
    pub games_played: i32,
    pub goal_diff: Option<i32>,
    pub description: Option<String>,
    pub form: Option<String>,
    pub group_name: Option<String>,
    pub season: Option<String>,
}

pub async fn upsert_standing(pool: &Arc<PgPool>, s: StandingData) -> Result<()> {
    let mut conn = pool.acquire().await?;
    query(
        "INSERT INTO standings (league, team_name, team_code, team_logo, rank, wins, losses, draws, points, games_played, goal_diff, description, form, group_name, season)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (league, team_name, season) DO UPDATE SET
            team_code = EXCLUDED.team_code, team_logo = EXCLUDED.team_logo,
            rank = EXCLUDED.rank, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
            draws = EXCLUDED.draws, points = EXCLUDED.points,
            games_played = EXCLUDED.games_played, goal_diff = EXCLUDED.goal_diff,
            description = EXCLUDED.description, form = EXCLUDED.form,
            group_name = EXCLUDED.group_name, updated_at = CURRENT_TIMESTAMP"
    )
    .bind(&s.league).bind(&s.team_name).bind(&s.team_code).bind(&s.team_logo)
    .bind(s.rank).bind(s.wins).bind(s.losses).bind(s.draws).bind(s.points)
    .bind(s.games_played).bind(s.goal_diff).bind(&s.description).bind(&s.form)
    .bind(&s.group_name).bind(&s.season)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// =============================================================================
// Teams
// =============================================================================

#[derive(Debug)]
pub struct TeamData {
    pub league: String,
    pub external_id: i32,
    pub name: String,
    pub code: Option<String>,
    pub logo: Option<String>,
    pub country: Option<String>,
    pub season: Option<String>,
}

pub async fn upsert_team(pool: &Arc<PgPool>, t: TeamData) -> Result<()> {
    let mut conn = pool.acquire().await?;
    query(
        "INSERT INTO teams (league, external_id, name, code, logo, country, season)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (league, external_id, season) DO UPDATE SET
            name = EXCLUDED.name, code = EXCLUDED.code, logo = EXCLUDED.logo,
            country = EXCLUDED.country, updated_at = CURRENT_TIMESTAMP"
    )
    .bind(&t.league).bind(t.external_id).bind(&t.name).bind(&t.code)
    .bind(&t.logo).bind(&t.country).bind(&t.season)
    .execute(&mut *conn)
    .await?;
    Ok(())
}
```

- [ ] **Step 3: Add standings poll function in lib.rs**

In `lib.rs`, add a new public function:

```rust
/// Poll standings for all enabled leagues. Runs daily.
pub async fn poll_standings(
    pool: &Arc<PgPool>,
    client: &Client,
    leagues: &[TrackedLeague],
    rate_limiter: &Arc<RateLimiter>,
) {
    info!("Starting standings poll for {} leagues", leagues.len());
    for league in leagues {
        // F1 and MMA don't have traditional standings
        if league.sport_api == "formula-1" || league.sport_api == "mma" {
            continue;
        }
        if !rate_limiter.has_budget(&league.sport_api) {
            warn!("[{}] Skipping standings poll — budget low", league.name);
            continue;
        }

        let format_str = league.season_format.as_deref().unwrap_or("calendar");
        let default_season = compute_current_season(format_str);
        let season = league.season.as_deref().unwrap_or(&default_season).to_string();
        let url = format!(
            "https://{}/standings?league={}&season={}",
            league.api_host, league.league_id, season
        );

        match client.get(&url).send().await {
            Ok(resp) => {
                // Extract rate limit from headers (same pattern as poll_league in lib.rs:322-328)
                if let Some(remaining) = resp.headers()
                    .get("x-ratelimit-requests-remaining")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u32>().ok())
                {
                    rate_limiter.update(&league.sport_api, remaining);
                }
                if !resp.status().is_success() {
                    warn!("[{}] Standings API returned {}", league.name, resp.status());
                    continue;
                }
                match resp.json::<serde_json::Value>().await {
                    Ok(body) => {
                        let response = body.get("response").and_then(|r| r.as_array()).cloned().unwrap_or_default();
                        parse_and_upsert_standings(pool, &league.name, &season, &response).await;
                    }
                    Err(e) => warn!("[{}] Failed to parse standings JSON: {}", league.name, e),
                }
            }
            Err(e) => error!("[{}] Standings request failed: {}", league.name, e),
        }
    }
    info!("Standings poll complete");
}
```

The `parse_and_upsert_standings` function should handle the api-sports.io standings response format. Different sports return standings slightly differently, but the common pattern is:

```rust
async fn parse_and_upsert_standings(
    pool: &Arc<PgPool>,
    league_name: &str,
    season: &str,
    response: &[serde_json::Value],
) {
    for entry in response {
        // Football has nested league.standings arrays
        // Other sports return flat standings arrays
        let standings_arrays = if let Some(league_obj) = entry.get("league") {
            league_obj.get("standings").and_then(|s| s.as_array()).cloned().unwrap_or_default()
        } else {
            vec![entry.clone()]
        };

        for group in &standings_arrays {
            let items = if group.is_array() {
                group.as_array().cloned().unwrap_or_default()
            } else {
                vec![group.clone()]
            };

            for item in &items {
                let team = match item.get("team") {
                    Some(t) => t,
                    None => continue,
                };
                let all = item.get("all").or_else(|| item.get("games"));
                let standing = StandingData {
                    league: league_name.to_string(),
                    team_name: team.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                    team_code: team.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
                    team_logo: team.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
                    rank: item.get("rank").and_then(|r| r.as_i64()).map(|r| r as i32),
                    wins: all.and_then(|a| a.get("win")).and_then(|w| w.as_i64()).unwrap_or(0) as i32,
                    losses: all.and_then(|a| a.get("lose")).and_then(|l| l.as_i64()).unwrap_or(0) as i32,
                    draws: all.and_then(|a| a.get("draw")).and_then(|d| d.as_i64()).unwrap_or(0) as i32,
                    points: item.get("points").and_then(|p| p.as_i64()).map(|p| p as i32),
                    games_played: all.and_then(|a| a.get("played")).and_then(|p| p.as_i64()).unwrap_or(0) as i32,
                    goal_diff: item.get("goalsDiff").and_then(|g| g.as_i64()).map(|g| g as i32),
                    description: item.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()),
                    form: item.get("form").and_then(|f| f.as_str()).map(|s| s.to_string()),
                    group_name: item.get("group").and_then(|g| g.as_str()).map(|s| s.to_string()),
                    season: Some(season.to_string()),
                };
                if let Err(e) = upsert_standing(pool, standing).await {
                    error!("[{}] Failed to upsert standing: {}", league_name, e);
                }
            }
        }
    }
}
```

- [ ] **Step 4: Add teams poll function in lib.rs**

```rust
/// Poll teams for all enabled leagues. Runs weekly.
pub async fn poll_teams(
    pool: &Arc<PgPool>,
    client: &Client,
    leagues: &[TrackedLeague],
    rate_limiter: &Arc<RateLimiter>,
) {
    info!("Starting teams poll for {} leagues", leagues.len());
    for league in leagues {
        if league.sport_api == "formula-1" || league.sport_api == "mma" {
            continue;
        }
        if !rate_limiter.has_budget(&league.sport_api) {
            continue;
        }

        let format_str = league.season_format.as_deref().unwrap_or("calendar");
        let default_season = compute_current_season(format_str);
        let season = league.season.as_deref().unwrap_or(&default_season).to_string();
        let url = format!(
            "https://{}/teams?league={}&season={}",
            league.api_host, league.league_id, season
        );

        match client.get(&url).send().await {
            Ok(resp) => {
                // Extract rate limit from headers (same pattern as poll_league in lib.rs:322-328)
                if let Some(remaining) = resp.headers()
                    .get("x-ratelimit-requests-remaining")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u32>().ok())
                {
                    rate_limiter.update(&league.sport_api, remaining);
                }
                if !resp.status().is_success() {
                    warn!("[{}] Teams API returned {}", league.name, resp.status());
                    continue;
                }
                match resp.json::<serde_json::Value>().await {
                    Ok(body) => {
                        let response = body.get("response").and_then(|r| r.as_array()).cloned().unwrap_or_default();
                        for item in &response {
                            let team = item.get("team").or(Some(item));
                            if let Some(t) = team {
                                let ext_id = t.get("id").and_then(|i| i.as_i64()).unwrap_or(0) as i32;
                                if ext_id == 0 { continue; }
                                let data = TeamData {
                                    league: league.name.clone(),
                                    external_id: ext_id,
                                    name: t.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                                    code: t.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
                                    logo: t.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
                                    country: t.get("country").and_then(|c| c.as_str()).map(|s| s.to_string()),
                                    season: Some(season.clone()),
                                };
                                if let Err(e) = upsert_team(pool, data).await {
                                    error!("[{}] Failed to upsert team: {}", league.name, e);
                                }
                            }
                        }
                    }
                    Err(e) => warn!("[{}] Failed to parse teams JSON: {}", league.name, e),
                }
            }
            Err(e) => error!("[{}] Teams request failed: {}", league.name, e),
        }
    }
    info!("Teams poll complete");
}
```

- [ ] **Step 5: Spawn standings + teams poll loops in main.rs**

In `channels/sports/service/src/main.rs`, after the schedule poll spawn (line 131), add two more poll loops:

**Standings poll** — daily (24 hours = 86400 seconds):
```rust
// ── Daily poll: standings (every 24 hours) ──
let pool_standings = pool.clone();
let client_standings = client.clone();
let leagues_standings = leagues.clone();
let rl_standings = rate_limiter.clone();
let cancel_standings = cancel.clone();
tokio::spawn(async move {
    println!("Starting standings poll loop (daily)...");
    poll_standings(&pool_standings, &client_standings, &leagues_standings, &rl_standings).await;
    loop {
        tokio::select! {
            _ = cancel_standings.cancelled() => break,
            _ = async {
                tokio::time::sleep(std::time::Duration::from_secs(86400)).await;
                poll_standings(&pool_standings, &client_standings, &leagues_standings, &rl_standings).await;
            } => {}
        }
    }
});
```

**Teams poll** — weekly (7 days = 604800 seconds), runs on startup:
```rust
// ── Weekly poll: teams (every 7 days) ──
let pool_teams = pool.clone();
let client_teams = client.clone();
let leagues_teams = leagues.clone();
let rl_teams = rate_limiter.clone();
let cancel_teams = cancel.clone();
tokio::spawn(async move {
    println!("Starting teams poll loop (weekly)...");
    poll_teams(&pool_teams, &client_teams, &leagues_teams, &rl_teams).await;
    loop {
        tokio::select! {
            _ = cancel_teams.cancelled() => break,
            _ = async {
                tokio::time::sleep(std::time::Duration::from_secs(604800)).await;
                poll_teams(&pool_teams, &client_teams, &leagues_teams, &rl_teams).await;
            } => {}
        }
    }
});
```

Update the imports in `main.rs`:
```rust
use sports_service::{
    init_sports_service, poll_live, poll_schedule, poll_standings, poll_teams,
    SportsHealth, RateLimiter,
    log::init_async_logger, database::initialize_pool,
};
```

- [ ] **Step 6: Export new functions from lib.rs**

Ensure `poll_standings` and `poll_teams` are `pub` (they are, per the code above). The `StandingData` and `TeamData` are only used internally by `database.rs`, so they don't need to be re-exported.

- [ ] **Step 7: Verify Rust compiles**

```bash
cd channels/sports/service && cargo check
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(sports): standings + teams polling pipeline (Rust)"
```

---

## Task 5: Standings & Teams — Go API Endpoints

**Files:**
- Modify: `channels/sports/api/models.go`
- Modify: `channels/sports/api/sports.go`
- Modify: `channels/sports/api/main.go`
- Modify: `channels/sports/manifest.json`

- [ ] **Step 1: Add Go structs**

In `models.go`, add:

```go
// Standing represents a league standing entry.
type Standing struct {
	League      string `json:"league"`
	TeamName    string `json:"team_name"`
	TeamCode    string `json:"team_code"`
	TeamLogo    string `json:"team_logo"`
	Rank        int    `json:"rank"`
	Wins        int    `json:"wins"`
	Losses      int    `json:"losses"`
	Draws       int    `json:"draws"`
	Points      int    `json:"points"`
	GamesPlayed int    `json:"games_played"`
	GoalDiff    int    `json:"goal_diff"`
	Description string `json:"description,omitempty"`
	Form        string `json:"form,omitempty"`
	GroupName   string `json:"group_name,omitempty"`
}

// TeamInfo represents a team entry from the teams table.
type TeamInfo struct {
	League     string `json:"league"`
	ExternalID int    `json:"external_id"`
	Name       string `json:"name"`
	Code       string `json:"code"`
	Logo       string `json:"logo"`
	Country    string `json:"country,omitempty"`
}
```

- [ ] **Step 2: Add handler functions in sports.go**

Add constants:
```go
const (
	StandingsCacheTTL = 1 * time.Hour
	TeamsCacheTTL     = 24 * time.Hour
)
```

Add standings handler:
```go
func (a *App) getStandings(c *fiber.Ctx) error {
	league := c.Query("league")
	if league == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "league query parameter is required",
		})
	}

	cacheKey := "cache:sports:standings:" + league
	var standings []Standing
	if GetCache(a.rdb, cacheKey, &standings) {
		return c.JSON(fiber.Map{"standings": standings})
	}

	rows, err := a.db.Query(c.Context(), `
		SELECT league, team_name, COALESCE(team_code, ''), COALESCE(team_logo, ''),
			COALESCE(rank, 0), wins, losses, draws, COALESCE(points, 0),
			games_played, COALESCE(goal_diff, 0),
			COALESCE(description, ''), COALESCE(form, ''), COALESCE(group_name, '')
		FROM standings
		WHERE league = $1
		ORDER BY COALESCE(rank, 9999) ASC`, league)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "failed to query standings",
		})
	}
	defer rows.Close()

	standings = make([]Standing, 0)
	for rows.Next() {
		var s Standing
		if err := rows.Scan(
			&s.League, &s.TeamName, &s.TeamCode, &s.TeamLogo,
			&s.Rank, &s.Wins, &s.Losses, &s.Draws, &s.Points,
			&s.GamesPlayed, &s.GoalDiff, &s.Description, &s.Form, &s.GroupName,
		); err != nil {
			log.Printf("[Sports] Standing row scan failed: %v", err)
			continue
		}
		standings = append(standings, s)
	}

	SetCache(a.rdb, cacheKey, standings, StandingsCacheTTL)
	return c.JSON(fiber.Map{"standings": standings})
}
```

Add teams handler:
```go
func (a *App) getTeams(c *fiber.Ctx) error {
	league := c.Query("league")
	if league == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "league query parameter is required",
		})
	}

	cacheKey := "cache:sports:teams:" + league
	var teams []TeamInfo
	if GetCache(a.rdb, cacheKey, &teams) {
		return c.JSON(fiber.Map{"teams": teams})
	}

	rows, err := a.db.Query(c.Context(), `
		SELECT league, external_id, name, COALESCE(code, ''), COALESCE(logo, ''),
			COALESCE(country, '')
		FROM teams
		WHERE league = $1
		ORDER BY name ASC`, league)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "failed to query teams",
		})
	}
	defer rows.Close()

	teams = make([]TeamInfo, 0)
	for rows.Next() {
		var t TeamInfo
		if err := rows.Scan(&t.League, &t.ExternalID, &t.Name, &t.Code, &t.Logo, &t.Country); err != nil {
			log.Printf("[Sports] Team row scan failed: %v", err)
			continue
		}
		teams = append(teams, t)
	}

	SetCache(a.rdb, cacheKey, teams, TeamsCacheTTL)
	return c.JSON(fiber.Map{"teams": teams})
}
```

- [ ] **Step 3: Register routes**

In `main.go`, add after `fiberApp.Get("/sports/health", ...)` (line 131):
```go
fiberApp.Get("/sports/standings", app.getStandings)
fiberApp.Get("/sports/teams", app.getTeams)
```

In the `registrationPayload` routes array (after line 185):
```go
{Method: "GET", Path: "/sports/standings", Auth: true},
{Method: "GET", Path: "/sports/teams", Auth: true},
```

- [ ] **Step 4: Update manifest.json**

In `channels/sports/manifest.json`, add to routes array:
```json
{ "method": "GET", "path": "/sports/standings", "auth": true },
{ "method": "GET", "path": "/sports/teams", "auth": true }
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sports): standings + teams Go API endpoints + route registration"
```

---

## Task 6: Unified Display Preferences

**Files:**
- Create: `desktop/src/hooks/useSportsConfig.ts`
- Modify: `desktop/src/channels/SportsConfigPanel.tsx`
- Modify: `desktop/src/components/dashboard/dashboardPrefs.ts`

- [ ] **Step 1: Create `useSportsConfig` hook**

Create `desktop/src/hooks/useSportsConfig.ts`:

```ts
/**
 * Atomic config hook for sports channel.
 *
 * Reads the full config, merges changes locally, and writes the complete
 * object to avoid data loss from the partial-write behavior of useChannelConfig.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { channelsApi } from "../api/client";
import { queryKeys } from "../api/queries";
import { useShellData } from "../shell-context";

export interface SportsDisplayPrefs {
  showUpcoming: boolean;
  showFinal: boolean;
  showLogos: boolean;
}

export interface SportsConfig {
  leagues: string[];
  display: SportsDisplayPrefs;
}

const DEFAULT_DISPLAY: SportsDisplayPrefs = {
  showUpcoming: true,
  showFinal: true,
  showLogos: true,
};

export function useSportsConfig() {
  const { channels } = useShellData();
  const queryClient = useQueryClient();

  // Read current config from the channels data (comes via dashboard response)
  const sportsChannel = channels.find((c) => c.channel_type === "sports");
  const raw = (sportsChannel?.config ?? {}) as Record<string, unknown>;

  const config: SportsConfig = useMemo(() => ({
    leagues: Array.isArray(raw.leagues) ? (raw.leagues as string[]) : [],
    display: {
      ...DEFAULT_DISPLAY,
      ...(typeof raw.display === "object" && raw.display !== null ? raw.display as Partial<SportsDisplayPrefs> : {}),
    },
  }), [raw]);

  const mutation = useMutation({
    mutationFn: (next: SportsConfig) =>
      channelsApi.update("sports", { config: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: () => {
      toast.error("Failed to save — try again");
    },
  });

  const setLeagues = useCallback(
    (leagues: string[]) => mutation.mutate({ ...config, leagues }),
    [config, mutation],
  );

  const setDisplay = useCallback(
    (partial: Partial<SportsDisplayPrefs>) =>
      mutation.mutate({ ...config, display: { ...config.display, ...partial } }),
    [config, mutation],
  );

  return {
    config,
    leagues: config.leagues,
    display: config.display,
    setLeagues,
    setDisplay,
    saving: mutation.isPending,
  };
}
```

- [ ] **Step 2: Update SportsConfigPanel to use new hook + add toggles**

Rewrite `desktop/src/channels/SportsConfigPanel.tsx` to:
1. Replace `useChannelConfig<string[]>("sports", "leagues")` with `useSportsConfig()`
2. Keep the `SetupBrowser` for league selection
3. Add a "Display" section below with 3 toggle switches

The toggle section should look like:

```tsx
{/* Display preferences */}
<div className="mt-6 border-t border-edge pt-4">
  <h3 className="text-[11px] font-bold uppercase tracking-wider text-fg-3 mb-3">
    Display
  </h3>
  <div className="space-y-2">
    {[
      { key: "showUpcoming" as const, label: "Show upcoming games" },
      { key: "showFinal" as const, label: "Show final scores" },
      { key: "showLogos" as const, label: "Show team logos" },
    ].map(({ key, label }) => (
      <label key={key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-hover/50 cursor-pointer">
        <span className="text-xs text-fg-2">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={display[key]}
          onClick={() => setDisplay({ [key]: !display[key] })}
          className={clsx(
            "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
            display[key] ? "bg-primary" : "bg-edge-2",
          )}
        >
          <span
            className={clsx(
              "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5",
              display[key] ? "translate-x-4 ml-0.5" : "translate-x-0 ml-0.5",
            )}
          />
        </button>
      </label>
    ))}
  </div>
</div>
```

The `updateItems` callback for `SetupBrowser` should use `setLeagues` from `useSportsConfig()`.

- [ ] **Step 3: Remove `SportsCardPrefs` and `SPORTS_SCHEMA`**

In `desktop/src/components/dashboard/dashboardPrefs.ts`:
- Delete the `SportsCardPrefs` interface (lines 21-28)
- Delete the `SPORTS_SCHEMA` array (lines 211-218)
- Remove `SportsCardPrefs` from the `DEFAULTS` object and `DashboardPrefs` type
- Remove the `sports` key from `useDashboardPrefs` if it exists

**Note:** Be careful — other channels (finance, RSS) also have schemas in this file. Only remove the sports-specific entries.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd desktop && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sports): unified display preferences via useSportsConfig"
```

---

## Task 7: Feed Page Redesign (Tabs)

**Files:**
- Create: `desktop/src/channels/sports/ScoresTab.tsx`
- Create: `desktop/src/channels/sports/ScheduleTab.tsx`
- Create: `desktop/src/channels/sports/StandingsTab.tsx`
- Modify: `desktop/src/channels/sports/FeedTab.tsx`
- Modify: `desktop/src/api/queries.ts`

- [ ] **Step 1: Add query options for standings**

In `desktop/src/api/queries.ts`, add:

```ts
// ── Sports Standings ─────────────────────────────────────────────

export const queryKeys = {
  // ... existing keys ...
  standings: (league: string) => ["standings", league] as const,
};

export function standingsOptions(league: string) {
  return queryOptions({
    queryKey: queryKeys.standings(league),
    queryFn: () => request<{ standings: Standing[] }>(`/sports/standings?league=${encodeURIComponent(league)}`),
    staleTime: 60 * 60 * 1000, // 1 hour
    enabled: !!league,
  });
}

export interface Standing {
  league: string;
  team_name: string;
  team_code: string;
  team_logo: string;
  rank: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  games_played: number;
  goal_diff: number;
  description?: string;
  form?: string;
  group_name?: string;
}
```

- [ ] **Step 2: Create ScoresTab (refactored from FeedTab game rendering)**

Extract the current game rendering logic from `FeedTab.tsx` into `ScoresTab.tsx`. This component receives the `games` array, `mode`, and display prefs, and renders the existing league-grouped game grid. It filters by `showUpcoming`/`showFinal` prefs.

- [ ] **Step 3: Create ScheduleTab**

`ScheduleTab.tsx` — filters games to `state === "pre"`, groups by date (Today, Tomorrow, date string), renders each as a row with team codes, logos, start time, and venue.

- [ ] **Step 4: Create StandingsTab**

`StandingsTab.tsx` — league selector dropdown (from user's subscribed leagues), fetches standings via `useQuery(standingsOptions(selectedLeague))`, renders a table with Rank | Logo | Team | W | L | D | Pts | GD | GP.

- [ ] **Step 5: Convert FeedTab to tab container**

Replace the current FeedTab body with a 3-tab layout:

```tsx
const [tab, setTab] = useState<"scores" | "schedule" | "standings">("scores");
```

Tab bar:
```tsx
<div className="flex border-b border-edge bg-surface">
  {(["scores", "schedule", "standings"] as const).map((t) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={clsx(
        "flex-1 px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors",
        tab === t ? "text-fg border-b-2 border-primary" : "text-fg-3 hover:text-fg-2",
      )}
    >
      {t === "scores" ? "Scores" : t === "schedule" ? "Schedule" : "Standings"}
    </button>
  ))}
</div>
```

Content area switches between ScoresTab, ScheduleTab, StandingsTab based on the active tab.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd desktop && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(sports): tabbed feed page with Scores, Schedule, Standings"
```

---

## Task 8: Dashboard + Ticker Prefs Integration

**Files:**
- Modify: `desktop/src/components/dashboard/SportsSummary.tsx`
- Modify: `desktop/src/components/chips/GameChip.tsx`
- Modify: `desktop/src/components/ScrollrTicker.tsx` (if needed for pref propagation)

- [ ] **Step 1: Update SportsSummary to read unified prefs**

In `SportsSummary.tsx`:
- Remove import/usage of `SportsCardPrefs` / `useDashboardPrefs` for sports
- Instead, read the sports channel config from the channels data (via `useShellData()` or props)
- Extract `display.showUpcoming`, `display.showFinal`, `display.showLogos` from the config
- Replace `prefs.upcoming`/`prefs.final`/`prefs.showLogos` references with the unified values
- Remove `prefs.showTimer` checks — timer is always shown
- Remove `prefs.compact` checks — compact overflow is always shown
- Remove `prefs.stats` — stats footer is removed
- Filter games using the unified prefs before grouping

- [ ] **Step 2: Update GameChip to respect showLogos**

In `GameChip.tsx`:
- Accept `showLogos?: boolean` prop (default `true`)
- When `showLogos` is `false`, skip rendering `TeamLogo` components
- The prop is passed from `ScrollrTicker.tsx` which reads the sports channel config

- [ ] **Step 3: Update ScrollrTicker to pass prefs to GameChip**

In `ScrollrTicker.tsx` (where `GameChip` instances are rendered for sports games):
- Read sports channel config from the dashboard data
- Extract `display` prefs
- Pass `showLogos={sportsDisplay.showLogos}` to each `<GameChip>`
- Filter sports games by `showUpcoming`/`showFinal` before rendering

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd desktop && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sports): dashboard + ticker respect unified display prefs"
```

---

## Dependency Graph

```
Task 1 (cleanup)         ─┐
Task 2 (Rust codes)      ─┤─→ Task 3 (Go + Desktop codes) ─┐
Task 4 (Rust standings)  ─┤─→ Task 5 (Go standings)        ─┤─→ Task 7 (Feed tabs)
                          │                                  │
Task 6 (unified prefs)   ─┼──────────────────────────────────┤─→ Task 8 (Dashboard + Ticker)
                          │
                          └──── Tasks 1-6 are parallelizable in pairs:
                                (1, 2) then (3, 4) then (5, 6) then (7, 8)
```

**Recommended execution order:**
1. Task 1 (cleanup — no deps)
2. Task 2 (Rust codes — no deps)
3. Task 3 (Go + Desktop codes — depends on Task 2)
4. Task 4 (Rust standings — depends on Task 2 for pattern)
5. Task 5 (Go standings — depends on Task 4)
6. Task 6 (unified prefs — depends on Task 1)
7. Task 7 (feed tabs — depends on Tasks 3, 5, 6)
8. Task 8 (dashboard + ticker — depends on Tasks 3, 6)
