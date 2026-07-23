# Sports Channel Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix recurring sports-tab bugs (Premier League fixtures disappearing, leagues looking broken in off-season, polling outages going undetected) with surgical changes — no architectural rewrite.

**Architecture:** Keep the existing four-loop Rust ingestion model. Remove the 12h future cutoff that drops valid fixtures, widen the schedule horizon to 7 days, split the rate budget per-league within shared hosts, lengthen the pre-game cleanup threshold so missed polls don't vanish games, add polling-health columns, and surface off-season + next-game + stale-data states to the desktop empty-state component.

**Tech Stack:** Rust (tokio, sqlx, axum, reqwest), Go (Fiber, pgx, go-redis), TypeScript (React 19, TanStack Query, Vite, Tailwind v4), Postgres, Redis.

**Spec:** `docs/superpowers/specs/2026-05-11-sports-channel-hardening.md`

---

## Task index

1. Delete the stale `channels/sports/configs/leagues.json` duplicate.
2. Add migration `120000000007_polling_health` with new `tracked_leagues` columns.
3. Add `record_poll_success` / `record_poll_error` helpers in `database.rs`.
4. Lengthen `cleanup_old_games` to per-state thresholds (12h final, 7d pre, 24h in).
5. Add `LeagueBudget` and the per-league `RateLimiter` to `types.rs`; rewire callers.
6. Add daily UTC midnight reset task in `main.rs`.
7. Remove the 12h future cutoff and widen `SCHEDULE_DAYS_AHEAD` to 7 in `lib.rs`.
8. Wire `record_poll_success` / `record_poll_error` into `poll_league` callers.
9. Extend `TrackedLeague` model in Go API + read polling-health columns.
10. Add `LeagueMeta` model + `loadLeagueStatus` helper; refactor `getLeagueCatalog`.
11. Reshape public + dashboard responses to `{sports, meta}`.
12. Update desktop `TrackedLeague` type + add `LeagueMeta` + `SportsMeta` to types.
13. Build `SportsEmptyState` component.
14. Wire `SportsEmptyState` into `feed.tsx` and fix the `final`/`post` priority map.
15. Add "Stale" warning chip to catalog `LeagueStatus`.
16. Manual smoke-test pass against dev environment.

Tasks 1-8 are backend-only (Rust + Go). Tasks 9-11 are Go API. Tasks 12-15 are desktop. Task 16 is verification.

---

## Task 1: Delete the stale leagues.json duplicate

**Files:**
- Delete: `channels/sports/configs/leagues.json`

This file is misleading — only `channels/sports/service/configs/leagues.json` is actually loaded by the Rust service (`lib.rs:84` uses `./configs/leagues.json` relative to the service binary's working directory).

- [ ] **Step 1: Verify no code references the file path**

Run:
```bash
rg -l "channels/sports/configs/leagues" --type-not md
```
Expected: zero matches (the only reference is in `docs/`, fine).

- [ ] **Step 2: Delete the file**

```bash
rm channels/sports/configs/leagues.json
```

- [ ] **Step 3: Commit**

```bash
git add -A channels/sports/configs/leagues.json
git commit -m "chore(sports): remove stale duplicate leagues.json

The Rust ingestion service loads channels/sports/service/configs/leagues.json
(its working-directory-relative ./configs/leagues.json). The top-level
channels/sports/configs/leagues.json was never read and was missing
offseason_months data — purely a foot-gun for future contributors."
```

---

## Task 2: Migration — polling-health columns

**Files:**
- Create: `channels/sports/service/migrations/120000000007_polling_health.up.sql`
- Create: `channels/sports/service/migrations/120000000007_polling_health.down.sql`

- [ ] **Step 1: Write the up migration**

Create `channels/sports/service/migrations/120000000007_polling_health.up.sql`:

```sql
-- Polling-health columns for per-league observability.
-- last_polled_at:        timestamp of the most recent poll attempt (success or failure)
-- last_poll_success_at:  timestamp of the most recent successful poll (response parsed OK)
-- last_poll_error:       error message from the most recent failed poll (NULL on success)
--
-- The split between last_polled_at and last_poll_success_at is intentional:
-- a league with last_polled_at = NOW() but last_poll_success_at = 6h ago is
-- silently broken. The Go API exposes a derived polling_healthy bool based
-- on the gap between last_poll_success_at and NOW().

ALTER TABLE tracked_leagues ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ;
ALTER TABLE tracked_leagues ADD COLUMN IF NOT EXISTS last_poll_success_at TIMESTAMPTZ;
ALTER TABLE tracked_leagues ADD COLUMN IF NOT EXISTS last_poll_error TEXT;
```

- [ ] **Step 2: Write the down migration**

Create `channels/sports/service/migrations/120000000007_polling_health.down.sql`:

```sql
ALTER TABLE tracked_leagues DROP COLUMN IF EXISTS last_polled_at;
ALTER TABLE tracked_leagues DROP COLUMN IF EXISTS last_poll_success_at;
ALTER TABLE tracked_leagues DROP COLUMN IF EXISTS last_poll_error;
```

- [ ] **Step 3: Verify migration version invariant passes**

The `tests/migration_versions.rs` test enforces that on-disk versions are within the sports range (`120_000_000_000..=129_999_999_999`). Version 120000000007 = 120_000_000_007 — inside the range.

Run:
```bash
cargo test --manifest-path channels/sports/service/Cargo.toml --test migration_versions
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add channels/sports/service/migrations/120000000007_polling_health.up.sql channels/sports/service/migrations/120000000007_polling_health.down.sql
git commit -m "feat(sports): add polling-health columns migration

Adds last_polled_at, last_poll_success_at, last_poll_error to
tracked_leagues. The split between last_polled_at and last_poll_success_at
lets us distinguish 'we tried' from 'we succeeded' — a league polled
recently but never successful is silently broken, and we want to see that."
```

---

## Task 3: Add `record_poll_success` and `record_poll_error` helpers

**Files:**
- Modify: `channels/sports/service/src/database.rs:296` (after `disable_stale_leagues`)

- [ ] **Step 1: Add the two helpers to database.rs**

Insert immediately after the `disable_stale_leagues` function (around line 296), before the `get_live_yesterday_leagues` function:

```rust
/// Record a successful poll. Updates `last_polled_at` and `last_poll_success_at`
/// to NOW(), and clears any previous error.
///
/// Errors are logged but not returned — polling-health bookkeeping must
/// never block the actual data ingestion. If the bookkeeping update fails,
/// the league will appear stale to the API; on the next successful poll
/// it will recover.
pub async fn record_poll_success(pool: &Arc<PgPool>, league_name: &str) {
    let res = async {
        let mut conn = pool.acquire().await?;
        query(
            "UPDATE tracked_leagues
             SET last_polled_at = NOW(),
                 last_poll_success_at = NOW(),
                 last_poll_error = NULL
             WHERE name = $1"
        )
        .bind(league_name)
        .execute(&mut *conn)
        .await?;
        Ok::<_, sqlx::Error>(())
    }.await;
    if let Err(e) = res {
        log::warn!("Failed to record poll success for {}: {}", league_name, e);
    }
}

/// Record a failed poll. Updates `last_polled_at` and `last_poll_error`,
/// but does NOT touch `last_poll_success_at` — that timestamp must only
/// move forward on actual successes so staleness detection works.
pub async fn record_poll_error(pool: &Arc<PgPool>, league_name: &str, err_msg: &str) {
    // Truncate excessively long error messages to keep the row small.
    // 1 KiB is plenty to see what went wrong; anything longer is noise.
    let truncated: &str = if err_msg.len() > 1024 { &err_msg[..1024] } else { err_msg };

    let res = async {
        let mut conn = pool.acquire().await?;
        query(
            "UPDATE tracked_leagues
             SET last_polled_at = NOW(),
                 last_poll_error = $2
             WHERE name = $1"
        )
        .bind(league_name)
        .bind(truncated)
        .execute(&mut *conn)
        .await?;
        Ok::<_, sqlx::Error>(())
    }.await;
    if let Err(e) = res {
        log::warn!("Failed to record poll error for {}: {}", league_name, e);
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cargo check --manifest-path channels/sports/service/Cargo.toml
```
Expected: 0 errors. Warnings about unused functions are OK at this point (they get called in Task 8).

- [ ] **Step 3: Commit**

```bash
git add channels/sports/service/src/database.rs
git commit -m "feat(sports): add record_poll_success/record_poll_error helpers

Per-league bookkeeping for polling-health columns. Errors are
truncated to 1 KiB and logged-but-not-propagated so a Postgres
hiccup never blocks data ingestion."
```

---

## Task 4: Lengthen `cleanup_old_games` to per-state thresholds

**Files:**
- Modify: `channels/sports/service/src/database.rs:335-345`
- Create: `channels/sports/service/tests/cleanup.rs` (new test file)

The current single-clause query deletes any `pre`-state row whose `start_time < NOW() - INTERVAL '12 hours'`. If a poll fails to flip the state to `in` or `final` (rate-limit miss, API error), the row vanishes. Split into three clauses with longer pre-game threshold.

- [ ] **Step 1: Write a failing test for the new cleanup behavior**

Create `channels/sports/service/tests/cleanup.rs`:

```rust
//! Cleanup behavior — verifies `cleanup_old_games` deletes only the
//! rows we expect at the right thresholds (12h finished, 7d pre, 24h live).
//!
//! Skips when DATABASE_URL is not set so unit-test runs in CI without
//! a Postgres backend don't fail.

#![cfg(test)]

use std::sync::Arc;
use chrono::Utc;
use sports_service::database::{cleanup_old_games, initialize_pool};
use sqlx::query;

async fn skip_unless_db() -> Option<Arc<sqlx::PgPool>> {
    if std::env::var("DATABASE_URL").is_err() && std::env::var("DB_HOST").is_err() {
        eprintln!("Skipping cleanup test: no DATABASE_URL / DB_HOST set");
        return None;
    }
    match initialize_pool().await {
        Ok(p) => Some(Arc::new(p)),
        Err(e) => {
            eprintln!("Skipping cleanup test: could not connect: {e:#}");
            None
        }
    }
}

#[tokio::test]
async fn test_cleanup_per_state_thresholds() {
    let Some(pool) = skip_unless_db().await else { return };

    // Ensure the tracked_leagues row exists for the dummy league
    query("INSERT INTO tracked_leagues (name, sport_api, api_host, league_id, category)
           VALUES ('__cleanup_test__', 'football', 'localhost', 0, 'Test')
           ON CONFLICT (name) DO NOTHING")
        .execute(&*pool).await.unwrap();

    // Wipe any leftover rows from previous runs
    query("DELETE FROM games WHERE league = '__cleanup_test__'")
        .execute(&*pool).await.unwrap();

    let now = Utc::now();
    let h = chrono::Duration::hours;
    let d = chrono::Duration::days;

    // Seed: id, state, start_time offset, updated_at offset, should_survive
    let cases: &[(&str, &str, chrono::Duration, chrono::Duration, bool)] = &[
        ("alive_pre_recent",   "pre",   h(-1),  h(-1),  true),   // started 1h ago, well within 7d
        ("alive_pre_3d",       "pre",   d(-3),  d(-3),  true),   // 3 days old, still within 7d
        ("dead_pre_8d",        "pre",   d(-8),  d(-8),  false),  // 8 days past kickoff
        ("alive_final_6h",     "final", h(-6),  h(-6),  true),   // <12h post final
        ("dead_final_13h",     "final", h(-13), h(-13), false),  // 13h post final
        ("dead_postponed_13h", "postponed", h(-13), h(-13), false),
        ("alive_in_recent",    "in",    h(-1),  h(-1),  true),   // live, recently seen
        ("alive_in_20h",       "in",    h(-22), h(-20), true),   // live, seen 20h ago
        ("dead_in_25h",        "in",    h(-30), h(-25), false),  // live, stale 25h
    ];

    for (id, state, start_off, upd_off, _survives) in cases {
        query(
            "INSERT INTO games (league, sport, external_game_id, home_team_name, away_team_name,
                                start_time, state, updated_at)
             VALUES ('__cleanup_test__', 'football', $1, 'H', 'A', $2, $3, $4)"
        )
        .bind(id)
        .bind(now + *start_off)
        .bind(*state)
        .bind(now + *upd_off)
        .execute(&*pool).await.unwrap();
    }

    cleanup_old_games(&pool).await.unwrap();

    for (id, _, _, _, should_survive) in cases {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM games WHERE league = '__cleanup_test__' AND external_game_id = $1"
        )
        .bind(*id)
        .fetch_one(&*pool).await.unwrap();
        let exists = row.0 > 0;
        assert_eq!(exists, *should_survive, "row {} should survive={} but exists={}", id, should_survive, exists);
    }

    // Cleanup
    query("DELETE FROM games WHERE league = '__cleanup_test__'")
        .execute(&*pool).await.unwrap();
    query("DELETE FROM tracked_leagues WHERE name = '__cleanup_test__'")
        .execute(&*pool).await.unwrap();
}
```

- [ ] **Step 2: Run the test to verify it currently fails**

Run:
```bash
DATABASE_URL=$DATABASE_URL cargo test --manifest-path channels/sports/service/Cargo.toml --test cleanup -- --nocapture
```
Expected (against current code): FAILS at `alive_pre_3d` — the current query deletes any `pre` row >12h past start.

If DATABASE_URL is not set: test is skipped with the message in `skip_unless_db()`. That's fine; the test still proves the change once you point it at a real DB.

- [ ] **Step 3: Update `cleanup_old_games` to per-state thresholds**

Replace the function body in `channels/sports/service/src/database.rs:327-345` with:

```rust
/// Delete stale games using per-state thresholds.
///
/// - `final` / `postponed`: 12 hours past `start_time` — they're done.
/// - `pre`:  7 days past `start_time` — survives short polling outages.
///           A `pre` row this old means the API stopped returning the fixture
///           entirely; safe to prune.
/// - `in`:   24 hours since `updated_at`. A legitimately long game (MLB
///           extras, NFL weather delay, F1 red-flag) can exceed 4h, so we
///           prune only after a full day of no updates.
pub async fn cleanup_old_games(pool: &Arc<PgPool>) -> Result<u64> {
    let mut connection = pool.acquire().await?;
    let result = query(
        "DELETE FROM games WHERE
            (state IN ('final', 'postponed') AND start_time < NOW() - INTERVAL '12 hours')
            OR (state = 'pre' AND start_time < NOW() - INTERVAL '7 days')
            OR (state = 'in' AND updated_at < NOW() - INTERVAL '24 hours')"
    )
    .execute(&mut *connection)
    .await?;
    Ok(result.rows_affected())
}
```

- [ ] **Step 4: Run the test again to verify it now passes**

Run:
```bash
DATABASE_URL=$DATABASE_URL cargo test --manifest-path channels/sports/service/Cargo.toml --test cleanup -- --nocapture
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add channels/sports/service/src/database.rs channels/sports/service/tests/cleanup.rs
git commit -m "fix(sports): per-state cleanup thresholds, save pre-games from missed polls

Pre-game rows now survive 7 days past kickoff instead of 12 hours. The
old 12h threshold meant a single missed pre→in poll vanished a Premier
League game entirely. Final and postponed games still clean up at 12h
(they're done). Live games still prune at 24h since updated_at."
```

---

## Task 5: Per-league rate budget (`LeagueBudget`)

**Files:**
- Modify: `channels/sports/service/src/types.rs`
- Modify: `channels/sports/service/src/lib.rs:128` (callsite)
- Modify: `channels/sports/service/src/main.rs:128` (callsite)

The current `RateLimiter` tracks one budget per `sport_api` host (e.g. "football" = one bucket for Premier League + La Liga + MLS + Champions League combined). On Champions League knockout nights this can starve Premier League polls. Add a per-league reserved share within each host plus a shared pool for borrowing.

- [ ] **Step 1: Write failing tests for the new `LeagueBudget`**

Append to `channels/sports/service/src/types.rs`, inside the existing `#[cfg(test)] mod tests` block (after the existing `test_rate_limiter_concurrent_updates`):

```rust
    use crate::database::TrackedLeague;

    fn make_league(name: &str, sport_api: &str, offseason: Option<Vec<i32>>) -> TrackedLeague {
        TrackedLeague {
            name: name.to_string(),
            sport_api: sport_api.to_string(),
            api_host: format!("v3.{}.api-sports.io", sport_api),
            league_id: 1,
            category: "Test".to_string(),
            country: None,
            logo_url: None,
            season: None,
            season_format: None,
            offseason_months: offseason,
        }
    }

    #[test]
    fn test_league_budget_reserved_share() {
        // 4 in-season football leagues sharing 7500/day → 1875 each reserved
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
            make_league("MLS", "football", None),
            make_league("Champions League", "football", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 7500);

        // Each in-season league has 1875 reserved
        assert_eq!(rl.reserved("Premier League"), 1875);
        assert_eq!(rl.reserved("Champions League"), 1875);
        // Shared pool is 0 (no off-season leagues contributing)
        assert_eq!(rl.shared_remaining("football"), 0);
    }

    #[test]
    fn test_league_budget_offseason_donates_to_shared_pool() {
        // 3 in-season + 1 off-season (current month) football leagues
        let current_month = chrono::Utc::now().month() as i32;
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
            make_league("MLS", "football", None),
            make_league("Off Season League", "football", Some(vec![current_month])),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 7500);

        // 7500 / 4 = 1875 each. Off-season league donates its 1875 to the pool.
        assert_eq!(rl.reserved("Premier League"), 1875);
        assert_eq!(rl.reserved("Off Season League"), 0);
        assert_eq!(rl.shared_remaining("football"), 1875);
    }

    #[test]
    fn test_league_budget_try_consume_uses_reserved_first() {
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        // 500 reserved each, 0 shared
        for _ in 0..400 {
            assert!(rl.try_consume("Premier League"));
        }
        assert_eq!(rl.reserved("Premier League"), 100);
        assert_eq!(rl.reserved("La Liga"), 500);
    }

    #[test]
    fn test_league_budget_falls_back_to_shared_pool() {
        // 1 in-season + 1 off-season → all of off-season's share goes to pool
        let current_month = chrono::Utc::now().month() as i32;
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("Off", "football", Some(vec![current_month])),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        // Premier League reserved = 500, shared pool = 500
        // Exhaust reserved
        for _ in 0..500 {
            assert!(rl.try_consume("Premier League"));
        }
        assert_eq!(rl.reserved("Premier League"), 0);
        // Next 500 come from shared pool
        for _ in 0..500 {
            assert!(rl.try_consume("Premier League"));
        }
        assert_eq!(rl.shared_remaining("football"), 0);
        // Now exhausted
        assert!(!rl.try_consume("Premier League"));
    }

    #[test]
    fn test_league_budget_daily_reset() {
        let leagues = vec![make_league("Premier League", "football", None)];
        let rl = RateLimiter::new_per_league(&leagues, 100);
        // Burn through it
        for _ in 0..100 {
            assert!(rl.try_consume("Premier League"));
        }
        assert!(!rl.try_consume("Premier League"));
        // Reset
        rl.reset_daily(&leagues, 100);
        assert_eq!(rl.reserved("Premier League"), 100);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cargo test --manifest-path channels/sports/service/Cargo.toml types::tests::test_league_budget
```
Expected: compile errors / `RateLimiter::new_per_league` not found / `reserved` / `try_consume` / `shared_remaining` / `reset_daily` not found.

- [ ] **Step 3: Extend `RateLimiter` with per-league budgets**

Replace `RateLimiter` in `channels/sports/service/src/types.rs` (currently lines 63-106). Keep the old constructor + methods for backwards compatibility, plus add the new per-league API:

```rust
use chrono::{Datelike, Utc};

/// Per-sport-host rate limit tracker with per-league fair-share allocation.
///
/// api-sports.io enforces budgets per `sport_api` host (basketball, football,
/// hockey, etc.). Within a host, multiple leagues can share the budget — e.g.
/// the football host serves Premier League, La Liga, MLS, and Champions League.
///
/// To prevent one league (typically Champions League on knockout nights) from
/// starving the others, each in-season league gets a reserved share of
/// `total / N_in_season`. Off-season leagues contribute their share entirely
/// to a per-host shared pool. When a league exhausts its reserved budget, it
/// falls back to the shared pool before being skipped.
pub struct RateLimiter {
    /// Legacy per-sport bucket — preserved for the health endpoint snapshot.
    /// Updated from `x-ratelimit-requests-remaining` headers as before, but
    /// no longer used for consumption decisions when per-league budgets are
    /// initialized.
    host_remaining: HashMap<String, AtomicU32>,
    /// Per-league reserved buckets, keyed by league name.
    league_reserved: HashMap<String, AtomicU32>,
    /// Map league_name → host so we know which shared pool to fall back to.
    league_to_host: HashMap<String, String>,
    /// Per-host shared pool — fed by off-season leagues' donated shares.
    host_shared: HashMap<String, AtomicU32>,
}

impl RateLimiter {
    /// Legacy constructor: one bucket per sport host, no per-league split.
    /// Kept for tests that don't exercise the per-league logic.
    pub fn new(sports: &[String], initial: u32) -> Self {
        let mut host_remaining = HashMap::new();
        for s in sports {
            host_remaining.insert(s.clone(), AtomicU32::new(initial));
        }
        Self {
            host_remaining,
            league_reserved: HashMap::new(),
            league_to_host: HashMap::new(),
            host_shared: HashMap::new(),
        }
    }

    /// Build a rate limiter with per-league reserved shares.
    ///
    /// Algorithm:
    ///   - Group leagues by sport_api host.
    ///   - Within each host, total daily budget = `daily_total`.
    ///   - Each league's share = `daily_total / N_leagues_on_host`.
    ///   - In-season leagues get their share as `reserved`.
    ///   - Off-season leagues (current UTC month is in offseason_months) get
    ///     `reserved = 0` and donate their share to the host's shared pool.
    pub fn new_per_league(leagues: &[crate::database::TrackedLeague], daily_total: u32) -> Self {
        use std::collections::HashMap as Map;

        let current_month: i32 = Utc::now().month() as i32;

        // Group leagues by host (== sport_api here; one host per sport_api in practice).
        let mut by_host: Map<String, Vec<&crate::database::TrackedLeague>> = Map::new();
        for l in leagues {
            by_host.entry(l.sport_api.clone()).or_default().push(l);
        }

        let mut league_reserved = HashMap::new();
        let mut league_to_host = HashMap::new();
        let mut host_shared = HashMap::new();
        let mut host_remaining = HashMap::new();

        for (host, host_leagues) in &by_host {
            let n = host_leagues.len().max(1) as u32;
            let share = daily_total / n;
            let mut donated = 0u32;
            for l in host_leagues {
                let is_offseason = l.offseason_months.as_ref()
                    .map(|months| months.contains(&current_month))
                    .unwrap_or(false);
                let reserved = if is_offseason { 0 } else { share };
                if is_offseason {
                    donated += share;
                }
                league_reserved.insert(l.name.clone(), AtomicU32::new(reserved));
                league_to_host.insert(l.name.clone(), host.clone());
            }
            host_shared.insert(host.clone(), AtomicU32::new(donated));
            host_remaining.insert(host.clone(), AtomicU32::new(daily_total));
        }

        Self {
            host_remaining,
            league_reserved,
            league_to_host,
            host_shared,
        }
    }

    /// Try to consume 1 request for the given league. Returns true if the
    /// caller may proceed, false if the league has exhausted both its
    /// reserved and its host's shared pool.
    ///
    /// Order: reserved → shared pool → fail.
    pub fn try_consume(&self, league_name: &str) -> bool {
        // Try reserved first
        if let Some(reserved) = self.league_reserved.get(league_name) {
            // Atomic decrement-if-positive
            let mut cur = reserved.load(Ordering::Relaxed);
            while cur > 0 {
                match reserved.compare_exchange_weak(cur, cur - 1, Ordering::Relaxed, Ordering::Relaxed) {
                    Ok(_) => return true,
                    Err(actual) => cur = actual,
                }
            }
        }
        // Fall back to shared pool
        let Some(host) = self.league_to_host.get(league_name) else {
            return false;
        };
        let Some(shared) = self.host_shared.get(host) else {
            return false;
        };
        let mut cur = shared.load(Ordering::Relaxed);
        while cur > 0 {
            match shared.compare_exchange_weak(cur, cur - 1, Ordering::Relaxed, Ordering::Relaxed) {
                Ok(_) => return true,
                Err(actual) => cur = actual,
            }
        }
        false
    }

    /// Snapshot of the per-league reserved budget. Used only by tests + logs.
    pub fn reserved(&self, league_name: &str) -> u32 {
        self.league_reserved.get(league_name)
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    /// Snapshot of a host's shared pool.
    pub fn shared_remaining(&self, host: &str) -> u32 {
        self.host_shared.get(host)
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    /// Reset all per-league reserved + per-host shared pools. Called at UTC
    /// midnight by the daily reset task in main.rs.
    pub fn reset_daily(&self, leagues: &[crate::database::TrackedLeague], daily_total: u32) {
        use std::collections::HashMap as Map;
        let current_month: i32 = Utc::now().month() as i32;

        let mut by_host: Map<String, Vec<&crate::database::TrackedLeague>> = Map::new();
        for l in leagues {
            by_host.entry(l.sport_api.clone()).or_default().push(l);
        }

        for (host, host_leagues) in &by_host {
            let n = host_leagues.len().max(1) as u32;
            let share = daily_total / n;
            let mut donated = 0u32;
            for l in host_leagues {
                let is_offseason = l.offseason_months.as_ref()
                    .map(|months| months.contains(&current_month))
                    .unwrap_or(false);
                let reserved = if is_offseason { 0 } else { share };
                if is_offseason {
                    donated += share;
                }
                if let Some(slot) = self.league_reserved.get(&l.name) {
                    slot.store(reserved, Ordering::Relaxed);
                }
            }
            if let Some(slot) = self.host_shared.get(host) {
                slot.store(donated, Ordering::Relaxed);
            }
            if let Some(slot) = self.host_remaining.get(host) {
                slot.store(daily_total, Ordering::Relaxed);
            }
        }
    }

    // ── Legacy methods (preserved for the health endpoint + standings/teams polls) ──

    pub fn update(&self, sport: &str, remaining: u32) {
        if let Some(counter) = self.host_remaining.get(sport) {
            counter.store(remaining, Ordering::Relaxed);
        }
    }

    pub fn remaining(&self, sport: &str) -> u32 {
        self.host_remaining.get(sport)
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    /// Returns true if the given sport host has enough budget for at least
    /// one more request (legacy API used by the standings + teams polls
    /// which don't go through per-league `try_consume`).
    pub fn has_budget(&self, sport: &str) -> bool {
        self.remaining(sport) > 100
    }

    pub fn all_remaining(&self) -> HashMap<String, u32> {
        self.host_remaining.iter()
            .map(|(k, v)| (k.clone(), v.load(Ordering::Relaxed)))
            .collect()
    }
}
```

- [ ] **Step 4: Run all rate-limiter tests to verify they pass**

Run:
```bash
cargo test --manifest-path channels/sports/service/Cargo.toml types::tests
```
Expected: all 9 tests PASS (4 legacy + 5 new).

- [ ] **Step 5: Wire `try_consume` into the live + schedule polls**

In `channels/sports/service/src/lib.rs:159-163` (inside `poll_live`):

Replace:
```rust
        if !rate_limiter.has_budget(&league.sport_api) {
            warn!("[{}] Skipping live poll — rate limit budget low for {} ({})",
                league.name, league.sport_api, rate_limiter.remaining(&league.sport_api));
            continue;
        }
```

With:
```rust
        if !rate_limiter.try_consume(&league.name) {
            warn!("[{}] Skipping live poll — per-league budget exhausted (reserved={}, shared={})",
                league.name,
                rate_limiter.reserved(&league.name),
                rate_limiter.shared_remaining(&league.sport_api));
            continue;
        }
```

Same change in `poll_live`'s yesterday branch at `lib.rs:183-186`:

Replace:
```rust
            if !rate_limiter.has_budget(&league.sport_api) {
                warn!("[{}] Skipping yesterday poll — rate limit budget low", league.name);
                continue;
            }
```

With:
```rust
            if !rate_limiter.try_consume(&league.name) {
                warn!("[{}] Skipping yesterday poll — per-league budget exhausted", league.name);
                continue;
            }
```

Same change in `poll_schedule` at `lib.rs:262-266`:

Replace:
```rust
            if !rate_limiter.has_budget(&league.sport_api) {
                warn!("[{}] Skipping schedule poll — rate limit budget low for {} ({})",
                    league.name, league.sport_api, rate_limiter.remaining(&league.sport_api));
                break;
            }
```

With:
```rust
            if !rate_limiter.try_consume(&league.name) {
                warn!("[{}] Skipping schedule poll — per-league budget exhausted (reserved={}, shared={})",
                    league.name,
                    rate_limiter.reserved(&league.name),
                    rate_limiter.shared_remaining(&league.sport_api));
                break;
            }
```

The standings/teams polls (`lib.rs:320`, `lib.rs:880`) keep using `has_budget` — they're daily/weekly and their cost is negligible.

- [ ] **Step 6: Switch the constructor in `main.rs`**

In `channels/sports/service/src/main.rs:120-128`, replace:

```rust
        // Pro plan: 7,500 requests/day per sport API. Each sport host
        // (basketball, football, hockey, etc.) has its own independent budget.
        let sports: Vec<String> = leagues
            .iter()
            .map(|l| l.sport_api.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        let rate_limiter = Arc::new(RateLimiter::new(&sports, 7500));
```

With:

```rust
        // Pro plan: 7,500 requests/day per sport host. Each league on a host
        // gets a reserved share of host_budget / N_leagues_on_host. Off-season
        // leagues donate their share to a per-host shared pool that any
        // in-season league can borrow from when its reserved budget is
        // exhausted. Prevents Champions League knockout nights from starving
        // Premier League polls.
        let rate_limiter = Arc::new(RateLimiter::new_per_league(&leagues, 7500));
```

- [ ] **Step 7: Verify the whole crate builds**

Run:
```bash
cargo build --manifest-path channels/sports/service/Cargo.toml
```
Expected: 0 errors.

- [ ] **Step 8: Run all tests again to make sure nothing regressed**

Run:
```bash
cargo test --manifest-path channels/sports/service/Cargo.toml
```
Expected: all tests pass (cleanup test skips if no DB).

- [ ] **Step 9: Commit**

```bash
git add channels/sports/service/src/types.rs channels/sports/service/src/lib.rs channels/sports/service/src/main.rs
git commit -m "feat(sports): per-league rate budget with shared-pool stealing

Replaces the host-wide rate limiter with per-league reserved shares
plus a per-host shared pool. Each in-season league gets total/N
reserved daily; off-season leagues donate their share to the shared
pool. Eliminates the failure mode where Champions League knockout
nights starve Premier League polls."
```

---

## Task 6: Daily UTC midnight rate-budget reset

**Files:**
- Modify: `channels/sports/service/src/main.rs` (add new spawned task)

The new `LeagueBudget::reset_daily` needs a caller. Add a tokio task that fires at UTC midnight every day.

- [ ] **Step 1: Add the reset task in main.rs**

In `channels/sports/service/src/main.rs` after the teams-poll `spawn_supervised` block (around line 263, just before the closing `});` of the supervised init block), add:

```rust
        // ── Daily reset: rate budgets at UTC midnight ─────────────────────
        let leagues_reset = leagues.clone();
        let rl_reset = rate_limiter.clone();
        let cancel_reset = cancel_bg.clone();
        spawn_supervised("sports-budget-reset", async move {
            println!("Starting daily rate-budget reset loop (UTC midnight)...");
            loop {
                // Sleep until next UTC midnight
                let now = chrono::Utc::now();
                let tomorrow = (now + chrono::Duration::days(1))
                    .date_naive()
                    .and_hms_opt(0, 0, 0)
                    .expect("midnight is a valid time")
                    .and_utc();
                let wait_secs = (tomorrow - now).num_seconds().max(60) as u64;

                tokio::select! {
                    _ = cancel_reset.cancelled() => {
                        println!("Budget reset loop shutting down...");
                        break;
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(wait_secs)) => {
                        rl_reset.reset_daily(&leagues_reset, 7500);
                        println!("[Rate Budget] Daily reset completed at UTC midnight");
                    }
                }
            }
        });
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cargo build --manifest-path channels/sports/service/Cargo.toml
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add channels/sports/service/src/main.rs
git commit -m "feat(sports): daily UTC-midnight rate-budget reset

Schedules LeagueBudget::reset_daily to fire at 00:00 UTC every day,
matching api-sports.io's daily quota window. Without this the budgets
silently drain over time and the per-league shares become inaccurate."
```

---

## Task 7: Remove 12h future cutoff + widen `SCHEDULE_DAYS_AHEAD`

**Files:**
- Modify: `channels/sports/service/src/lib.rs:24` (constant)
- Modify: `channels/sports/service/src/lib.rs:230-288` (poll_schedule body)

The 12h filter at `lib.rs:270-275` silently drops next-day fixtures kicking off more than 12h in the future (UTC). Combined with `SCHEDULE_DAYS_AHEAD=1`, this means Premier League weekend matches polled Friday evening are dropped.

- [ ] **Step 1: Change the schedule horizon constant**

In `channels/sports/service/src/lib.rs:21-24`, replace:

```rust
/// Number of days ahead to poll in the schedule task.
/// Set to 1 to capture midnight crossover games (games that are evening local
/// time but fall on the next UTC date).
const SCHEDULE_DAYS_AHEAD: i64 = 1;
```

With:

```rust
/// Number of days ahead to poll in the schedule task. 7 days covers a full
/// week of fixtures — Premier League Saturday matches show up Monday morning.
///
/// Rate-budget impact (worst case, 4 in-season football leagues): 4 leagues
/// × 8 dates × 48 polls/day = 1,536 calls/day on the football host, well
/// under the 7,500/day quota.
const SCHEDULE_DAYS_AHEAD: i64 = 7;
```

- [ ] **Step 2: Remove the cutoff filter in `poll_schedule`**

In `channels/sports/service/src/lib.rs:217-301`, replace the entire `poll_schedule` function body. Find the function starting at line ~224:

```rust
pub async fn poll_schedule(
    pool: &Arc<PgPool>,
    client: &Client,
    leagues: &[TrackedLeague],
    rate_limiter: &Arc<RateLimiter>,
) {
    let now = Utc::now();
    let today = now.format("%Y-%m-%d").to_string();
    let cutoff = now + Duration::hours(12);
```

Replace `let cutoff = now + Duration::hours(12);` line with a comment removal (drop the line entirely). The `now` and `today` lines stay.

Then find the inner match block at `lib.rs:268-283`:

```rust
            match poll_league(client, league, date, rate_limiter).await {
                Ok(games) => {
                    // Filter future dates to only include games within 12 hours
                    let filtered = if date != &today {
                        games.into_iter().filter(|g| g.start_time <= cutoff).collect()
                    } else {
                        games
                    };
                    let (upserted, failed, _) = upsert_games(pool, league, filtered).await;
                    total_upserted += upserted;
                    total_failed += failed;
                }
                Err(e) => {
                    error!("[{}] Schedule poll error for {}: {}", league.name, date, e);
                }
            }
```

Replace it with:

```rust
            match poll_league(client, league, date, rate_limiter).await {
                Ok(games) => {
                    let (upserted, failed, _) = upsert_games(pool, league, games).await;
                    total_upserted += upserted;
                    total_failed += failed;
                    crate::database::record_poll_success(pool, &league.name).await;
                }
                Err(e) => {
                    error!("[{}] Schedule poll error for {}: {}", league.name, date, e);
                    crate::database::record_poll_error(pool, &league.name, &e.to_string()).await;
                }
            }
```

(This also adds the polling-health bookkeeping; task 8 wires it into `poll_live` similarly.)

- [ ] **Step 3: Update the doc-comment above `poll_schedule`**

The current doc comment at `lib.rs:213-223` describes the removed 12h behavior. Replace:

```rust
// =============================================================================
// Schedule polling (slow — today + 7 days ahead, every 30 min)
// =============================================================================

/// Poll today's games to populate the upcoming schedule.
/// Also cleans up finished games older than 12 hours.
///
/// When querying future dates (tomorrow), games are filtered to only include
/// those starting within 12 hours from now. This captures midnight crossover
/// games (evening US time that falls on the next UTC date) without prematurely
/// fetching mid-day tomorrow games.
pub async fn poll_schedule(
```

With:

```rust
// =============================================================================
// Schedule polling (slow — today + 7 days ahead, every 30 min)
// =============================================================================

/// Poll today + SCHEDULE_DAYS_AHEAD upcoming dates to populate the schedule.
/// Each polled league records `last_polled_at` / `last_poll_success_at` so
/// the API can surface a `polling_healthy` indicator. Cleanup of stale games
/// runs at the end of every cycle (per-state thresholds in cleanup_old_games).
pub async fn poll_schedule(
```

- [ ] **Step 4: Verify it builds**

Run:
```bash
cargo build --manifest-path channels/sports/service/Cargo.toml
```
Expected: 0 errors. There may be a warning about the unused `Duration` import — leave it; `Duration` is still used by `tokio::time::sleep` callsites in the same file.

- [ ] **Step 5: Commit**

```bash
git add channels/sports/service/src/lib.rs
git commit -m "fix(sports): widen schedule horizon to 7 days, drop 12h future cutoff

The 12h cutoff silently dropped next-day fixtures kicking off more
than 12 hours in the future (UTC). Premier League Saturday 3pm UK
fixtures polled Friday evening were filtered out — they only landed
in the DB once polling ran on the day-of. Combined with SCHEDULE_DAYS_AHEAD=1
this meant users couldn't see weekend matches until the morning of.

Widens horizon to 7 days. Worst case 1,536 schedule calls/day on the
football host, well under the 7,500/day quota."
```

---

## Task 8: Wire `record_poll_success` / `record_poll_error` into `poll_live`

**Files:**
- Modify: `channels/sports/service/src/lib.rs:158-201` (poll_live inner loop)

Task 7 already added the calls into `poll_schedule`. Mirror them in `poll_live` so live polls also update the polling-health timestamps (otherwise an off-day for a league that only has live games could look stale).

- [ ] **Step 1: Update `poll_live` today-branch**

In `channels/sports/service/src/lib.rs:165-179`, replace:

```rust
        // Always poll today
        match poll_league(client, league, &today, rate_limiter).await {
            Ok(games) => {
                let (upserted, failed, has_live) = upsert_games(pool, league, games).await;
                if has_live {
                    leagues_with_live += 1;
                }
                total_upserted += upserted;
                total_failed += failed;
            }
            Err(e) => {
                error!("[{}] Live poll error: {}", league.name, e);
                health_state.lock().await.record_error(e.to_string());
            }
        }
```

With:

```rust
        // Always poll today
        match poll_league(client, league, &today, rate_limiter).await {
            Ok(games) => {
                let (upserted, failed, has_live) = upsert_games(pool, league, games).await;
                if has_live {
                    leagues_with_live += 1;
                }
                total_upserted += upserted;
                total_failed += failed;
                crate::database::record_poll_success(pool, &league.name).await;
            }
            Err(e) => {
                error!("[{}] Live poll error: {}", league.name, e);
                health_state.lock().await.record_error(e.to_string());
                crate::database::record_poll_error(pool, &league.name, &e.to_string()).await;
            }
        }
```

- [ ] **Step 2: Update `poll_live` yesterday-branch**

In `channels/sports/service/src/lib.rs:187-201`, replace:

```rust
            match poll_league(client, league, &yesterday, rate_limiter).await {
                Ok(games) => {
                    let (upserted, failed, has_live) = upsert_games(pool, league, games).await;
                    if has_live {
                        leagues_with_live += 1;
                    }
                    total_upserted += upserted;
                    total_failed += failed;
                }
                Err(e) => {
                    error!("[{}] Yesterday poll error: {}", league.name, e);
                    health_state.lock().await.record_error(e.to_string());
                }
            }
```

With:

```rust
            match poll_league(client, league, &yesterday, rate_limiter).await {
                Ok(games) => {
                    let (upserted, failed, has_live) = upsert_games(pool, league, games).await;
                    if has_live {
                        leagues_with_live += 1;
                    }
                    total_upserted += upserted;
                    total_failed += failed;
                    crate::database::record_poll_success(pool, &league.name).await;
                }
                Err(e) => {
                    error!("[{}] Yesterday poll error: {}", league.name, e);
                    health_state.lock().await.record_error(e.to_string());
                    crate::database::record_poll_error(pool, &league.name, &e.to_string()).await;
                }
            }
```

- [ ] **Step 3: Verify it builds**

Run:
```bash
cargo build --manifest-path channels/sports/service/Cargo.toml
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add channels/sports/service/src/lib.rs
git commit -m "feat(sports): record polling health from poll_live as well as poll_schedule

Mirrors the bookkeeping added to poll_schedule in Task 7. Without this,
a league that only has live games (no scheduled fixtures in the polled
window) would appear stale to the API because nothing was updating its
last_poll_success_at."
```

---

## Task 9: Go API — extend `TrackedLeague` to read polling-health columns

**Files:**
- Modify: `channels/sports/api/models.go`
- Modify: `channels/sports/api/sports.go:114-115` (catalog SQL)
- Modify: `channels/sports/api/sports.go:128` (scan)
- Modify: `channels/sports/api/sports.go:132-133` (compute polling_healthy)

- [ ] **Step 1: Add fields to `TrackedLeague`**

In `channels/sports/api/models.go:32-43`, replace the `TrackedLeague` struct:

```go
// TrackedLeague represents a league entry from the catalog, enriched with
// current game activity counts and polling-health for the dashboard league browser.
type TrackedLeague struct {
	Name              string     `json:"name"`
	SportAPI          string     `json:"sport_api"`
	Category          string     `json:"category"`
	Country           string     `json:"country"`
	LogoURL           string     `json:"logo_url"`
	GameCount         int        `json:"game_count"`
	LiveCount         int        `json:"live_count"`
	NextGame          *time.Time `json:"next_game,omitempty"`
	IsOffseason       bool       `json:"is_offseason"`
	LastPolledAt      *time.Time `json:"last_polled_at,omitempty"`
	LastPollSuccessAt *time.Time `json:"last_poll_success_at,omitempty"`
	PollingHealthy    bool       `json:"polling_healthy"`
	OffseasonMonths   []int32    `json:"-"` // internal, not serialized
}
```

- [ ] **Step 2: Add the polling-health threshold constant**

In `channels/sports/api/sports.go:20-53` (the `const` block), add at the end:

```go
	// PollingStaleThreshold is the maximum acceptable age of the last
	// successful poll before a league is marked polling_healthy: false.
	// Set to 3× the schedule poll cadence (30 min × 3 = 90 min) — enough
	// slack for transient failures without hiding a real outage.
	PollingStaleThreshold = 90 * time.Minute
```

- [ ] **Step 3: Update the catalog SQL to read the new columns**

In `channels/sports/api/sports.go:113-115`, replace:

```go
	rows, err := a.db.Query(ctx,
		`SELECT name, COALESCE(sport_api, ''), COALESCE(category, 'Other'), COALESCE(country, ''), COALESCE(logo_url, ''), offseason_months
		 FROM tracked_leagues WHERE is_enabled = true ORDER BY category, name`)
```

With:

```go
	rows, err := a.db.Query(ctx,
		`SELECT name, COALESCE(sport_api, ''), COALESCE(category, 'Other'), COALESCE(country, ''), COALESCE(logo_url, ''),
		        offseason_months, last_polled_at, last_poll_success_at
		 FROM tracked_leagues WHERE is_enabled = true ORDER BY category, name`)
```

- [ ] **Step 4: Update the scan and compute `PollingHealthy`**

In `channels/sports/api/sports.go:126-135`, replace:

```go
	for rows.Next() {
		var l TrackedLeague
		if err := rows.Scan(&l.Name, &l.SportAPI, &l.Category, &l.Country, &l.LogoURL, &l.OffseasonMonths); err != nil {
			log.Printf("[Sports] Catalog scan error: %v", err)
			continue
		}
		// Compute is_offseason from offseason_months (default false if nil/empty)
		l.IsOffseason = containsMonth(l.OffseasonMonths, currentMonth)
		catalog = append(catalog, l)
	}
```

With:

```go
	for rows.Next() {
		var l TrackedLeague
		if err := rows.Scan(
			&l.Name, &l.SportAPI, &l.Category, &l.Country, &l.LogoURL,
			&l.OffseasonMonths, &l.LastPolledAt, &l.LastPollSuccessAt,
		); err != nil {
			log.Printf("[Sports] Catalog scan error: %v", err)
			continue
		}
		// Compute is_offseason from offseason_months (default false if nil/empty)
		l.IsOffseason = containsMonth(l.OffseasonMonths, currentMonth)
		// Compute polling_healthy: last_poll_success_at is non-null AND within threshold.
		// Off-season leagues are exempt — we don't poll them, so they can't be "stale".
		l.PollingHealthy = l.IsOffseason ||
			(l.LastPollSuccessAt != nil && time.Since(*l.LastPollSuccessAt) < PollingStaleThreshold)
		catalog = append(catalog, l)
	}
```

- [ ] **Step 5: Verify it builds**

Run:
```bash
cd channels/sports/api && go build ./...
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add channels/sports/api/models.go channels/sports/api/sports.go
git commit -m "feat(sports-api): expose polling-health on catalog endpoint

Adds last_polled_at, last_poll_success_at, polling_healthy fields to
TrackedLeague. polling_healthy is derived: true if last_poll_success_at
is within 90 min (3× schedule cadence) OR if the league is off-season
(no poll expected). Catalog SQL reads the new tracked_leagues columns
added in migration 120000000007."
```

---

## Task 10: `LeagueMeta` model + `loadLeagueStatus` helper

**Files:**
- Modify: `channels/sports/api/models.go`
- Modify: `channels/sports/api/sports.go` (refactor catalog + new helper)

- [ ] **Step 1: Add the `LeagueMeta` model**

Append to `channels/sports/api/models.go` (after the `TrackedLeague` definition):

```go
// LeagueMeta is the per-league summary attached to dashboard + public
// sports responses. Lets the desktop empty-state component explain WHY a
// league has no games right now (off-season, next game soon, polling
// stale, or genuinely nothing scheduled).
type LeagueMeta struct {
	Name           string     `json:"name"`
	IsOffseason    bool       `json:"is_offseason"`
	NextGame       *time.Time `json:"next_game,omitempty"`
	PollingHealthy bool       `json:"polling_healthy"`
}

// SportsResponse is the new shape returned by /sports, /sports/public,
// and /internal/dashboard. Game array stays under "sports" for backwards
// compatibility; per-league context lives under "meta".
type SportsResponse struct {
	Sports []Game     `json:"sports"`
	Meta   SportsMeta `json:"meta"`
}

// SportsMeta wraps per-league context.
type SportsMeta struct {
	Leagues []LeagueMeta `json:"leagues"`
}
```

- [ ] **Step 2: Add `loadLeagueStatus` helper**

The current `getLeagueCatalog` has its own inline status query at `sports.go:137-166`. Extract it into a shared method that can serve both the catalog and the dashboard `meta`.

Insert in `channels/sports/api/sports.go` just before `getLeagueCatalog` (around line 100):

```go
// leagueStatus holds the per-league activity computed from the games table.
// Used by both the catalog endpoint and the dashboard meta payload.
type leagueStatus struct {
	GameCount int
	LiveCount int
	NextGame  *time.Time
}

// loadLeagueStatus returns activity counts and the next upcoming game per
// league. If `names` is empty, returns stats for every league that appears
// in the games table. If `names` is non-empty, the result is restricted to
// just those leagues (LEFT JOIN semantics in spirit — leagues with no games
// simply don't appear in the map).
//
// The query is intentionally batched so we run one round-trip per call,
// not one query per league.
func (a *App) loadLeagueStatus(ctx context.Context, names []string) (map[string]leagueStatus, error) {
	statusMap := make(map[string]leagueStatus)

	var rows pgx.Rows
	var err error
	if len(names) == 0 {
		rows, err = a.db.Query(ctx, `
			SELECT league,
			       COUNT(*) AS game_count,
			       COUNT(*) FILTER (WHERE state = 'in') AS live_count,
			       MIN(start_time) FILTER (WHERE state = 'pre') AS next_game
			FROM games
			GROUP BY league`)
	} else {
		rows, err = a.db.Query(ctx, `
			SELECT league,
			       COUNT(*) AS game_count,
			       COUNT(*) FILTER (WHERE state = 'in') AS live_count,
			       MIN(start_time) FILTER (WHERE state = 'pre') AS next_game
			FROM games
			WHERE league = ANY($1)
			GROUP BY league`, names)
	}
	if err != nil {
		return nil, fmt.Errorf("load league status: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var league string
		var s leagueStatus
		if err := rows.Scan(&league, &s.GameCount, &s.LiveCount, &s.NextGame); err != nil {
			log.Printf("[Sports] loadLeagueStatus scan error: %v", err)
			continue
		}
		statusMap[league] = s
	}
	return statusMap, nil
}
```

You'll need to add `"github.com/jackc/pgx/v5"` to the import block at the top of `sports.go` for the `pgx.Rows` type.

- [ ] **Step 3: Refactor `getLeagueCatalog` to use the helper**

In `channels/sports/api/sports.go:137-174`, replace the entire inline enrichment block:

```go
	// Enrich with per-league game activity counts.
	type leagueStatus struct {
		GameCount int
		LiveCount int
		NextGame  *time.Time
	}
	statusMap := make(map[string]leagueStatus)

	statusRows, err := a.db.Query(ctx,
		`SELECT league,
		        COUNT(*) AS game_count,
		        COUNT(*) FILTER (WHERE state = 'in') AS live_count,
		        MIN(start_time) FILTER (WHERE state = 'pre') AS next_game
		 FROM games
		 GROUP BY league`)
	if err != nil {
		log.Printf("[Sports] League status query failed (non-fatal): %v", err)
		// Continue without enrichment — the catalog is still useful.
	} else {
		defer statusRows.Close()
		for statusRows.Next() {
			var league string
			var s leagueStatus
			if err := statusRows.Scan(&league, &s.GameCount, &s.LiveCount, &s.NextGame); err != nil {
				log.Printf("[Sports] League status scan error: %v", err)
				continue
			}
			statusMap[league] = s
		}
	}

	for i := range catalog {
		if s, ok := statusMap[catalog[i].Name]; ok {
			catalog[i].GameCount = s.GameCount
			catalog[i].LiveCount = s.LiveCount
			catalog[i].NextGame = s.NextGame
		}
	}
```

With:

```go
	// Enrich with per-league game activity counts.
	statusMap, statusErr := a.loadLeagueStatus(ctx, nil)
	if statusErr != nil {
		log.Printf("[Sports] League status query failed (non-fatal): %v", statusErr)
		// Continue without enrichment — the catalog is still useful.
	}
	for i := range catalog {
		if s, ok := statusMap[catalog[i].Name]; ok {
			catalog[i].GameCount = s.GameCount
			catalog[i].LiveCount = s.LiveCount
			catalog[i].NextGame = s.NextGame
		}
	}
```

- [ ] **Step 4: Verify it builds**

Run:
```bash
cd channels/sports/api && go build ./...
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add channels/sports/api/models.go channels/sports/api/sports.go
git commit -m "refactor(sports-api): extract loadLeagueStatus, add LeagueMeta/SportsResponse

Shared helper for per-league activity counts that both the catalog
and (next commit) the dashboard meta endpoint will consume. Drops the
inline duplicate query in getLeagueCatalog."
```

---

## Task 11: Reshape public + dashboard responses to `{sports, meta}`

**Files:**
- Modify: `channels/sports/api/sports.go` (`getSports`, `getUserGames`, `handleInternalDashboard`)
- Modify: `channels/sports/api/sports.go` (new `loadLeagueMeta` helper)

Today these endpoints return a bare `[]Game`. Change to `{sports: [], meta: {leagues: []}}` so the desktop empty-state can show "Off-season — returns August" / "Next: in 2 days" / "Live data unavailable" instead of a generic "Empty."

- [ ] **Step 1: Add `loadLeagueMeta` helper**

Insert in `channels/sports/api/sports.go` right after `loadLeagueStatus` (added in Task 10):

```go
// loadLeagueMeta builds the per-league meta array attached to dashboard +
// public sports responses. `names` is the set of leagues to include —
// typically the user's selected leagues for /dashboard, or every enabled
// league for the public endpoint.
//
// For each league:
//   - is_offseason: derived from offseason_months and the current UTC month.
//   - next_game:    earliest start_time of any pre-state game.
//   - polling_healthy: same rule as catalog (90-min staleness threshold,
//     exempt for off-season leagues).
//
// Returns an empty slice (never nil) so callers can JSON-encode cleanly.
func (a *App) loadLeagueMeta(ctx context.Context, names []string) []LeagueMeta {
	if len(names) == 0 {
		return []LeagueMeta{}
	}

	currentMonth := int32(time.Now().Month())

	// Query tracked_leagues for off-season + polling-health columns.
	rows, err := a.db.Query(ctx, `
		SELECT name, offseason_months, last_poll_success_at
		FROM tracked_leagues
		WHERE name = ANY($1)`, names)
	if err != nil {
		log.Printf("[Sports] loadLeagueMeta tracked_leagues query failed: %v", err)
		return []LeagueMeta{}
	}
	defer rows.Close()

	type leagueRow struct {
		Name              string
		OffseasonMonths   []int32
		LastPollSuccessAt *time.Time
	}
	leagueRows := make([]leagueRow, 0, len(names))
	for rows.Next() {
		var r leagueRow
		if err := rows.Scan(&r.Name, &r.OffseasonMonths, &r.LastPollSuccessAt); err != nil {
			log.Printf("[Sports] loadLeagueMeta scan error: %v", err)
			continue
		}
		leagueRows = append(leagueRows, r)
	}

	// Pull next_game alongside in a single batched query.
	statusMap, _ := a.loadLeagueStatus(ctx, names)

	meta := make([]LeagueMeta, 0, len(leagueRows))
	for _, r := range leagueRows {
		isOffseason := containsMonth(r.OffseasonMonths, currentMonth)
		var nextGame *time.Time
		if s, ok := statusMap[r.Name]; ok {
			nextGame = s.NextGame
		}
		pollingHealthy := isOffseason ||
			(r.LastPollSuccessAt != nil && time.Since(*r.LastPollSuccessAt) < PollingStaleThreshold)
		meta = append(meta, LeagueMeta{
			Name:           r.Name,
			IsOffseason:    isOffseason,
			NextGame:       nextGame,
			PollingHealthy: pollingHealthy,
		})
	}
	return meta
}
```

- [ ] **Step 2: Add a helper for "all enabled league names"**

Insert in `channels/sports/api/sports.go` right after `loadLeagueMeta`:

```go
// allEnabledLeagueNames returns the names of every enabled tracked league.
// Used by the public /sports endpoint where there is no per-user filter.
// Errors are logged and a nil slice is returned so the public endpoint
// degrades to an empty meta rather than 500-ing.
func (a *App) allEnabledLeagueNames(ctx context.Context) []string {
	rows, err := a.db.Query(ctx,
		`SELECT name FROM tracked_leagues WHERE is_enabled = true ORDER BY name`)
	if err != nil {
		log.Printf("[Sports] allEnabledLeagueNames query failed: %v", err)
		return nil
	}
	defer rows.Close()
	names := make([]string, 0)
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			log.Printf("[Sports] allEnabledLeagueNames scan error: %v", err)
			continue
		}
		names = append(names, n)
	}
	return names
}
```

- [ ] **Step 3: Update `getSports` (public path)**

In `channels/sports/api/sports.go:72-99`, replace:

```go
func (a *App) getSports(c *fiber.Ctx) error {
	userSub := c.Get("X-User-Sub")

	// Authenticated: return per-user filtered games
	if userSub != "" {
		return a.getUserGames(c, userSub, DefaultSportsLimit)
	}

	// Public: return all games (no favorites)
	var games []Game
	if GetCache(a.rdb, CacheKeySports, &games) {
		c.Set("X-Cache", "HIT")
		return c.JSON(games)
	}

	games, err := a.queryGames(context.Background(), DefaultSportsLimit, nil)
	if err != nil {
		log.Printf("[Sports] getSports query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}

	SetCache(a.rdb, CacheKeySports, games, SportsCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(games)
}
```

With:

```go
func (a *App) getSports(c *fiber.Ctx) error {
	userSub := c.Get("X-User-Sub")

	// Authenticated: return per-user filtered games
	if userSub != "" {
		return a.getUserGames(c, userSub, DefaultSportsLimit)
	}

	// Public: return all games + meta for every enabled league.
	var resp SportsResponse
	if GetCache(a.rdb, CacheKeySports, &resp) {
		c.Set("X-Cache", "HIT")
		return c.JSON(resp)
	}

	ctx := context.Background()
	games, err := a.queryGames(ctx, DefaultSportsLimit, nil)
	if err != nil {
		log.Printf("[Sports] getSports query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}
	meta := a.loadLeagueMeta(ctx, a.allEnabledLeagueNames(ctx))

	resp = SportsResponse{Sports: games, Meta: SportsMeta{Leagues: meta}}
	SetCache(a.rdb, CacheKeySports, resp, SportsCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(resp)
}
```

- [ ] **Step 4: Update `getUserGames` (per-user path)**

In `channels/sports/api/sports.go:520-547`, replace the entire function:

```go
// getUserGames returns per-user filtered games (used by authenticated getSports).
func (a *App) getUserGames(c *fiber.Ctx, userSub string, limit int) error {
	cacheKey := CacheKeySportsPrefix + userSub
	var games []Game
	if GetCache(a.rdb, cacheKey, &games) {
		c.Set("X-Cache", "HIT")
		return c.JSON(games)
	}

	leagues := a.getUserSportsLeagues(userSub)
	if len(leagues) == 0 {
		return c.JSON([]Game{})
	}

	favoriteTeams := a.getUserFavoriteTeams(userSub)
	games, err := a.queryGamesByLeagues(context.Background(), leagues, limit, favoriteTeams)
	if err != nil {
		log.Printf("[Sports] getUserGames query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}

	SetCache(a.rdb, cacheKey, games, SportsCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(games)
}
```

With:

```go
// getUserGames returns per-user filtered games + meta (used by authenticated getSports).
func (a *App) getUserGames(c *fiber.Ctx, userSub string, limit int) error {
	cacheKey := CacheKeySportsPrefix + userSub
	var resp SportsResponse
	if GetCache(a.rdb, cacheKey, &resp) {
		c.Set("X-Cache", "HIT")
		return c.JSON(resp)
	}

	ctx := context.Background()
	leagues := a.getUserSportsLeagues(userSub)
	if len(leagues) == 0 {
		// Even with no leagues, return the new shape — empty arrays both sides.
		return c.JSON(SportsResponse{Sports: []Game{}, Meta: SportsMeta{Leagues: []LeagueMeta{}}})
	}

	favoriteTeams := a.getUserFavoriteTeams(userSub)
	games, err := a.queryGamesByLeagues(ctx, leagues, limit, favoriteTeams)
	if err != nil {
		log.Printf("[Sports] getUserGames query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}
	meta := a.loadLeagueMeta(ctx, leagues)

	resp = SportsResponse{Sports: games, Meta: SportsMeta{Leagues: meta}}
	SetCache(a.rdb, cacheKey, resp, SportsCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(resp)
}
```

- [ ] **Step 5: Update `handleInternalDashboard`**

In `channels/sports/api/sports.go:255-283`, replace:

```go
func (a *App) handleInternalDashboard(c *fiber.Ctx) error {
	userSub := c.Query("user")
	if userSub == "" {
		return c.JSON(fiber.Map{"sports": []Game{}})
	}

	// Check per-user cache first
	cacheKey := CacheKeySportsPrefix + userSub
	var games []Game
	if GetCache(a.rdb, cacheKey, &games) {
		return c.JSON(fiber.Map{"sports": games})
	}

	// Get user's selected leagues from their channel config
	leagues := a.getUserSportsLeagues(userSub)
	if len(leagues) == 0 {
		return c.JSON(fiber.Map{"sports": []Game{}})
	}

	favoriteTeams := a.getUserFavoriteTeams(userSub)
	games, err := a.queryGamesByLeagues(context.Background(), leagues, DashboardSportsLimit, favoriteTeams)
	if err != nil {
		log.Printf("[Sports] Dashboard query failed: %v", err)
		return c.JSON(fiber.Map{"sports": []Game{}})
	}

	SetCache(a.rdb, cacheKey, games, SportsCacheTTL)
	return c.JSON(fiber.Map{"sports": games})
}
```

With:

```go
func (a *App) handleInternalDashboard(c *fiber.Ctx) error {
	userSub := c.Query("user")
	if userSub == "" {
		return c.JSON(fiber.Map{
			"sports":      []Game{},
			"sports_meta": SportsMeta{Leagues: []LeagueMeta{}},
		})
	}

	cacheKey := CacheKeySportsPrefix + userSub
	var resp SportsResponse
	if GetCache(a.rdb, cacheKey, &resp) {
		return c.JSON(fiber.Map{
			"sports":      resp.Sports,
			"sports_meta": resp.Meta,
		})
	}

	ctx := context.Background()
	leagues := a.getUserSportsLeagues(userSub)
	if len(leagues) == 0 {
		return c.JSON(fiber.Map{
			"sports":      []Game{},
			"sports_meta": SportsMeta{Leagues: []LeagueMeta{}},
		})
	}

	favoriteTeams := a.getUserFavoriteTeams(userSub)
	games, err := a.queryGamesByLeagues(ctx, leagues, DashboardSportsLimit, favoriteTeams)
	if err != nil {
		log.Printf("[Sports] Dashboard query failed: %v", err)
		return c.JSON(fiber.Map{
			"sports":      []Game{},
			"sports_meta": SportsMeta{Leagues: []LeagueMeta{}},
		})
	}
	meta := a.loadLeagueMeta(ctx, leagues)

	resp = SportsResponse{Sports: games, Meta: SportsMeta{Leagues: meta}}
	SetCache(a.rdb, cacheKey, resp, SportsCacheTTL)

	// Dashboard envelope uses sibling key `sports_meta` (not nested `meta`)
	// so the core gateway can merge multi-channel responses cleanly.
	return c.JSON(fiber.Map{
		"sports":      resp.Sports,
		"sports_meta": resp.Meta,
	})
}
```

- [ ] **Step 6: Verify it builds**

Run:
```bash
cd channels/sports/api && go build ./...
```
Expected: 0 errors.

- [ ] **Step 7: Run existing tests**

Run:
```bash
cd channels/sports/api && go test ./...
```
Expected: existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add channels/sports/api/sports.go channels/sports/api/models.go
git commit -m "feat(sports-api): attach per-league meta to dashboard + public responses

GET /sports, /sports/public, and /internal/dashboard now return
{sports: [...], meta: {leagues: [...]}}. The dashboard envelope uses
sports_meta as a sibling key (not nested meta) so the core gateway
merges multi-channel responses cleanly. Per-user cache key now stores
SportsResponse instead of bare []Game; CDC bust logic unchanged."
```

---

## Task 12: Desktop TypeScript types

**Files:**
- Modify: `desktop/src/types/index.ts`
- Modify: `desktop/src/api/queries.ts`

- [ ] **Step 1: Extend `TrackedLeague` in `queries.ts`**

In `desktop/src/api/queries.ts:93-103`, replace:

```ts
export interface TrackedLeague {
  name: string;
  sport_api: string;
  category: string;
  country: string;
  logo_url: string;
  game_count: number;
  live_count: number;
  next_game: string | null;
  is_offseason: boolean;
}
```

With:

```ts
export interface TrackedLeague {
  name: string;
  sport_api: string;
  category: string;
  country: string;
  logo_url: string;
  game_count: number;
  live_count: number;
  next_game: string | null;
  is_offseason: boolean;
  /** ISO timestamp of the most recent poll attempt (success or failure). */
  last_polled_at?: string | null;
  /** ISO timestamp of the most recent successful poll. */
  last_poll_success_at?: string | null;
  /** True if last_poll_success_at is recent OR the league is off-season. */
  polling_healthy: boolean;
}

/**
 * Per-league meta attached to the dashboard + public sports responses.
 * Lets the empty-state component explain WHY a league has no games.
 */
export interface LeagueMeta {
  name: string;
  is_offseason: boolean;
  /** ISO timestamp of the earliest upcoming game, or null if none. */
  next_game: string | null;
  polling_healthy: boolean;
}

/** Wrapper around the meta payload returned alongside sports games. */
export interface SportsMeta {
  leagues: LeagueMeta[];
}
```

- [ ] **Step 2: Extend `DashboardResponse` to carry `sports_meta`**

In `desktop/src/types/index.ts:69-87`, replace:

```ts
export interface DashboardResponse {
  data: {
    finance?: Trade[];
    sports?: Game[];
    rss?: RssItem[];
    [key: string]: unknown;
  };
```

With:

```ts
export interface DashboardResponse {
  data: {
    finance?: Trade[];
    sports?: Game[];
    sports_meta?: SportsMeta;
    rss?: RssItem[];
    [key: string]: unknown;
  };
```

Add the import at the top of `desktop/src/types/index.ts`:

```ts
import type { SportsMeta } from "../api/queries";
```

Note: this creates a tiny circular dependency (queries imports DashboardResponse from types; types imports SportsMeta from queries). Since both are type-only imports under `verbatimModuleSyntax: true`, TypeScript handles this fine at build time.

- [ ] **Step 3: Verify it builds**

Run:
```bash
cd desktop && npm run build
```
Expected: build succeeds. If TypeScript complains about the circular import, move `SportsMeta` and `LeagueMeta` from `queries.ts` to `types/index.ts` and import from there in `queries.ts`.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/types/index.ts desktop/src/api/queries.ts
git commit -m "feat(desktop): types for sports polling-health and per-league meta

Adds LeagueMeta + SportsMeta types and extends TrackedLeague with
polling_healthy / last_poll_success_at / last_polled_at. DashboardResponse
carries sports_meta as a sibling key (matches the Go API envelope)."
```

---

## Task 13: Build `SportsEmptyState` component

**Files:**
- Create: `desktop/src/channels/sports/EmptyState.tsx`

A new component that replaces the generic `EmptyDataRow` on the sports row of the home feed. Surfaces off-season status, next-game countdown, or polling-stale warnings.

- [ ] **Step 1: Create the component**

Create `desktop/src/channels/sports/EmptyState.tsx`:

```tsx
/**
 * Sports-specific empty-state row for the home feed.
 *
 * Replaces the generic EmptyDataRow with context-aware messaging:
 * polling outages, off-season leagues, next-game countdown, or
 * "no leagues selected" CTA. Driven entirely by the LeagueMeta array
 * served alongside the games payload.
 */
import { Settings, AlertTriangle } from "lucide-react";
import { formatCountdown } from "../../utils/gameHelpers";
import type { LeagueMeta } from "../../api/queries";

interface SportsEmptyStateProps {
  /** User's selected leagues with their off-season / next-game / health status. */
  leagues: LeagueMeta[];
  /** Optional Configure CTA — only shown when leagues array is empty. */
  onConfigure?: () => void;
}

/**
 * Decision tree (top wins):
 *   1. leagues empty                  → "Pick leagues to follow" + CTA
 *   2. any polling_healthy=false      → "Live data unavailable: ..." (warning)
 *   3. all leagues is_offseason=true  → "Off-season — X returns in Yd"
 *   4. any league has next_game      → "Next: X • in Y"
 *   5. otherwise                      → "No games scheduled — check back later"
 */
export default function SportsEmptyState({ leagues, onConfigure }: SportsEmptyStateProps) {
  // Branch 1: no leagues selected
  if (leagues.length === 0) {
    return (
      <div className="px-4 py-5 text-center">
        <p className="text-xs text-fg-3 font-medium mb-1">No leagues configured yet</p>
        {onConfigure && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfigure();
            }}
            className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent/80 transition-colors"
          >
            <Settings size={11} />
            Open Settings to pick your leagues
          </button>
        )}
      </div>
    );
  }

  // Branch 2: polling unhealthy on one or more leagues
  const unhealthy = leagues.filter((l) => !l.polling_healthy);
  if (unhealthy.length > 0) {
    const names = [...unhealthy.map((l) => l.name)].sort();
    const display =
      names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
    return (
      <div className="px-4 py-5 text-center">
        <p className="inline-flex items-center justify-center gap-1.5 text-xs text-amber-400 font-medium mb-1">
          <AlertTriangle size={11} />
          Live data unavailable
        </p>
        <p className="text-[11px] text-fg-3">{display}</p>
      </div>
    );
  }

  // Branch 3: all leagues are off-season
  const allOffseason = leagues.every((l) => l.is_offseason);
  if (allOffseason) {
    const withNext = leagues
      .filter((l) => l.next_game != null)
      .sort((a, b) => +new Date(a.next_game!) - +new Date(b.next_game!));
    if (withNext.length > 0) {
      const target = withNext[0];
      return (
        <div className="px-4 py-5 text-center">
          <p className="text-xs text-fg-3 font-medium mb-1">All your leagues are off-season</p>
          <p className="text-[11px] text-fg-4">
            {target.name} returns {formatCountdown(target.next_game!)}
          </p>
        </div>
      );
    }
    // No next_game known — pick alphabetically first league
    const fallback = [...leagues].sort((a, b) => a.name.localeCompare(b.name))[0];
    return (
      <div className="px-4 py-5 text-center">
        <p className="text-xs text-fg-3 font-medium mb-1">All your leagues are off-season</p>
        <p className="text-[11px] text-fg-4">{fallback.name} returns next season</p>
      </div>
    );
  }

  // Branch 4: some league has an upcoming game
  const withNext = leagues
    .filter((l) => l.next_game != null)
    .sort((a, b) => {
      const cmp = +new Date(a.next_game!) - +new Date(b.next_game!);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
  if (withNext.length > 0) {
    const target = withNext[0];
    return (
      <div className="px-4 py-5 text-center">
        <p className="text-xs text-fg-3 font-medium mb-1">No games right now</p>
        <p className="text-[11px] text-fg-4">
          Next: {target.name} • {formatCountdown(target.next_game!)}
        </p>
      </div>
    );
  }

  // Branch 5: in-season but nothing scheduled
  return (
    <div className="px-4 py-5 text-center">
      <p className="text-xs text-fg-3 font-medium">No games scheduled — check back later</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run:
```bash
cd desktop && npm run build
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/channels/sports/EmptyState.tsx
git commit -m "feat(desktop): SportsEmptyState component with context-aware messaging

Five-branch decision tree: no leagues, polling stale, all off-season,
next-game countdown, in-season-but-empty. Uses LeagueMeta from the
dashboard response. Replaces the generic EmptyDataRow used by feed.tsx
in the next commit."
```

---

## Task 14: Wire `SportsEmptyState` into feed.tsx + fix priority map

**Files:**
- Modify: `desktop/src/routes/feed.tsx`

- [ ] **Step 1: Find the SportsRows callsite to understand the wire-up**

The current `SportsRows` is invoked somewhere in `feed.tsx`. Locate it:

Run:
```bash
rg -n "SportsRows" desktop/src/routes/feed.tsx
```
Expected: at least 2 matches — the function definition near line 703 and one or more callsites.

- [ ] **Step 2: Update `SportsRows` to accept and use `meta`**

In `desktop/src/routes/feed.tsx`, replace the existing `SportsRows` function (currently `feed.tsx:701-768`) with:

```tsx
// ── Sports rows ─────────────────────────────────────────────────

function SportsRows({
  data,
  meta,
  filter,
  onConfigure,
}: {
  data: unknown;
  meta: LeagueMeta[] | undefined;
  filter: string[];
  onConfigure: () => void;
}) {
  const games = Array.isArray(data) ? (data as Game[]) : [];
  // Restrict meta to the user's filter selection so the empty-state speaks
  // only about leagues the user has configured.
  const visibleMeta: LeagueMeta[] = (meta ?? []).filter(
    (m) => filter.length === 0 || filter.includes(m.name),
  );

  if (games.length === 0) {
    return <SportsEmptyState leagues={visibleMeta} onConfigure={onConfigure} />;
  }

  const filtered =
    filter.length > 0
      ? games.filter((g) => filter.includes(g.league))
      : games;

  // State priority matches the API contract: in > pre > final > postponed.
  // Earlier versions used the legacy "post" state from the ESPN era — that
  // never matched anything the api-sports.io ingestion produces.
  const priority: Record<string, number> = { in: 0, pre: 1, final: 2, postponed: 3 };
  const sorted = [...filtered]
    .sort(
      (a, b) =>
        (priority[a.state ?? ""] ?? 4) - (priority[b.state ?? ""] ?? 4),
    )
    .slice(0, MAX_PREVIEW);

  if (sorted.length === 0)
    return <SportsEmptyState leagues={visibleMeta} onConfigure={onConfigure} />;

  return (
    <>
      {sorted.map((g) => {
        const isLive = g.state === "in";
        return (
          <div key={g.id} className="flex items-center px-4 py-2.5 gap-3">
            {isLive && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <span className="text-[10px] font-mono font-semibold text-fg-4 uppercase w-10 shrink-0 truncate">
              {g.league}
            </span>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {g.away_team_logo && (
                <img
                  src={g.away_team_logo}
                  alt=""
                  className="w-4 h-4 shrink-0 object-contain"
                />
              )}
              <span className="text-xs text-fg-2 truncate">
                {g.away_team_name || g.away_team_code}
              </span>
              <span className="text-xs text-fg-3 tabular-nums shrink-0">
                {g.away_team_score} – {g.home_team_score}
              </span>
              <span className="text-xs text-fg-2 truncate">
                {g.home_team_name || g.home_team_code}
              </span>
              {g.home_team_logo && (
                <img
                  src={g.home_team_logo}
                  alt=""
                  className="w-4 h-4 shrink-0 object-contain"
                />
              )}
            </div>
            <span className="text-[10px] text-fg-4 shrink-0 truncate max-w-24">
              {g.short_detail ?? g.status_short ?? ""}
            </span>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: Add the imports**

Near the top of `desktop/src/routes/feed.tsx`, add:

```tsx
import SportsEmptyState from "../channels/sports/EmptyState";
import type { LeagueMeta } from "../api/queries";
```

- [ ] **Step 4: Update the `SportsRows` callsite**

Find the callsite where `<SportsRows data={...} filter={...} onConfigure={...} />` is invoked in `feed.tsx`. Add a `meta` prop reading from the dashboard data:

```tsx
<SportsRows
  data={data.sports}
  meta={data.sports_meta?.leagues}
  filter={sportsFilter}
  onConfigure={onConfigureSports}
/>
```

The variable names (`data`, `sportsFilter`, `onConfigureSports`) might differ — use whatever the existing callsite uses, just add the new `meta` prop.

- [ ] **Step 5: Verify it builds**

Run:
```bash
cd desktop && npm run build
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/routes/feed.tsx
git commit -m "feat(desktop): wire SportsEmptyState into feed + fix priority map

Replaces generic EmptyDataRow with the context-aware SportsEmptyState
on the sports feed row. Off-season leagues, polling outages, and
next-game countdowns now display directly on the home feed instead
of just 'Empty'. Also fixes the legacy ESPN-era 'post' priority map
to match the api-sports.io state names (in/pre/final/postponed)."
```

---

## Task 15: Add "Stale" warning chip to catalog `LeagueStatus`

**Files:**
- Modify: `desktop/src/channels/sports/LeagueManager.tsx:474-506`

The catalog row component `LeagueStatus` shows live count, total games, off-season, or next-game countdown. Add a top-priority branch for unhealthy polling so the user sees when data is stale.

- [ ] **Step 1: Add the `AlertTriangle` import**

In `desktop/src/channels/sports/LeagueManager.tsx:14-19`, add `AlertTriangle` to the `lucide-react` import:

```tsx
import {
  Plus,
  Check,
  Search as SearchIcon,
  X,
  Star,
  Trophy,
  AlertTriangle,
} from "lucide-react";
```

- [ ] **Step 2: Add the unhealthy branch to `LeagueStatus`**

In `desktop/src/channels/sports/LeagueManager.tsx:474-506`, replace the `LeagueStatus` function:

```tsx
// ── League status ────────────────────────────────────────────────

function LeagueStatus({ league }: { league: TrackedLeague }) {
  // Polling-stale takes precedence over every other state — if we can't
  // get fresh data, the live/game counts shown below could be hours old.
  // Off-season leagues are exempt: we don't poll them, so they can't be
  // "stale" in a meaningful sense (the backend already marks them healthy=true).
  if (!league.polling_healthy) {
    const tooltipText = league.last_poll_success_at
      ? `Last successful update: ${new Date(league.last_poll_success_at).toLocaleString()}`
      : "This league has not polled successfully yet";
    return (
      <Tooltip content={tooltipText}>
        <span className="flex items-center gap-1 text-ui-chip text-amber-400">
          <AlertTriangle size={10} />
          Stale
        </span>
      </Tooltip>
    );
  }
  if (league.live_count > 0) {
    return (
      <span className="flex items-center justify-end gap-1 text-ui-chip text-live tabular-nums">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-live opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-live" />
        </span>
        {league.live_count} Live
      </span>
    );
  }
  if (league.game_count > 0) {
    return (
      <span className="text-ui-chip text-fg-3 tabular-nums">
        {league.game_count} game{league.game_count !== 1 ? "s" : ""}
      </span>
    );
  }
  if (league.is_offseason) {
    return <span className="text-ui-chip text-fg-3">Off-season</span>;
  }
  if (league.next_game) {
    return (
      <Tooltip content={`Next game: ${new Date(league.next_game).toLocaleString()}`}>
        <span className="text-ui-chip text-fg-3 tabular-nums">
          {formatCountdown(league.next_game)}
        </span>
      </Tooltip>
    );
  }
  return <span className="text-ui-chip text-fg-3">—</span>;
}
```

- [ ] **Step 3: Verify it builds**

Run:
```bash
cd desktop && npm run build
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/channels/sports/LeagueManager.tsx
git commit -m "feat(desktop): surface polling-stale state in league catalog

LeagueStatus now shows a 'Stale' chip with the last-success timestamp
in a tooltip when polling_healthy=false. Off-season leagues remain
healthy (backend marks them exempt). Previously a polling outage was
invisible until someone happened to notice game data was hours old."
```

---

## Task 16: Manual smoke-test pass

**Files:** None — this is verification.

Run all six scenarios from the spec against a local dev environment (Postgres + Redis + Rust service + Go API + desktop).

- [ ] **Step 1: Boot the stack**

```bash
# Terminal 1: sports Rust service
cd channels/sports/service && cargo run

# Terminal 2: sports Go API
cd channels/sports/api && go build -o sports_api && ./sports_api

# Terminal 3: core Go API
cd api && go build -o scrollr_api && ./scrollr_api

# Terminal 4: desktop
cd desktop && npm run tauri:dev
```

Wait for the schedule poll to complete at least once (look for `Schedule poll complete: N upserted` in the Rust service logs).

- [ ] **Step 2: Scenario 1 — off-season-only user**

Manually set a test user's sports leagues to NFL only:
```sql
UPDATE user_channels
SET config = jsonb_set(config, '{leagues}', '["NFL"]')
WHERE logto_sub = '<your_test_sub>' AND channel_type = 'sports';
```

Load the desktop feed. Expected: `<SportsEmptyState>` shows "All your leagues are off-season" with NFL's return countdown.

- [ ] **Step 3: Scenario 2 — Premier League upcoming game**

```sql
UPDATE user_channels
SET config = jsonb_set(config, '{leagues}', '["Premier League"]')
WHERE logto_sub = '<your_test_sub>' AND channel_type = 'sports';
```

Load feed. Expected: if there's a Premier League game today, it shows in the rows. If not, the empty-state shows "Next: Premier League • in Xd".

- [ ] **Step 4: Scenario 3 — Mixed leagues**

```sql
UPDATE user_channels
SET config = jsonb_set(config, '{leagues}', '["Premier League","NFL"]')
WHERE logto_sub = '<your_test_sub>' AND channel_type = 'sports';
```

Expected: Premier League games (if any) render normally; NFL doesn't appear in the empty-state branch because there are games to show.

- [ ] **Step 5: Scenario 4 — No leagues selected**

```sql
UPDATE user_channels
SET config = jsonb_set(config, '{leagues}', '[]')
WHERE logto_sub = '<your_test_sub>' AND channel_type = 'sports';
```

Expected: "No leagues configured yet" + "Open Settings to pick your leagues" CTA.

- [ ] **Step 6: Scenario 5 — Simulated polling outage**

Stop the Rust service. Manually backdate the polling-health for Premier League:
```sql
UPDATE tracked_leagues
SET last_poll_success_at = NOW() - INTERVAL '2 hours'
WHERE name = 'Premier League';
```

Reload desktop. Expected:
- Catalog row for Premier League shows "Stale" chip with tooltip "Last successful update: ..."
- Feed empty-state (if no games) shows "Live data unavailable — Premier League"

Restart the Rust service, wait for the next schedule poll, reload — staleness should clear.

- [ ] **Step 7: Scenario 6 — CDC cache bust**

Manually insert a game:
```sql
INSERT INTO games (league, sport, external_game_id, home_team_name, away_team_name, start_time, state)
VALUES ('Premier League', 'football', 'test-cdc-1', 'Liverpool', 'Arsenal', NOW() + INTERVAL '2 hours', 'pre');
```

Within 10s, the dashboard query should reflect the new game (CDC fires → cache bust → next fetch returns it).

- [ ] **Step 8: Clean up test data**

```sql
DELETE FROM games WHERE external_game_id = 'test-cdc-1';
```

- [ ] **Step 9: If all six scenarios pass, you're done**

Open the PR.

```bash
gh pr create --title "fix(sports): channel hardening — fixes Premier League fixtures, off-season UX, polling health" --body "$(cat <<'EOF'
## Summary

- Drops the 12h future cutoff in poll_schedule that silently dropped next-day Premier League fixtures.
- Widens schedule horizon from 1 day to 7 days so weekend fixtures show up on Monday.
- Per-league fair-share rate budget within shared API hosts — Champions League can no longer starve Premier League polls.
- Per-state cleanup thresholds: pre-game rows survive 7 days past kickoff (was 12h), so a single missed poll doesn't vanish a game.
- Adds last_polled_at / last_poll_success_at / last_poll_error columns + polling_healthy derived field.
- New SportsEmptyState component surfaces off-season / next-game / polling-stale on the home feed (was a generic "Empty").
- Catalog rows show a "Stale" chip when polling has fallen behind.
- Removes the dead duplicate channels/sports/configs/leagues.json.

## Spec

docs/superpowers/specs/2026-05-11-sports-channel-hardening.md

## Plan

docs/superpowers/plans/2026-05-11-sports-channel-hardening.md

## Test plan

Six manual smoke scenarios from the plan, all passing locally:
1. Off-season-only user shows "All your leagues are off-season" with countdown.
2. Premier League user sees either games or "Next: in Xd" countdown.
3. Mixed leagues render normally.
4. Zero leagues shows Configure CTA.
5. Simulated polling outage shows "Stale" chip + "Live data unavailable" empty-state.
6. CDC cache bust still works after the response shape change.

## Rollback

- Migration is idempotent (`ADD COLUMN IF NOT EXISTS`). Down-migration drops the three columns; leaving them in place after a code rollback is harmless.
- API response shape is backwards-compatible: old desktop clients read `data.sports` (unchanged) and ignore `data.sports_meta`.
EOF
)"
```

---

## Self-review (run by the plan author)

### Spec coverage

Walking the spec → tasks:

- ✅ Remove 12h cutoff → Task 7
- ✅ Widen `SCHEDULE_DAYS_AHEAD` to 7 → Task 7
- ✅ Per-league fair-share rate budget → Tasks 5 + 6
- ✅ Pre-game cleanup at 7 days → Task 4
- ✅ Polling-health columns → Tasks 2 + 3 + 8 + 7 (writes)
- ✅ Catalog endpoint exposes polling-health → Task 9
- ✅ Dashboard `meta` field → Tasks 10 + 11
- ✅ Public endpoint `meta` field → Task 11
- ✅ Shared `loadLeagueStatus` helper → Task 10
- ✅ Desktop `LeagueMeta` type + `sports_meta` → Task 12
- ✅ `SportsEmptyState` component with 5-branch decision tree → Task 13
- ✅ Wire empty-state into feed.tsx → Task 14
- ✅ Fix `final`/`post` priority map → Task 14
- ✅ Polling-health indicator in catalog → Task 15
- ✅ Delete stale config file → Task 1
- ✅ Smoke tests → Task 16

### Placeholder scan

No "TBD", no "implement later", no "similar to Task N." All code blocks contain the actual content.

### Type consistency

- `LeagueMeta` shape:
  - Go (`models.go`): `Name string, IsOffseason bool, NextGame *time.Time, PollingHealthy bool` → JSON: `{name, is_offseason, next_game, polling_healthy}`
  - TS (`queries.ts`): `{ name: string; is_offseason: boolean; next_game: string | null; polling_healthy: boolean }`
  - Match: ✅
- `SportsResponse` / `SportsMeta`:
  - Go: `{Sports []Game, Meta SportsMeta{Leagues []LeagueMeta}}` → JSON: `{sports, meta: {leagues}}`
  - TS: `DashboardResponse.data.sports_meta: SportsMeta { leagues: LeagueMeta[] }` — note the dashboard uses the sibling key `sports_meta`, not nested `meta`.
  - Public/user endpoints (non-dashboard): use the nested form `{sports, meta}` directly.
  - This is intentional and documented in Tasks 11 + 12. ✅
- `polling_healthy` rule:
  - Spec: derived as `last_poll_success_at != nil && time.Since(*last_poll_success_at) < 90 min`, OR off-season.
  - Go catalog: `IsOffseason || (LastPollSuccessAt != nil && time.Since(*LastPollSuccessAt) < PollingStaleThreshold)` ✅
  - Go meta: same ✅
- `RateLimiter` legacy methods (`has_budget`, `update`, `remaining`) are preserved in the rewritten struct for standings + teams polls. ✅
- The `formatCountdown` import in `EmptyState.tsx` matches the existing export at `desktop/src/utils/gameHelpers.ts:74`. ✅

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-11-sports-channel-hardening.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
