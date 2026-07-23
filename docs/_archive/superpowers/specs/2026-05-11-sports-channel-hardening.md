# Sports Channel Hardening

**Date:** 2026-05-11
**Status:** Spec — approved scope, awaiting user review before implementation plan
**Scope:** Bug fixes + structural hardening (no architectural rewrite)

## Problem

The sports tab has been a recurring source of user complaints. The most recent: Premier League games are not visible in the home feed despite fixtures being scheduled. Investigation revealed several compounding issues, some real bugs and some UX gaps that make the channel *look* broken even when it is working correctly.

### Confirmed issues

1. **12-hour future cutoff drops valid fixtures.** `channels/sports/service/src/lib.rs:270-275` filters tomorrow's fixtures to those starting within 12h of `now()` (UTC). Premier League afternoon kickoffs polled the prior evening fall outside this window and are silently dropped from the upsert. They only appear in the DB once the schedule poll runs on the day-of, sometimes only a few hours before kickoff.
2. **Pre-game cleanup deletes games 12h past start.** `channels/sports/service/src/database.rs:335-345` deletes any `pre`-state row whose `start_time < NOW() - INTERVAL '12 hours'`. If a poll fails to flip the state to `in` or `final` (rate-limit miss, API error), the game vanishes entirely.
3. **Shared rate budget across four soccer leagues.** All `football` host leagues (Premier League, La Liga, MLS, Champions League) share a single 7,500/day api-sports.io budget. On Champions League knockout nights, Premier League polls can be starved.
4. **`SCHEDULE_DAYS_AHEAD = 1`.** Users never see a fixture more than ~36 hours away. There is no concept of a "week ahead" view.
5. **Off-season is detected but not surfaced on the feed.** `is_offseason` is computed in `channels/sports/api/sports.go:111-133` and displayed in the catalog (`desktop/src/channels/sports/LeagueManager.tsx:493`), but the home feed shows a generic empty state with no context. NFL in May looks identical to "broken Premier League integration."
6. **No polling-health observability.** There is no way to detect that a league has stopped polling until users complain. Past silent failures have lasted days (referenced in PR #106).
7. **Two `leagues.json` files exist.** `channels/sports/configs/leagues.json` (11 leagues, no `offseason_months`) is stale and never loaded. `channels/sports/service/configs/leagues.json` (21 leagues) is the canonical config. The duplicate misleads future contributors.
8. **Frontend state-name mismatch.** `desktop/src/routes/feed.tsx:712` uses `post` in its priority map, but the API contract returns `final`. Cosmetic but indicative of an incomplete migration.

## Goals

- A user looking at the feed Friday evening sees Saturday's Premier League fixtures.
- A user with NFL-only configuration in May sees "Off-season — returns August" instead of "Empty."
- Champions League cannot starve Premier League polls.
- A polling outage of >90 min surfaces visibly to the user.
- Pre-game rows survive isolated polling failures.
- Code references one canonical `leagues.json`.
- Frontend state names match the API contract.

## Non-goals

- Re-architecting the polling loop. The current four-loop model (live / schedule / standings / teams) is sound.
- Replacing api-sports.io as the data provider.
- Building a persistent retry queue.
- Adding per-fixture state machines or tiered cadences.
- Redesigning the sports tab UI beyond the empty-state component.

## Approach

A single PR / single deploy. Surgical changes targeting each failure mode independently.

### File-level overview

| File | Change |
|---|---|
| `channels/sports/service/src/lib.rs` | Remove 12h cutoff, widen `SCHEDULE_DAYS_AHEAD`, integrate per-league rate budget, write polling-health on each poll |
| `channels/sports/service/src/database.rs` | Split cleanup query into per-state clauses; add helpers for polling-health updates |
| `channels/sports/service/src/main.rs` | Schedule daily UTC reset task for per-league rate budget |
| `channels/sports/service/migrations/120000000007_polling_health.up.sql` (new) | Add `last_polled_at`, `last_poll_success_at`, `last_poll_error` to `tracked_leagues` |
| `channels/sports/service/migrations/120000000007_polling_health.down.sql` (new) | Drop the three columns |
| `channels/sports/service/tests/rate_limiter.rs` (new) | Unit tests for per-league budget allocation and stealing |
| `channels/sports/service/tests/cleanup.rs` (new) | Unit tests for cleanup query |
| `channels/sports/api/sports.go` | Expose polling-health on `/sports/leagues`; add `meta` to dashboard and public responses; consolidate `next_game` computation |
| `channels/sports/api/models.go` | Add `LastPolledAt`, `LastPollSuccessAt`, `PollingHealthy` to `TrackedLeague`; new `LeagueMeta` and `SportsResponse` types |
| `channels/sports/api/sports_test.go` | Add tests for `loadLeagueStatus` helper |
| `desktop/src/api/queries.ts` | Add `LeagueMeta` type, extend dashboard data shape |
| `desktop/src/routes/feed.tsx` | Replace `EmptyDataRow` with `SportsEmptyState`; fix `final`/`post` priority map |
| `desktop/src/channels/sports/EmptyState.tsx` (new) | Off-season + next-game + stale-polling banner |
| `desktop/src/channels/sports/format.ts` (new) | Extracted `formatCountdown` shared between catalog and feed |
| `desktop/src/channels/sports/LeagueManager.tsx` | Add "Stale" warning chip when `polling_healthy: false`; consume extracted `formatCountdown` |
| `channels/sports/configs/leagues.json` | **DELETE** — stale duplicate |

## Detailed design

### Polling fixes (Rust ingestion service)

**Remove the 12-hour future cutoff.** Drop `lib.rs:270-275`. The `cutoff` variable at `lib.rs:232` becomes unused — remove. The schedule loop's inner block becomes:

```rust
match poll_league(client, league, date, rate_limiter).await {
    Ok(games) => {
        let (upserted, failed, _) = upsert_games(pool, league, games).await;
        total_upserted += upserted;
        total_failed += failed;
        record_poll_success(pool, &league.name).await;
    }
    Err(e) => {
        error!("[{}] Schedule poll error for {}: {}", league.name, date, e);
        record_poll_error(pool, &league.name, &e.to_string()).await;
    }
}
```

**Widen schedule horizon to 7 days.** `lib.rs:24`: `const SCHEDULE_DAYS_AHEAD: i64 = 7;`. Rate-budget impact: ~1,536 schedule calls/day on the football host (worst case, 4 in-season leagues × 8 dates × 48 polls/day), well under the 7,500/day quota.

**Per-league fair-share rate budget.** Replace the host-level `RateLimiter` with a structure that gives each in-season league a reserved share and a shared pool for borrowing:

```rust
pub struct LeagueBudget {
    reserved: AtomicU32,
    shared_pool: Arc<AtomicU32>,
    last_reset: Mutex<DateTime<Utc>>,
}

impl LeagueBudget {
    pub fn try_consume(&self, league_name: &str) -> bool { ... }
    pub fn update_from_response(&self, host_remaining: u32) { ... }
    pub fn reset_daily(&self, leagues: &[TrackedLeague]) { ... }
}
```

The `RateLimiter` becomes `HashMap<host, HashMap<league_name, LeagueBudget>>`. Consumption order: reserved → shared pool → skip. In-season is determined by `current_month NOT IN offseason_months`. Off-season leagues contribute their share entirely to the shared pool.

A new tokio task in `main.rs` runs daily at UTC 00:00 to call `reset_daily` on each host's limiter.

**Cleanup query split by state.** `database.rs:335-345` becomes:

```sql
DELETE FROM games WHERE
    (state IN ('final', 'postponed') AND start_time < NOW() - INTERVAL '12 hours')
    OR (state = 'pre' AND start_time < NOW() - INTERVAL '7 days')
    OR (state = 'in' AND updated_at < NOW() - INTERVAL '24 hours')
```

`pre`-state rows survive a full week past kickoff, eliminating the "vanished game after one missed poll" failure mode.

**Polling-health columns.** Migration `120000000007_polling_health.up.sql`:

```sql
ALTER TABLE tracked_leagues ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ;
ALTER TABLE tracked_leagues ADD COLUMN IF NOT EXISTS last_poll_error TEXT;
ALTER TABLE tracked_leagues ADD COLUMN IF NOT EXISTS last_poll_success_at TIMESTAMPTZ;
```

Down-migration drops them. Within the service, every `poll_league` call writes outcome via `record_poll_success` (sets `last_polled_at` + `last_poll_success_at`, clears `last_poll_error`) or `record_poll_error` (sets `last_polled_at` + `last_poll_error`, leaves `last_poll_success_at` untouched). The split between "tried" and "succeeded" is intentional: a league polled recently but never successful is silently broken.

### Go API surface

**Catalog endpoint** (`GET /sports/leagues`) gains three fields per league: `last_polled_at`, `last_poll_success_at`, `polling_healthy`. `polling_healthy` is computed server-side as `last_poll_success_at != nil && time.Since(*last_poll_success_at) < 90 * time.Minute` (threshold = 3× expected cadence of 30 min). Never-polled leagues return `polling_healthy: false`.

**Dashboard endpoint** (`GET /internal/dashboard?user=X`) and public endpoints (`GET /sports`, `GET /sports/public`) change response shape from `{sports: Game[]}` to `{sports: Game[], meta: {leagues: LeagueMeta[]}}`. `meta.leagues` contains one entry per user-selected league (or per in-season league for the public variant):

```go
type LeagueMeta struct {
    Name           string     `json:"name"`
    IsOffseason    bool       `json:"is_offseason"`
    NextGame       *time.Time `json:"next_game"`
    PollingHealthy bool       `json:"polling_healthy"`
}
```

A new helper `(a *App).loadLeagueStatus(ctx, names []string) (map[string]leagueStatus, error)` runs one batched SQL query and is shared between the catalog and dashboard paths, replacing the current duplicated logic in `getLeagueCatalog`.

**Cache change.** The per-user cache key (`cache:sports:<sub>`, 10s TTL) now stores `{sports, meta}` instead of `[]Game`. CDC bust logic is unchanged.

**Backwards compatibility.** The dashboard envelope gains `sports_meta` as a sibling key (not nested). Old desktop clients reading `data.sports` continue to work; they simply ignore `data.sports_meta` and fall back to the existing empty-state. This is graceful degradation, not a hard break.

### Desktop UI

**New `SportsEmptyState` component** (`desktop/src/channels/sports/EmptyState.tsx`) replaces the generic `EmptyDataRow` on the sports row of the home feed. Decision tree (top wins, evaluated in order):

| # | Condition | Render |
|---|---|---|
| 1 | `leagues.length === 0` | "Pick leagues to follow" + Configure CTA |
| 2 | Any `polling_healthy === false` | Warning row with amber accent: "Live data unavailable: {comma-separated unhealthy league names}" |
| 3 | All leagues `is_offseason === true` | "Off-season — {league} returns in {countdown}" where the chosen league is the one with the earliest non-null `next_game`, or the first league alphabetically if all `next_game` are null |
| 4 | Any league has `next_game !== null` | "Next: {league} • in {countdown}" picking the league with the soonest `next_game` |
| 5 | Otherwise (in-season but no fixtures and no `next_game`) | "No games scheduled — check back later" |

Tie-breakers across all branches:
- Equal `next_game` timestamps: tie-break alphabetically by league name (deterministic across renders).
- Unhealthy league names in branch 2: sorted alphabetically, truncated to first 3 with "+N more" suffix if longer.

Tooltip text for the "Stale" catalog chip (branch in `LeagueStatus`): `"Last successful update: {last_poll_success_at as locale-formatted string}"` if non-null, else `"This league has not polled successfully yet"`.

`formatCountdown` is extracted from `LeagueManager.tsx:496-503` to a new `desktop/src/channels/sports/format.ts` module, consumed by both the catalog and the empty-state. Its signature: `formatCountdown(iso: string): string` returning e.g. `"2h 15m"`, `"3 days"`, `"12 weeks"` depending on magnitude.

**Polling-health indicator in catalog.** `LeagueStatus` in `LeagueManager.tsx:474-506` gains a top-priority branch: if `!league.polling_healthy`, render a warning chip with the `last_poll_success_at` timestamp in a tooltip.

**Final/post priority cleanup.** `feed.tsx:712-717`:

```tsx
const priority: Record<string, number> = { in: 0, pre: 1, final: 2, postponed: 3 };
const sorted = [...filtered].sort(
  (a, b) => (priority[a.state ?? ""] ?? 4) - (priority[b.state ?? ""] ?? 4),
);
```

Matches the API contract from `map_status_to_state` in `lib.rs:1157-1169`.

**Dashboard data shape.** `desktop/src/api/queries.ts`:

```ts
type DashboardData = {
  sports?: Game[];
  sports_meta?: { leagues: LeagueMeta[] };
  finance?: Ticker[];
  rss?: RssItem[];
  fantasy?: FantasyMatchup[];
};
```

## Testing strategy

### Unit tests (new)

- `channels/sports/service/tests/rate_limiter.rs`: simulate 4 in-season football leagues, exhaust Champions League reserved budget, assert Premier League can still consume; assert daily reset redistributes correctly between in-season and off-season leagues.
- `channels/sports/service/tests/cleanup.rs`: seed games at various ages and states, run `cleanup_old_games`, assert correct rows deleted (pre <7d stays, pre >7d deleted, final >12h deleted, in >24h deleted, in <24h stays).
- `channels/sports/api/sports_test.go`: mock DB, assert `loadLeagueStatus` returns expected map for both catalog and dashboard paths; assert `polling_healthy` boundary cases (null timestamp, 89-min-old timestamp, 91-min-old timestamp).

### Integration smoke (manual, pre-merge)

Six scenarios against a dev environment running core + sports API + Rust service + desktop:

1. NFL-only user in May → empty-state shows "Off-season — NFL returns in N days."
2. Premier League user with upcoming game → next-game countdown shows.
3. Premier League + NFL mixed → games render; NFL doesn't appear in empty-state branch.
4. User with no leagues selected → "Pick leagues to follow" + Configure CTA.
5. Stop Rust service for 2h, reload catalog → Premier League shows "Stale" chip; feed empty-state shows "Live data unavailable."
6. Manually insert a `games` row → dashboard query reflects it within 10s (verifies CDC bust still works after `meta` shape change).

### Migration verification

- Fresh DB: migration creates columns, service boots clean.
- Existing DB with data: migration adds columns (idempotent via `IF NOT EXISTS`), existing rows get `NULL` values for the three new columns, service treats them as `polling_healthy: false` until the first successful poll.

## Rollout

Single PR, single coordinated deploy.

- **Backend** (Rust service + Go API) ships together to Coolify in one PR. The new DB columns are nullable; the Go API tolerates nulls. The Rust service applies the migration on boot via `sqlx::migrate`.
- **Desktop** ships in the same PR but reaches users only when they update their installed binary (Tauri auto-updater). Users on older desktop binaries continue to function: they read `data.sports` (unchanged) and ignore `data.sports_meta` (new). They see the old generic empty state — graceful degradation, not a hard break.
- **Note:** The "single PR" choice means we will land Rust + Go + desktop code in one merge. The backend will deploy immediately; the desktop UX improvements roll out to each user as they update. This is intentional and aligned with the user's "single PR, single deploy" preference.

### Rollback

- Migration failure: sqlx refuses to start the service, Coolify keeps the old pod live. Roll back the PR. The up-migration is idempotent (`IF NOT EXISTS`) and adds nullable columns, so leaving the columns in place after a rollback is harmless.
- Rust service crashes post-migration: same — old pod stays serving. Roll back PR.
- Go API breaks: response shape change is the highest-risk surface. Old desktop clients use `data.sports` only and don't read `data.sports_meta`, so they degrade gracefully. New desktop clients use `meta?.leagues ?? []` everywhere, so missing/malformed meta degrades to the old empty-state path.
- Desktop empty-state component throws: React error boundary on the route catches it; feed still renders games. Ship a desktop patch.

## Residual risks (out of scope)

- **api-sports.io upstream outages.** Polling-health indicator will correctly show "Stale" but there is no offline cache or fallback provider.
- **api-sports.io schema drift.** Parsing failures captured in `last_poll_error`. Detection but not auto-recovery.
- **Wrong `offseason_months` in `leagues.json`.** Editable but requires human awareness when a league's calendar shifts.
- **DST and timezone edges.** All polling in UTC, display in local time via `toLocaleString()`. Existing behavior, not new.
- **Multiple ingestion service replicas racing on `last_polled_at`.** Last-writer-wins is tolerable; the field is advisory.

## Definition of done

- Premier League games appear in the DB up to 7 days ahead.
- A user looking at the feed Friday evening sees Saturday's Premier League fixtures.
- NFL/NCAAF/etc. in offseason show "Off-season — returns August" instead of "Empty."
- Champions League cannot starve Premier League polls.
- A polling outage of >90 min shows a "Stale" chip in the catalog and "Live data unavailable" in the feed empty-state.
- Pre-game rows survive isolated polling failures (deletion threshold 7d, not 12h).
- Code references one canonical `leagues.json`.
- Frontend `state` priority map matches the API contract (`in`, `pre`, `final`, `postponed`).
- All new unit tests pass.
- All six smoke-test scenarios pass against dev environment.
