use std::{collections::HashMap, env, time::Duration, sync::Arc};
use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
pub use sqlx::PgPool;
use sqlx::{FromRow, query, query_as};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;

/// Build the sqlx migrator for this service.
///
/// `set_ignore_missing(true)` is required because all three Rust services
/// (finance, sports, rss) share a single `_sqlx_migrations` table in the
/// scrollr Postgres DB — sqlx 0.8.x has no API to name the table per
/// service (see PRs #106 / #107). Without this flag, each service sees
/// the other services' rows and errors out with `VersionMissing` because
/// e.g. sports has no `11*` files on disk.
///
/// With each service on a unique numeric version prefix (finance 11*,
/// sports 12*, rss 20250601*/13*), the flag tolerates "versions recorded
/// for *other* services" without hiding checksum drift on *this*
/// service's own rows — VersionMismatch (drift on an applied row whose
/// file *is* on disk) still fires and fails the boot loudly, which is
/// the behavior PR #106 was after.
fn migrator() -> sqlx::migrate::Migrator {
    let mut m = sqlx::migrate!("./migrations");
    m.set_ignore_missing(true);
    m
}

/// Numeric version range that uniquely identifies sports-service migrations
/// in the shared `_sqlx_migrations` table. Must match the prefix enforced by
/// `tests/migration_versions.rs` (PREFIX_LO / PREFIX_HI).
///
/// Sports migration filenames start with `12` and are 12 digits long, e.g.
/// `120000000001_initial.up.sql`. That's a version of 120_000_000_001
/// (one hundred twenty billion and one), so the prefix range is 120B..<130B.
/// An earlier version of these constants was 12_000_000_000..=12_999_999_999
/// which is off by exactly 10× and silently matches NO real migration rows;
/// that caused the invariant check below to reliably fail on production
/// boot because `recorded` was always 0. See tests/migration_versions.rs
/// for the matching test-side constants.
pub const SPORTS_MIGRATION_MIN: i64 = 120_000_000_000;
pub const SPORTS_MIGRATION_MAX: i64 = 129_999_999_999;

pub async fn initialize_pool() -> Result<PgPool> {
    let pool_options = PgPoolOptions::new()
        // Pool sizing rationale: sports runs parallel per-league polls and
        // each one can spawn several concurrent upserts. Ten connections
        // was producing occasional `acquire_timeout` pressure when several
        // leagues completed their fetch simultaneously; 20 gives headroom
        // without straining the Postgres connection budget.
        .max_connections(20)
        // Keep one warm connection so the first query after an idle period
        // doesn't eat the TLS/auth handshake latency.
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(30));

    let database_url = if let Ok(url) = env::var("DATABASE_URL") {
        let mut url = url.trim().trim_matches('"').trim_matches('\'').to_string();
        if url.starts_with("postgres:") && !url.starts_with("postgres://") {
            url = url.replacen("postgres:", "postgres://", 1);
        } else if url.starts_with("postgresql:") && !url.starts_with("postgresql://") {
            url = url.replacen("postgresql:", "postgresql://", 1);
        }
        url
    } else {
        let get_env_var = |key: &str| -> Result<String> {
            env::var(key).with_context(|| format!("Missing environment variable: {}", key))
        };

        let raw_host = get_env_var("DB_HOST")?;
        let port_str = get_env_var("DB_PORT")?;
        let user = get_env_var("DB_USER")?;
        let password = get_env_var("DB_PASSWORD")?;
        let database = get_env_var("DB_DATABASE")?;

        // Use the raw host as-is. Older code stripped a `db.` prefix as a
        // holdover from Supabase-era hostnames; that was silently rewriting
        // any legitimate host starting with `db.`, which is undefined
        // behaviour with no logging. If the host is wrong the operator
        // should see a connect failure, not magical rewriting.
        let port: u16 = port_str.parse().context("DB_PORT must be a valid u16 integer")?;

        format!("postgres://{}:{}@{}:{}/{}", user, password, raw_host, port, database)
    };

    eprintln!("[DB] Connecting to database...");
    let pool = tokio::time::timeout(
        Duration::from_secs(15),
        pool_options.connect(&database_url),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Connection attempt timed out (15s)"))?
    .context("Failed to connect to the PostgreSQL database")?;
    eprintln!("[DB] Connected successfully, running migrations...");

    // Run migrations. A previous iteration of this code caught migration
    // errors, wiped `_sqlx_migrations`, and re-ran the migrator — that path
    // was data-unsafe. Failed migrations now propagate with the full sqlx
    // error chain (including `VersionMismatch(version)` and the colliding
    // file name) so an on-call engineer can diagnose without having to
    // re-run the binary under a debugger. See the long troubleshooting
    // note in AGENTS.md under "Database Migrations".
    let m = migrator();
    if let Err(err) = m.run(&pool).await {
        eprintln!("[DB] Migration failure: {err}");
        eprintln!("[DB] Underlying error chain: {err:?}");
        return Err(anyhow::Error::new(err)
            .context("Failed to run migrations. No automatic recovery — inspect _sqlx_migrations"));
    }
    eprintln!("[DB] Migrations complete");

    // Startup invariant: every on-disk migration for *this* service's
    // version range must have a corresponding recorded row in
    // `_sqlx_migrations`. Guards against "file deleted but row still in DB"
    // drift that `set_ignore_missing(true)` silently tolerates.
    //
    // IMPORTANT: only count UP migrations. `migrator().iter()` yields both
    // halves of each reversible migration (`ReversibleUp` + `ReversibleDown`),
    // so for 6 `.up.sql` + 6 `.down.sql` files it returns 12 while the
    // DB records only 6 rows. See finance database.rs + commit 2cb0e90.
    let on_disk: i64 = migrator()
        .iter()
        .filter(|m| m.migration_type.is_up_migration())
        .count() as i64;
    let recorded: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM _sqlx_migrations WHERE version >= $1 AND version <= $2",
    )
    .bind(SPORTS_MIGRATION_MIN)
    .bind(SPORTS_MIGRATION_MAX)
    .fetch_one(&pool)
    .await
    .context("query migration count")?;

    if recorded != on_disk {
        anyhow::bail!(
            "migration invariant violated: {} up-migrations on disk but {} recorded in DB \
             (sports prefix {}-{}). Someone deleted a migration file, or this service is \
             pointing at a DB whose migrations haven't been applied.",
            on_disk,
            recorded,
            SPORTS_MIGRATION_MIN,
            SPORTS_MIGRATION_MAX
        );
    }

    eprintln!(
        "[DB] Migration invariant check ok: {on_disk} up-migrations on disk / \
         {recorded} recorded in {SPORTS_MIGRATION_MIN}..={SPORTS_MIGRATION_MAX}"
    );

    Ok(pool)
}

// =============================================================================
// League Config — loaded from configs/leagues.json and stored in tracked_leagues
// =============================================================================

#[derive(Deserialize, Clone, Debug, FromRow)]
pub struct LeagueConfig {
    pub name: String,
    pub sport_api: String,
    pub api_host: String,
    pub league_id: i32,
    pub category: String,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub logo_url: Option<String>,
    #[serde(default)]
    pub season: Option<String>,
    #[serde(default)]
    pub season_format: Option<String>,
    #[serde(default)]
    pub offseason_months: Option<Vec<i32>>,
}

/// Stored league row read back from the database.
#[derive(Debug, Clone, FromRow)]
pub struct TrackedLeague {
    pub name: String,
    pub sport_api: String,
    pub api_host: String,
    pub league_id: i32,
    pub category: String,
    pub country: Option<String>,
    pub logo_url: Option<String>,
    pub season: Option<String>,
    pub season_format: Option<String>,
    pub offseason_months: Option<Vec<i32>>,
}

impl TrackedLeague {
    /// True when `month` (1-12) falls inside this league's configured
    /// off-season window. Leagues without `offseason_months` are treated
    /// as always in season.
    pub fn is_offseason(&self, month: i32) -> bool {
        self.offseason_months
            .as_ref()
            .is_some_and(|months| months.contains(&month))
    }
}

// =============================================================================
// Game data — normalized from all api-sports.io sport APIs
// =============================================================================

#[derive(Debug)]
pub struct CleanedData {
    pub league: String,
    pub sport: String,
    pub external_game_id: String,
    pub link: Option<String>,
    pub home_team: Team,
    pub away_team: Team,
    pub start_time: chrono::DateTime<Utc>,
    pub short_detail: Option<String>,
    pub state: String,
    pub status_short: Option<String>,
    pub status_long: Option<String>,
    pub timer: Option<String>,
    pub venue: Option<String>,
    pub season: Option<String>,
}

#[derive(Debug)]
pub struct Team {
    pub name: String,
    pub logo: Option<String>,
    pub score: Option<i32>,
    pub code: Option<String>,
}

// =============================================================================
// Tracked league queries
// =============================================================================

pub async fn get_tracked_leagues(pool: Arc<PgPool>) -> Vec<TrackedLeague> {
    let statement = "
        SELECT name, sport_api, api_host, league_id, category, country, logo_url, season, season_format, offseason_months
        FROM tracked_leagues
        WHERE is_enabled = TRUE
    ";
    let res: Result<Vec<TrackedLeague>, sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        let data = query_as(statement).fetch_all(&mut *connection).await?;
        Ok(data)
    }.await;

    match res {
        Ok(data) => data,
        Err(e) => {
            log::error!("Failed to get tracked leagues: {}", e);
            Vec::new()
        }
    }
}

pub async fn seed_tracked_leagues(pool: Arc<PgPool>, leagues: Vec<LeagueConfig>) -> Result<()> {
    let statement = "
        INSERT INTO tracked_leagues (name, sport_api, api_host, league_id, category, country, logo_url, season, season_format, offseason_months)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (name) DO UPDATE SET
            sport_api = EXCLUDED.sport_api,
            api_host = EXCLUDED.api_host,
            league_id = EXCLUDED.league_id,
            category = EXCLUDED.category,
            country = EXCLUDED.country,
            logo_url = EXCLUDED.logo_url,
            season = EXCLUDED.season,
            season_format = EXCLUDED.season_format,
            offseason_months = EXCLUDED.offseason_months
    ";
    let mut connection = pool.acquire().await?;
    for league in leagues {
        query(statement)
            .bind(&league.name)
            .bind(&league.sport_api)
            .bind(&league.api_host)
            .bind(league.league_id)
            .bind(&league.category)
            .bind(&league.country)
            .bind(&league.logo_url)
            .bind(&league.season)
            .bind(&league.season_format)
            .bind(&league.offseason_months)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

/// Disable any tracked_leagues rows not present in the config file.
/// This cleans up old ESPN-era leagues (e.g. "College Football") that were
/// never overwritten by the ON CONFLICT upsert (different names).
pub async fn disable_stale_leagues(pool: &Arc<PgPool>, active_names: &[String]) -> Result<()> {
    if active_names.is_empty() {
        return Ok(());
    }
    let mut connection = pool.acquire().await?;
    query("UPDATE tracked_leagues SET is_enabled = false WHERE name != ALL($1) AND is_enabled = true")
        .bind(active_names)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

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
    // Walk char boundaries so we never split a multi-byte UTF-8 sequence —
    // panicking inside error-handling code would lose the original failure.
    let truncated: &str = if err_msg.len() > 1024 {
        let mut end = 1024;
        while end > 0 && !err_msg.is_char_boundary(end) {
            end -= 1;
        }
        &err_msg[..end]
    } else {
        err_msg
    };

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

/// Return distinct league names that have live games from yesterday (UTC).
/// Used by poll_live to decide whether to also query yesterday's date.
pub async fn get_live_yesterday_leagues(pool: &Arc<PgPool>) -> Vec<String> {
    let today_start = Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("valid midnight timestamp");
    let today_utc = today_start.and_utc();

    let result: Result<Vec<(String,)>, sqlx::Error> = async {
        let mut conn = pool.acquire().await?;
        let rows = sqlx::query_as(
            "SELECT DISTINCT league FROM games WHERE state = 'in' AND start_time < $1"
        )
        .bind(today_utc)
        .fetch_all(&mut *conn)
        .await?;
        Ok(rows)
    }.await;

    match result {
        Ok(rows) => rows.into_iter().map(|(league,)| league).collect(),
        Err(e) => {
            log::warn!("Failed to query live-yesterday leagues, skipping yesterday poll: {}", e);
            Vec::new()
        }
    }
}

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

// =============================================================================
// Rate budget persistence — sports_rate_budget (host, UTC day) → consumed
// =============================================================================

/// Load today's (UTC) consumed request count per host. Used once on startup
/// to seed the RateLimiter so a mid-day restart resumes from the quota
/// actually spent instead of a fresh full budget.
///
/// Errors are logged and yield an empty map (fail open: the service starts
/// with full budgets, which is exactly the pre-persistence behavior). The
/// header clamp in RateLimiter::update still catches the overshoot.
pub async fn get_consumed_today(pool: &Arc<PgPool>) -> HashMap<String, u32> {
    let today = Utc::now().date_naive();
    let result: Result<Vec<(String, i32)>, sqlx::Error> = async {
        let mut conn = pool.acquire().await?;
        let rows = query_as("SELECT host, consumed FROM sports_rate_budget WHERE day = $1")
            .bind(today)
            .fetch_all(&mut *conn)
            .await?;
        Ok(rows)
    }.await;

    match result {
        Ok(rows) => rows
            .into_iter()
            .map(|(host, consumed)| (host, consumed.max(0) as u32))
            .collect(),
        Err(e) => {
            log::error!("Failed to load persisted rate-budget consumption, starting from full quota: {}", e);
            HashMap::new()
        }
    }
}

/// Add per-host consumption deltas to the given UTC day's rows. Additive
/// upsert (`consumed + delta`, not overwrite) so flushes are safe even if
/// another writer touched the row between flushes.
pub async fn add_consumed(
    pool: &Arc<PgPool>,
    day: NaiveDate,
    deltas: &HashMap<String, u32>,
) -> Result<()> {
    let mut conn = pool.acquire().await?;
    for (host, delta) in deltas {
        query(
            "INSERT INTO sports_rate_budget (host, day, consumed)
             VALUES ($1, $2, $3)
             ON CONFLICT (host, day) DO UPDATE SET
                 consumed = sports_rate_budget.consumed + EXCLUDED.consumed,
                 updated_at = NOW()"
        )
        .bind(host)
        .bind(day)
        .bind(*delta as i32)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Delete rate-budget rows older than a week. Only today's row is ever read
/// back; a week of history is kept for operator debugging (e.g. comparing
/// against the api-sports dashboard after a quota incident).
pub async fn prune_rate_budget(pool: &Arc<PgPool>) -> Result<u64> {
    let cutoff = Utc::now().date_naive() - chrono::Days::new(7);
    let mut conn = pool.acquire().await?;
    let result = query("DELETE FROM sports_rate_budget WHERE day < $1")
        .bind(cutoff)
        .execute(&mut *conn)
        .await?;
    Ok(result.rows_affected())
}

// =============================================================================
// Game upsert
// =============================================================================

pub async fn upsert_game(pool: Arc<PgPool>, game: CleanedData) -> Result<()> {
    let statement = "
        INSERT INTO games (
            league, sport, external_game_id, link,
            home_team_name, home_team_logo, home_team_score, home_team_code,
            away_team_name, away_team_logo, away_team_score, away_team_code,
            start_time, short_detail, state,
            status_short, status_long, timer, venue, season
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (league, external_game_id)
        DO UPDATE SET
            sport = EXCLUDED.sport,
            link = EXCLUDED.link,
            home_team_name = EXCLUDED.home_team_name,
            home_team_logo = EXCLUDED.home_team_logo,
            home_team_score = EXCLUDED.home_team_score,
            home_team_code = EXCLUDED.home_team_code,
            away_team_name = EXCLUDED.away_team_name,
            away_team_logo = EXCLUDED.away_team_logo,
            away_team_score = EXCLUDED.away_team_score,
            away_team_code = EXCLUDED.away_team_code,
            start_time = EXCLUDED.start_time,
            short_detail = EXCLUDED.short_detail,
            state = EXCLUDED.state,
            status_short = EXCLUDED.status_short,
            status_long = EXCLUDED.status_long,
            timer = EXCLUDED.timer,
            venue = EXCLUDED.venue,
            season = EXCLUDED.season,
            updated_at = CURRENT_TIMESTAMP;
    ";
    let mut connection = pool.acquire().await?;
    query(statement)
        .bind(&game.league)
        .bind(&game.sport)
        .bind(game.external_game_id)
        .bind(game.link)
        .bind(game.home_team.name)
        .bind(game.home_team.logo)
        .bind(game.home_team.score)
        .bind(game.home_team.code)
        .bind(game.away_team.name)
        .bind(game.away_team.logo)
        .bind(game.away_team.score)
        .bind(game.away_team.code)
        .bind(game.start_time)
        .bind(game.short_detail)
        .bind(game.state)
        .bind(game.status_short)
        .bind(game.status_long)
        .bind(game.timer)
        .bind(game.venue)
        .bind(game.season)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

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
    pub sport_api: Option<String>,
    pub pct: Option<String>,
    pub games_behind: Option<String>,
    pub otl: Option<i32>,
    pub goals_for: Option<i32>,
    pub goals_against: Option<i32>,
    pub points_for: Option<i32>,
    pub points_against: Option<i32>,
    pub streak: Option<String>,
}

pub async fn upsert_standing(pool: &Arc<PgPool>, s: StandingData) -> Result<()> {
    let mut conn = pool.acquire().await?;
    query(
        "INSERT INTO standings (league, team_name, team_code, team_logo, rank, wins, losses, draws, points, games_played, goal_diff, description, form, group_name, season, sport_api, pct, games_behind, otl, goals_for, goals_against, points_for, points_against, streak)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
         ON CONFLICT (league, team_name, season) DO UPDATE SET
             team_code = EXCLUDED.team_code, team_logo = EXCLUDED.team_logo,
             rank = EXCLUDED.rank, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
             draws = EXCLUDED.draws, points = EXCLUDED.points,
             games_played = EXCLUDED.games_played, goal_diff = EXCLUDED.goal_diff,
             description = EXCLUDED.description, form = EXCLUDED.form,
             group_name = EXCLUDED.group_name, sport_api = EXCLUDED.sport_api,
             pct = EXCLUDED.pct, games_behind = EXCLUDED.games_behind,
             otl = EXCLUDED.otl, goals_for = EXCLUDED.goals_for,
             goals_against = EXCLUDED.goals_against, points_for = EXCLUDED.points_for,
             points_against = EXCLUDED.points_against, streak = EXCLUDED.streak,
             updated_at = CURRENT_TIMESTAMP"
    )
    .bind(&s.league).bind(&s.team_name).bind(&s.team_code).bind(&s.team_logo)
    .bind(s.rank).bind(s.wins).bind(s.losses).bind(s.draws).bind(s.points)
    .bind(s.games_played).bind(s.goal_diff).bind(&s.description).bind(&s.form)
    .bind(&s.group_name).bind(&s.season).bind(&s.sport_api).bind(&s.pct)
    .bind(&s.games_behind).bind(s.otl).bind(s.goals_for).bind(s.goals_against)
    .bind(s.points_for).bind(s.points_against).bind(&s.streak)
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
