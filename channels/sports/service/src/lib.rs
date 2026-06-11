use std::{env, fs, sync::Arc};
use anyhow::{Context, Result};
use reqwest::{Client, header};
use tokio::sync::Mutex;
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, Utc};
use crate::log::{error, info, warn};
use crate::database::{
    PgPool,
    get_tracked_leagues, seed_tracked_leagues, disable_stale_leagues,
    cleanup_old_games, get_live_yesterday_leagues,
    LeagueConfig, TrackedLeague, upsert_game, CleanedData, Team,
    StandingData, upsert_standing, TeamData, upsert_team,
};
pub use crate::types::{SportsHealth, RateLimiter};

pub mod log;
pub mod database;
pub mod init;
pub mod types;

/// Number of days ahead to poll in the schedule task. 7 days covers a full
/// week of fixtures — Premier League Saturday matches show up Monday morning.
///
/// Rate-budget impact: only in-season leagues are polled (off-season leagues
/// are skipped in both poll_live and poll_schedule). Worst case on the
/// football host is 4 simultaneous in-season leagues (Aug–Nov, Mar–May):
/// 4 leagues × 8 dates × 48 polls/day = 1,536 schedule calls/day, leaving
/// ~6,000 of the 7,500/day quota for live polling.
const SCHEDULE_DAYS_AHEAD: i64 = 7;

/// Delay between league requests on startup burst to avoid rate limits.
/// 200ms spacing between requests spreads ~60 requests across ~12 seconds.
const STARTUP_REQUEST_DELAY_MS: u64 = 200;

// =============================================================================
// Service initialization (runs once on startup)
// =============================================================================

/// Outcome of `init_sports_service`. The failure variants name the exact
/// condition so `main.rs` can surface a useful reason via the readiness
/// gate before the process exits.
#[derive(Debug)]
pub enum InitError {
    /// The `tracked_leagues` table has no enabled rows and `configs/leagues.json`
    /// did not supply any either. There is no work to do and nothing to poll.
    NoLeaguesConfigured,
    /// `API_SPORTS_KEY` is missing or empty. The service literally cannot make
    /// a single request.
    MissingApiKey,
    /// HTTP client construction failed — either the TLS stack is broken or the
    /// API key contains bytes that aren't valid in an HTTP header. Both are
    /// unrecoverable config/env problems.
    ClientBuild(String),
}

impl std::fmt::Display for InitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InitError::NoLeaguesConfigured => {
                write!(f, "No leagues to track: tracked_leagues is empty and configs/leagues.json yielded no entries")
            }
            InitError::MissingApiKey => {
                write!(f, "API_SPORTS_KEY is not set or empty")
            }
            InitError::ClientBuild(msg) => {
                write!(f, "Failed to build HTTP client: {msg}")
            }
        }
    }
}

/// Initialize the sports service: seed tracked leagues from the config file,
/// then load the active set from the database. Returns the API client and
/// tracked leagues on success, or an explicit [`InitError`] so the caller
/// can surface the exact cause via the readiness gate before exiting.
///
/// Note: this function no longer inspects the `games` table for "old ESPN
/// data" and truncates it. That startup-side effect existed during the
/// ESPN → api-sports.io migration (early 2026). It is now an active
/// foot-gun: anything that accidentally leaves a row with an empty `sport`
/// field would wipe the whole table on the next pod restart. All production
/// data has been in the new format for months.
pub async fn init_sports_service(
    pool: &Arc<PgPool>,
) -> Result<(Client, Vec<TrackedLeague>), InitError> {
    info!("Starting sports service...");

    // Seed from JSON config — always upsert to pick up new leagues
    if let Ok(file_contents) = fs::read_to_string("./configs/leagues.json") {
        match serde_json::from_str::<Vec<LeagueConfig>>(&file_contents) {
            Ok(config) => {
                info!("Seeding/updating {} leagues from config", config.len());
                let active_names: Vec<String> = config.iter().map(|l| l.name.clone()).collect();
                if let Err(e) = seed_tracked_leagues(pool.clone(), config).await {
                    error!("Failed to seed tracked leagues: {}", e);
                }
                // Disable any old leagues not in the current config (e.g. ESPN-era names)
                if let Err(e) = disable_stale_leagues(pool, &active_names).await {
                    warn!("Failed to disable stale leagues: {}", e);
                }
            }
            Err(e) => error!("Failed to parse leagues.json: {}", e),
        }
    } else {
        warn!("Could not read ./configs/leagues.json");
    }

    let leagues = get_tracked_leagues(pool.clone()).await;
    if leagues.is_empty() {
        error!("No leagues to track.");
        return Err(InitError::NoLeaguesConfigured);
    }

    // Trim the API key so a trailing newline (common when pasted from a web
    // UI or interpolated via `echo`) doesn't cause `HeaderValue::from_str`
    // to fail deeper in `build_client` with a cryptic error.
    let api_key = env::var("API_SPORTS_KEY").unwrap_or_default().trim().to_string();
    if api_key.is_empty() {
        error!("API_SPORTS_KEY not set. Cannot poll api-sports.io.");
        return Err(InitError::MissingApiKey);
    }

    let client = build_client(&api_key).map_err(|e| InitError::ClientBuild(format!("{e:#}")))?;
    info!("Initialized with {} leagues", leagues.len());
    Ok((client, leagues))
}

// =============================================================================
// Live polling (fast — today + yesterday when needed, every 30s-1min)
// =============================================================================

/// Poll today's games for live score updates. Called on the fast interval.
/// Also polls yesterday's date for leagues that still have live games from
/// yesterday (handles UTC midnight boundary — US evening games that started
/// on the previous UTC date).
pub async fn poll_live(
    pool: &Arc<PgPool>,
    client: &Client,
    leagues: &[TrackedLeague],
    health_state: &Arc<Mutex<SportsHealth>>,
    rate_limiter: &Arc<RateLimiter>,
) {
    let now = Utc::now();
    let today = now.format("%Y-%m-%d").to_string();
    let yesterday = (now - Duration::days(1)).format("%Y-%m-%d").to_string();

    // Check which leagues still have live games from yesterday's UTC date.
    // On DB error this returns empty — we only poll today (fail safe).
    let yesterday_leagues = get_live_yesterday_leagues(pool).await;
    let has_yesterday = !yesterday_leagues.is_empty();
    let yesterday_set: std::collections::HashSet<&str> =
        yesterday_leagues.iter().map(|s| s.as_str()).collect();

    if has_yesterday {
        info!("Yesterday live games detected for {} league(s): {}",
            yesterday_leagues.len(), yesterday_leagues.join(", "));
    }

    let mut total_upserted = 0u32;
    let mut total_failed = 0u32;
    let mut leagues_with_live = 0u32;

    let current_month = now.month() as i32;

    for league in leagues {
        // Off-season leagues have no fixtures — polling them burns the shared
        // budget pool on requests that return empty. Skip silently (this loop
        // runs every 30-60s; logging would flood).
        if league.is_offseason(current_month) {
            continue;
        }

        if !rate_limiter.try_consume(&league.name) {
            warn!("[{}] Skipping live poll — per-league budget exhausted (reserved={}, shared={})",
                league.name,
                rate_limiter.reserved(&league.name),
                rate_limiter.shared_remaining(&league.sport_api));
            continue;
        }

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

        // Also poll yesterday if this league has live games from yesterday
        if yesterday_set.contains(league.name.as_str()) {
            if !rate_limiter.try_consume(&league.name) {
                warn!("[{}] Skipping yesterday poll — per-league budget exhausted", league.name);
                continue;
            }
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
        }
    }

    let mut health = health_state.lock().await;
    health.record_success(leagues.len() as u32, leagues_with_live);
    health.set_rate_limits(rate_limiter.all_remaining());

    if total_failed > 0 {
        info!("Live poll complete: {} upserted, {} failed across {} leagues", total_upserted, total_failed, leagues.len());
    }
}

// =============================================================================
// Schedule polling (slow — today + 7 days ahead, every 30 min)
// =============================================================================

/// Poll today + SCHEDULE_DAYS_AHEAD upcoming dates to populate the schedule.
/// Each polled league records `last_polled_at` / `last_poll_success_at` so
/// the API can surface a `polling_healthy` indicator. Cleanup of stale games
/// runs at the end of every cycle (per-state thresholds in cleanup_old_games).
pub async fn poll_schedule(
    pool: &Arc<PgPool>,
    client: &Client,
    leagues: &[TrackedLeague],
    rate_limiter: &Arc<RateLimiter>,
) {
    let now = Utc::now();

    // Build list of dates: today, +1 ... +SCHEDULE_DAYS_AHEAD
    let mut dates = Vec::with_capacity((SCHEDULE_DAYS_AHEAD + 1) as usize);
    for offset in 0..=SCHEDULE_DAYS_AHEAD {
        dates.push((now + Duration::days(offset)).format("%Y-%m-%d").to_string());
    }

    // Defensive guard: the loop above always pushes at least one date when
    // `SCHEDULE_DAYS_AHEAD >= 0`, but if the constant were ever changed to a
    // negative value the `.first().unwrap() / .last().unwrap()` below would
    // panic. Bail out with a warning instead.
    if dates.is_empty() {
        warn!("[Sports] poll_schedule invoked with no dates to query");
        return;
    }

    info!("Schedule poll: fetching {} days ({} to {}) for {} leagues",
        dates.len(), dates.first().unwrap(), dates.last().unwrap(), leagues.len());

    let mut total_upserted = 0u32;
    let mut total_failed = 0u32;

    let current_month = now.month() as i32;

    for league in leagues {
        // Formula 1 fetches the whole season (no date param), skip per-date polling
        if league.sport_api == "formula-1" {
            continue;
        }

        // Off-season leagues have no upcoming fixtures inside the 8-date
        // window. Skipping saves 8 requests × 48 cycles/day per dormant
        // league — with three off-season soccer leagues that's ~1,150
        // football-host requests/day spent on empty schedules.
        if league.is_offseason(current_month) {
            info!("[{}] Skipping schedule poll — off-season in month {}", league.name, current_month);
            continue;
        }

        for date in &dates {
            if !rate_limiter.try_consume(&league.name) {
                warn!("[{}] Skipping schedule poll — per-league budget exhausted (reserved={}, shared={})",
                    league.name,
                    rate_limiter.reserved(&league.name),
                    rate_limiter.shared_remaining(&league.sport_api));
                break;
            }

            // Bookkeeping is called once per (league, date). The "latest call
            // wins" semantics in `record_poll_success` / `record_poll_error`
            // are intentional: across an 8-date cycle, the final tracked_leagues
            // state reflects the most-recent poll outcome. Do not deduplicate
            // to once-per-league or `last_poll_error` will lag a recovered poll.
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

            // Spread requests to avoid rate limiting on startup
            tokio::time::sleep(std::time::Duration::from_millis(STARTUP_REQUEST_DELAY_MS)).await;
        }
    }

    info!("Schedule poll complete: {} upserted, {} failed", total_upserted, total_failed);

    // Clean up stale games
    match cleanup_old_games(pool).await {
        Ok(count) => {
            if count > 0 {
                info!("Cleaned up {} stale games", count);
            }
        }
        Err(e) => warn!("Failed to clean up old games: {}", e),
    }
}

// =============================================================================
// Standings polling (daily — every 24 hours)
// =============================================================================

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

        let (base, is_mock) = match std::env::var("API_SPORTS_BASE_URL") {
            Ok(override_url) => (override_url.trim_end_matches('/').to_string(), true),
            Err(_) => (format!("https://{}", league.api_host), false),
        };
        let mut url = format!(
            "{}/standings?league={}&season={}",
            base, league.league_id, season
        );
        if is_mock {
            url = format!("{}&sport={}", url, league.sport_api);
        }

        // Standings requests don't go through try_consume (has_budget gate
        // above), so record them against the persisted consumption count.
        rate_limiter.note_consumed(&league.sport_api, 1);
        match client.get(&url).send().await {
            Ok(resp) => {
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
                        parse_and_upsert_standings(pool, &league.name, &season, &league.sport_api, &response).await;
                    }
                    Err(e) => warn!("[{}] Failed to parse standings JSON: {}", league.name, e),
                }
            }
            Err(e) => error!("[{}] Standings request failed: {}", league.name, e),
        }

        // Spread requests to avoid rate limiting on startup
        tokio::time::sleep(std::time::Duration::from_millis(STARTUP_REQUEST_DELAY_MS)).await;
    }
    info!("Standings poll complete");
}

async fn parse_and_upsert_standings(
    pool: &Arc<PgPool>,
    league_name: &str,
    season: &str,
    sport_api: &str,
    response: &[serde_json::Value],
) {
    // Route to the appropriate parser based on sport API
    match sport_api {
        "football" => parse_football_standings(pool, league_name, season, sport_api, response).await,
        "american-football" => parse_v1_standings(pool, league_name, season, sport_api, response).await,
        "basketball" => parse_basketball_standings(pool, league_name, season, sport_api, response).await,
        "hockey" => parse_hockey_standings(pool, league_name, season, sport_api, response).await,
        "baseball" => parse_basketball_standings(pool, league_name, season, sport_api, response).await, // Same as basketball format
        "rugby" | "afl" => parse_v1_standings(pool, league_name, season, sport_api, response).await,
        "handball" | "volleyball" => parse_basketball_standings(pool, league_name, season, sport_api, response).await,
        _ => {
            // Default to football-style parser
            parse_football_standings(pool, league_name, season, sport_api, response).await;
        }
    }
}

/// Parse soccer/football standings (v3 API, nested league.standings structure)
async fn parse_football_standings(
    pool: &Arc<PgPool>,
    league_name: &str,
    season: &str,
    sport_api: &str,
    response: &[serde_json::Value],
) {
    for entry in response {
        // Football: nested response[].league.standings arrays
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
                    sport_api: Some(sport_api.to_string()),
                    pct: None,
                    games_behind: None,
                    otl: None,
                    goals_for: None,
                    goals_against: None,
                    points_for: None,
                    points_against: None,
                    streak: None,
                };
                if let Err(e) = upsert_standing(pool, standing).await {
                    error!("[{}] Failed to upsert standing: {}", league_name, e);
                }
            }
        }
    }
}

/// Parse NFL, Rugby, AFL standings (v1 API, flat structure with won/lost/ties at top level)
async fn parse_v1_standings(
    pool: &Arc<PgPool>,
    league_name: &str,
    season: &str,
    sport_api: &str,
    response: &[serde_json::Value],
) {
    for entry in response {
        // V1 sports: flat response array, each entry is a standing record
        // May have a "league" metadata key but standings are at top level
        // Skip entries that are arrays (these are group containers)
        if entry.is_array() {
            // This is a group array, iterate through items
            for item in entry.as_array().unwrap_or(&vec![]) {
                parse_v1_standing_item(pool, league_name, season, sport_api, item).await;
            }
        } else if entry.is_object() {
            // Check if this is a nested league.standings structure (some responses have this)
            if let Some(nested) = entry.get("league").and_then(|l| l.get("standings")) {
                if let Some(groups) = nested.as_array() {
                    for group in groups {
                        if let Some(items) = group.as_array() {
                            for item in items {
                                parse_v1_standing_item(pool, league_name, season, sport_api, item).await;
                            }
                        }
                    }
                }
            } else {
                // Direct standing item
                parse_v1_standing_item(pool, league_name, season, sport_api, entry).await;
            }
        }
    }
}

async fn parse_v1_standing_item(
    pool: &Arc<PgPool>,
    league_name: &str,
    season: &str,
    sport_api: &str,
    item: &serde_json::Value,
) {
    let team = match item.get("team") {
        Some(t) => t,
        None => return,
    };

    // Extract wins/losses/ties from top-level fields
    let wins = item.get("won").and_then(|w| w.as_i64()).unwrap_or(0) as i32;
    let losses = item.get("lost").and_then(|l| l.as_i64()).unwrap_or(0) as i32;
    let ties = item.get("ties").and_then(|t| t.as_i64()).unwrap_or(0) as i32;
    let games_played = wins + losses + ties;

    // Extract points - can be integer (NHL) or object {for, against} (NFL)
    let (points, points_for, points_against) = if let Some(p) = item.get("points") {
        if let Some(p_int) = p.as_i64() {
            (Some(p_int as i32), None, None)
        } else if let Some(p_obj) = p.as_object() {
            let pf = p_obj.get("for").and_then(|v| v.as_i64()).map(|v| v as i32);
            let pa = p_obj.get("against").and_then(|v| v.as_i64()).map(|v| v as i32);
            (None, pf, pa)
        } else {
            (None, None, None)
        }
    } else {
        (None, None, None)
    };

    // Extract streak
    let streak = item.get("streak").and_then(|s| s.as_str()).map(|s| s.to_string());

    // Group name - can be string (NFL) or object {name} (some v1 responses)
    let group_name = if let Some(g) = item.get("group") {
        if let Some(g_str) = g.as_str() {
            Some(g_str.to_string())
        } else if let Some(g_obj) = g.as_object() {
            g_obj.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
        } else {
            None
        }
    } else {
        None
    };

    // Calculate PCT using standard sports-notation formatting (.{3}).
    // The old `format!(".{:03}", (pct_val * 1000.0).round() as i32)` path
    // emitted `.1000` for a perfect 1.000 record because `:03` only pads
    // to three *minimum* digits; `{:.3}` naturally yields `1.000`, `0.500`,
    // `0.750`, matching what operators expect to see in an NFL standing.
    let pct = if games_played > 0 {
        let pct_val = (wins as f64) / (games_played as f64);
        Some(format!("{:.3}", pct_val))
    } else {
        None
    };

    let standing = StandingData {
        league: league_name.to_string(),
        team_name: team.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        team_code: team.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
        team_logo: team.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
        rank: item.get("position").or_else(|| item.get("rank")).and_then(|r| r.as_i64()).map(|r| r as i32),
        wins,
        losses,
        draws: ties,
        points,
        games_played,
        goal_diff: None, // Not available in v1 format
        description: item.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()),
        form: item.get("form").and_then(|f| f.as_str()).map(|s| s.to_string()),
        group_name,
        season: Some(season.to_string()),
        sport_api: Some(sport_api.to_string()),
        pct,
        games_behind: None,
        otl: None,
        goals_for: None,
        goals_against: None,
        points_for,
        points_against,
        streak,
    };

    if let Err(e) = upsert_standing(pool, standing).await {
        error!("[{}] Failed to upsert standing: {}", league_name, e);
    }
}

/// Parse NBA, MLB, Handball, Volleyball standings (v1 API with nested games object)
async fn parse_basketball_standings(
    pool: &Arc<PgPool>,
    league_name: &str,
    season: &str,
    sport_api: &str,
    response: &[serde_json::Value],
) {
    for entry in response {
        // V1 sports with games object: flat response array
        if entry.is_array() {
            for item in entry.as_array().unwrap_or(&vec![]) {
                parse_basketball_standing_item(pool, league_name, season, sport_api, item).await;
            }
        } else if entry.is_object() {
            // Check for nested structure
            if let Some(nested) = entry.get("league").and_then(|l| l.get("standings")) {
                if let Some(groups) = nested.as_array() {
                    for group in groups {
                        if let Some(items) = group.as_array() {
                            for item in items {
                                parse_basketball_standing_item(pool, league_name, season, sport_api, item).await;
                            }
                        }
                    }
                }
            } else {
                parse_basketball_standing_item(pool, league_name, season, sport_api, entry).await;
            }
        }
    }
}

async fn parse_basketball_standing_item(
    pool: &Arc<PgPool>,
    league_name: &str,
    season: &str,
    sport_api: &str,
    item: &serde_json::Value,
) {
    let team = match item.get("team") {
        Some(t) => t,
        None => return,
    };

    // Resolve a wins / losses count from a `games.win` or `games.lose`
    // object. The api-sports.io response typically looks like:
    //   {"total": 50}   (NBA) or
    //   {"home": 25, "road": 25, "all": 50}  (MLB)
    // The previous implementation fell back to `.values().next()` which
    // picked an arbitrary field — breaking determinism (the map iteration
    // order is unspecified) and occasionally returning a home-only number
    // as if it were the full season total. Explicitly prefer `total`, then
    // fall back to `home + road` when `total` isn't in the payload.
    fn resolve_wl(node: Option<&serde_json::Value>) -> i64 {
        let Some(n) = node else { return 0 };
        if let Some(total) = n.get("total").and_then(|v| v.as_i64()) {
            return total;
        }
        let home = n.get("home").and_then(|v| v.as_i64()).unwrap_or(0);
        let road = n.get("road").and_then(|v| v.as_i64()).unwrap_or(0);
        home + road
    }

    // NBA/MLB: games object has nested win/lose with {total, percentage}
    let games = item.get("games");
    let (wins, losses, games_played, pct) = if let Some(g) = games {
        let w = resolve_wl(g.get("win")) as i32;
        let l = resolve_wl(g.get("lose")) as i32;
        let gp = g.get("played").and_then(|p| p.as_i64()).unwrap_or(0) as i32;

        // Extract percentage from win.percentage. The feed may send it as
        // a string (already formatted) or a raw float — normalize both to
        // the `.NNN` convention used elsewhere.
        let pct_str = g.get("win").and_then(|w| w.get("percentage")).and_then(|p| {
            if let Some(pct_str) = p.as_str() {
                Some(pct_str.to_string())
            } else {
                p.as_f64().map(|pct_f| format!("{:.3}", pct_f))
            }
        });

        (w, l, gp, pct_str)
    } else {
        (0, 0, 0, None)
    };

    // Points for/against (available in some responses)
    let (points_for, points_against) = if let Some(p) = item.get("points") {
        if let Some(p_obj) = p.as_object() {
            (p_obj.get("for").and_then(|v| v.as_i64()).map(|v| v as i32),
             p_obj.get("against").and_then(|v| v.as_i64()).map(|v| v as i32))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    // Games behind (for MLB)
    let games_behind = item.get("games_behind").and_then(|gb| {
        if let Some(gb_str) = gb.as_str() {
            Some(gb_str.to_string())
        } else {
            gb.as_f64().map(|gb_f| format!("{:.1}", gb_f))
        }
    });

    // Group - can be object {name} or string
    let group_name = if let Some(g) = item.get("group") {
        if let Some(g_str) = g.as_str() {
            Some(g_str.to_string())
        } else if let Some(g_obj) = g.as_object() {
            g_obj.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
        } else {
            None
        }
    } else {
        None
    };

    let standing = StandingData {
        league: league_name.to_string(),
        team_name: team.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        team_code: team.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
        team_logo: team.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
        rank: item.get("position").or_else(|| item.get("rank")).and_then(|r| r.as_i64()).map(|r| r as i32),
        wins,
        losses,
        draws: 0, // Basketball/Baseball don't have draws
        points: None, // Basketball/MLB don't use points
        games_played,
        goal_diff: None,
        description: item.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()),
        form: item.get("form").and_then(|f| f.as_str()).map(|s| s.to_string()),
        group_name,
        season: Some(season.to_string()),
        sport_api: Some(sport_api.to_string()),
        pct,
        games_behind,
        otl: None,
        goals_for: None,
        goals_against: None,
        points_for,
        points_against,
        streak: item.get("streak").and_then(|s| s.as_str()).map(|s| s.to_string()),
    };

    if let Err(e) = upsert_standing(pool, standing).await {
        error!("[{}] Failed to upsert standing: {}", league_name, e);
    }
}

/// Parse NHL standings (similar to v1 but with overtime losses)
async fn parse_hockey_standings(
    pool: &Arc<PgPool>,
    league_name: &str,
    season: &str,
    sport_api: &str,
    response: &[serde_json::Value],
) {
    for entry in response {
        if entry.is_array() {
            for item in entry.as_array().unwrap_or(&vec![]) {
                parse_hockey_standing_item(pool, league_name, season, sport_api, item).await;
            }
        } else if entry.is_object() {
            if let Some(nested) = entry.get("league").and_then(|l| l.get("standings")) {
                if let Some(groups) = nested.as_array() {
                    for group in groups {
                        if let Some(items) = group.as_array() {
                            for item in items {
                                parse_hockey_standing_item(pool, league_name, season, sport_api, item).await;
                            }
                        }
                    }
                }
            } else {
                parse_hockey_standing_item(pool, league_name, season, sport_api, entry).await;
            }
        }
    }
}

async fn parse_hockey_standing_item(
    pool: &Arc<PgPool>,
    league_name: &str,
    season: &str,
    sport_api: &str,
    item: &serde_json::Value,
) {
    let team = match item.get("team") {
        Some(t) => t,
        None => return,
    };

    // NHL: won, lost, lost_overtime at top level, points is integer
    let wins = item.get("won").and_then(|w| w.as_i64()).unwrap_or(0) as i32;
    let losses = item.get("lost").and_then(|l| l.as_i64()).unwrap_or(0) as i32;
    let otl = item.get("lost_overtime").and_then(|l| l.as_i64()).unwrap_or(0) as i32;
    let games_played = item.get("games").and_then(|g| g.get("played")).and_then(|p| p.as_i64()).unwrap_or(0) as i32;
    
    // Points is directly available as integer in NHL
    let points = item.get("points").and_then(|p| p.as_i64()).map(|p| p as i32);

    // Goals for/against
    let goals_for = item.get("goals_for").and_then(|g| g.as_i64()).map(|g| g as i32);
    let goals_against = item.get("goals_against").and_then(|g| g.as_i64()).map(|g| g as i32);

    // Calculate goal diff
    let goal_diff = match (goals_for, goals_against) {
        (Some(gf), Some(ga)) => Some(gf - ga),
        _ => None,
    };

    // Group name
    let group_name = if let Some(g) = item.get("group") {
        if let Some(g_str) = g.as_str() {
            Some(g_str.to_string())
        } else if let Some(g_obj) = g.as_object() {
            g_obj.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
        } else {
            None
        }
    } else {
        None
    };

    // Calculate PCT using standard sports-notation formatting — see the
    // equivalent comment in parse_v1_standing_item for why `{:.3}` instead
    // of `.{:03}`.
    let pct = if games_played > 0 {
        let pct_val = (wins as f64) / (games_played as f64);
        Some(format!("{:.3}", pct_val))
    } else {
        None
    };

    let standing = StandingData {
        league: league_name.to_string(),
        team_name: team.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        team_code: team.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
        team_logo: team.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
        rank: item.get("position").or_else(|| item.get("rank")).and_then(|r| r.as_i64()).map(|r| r as i32),
        wins,
        losses,
        draws: 0, // NHL doesn't have draws
        points,
        games_played,
        goal_diff,
        description: item.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()),
        form: item.get("form").and_then(|f| f.as_str()).map(|s| s.to_string()),
        group_name,
        season: Some(season.to_string()),
        sport_api: Some(sport_api.to_string()),
        pct,
        games_behind: None,
        otl: Some(otl),
        goals_for,
        goals_against,
        points_for: None,
        points_against: None,
        streak: item.get("streak").and_then(|s| s.as_str()).map(|s| s.to_string()),
    };

    if let Err(e) = upsert_standing(pool, standing).await {
        error!("[{}] Failed to upsert standing: {}", league_name, e);
    }
}

// =============================================================================
// Teams polling (weekly — every 7 days)
// =============================================================================

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
            warn!("[{}] Skipping teams poll — budget low", league.name);
            continue;
        }

        let format_str = league.season_format.as_deref().unwrap_or("calendar");
        let default_season = compute_current_season(format_str);
        let season = league.season.as_deref().unwrap_or(&default_season).to_string();

        let (base, is_mock) = match std::env::var("API_SPORTS_BASE_URL") {
            Ok(override_url) => (override_url.trim_end_matches('/').to_string(), true),
            Err(_) => (format!("https://{}", league.api_host), false),
        };
        let mut url = format!(
            "{}/teams?league={}&season={}",
            base, league.league_id, season
        );
        if is_mock {
            url = format!("{}&sport={}", url, league.sport_api);
        }

        // Teams requests don't go through try_consume (has_budget gate
        // above), so record them against the persisted consumption count.
        rate_limiter.note_consumed(&league.sport_api, 1);
        match client.get(&url).send().await {
            Ok(resp) => {
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

        // Spread requests to avoid rate limiting on startup
        tokio::time::sleep(std::time::Duration::from_millis(STARTUP_REQUEST_DELAY_MS)).await;
    }
    info!("Teams poll complete");
}

// =============================================================================
// Shared upsert helper
// =============================================================================

/// Upsert a batch of games and return (upserted, failed, has_live).
async fn upsert_games(
    pool: &Arc<PgPool>,
    league: &TrackedLeague,
    games: Vec<CleanedData>,
) -> (u32, u32, bool) {
    let total = games.len();
    let has_live = games.iter().any(|g| g.state == "in");

    let mut upserted = 0u32;
    let mut failed = 0u32;
    for game in games {
        let game_id = game.external_game_id.clone();
        match upsert_game(pool.clone(), game).await {
            Ok(_) => upserted += 1,
            Err(e) => {
                error!("[{}] Failed to upsert game {}: {}", league.name, game_id, e);
                failed += 1;
            }
        }
    }

    if total > 0 {
        info!("[{}] {} games found, {} upserted, {} failed", league.name, total, upserted, failed);
    }

    (upserted, failed, has_live)
}

// =============================================================================
// HTTP client
// =============================================================================

/// Build the HTTP client used for all api-sports.io requests. Fails with
/// context rather than panicking so `init_sports_service` can surface the
/// error through the readiness gate instead of taking the process down via
/// an uncaught `.expect()`.
fn build_client(api_key: &str) -> Result<Client> {
    let mut headers = header::HeaderMap::new();
    let header_value = header::HeaderValue::from_str(api_key)
        .context("API_SPORTS_KEY contains bytes that aren't valid in an HTTP header value")?;
    headers.insert("x-apisports-key", header_value);

    Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .context("reqwest client build failed (TLS stack? DNS resolver?)")
}

// =============================================================================
// League polling
// =============================================================================

async fn poll_league(
    client: &Client,
    league: &TrackedLeague,
    date: &str,
    rate_limiter: &RateLimiter,
) -> anyhow::Result<Vec<CleanedData>> {
    let url = build_api_url(league, date);

    let resp = client.get(&url).send().await?;

    // Extract rate limit info from headers — update only this sport's bucket
    if let Some(remaining) = resp.headers()
        .get("x-ratelimit-requests-remaining")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u32>().ok())
    {
        rate_limiter.update(&league.sport_api, remaining);
    }

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("[{}] API returned {}: {}", league.name, status, body);
    }

    let body: serde_json::Value = resp.json().await?;

    // api-sports.io wraps all responses in: {"get": "...", "results": N, "response": [...]}
    let response_array = body.get("response")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    if let Some(errors) = body.get("errors")
        && errors.is_object()
        && errors.as_object().is_some_and(|m| !m.is_empty())
    {
        warn!("[{}] API returned errors: {}", league.name, errors);
    }

    let mut cleaned_games = Vec::new();
    for item in &response_array {
        if let Some(game) = parse_game(item, league) {
            cleaned_games.push(game);
        }
    }

    Ok(cleaned_games)
}

/// Compute the current season string dynamically based on the league's
/// `season_format` and today's date. This eliminates the need to manually
/// update season values in `leagues.json` every year.
///
/// Supported formats:
///   - `"cross-year"`    — YYYY-YYYY, new season starts October (NBA, NCAA Basketball)
///   - `"fall-october"`  — YYYY (start year), new season starts October (NHL)
///   - `"fall-august"`   — YYYY (start year), new season starts August (NFL, NCAA Football, Soccer)
///   - `"calendar"`      — YYYY, always the current calendar year (MLB, MLS, F1)
fn compute_current_season(season_format: &str) -> String {
    let now = Utc::now();
    let year = now.year();
    let month = now.month();

    match season_format {
        "cross-year" => {
            if month >= 10 { format!("{}-{}", year, year + 1) }
            else { format!("{}-{}", year - 1, year) }
        }
        "fall-october" => {
            if month >= 10 { format!("{}", year) }
            else { format!("{}", year - 1) }
        }
        "fall-august" => {
            if month >= 8 { format!("{}", year) }
            else { format!("{}", year - 1) }
        }
        "calendar" => format!("{}", year),
        other => {
            warn!("Unknown season_format '{}', falling back to calendar year", other);
            format!("{}", year)
        }
    }
}

/// Build the correct API URL based on the sport type.
///
/// When `API_SPORTS_BASE_URL` is set (e.g. `http://localhost:9090`), all
/// requests are redirected to that host instead of the real api-sports.io
/// endpoints.  The original `api_host` is sent as a query parameter so the
/// mock server can distinguish between sports.
fn build_api_url(league: &TrackedLeague, date: &str) -> String {
    let (base, is_mock) = match std::env::var("API_SPORTS_BASE_URL") {
        Ok(override_url) => (override_url.trim_end_matches('/').to_string(), true),
        Err(_) => (format!("https://{}", league.api_host), false),
    };
    let format_str = league.season_format.as_deref().unwrap_or("calendar");
    let default_season = compute_current_season(format_str);
    let season = league.season.as_deref().unwrap_or(&default_season);

    let url = match league.sport_api.as_str() {
        "football" => {
            format!("{}/fixtures?league={}&season={}&date={}", base, league.league_id, season, date)
        }
        "formula-1" => {
            format!("{}/races?season={}", base, season)
        }
        "mma" => {
            format!("{}/fights?date={}", base, date)
        }
        other => {
            if !matches!(other,
                "basketball" | "hockey" | "baseball" | "american-football" |
                "rugby" | "handball" | "volleyball" | "afl"
            ) {
                warn!("Unknown sport_api '{}', falling back to /games", other);
            }
            format!("{}/games?league={}&season={}&date={}", base, league.league_id, season, date)
        }
    };

    if is_mock {
        format!("{}&sport={}", url, league.sport_api)
    } else {
        url
    }
}

// =============================================================================
// Response parsing — dispatches to sport-specific parsers
// =============================================================================

fn parse_game(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    match league.sport_api.as_str() {
        "football" => parse_football_fixture(item, league),
        "american-football" => parse_american_football_game(item, league),
        "basketball" => parse_basketball_game(item, league),
        "hockey" => parse_hockey_game(item, league),
        "baseball" => parse_baseball_game(item, league),
        "formula-1" => parse_f1_race(item, league),
        "rugby" => parse_rugby_game(item, league),
        "handball" => parse_handball_game(item, league),
        "volleyball" => parse_volleyball_game(item, league),
        "afl" => parse_afl_game(item, league),
        "mma" => parse_mma_fight(item, league),
        _ => {
            warn!("[{}] No parser for sport_api '{}'", league.name, league.sport_api);
            None
        }
    }
}

// =============================================================================
// Status mapping — consistent across all sports
// =============================================================================

/// Map api-sports.io status short codes to our state enum: "pre", "in", "final", "postponed"
fn map_status_to_state(status_short: &str) -> &'static str {
    match status_short {
        // Not started
        "NS" | "TBD" | "CANC" | "WO" => "pre",
        // Finished
        "FT" | "AET" | "PEN" | "AOT" | "AP" | "ABD" | "AWD" | "INT" => "final",
        // Postponed / suspended
        "PST" | "SUSP" => "postponed",
        // Everything else is live / in progress
        // Q1, Q2, Q3, Q4, HT, OT, P1, P2, P3, BT, 1H, 2H, ET, IN1-IN9, etc.
        _ => "in",
    }
}

// =============================================================================
// Football (Soccer) — v3.football.api-sports.io
// =============================================================================

fn parse_football_fixture(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let fixture = item.get("fixture")?;
    let teams = item.get("teams")?;
    let goals = item.get("goals")?;

    let game_id = fixture.get("id")?.as_i64()?.to_string();
    let timestamp = fixture.get("timestamp").and_then(|t| t.as_i64());
    let date_str = fixture.get("date").and_then(|d| d.as_str());

    let start_time = parse_api_date(timestamp, date_str)?;

    let status = fixture.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());
    let elapsed = status.get("elapsed").and_then(|e| e.as_i64());

    let home = teams.get("home")?;
    let away = teams.get("away")?;

    let venue_obj = fixture.get("venue");
    let venue = venue_obj
        .and_then(|v| v.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());

    let timer = elapsed.map(|e| format!("{}′", e));
    let detail = build_detail(status_short, status_long, timer.as_deref());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: game_id,
        link: None,
        home_team: Team {
            name: home.get("name").and_then(|n| n.as_str())?.to_string(),
            logo: home.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
            score: goals.get("home").and_then(|s| s.as_i64()).map(|s| s as i32),
            code: home.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
        },
        away_team: Team {
            name: away.get("name").and_then(|n| n.as_str())?.to_string(),
            logo: away.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
            score: goals.get("away").and_then(|s| s.as_i64()).map(|s| s as i32),
            code: away.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()),
        },
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer,
        venue,
        season: league.season.clone(),
    })
}

// =============================================================================
// American Football (NFL / NCAA) — v1.american-football.api-sports.io
// =============================================================================

fn parse_american_football_game(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let game = item.get("game")?;
    let teams = item.get("teams")?;
    let scores = item.get("scores")?;

    let game_id = game.get("id")?.as_i64()?.to_string();
    let date_obj = game.get("date")?;
    let timestamp = date_obj.get("timestamp").and_then(|t| t.as_i64());
    let date_str = date_obj.get("date").and_then(|d| d.as_str())
        .or_else(|| date_obj.get("start").and_then(|d| d.as_str()));

    let start_time = parse_api_date(timestamp, date_str)?;

    let status = game.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());
    let timer_str = status.get("timer").and_then(|t| t.as_str()).map(|s| s.to_string());

    let home = teams.get("home")?;
    let away = teams.get("away")?;

    let home_score = scores.get("home").and_then(|s| s.get("total")).and_then(|t| t.as_i64()).map(|s| s as i32);
    let away_score = scores.get("away").and_then(|s| s.get("total")).and_then(|t| t.as_i64()).map(|s| s as i32);

    let venue = game.get("venue")
        .and_then(|v| v.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());

    let detail = build_detail(status_short, status_long, timer_str.as_deref());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: game_id,
        link: None,
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
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer: timer_str,
        venue,
        season: league.season.clone(),
    })
}

// =============================================================================
// Basketball (NBA / NCAA Basketball) — v1.basketball.api-sports.io
// =============================================================================

fn parse_basketball_game(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let game_id = item.get("id")?.as_i64()?.to_string();

    let timestamp = item.get("timestamp").and_then(|t| t.as_i64());
    let date_str = item.get("date").and_then(|d| d.as_str());
    let start_time = parse_api_date(timestamp, date_str)?;

    let status = item.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());
    let timer_str = status.get("timer").and_then(|t| t.as_str()).map(|s| s.to_string());

    let teams = item.get("teams")?;
    let scores = item.get("scores")?;

    let home = teams.get("home")?;
    let away = teams.get("away")?;

    let home_score = scores.get("home").and_then(|s| s.get("total")).and_then(|t| t.as_i64()).map(|s| s as i32);
    let away_score = scores.get("away").and_then(|s| s.get("total")).and_then(|t| t.as_i64()).map(|s| s as i32);

    let detail = build_detail(status_short, status_long, timer_str.as_deref());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: game_id,
        link: None,
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
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer: timer_str,
        venue: None,
        season: league.season.clone(),
    })
}

// =============================================================================
// Hockey (NHL) — v1.hockey.api-sports.io
// =============================================================================

fn parse_hockey_game(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let game_id = item.get("id")?.as_i64()?.to_string();

    let timestamp = item.get("timestamp").and_then(|t| t.as_i64());
    let date_str = item.get("date").and_then(|d| d.as_str());
    let start_time = parse_api_date(timestamp, date_str)?;

    let status = item.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());
    let timer_str = status.get("timer").and_then(|t| t.as_str()).map(|s| s.to_string());

    let teams = item.get("teams")?;
    let scores = item.get("scores")?;

    let home = teams.get("home")?;
    let away = teams.get("away")?;

    // Hockey scores can be at top level of scores.home/scores.away as integers
    let home_score = scores.get("home").and_then(|s| s.as_i64()).map(|s| s as i32);
    let away_score = scores.get("away").and_then(|s| s.as_i64()).map(|s| s as i32);

    let detail = build_detail(status_short, status_long, timer_str.as_deref());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: game_id,
        link: None,
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
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer: timer_str,
        venue: None,
        season: league.season.clone(),
    })
}

// =============================================================================
// Baseball (MLB) — v1.baseball.api-sports.io
// =============================================================================

fn parse_baseball_game(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let game_id = item.get("id")?.as_i64()?.to_string();

    let timestamp = item.get("timestamp").and_then(|t| t.as_i64());
    let date_str = item.get("date").and_then(|d| d.as_str());
    let start_time = parse_api_date(timestamp, date_str)?;

    let status = item.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());

    let teams = item.get("teams")?;
    let scores = item.get("scores")?;

    let home = teams.get("home")?;
    let away = teams.get("away")?;

    // Baseball scores: sum per-inning runs for real-time accuracy (total lags behind)
    let home_score = scores.get("home")
        .and_then(|s| s.get("innings"))
        .and_then(|inn| inn.as_object())
        .map(|obj| obj.values().filter_map(|v| v.as_i64()).sum::<i64>() as i32);
    let away_score = scores.get("away")
        .and_then(|s| s.get("innings"))
        .and_then(|inn| inn.as_object())
        .map(|obj| obj.values().filter_map(|v| v.as_i64()).sum::<i64>() as i32);

    // Baseball uses inning info in status
    let inning = status.get("inning").and_then(|i| i.as_i64());
    let timer_str = inning.map(|i| format!("Inn {}", i));

    let detail = build_detail(status_short, status_long, timer_str.as_deref());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: game_id,
        link: None,
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
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer: timer_str,
        venue: None,
        season: league.season.clone(),
    })
}

// =============================================================================
// Formula 1 — v1.formula-1.api-sports.io
// =============================================================================

fn parse_f1_race(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    // Only ingest actual Race sessions — skip practice, qualifying, sprint
    let race_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if race_type != "Race" {
        return None;
    }

    let race_id = item.get("id")?.as_i64()?.to_string();

    let date_str = item.get("date").and_then(|d| d.as_str());
    let start_time = parse_api_date(None, date_str)?;

    let status = item.get("status").and_then(|s| s.as_str()).unwrap_or("Scheduled");

    // F1 doesn't have a traditional home/away structure.
    // We use the race name as "home" and circuit as "away" for display.
    let state = match status {
        "Completed" => "final",
        "Live" | "In Progress" => "in",
        _ => "pre",
    };

    // Skip old completed races — they'd be cleaned up anyway and waste DB writes
    if state == "final" && start_time < Utc::now() - Duration::hours(12) {
        return None;
    }

    let competition = item.get("competition")?;
    let race_name = competition.get("name").and_then(|n| n.as_str()).unwrap_or("Race");
    let circuit = item.get("circuit");
    let circuit_name = circuit
        .and_then(|c| c.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: race_id,
        link: None,
        home_team: Team {
            name: race_name.to_string(),
            logo: None,
            score: None,
            code: None,
        },
        away_team: Team {
            name: circuit_name.clone().unwrap_or_else(|| "TBD".to_string()),
            logo: None,
            score: None,
            code: None,
        },
        start_time,
        short_detail: Some(status.to_string()),
        state: state.to_string(),
        status_short: Some(status.to_string()),
        status_long: Some(status.to_string()),
        timer: None,
        venue: circuit_name,
        season: league.season.clone(),
    })
}

// =============================================================================
// Rugby — v1.rugby.api-sports.io
// =============================================================================

fn parse_rugby_game(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let game_id = item.get("id")?.as_i64()?.to_string();

    let timestamp = item.get("timestamp").and_then(|t| t.as_i64());
    let date_str = item.get("date").and_then(|d| d.as_str());
    let start_time = parse_api_date(timestamp, date_str)?;

    let status = item.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());
    let timer_str = status.get("timer").and_then(|t| t.as_str()).map(|s| s.to_string());

    let teams = item.get("teams")?;
    let scores = item.get("scores")?;

    let home = teams.get("home")?;
    let away = teams.get("away")?;

    let home_score = scores.get("home").and_then(|s| s.as_i64()).map(|s| s as i32);
    let away_score = scores.get("away").and_then(|s| s.as_i64()).map(|s| s as i32);

    let detail = build_detail(status_short, status_long, timer_str.as_deref());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: game_id,
        link: None,
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
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer: timer_str,
        venue: None,
        season: league.season.clone(),
    })
}

// =============================================================================
// Handball — v1.handball.api-sports.io
// =============================================================================

fn parse_handball_game(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let game_id = item.get("id")?.as_i64()?.to_string();

    let timestamp = item.get("timestamp").and_then(|t| t.as_i64());
    let date_str = item.get("date").and_then(|d| d.as_str());
    let start_time = parse_api_date(timestamp, date_str)?;

    let status = item.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());
    let timer_str = status.get("timer").and_then(|t| t.as_str()).map(|s| s.to_string());

    let teams = item.get("teams")?;
    let scores = item.get("scores")?;

    let home = teams.get("home")?;
    let away = teams.get("away")?;

    let home_score = scores.get("home").and_then(|s| s.as_i64()).map(|s| s as i32);
    let away_score = scores.get("away").and_then(|s| s.as_i64()).map(|s| s as i32);

    let detail = build_detail(status_short, status_long, timer_str.as_deref());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: game_id,
        link: None,
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
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer: timer_str,
        venue: None,
        season: league.season.clone(),
    })
}

// =============================================================================
// Volleyball — v1.volleyball.api-sports.io
// =============================================================================

fn parse_volleyball_game(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let game_id = item.get("id")?.as_i64()?.to_string();

    let timestamp = item.get("timestamp").and_then(|t| t.as_i64());
    let date_str = item.get("date").and_then(|d| d.as_str());
    let start_time = parse_api_date(timestamp, date_str)?;

    let status = item.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());
    let timer_str = status.get("timer").and_then(|t| t.as_str()).map(|s| s.to_string());

    let teams = item.get("teams")?;
    let scores = item.get("scores")?;

    let home = teams.get("home")?;
    let away = teams.get("away")?;

    // Volleyball scores represent sets won
    let home_score = scores.get("home").and_then(|s| s.as_i64()).map(|s| s as i32);
    let away_score = scores.get("away").and_then(|s| s.as_i64()).map(|s| s as i32);

    let detail = build_detail(status_short, status_long, timer_str.as_deref());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: game_id,
        link: None,
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
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer: timer_str,
        venue: None,
        season: league.season.clone(),
    })
}

// =============================================================================
// AFL (Australian Football League) — v1.afl.api-sports.io
// =============================================================================

fn parse_afl_game(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let game = item.get("game")?;
    let game_id = game.get("id")?.as_i64()?.to_string();

    // AFL returns timestamp as a string
    let timestamp = item.get("timestamp")
        .and_then(|t| t.as_i64().or_else(|| t.as_str().and_then(|s| s.parse::<i64>().ok())));
    let date_str = item.get("date").and_then(|d| d.as_str());
    let start_time = parse_api_date(timestamp, date_str)?;

    let status = item.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());
    let timer_str = status.get("timer").and_then(|t| t.as_str()).map(|s| s.to_string());

    let teams = item.get("teams")?;
    let scores = item.get("scores")?;

    let home = teams.get("home")?;
    let away = teams.get("away")?;

    // AFL scores: nested under scores.home.score / scores.away.score (total points)
    let home_score = scores.get("home")
        .and_then(|s| s.get("score"))
        .and_then(|t| t.as_i64())
        .map(|s| s as i32);
    let away_score = scores.get("away")
        .and_then(|s| s.get("score"))
        .and_then(|t| t.as_i64())
        .map(|s| s as i32);

    let venue = item.get("venue")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let detail = build_detail(status_short, status_long, timer_str.as_deref());

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: game_id,
        link: None,
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
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer: timer_str,
        venue,
        season: league.season.clone(),
    })
}

// =============================================================================
// MMA (Mixed Martial Arts) — v1.mma.api-sports.io
// =============================================================================

fn parse_mma_fight(item: &serde_json::Value, league: &TrackedLeague) -> Option<CleanedData> {
    let fight_id = item.get("id")?.as_i64()?.to_string();

    let timestamp = item.get("timestamp").and_then(|t| t.as_i64());
    let date_str = item.get("date").and_then(|d| d.as_str());
    let start_time = parse_api_date(timestamp, date_str)?;

    let status = item.get("status")?;
    let status_short = status.get("short").and_then(|s| s.as_str()).unwrap_or("NS");
    let status_long = status.get("long").and_then(|s| s.as_str());

    let fighters = item.get("fighters")?;
    let first = fighters.get("first")?;
    let second = fighters.get("second")?;

    // Weight class as category context, event name as venue
    let category = item.get("category").and_then(|c| c.as_str());
    let event_name = item.get("slug").and_then(|s| s.as_str()).map(|s| s.to_string());

    // Build a detail string: weight class for pre-fight, status for finished
    let detail = match map_status_to_state(status_short) {
        "final" => status_long.map(|s| s.to_string()),
        "in" => Some("Live".to_string()),
        _ => category.map(|c| c.to_string()),
    };

    Some(CleanedData {
        league: league.name.clone(),
        sport: league.sport_api.clone(),
        external_game_id: fight_id,
        link: None,
        home_team: Team {
            name: first.get("name").and_then(|n| n.as_str())?.to_string(),
            logo: first.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
            score: None,
            code: None,
        },
        away_team: Team {
            name: second.get("name").and_then(|n| n.as_str())?.to_string(),
            logo: second.get("logo").and_then(|l| l.as_str()).map(|s| s.to_string()),
            score: None,
            code: None,
        },
        start_time,
        short_detail: detail,
        state: map_status_to_state(status_short).to_string(),
        status_short: Some(status_short.to_string()),
        status_long: status_long.map(|s| s.to_string()),
        timer: category.map(|c| c.to_string()),
        venue: event_name,
        season: league.season.clone(),
    })
}

// =============================================================================
// Date parsing helpers
// =============================================================================

/// Parse dates from api-sports.io. They provide either a UNIX timestamp,
/// an ISO 8601 date string, or both.
fn parse_api_date(timestamp: Option<i64>, date_str: Option<&str>) -> Option<DateTime<Utc>> {
    // Prefer timestamp if available
    if let Some(ts) = timestamp {
        return DateTime::from_timestamp(ts, 0);
    }

    // Fall back to date string
    if let Some(s) = date_str {
        // Try full ISO 8601 / RFC 3339
        if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
            return Some(dt.with_timezone(&Utc));
        }

        // Try without timezone: "2025-03-09T19:00:00"
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
            return Some(dt.and_utc());
        }

        // Try date-only: "2025-03-09"
        if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
            return d.and_hms_opt(0, 0, 0).map(|dt| dt.and_utc());
        }

        // Try with timezone offset without colon: "2025-03-09T19:00:00+0000"
        if let Ok(dt) = DateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%z") {
            return Some(dt.with_timezone(&Utc));
        }
    }

    None
}

/// Build a human-readable detail string from status fields.
fn build_detail(status_short: &str, status_long: Option<&str>, timer: Option<&str>) -> Option<String> {
    match (status_short, status_long, timer) {
        // Live with timer: "Q3 · 4:32"
        (_, _, Some(t)) if map_status_to_state(status_short) == "in" => {
            Some(format!("{} · {}", status_short, t))
        }
        // Live without timer: use long status
        (_, Some(long), _) if map_status_to_state(status_short) == "in" => {
            Some(long.to_string())
        }
        // Finished
        (_, Some(long), _) if map_status_to_state(status_short) == "final" => {
            Some(long.to_string())
        }
        // Not started / other
        (_, Some(long), _) => Some(long.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_status_to_state_pre() {
        assert_eq!(map_status_to_state("NS"), "pre");
        assert_eq!(map_status_to_state("TBD"), "pre");
        assert_eq!(map_status_to_state("CANC"), "pre");
        assert_eq!(map_status_to_state("WO"), "pre");
    }

    #[test]
    fn test_map_status_to_state_final() {
        assert_eq!(map_status_to_state("FT"), "final");
        assert_eq!(map_status_to_state("AET"), "final");
        assert_eq!(map_status_to_state("PEN"), "final");
        assert_eq!(map_status_to_state("AOT"), "final");
        assert_eq!(map_status_to_state("AP"), "final");
        assert_eq!(map_status_to_state("ABD"), "final");
        assert_eq!(map_status_to_state("AWD"), "final");
        assert_eq!(map_status_to_state("INT"), "final");
    }

    #[test]
    fn test_map_status_to_state_postponed() {
        assert_eq!(map_status_to_state("PST"), "postponed");
        assert_eq!(map_status_to_state("SUSP"), "postponed");
    }

    #[test]
    fn test_map_status_to_state_in_progress() {
        // Live game status codes
        assert_eq!(map_status_to_state("1H"), "in");
        assert_eq!(map_status_to_state("2H"), "in");
        assert_eq!(map_status_to_state("HT"), "in");
        assert_eq!(map_status_to_state("OT"), "in");
        assert_eq!(map_status_to_state("Q1"), "in");
        assert_eq!(map_status_to_state("Q4"), "in");
        assert_eq!(map_status_to_state("BT"), "in");
        assert_eq!(map_status_to_state("P1"), "in");
        assert_eq!(map_status_to_state("P3"), "in");
        assert_eq!(map_status_to_state("ET"), "in");
        assert_eq!(map_status_to_state("IN1"), "in");
        assert_eq!(map_status_to_state("IN9"), "in");
        assert_eq!(map_status_to_state(""), "in"); // empty → falls through to "in"
        assert_eq!(map_status_to_state("LIVE"), "in"); // unknown → "in"
    }

    #[test]
    fn test_compute_current_season_format() {
        // Test the function doesn't panic and returns a 4-digit year string
        for fmt in &["cross-year", "fall-october", "fall-august", "calendar", "unknown"] {
            let result = compute_current_season(fmt);
            assert!(!result.is_empty(), "compute_current_season({}) returned empty", fmt);
            // Result should be either a 4-digit year or YYYY-YYYY format
            assert!(
                result.len() == 4 || (result.len() == 9 && result.contains("-")),
                "compute_current_season({}) = {:?}, expected YYYY or YYYY-YYYY",
                fmt, result
            );
        }
    }

    #[test]
    fn test_parse_api_date_timestamp() {
        // UNIX timestamp → UTC
        let dt = parse_api_date(Some(1709337600), None);
        assert!(dt.is_some());
        let dt = dt.unwrap();
        assert_eq!(dt.timestamp(), 1709337600);
    }

    #[test]
    fn test_parse_api_date_rfc3339() {
        let dt = parse_api_date(None, Some("2025-03-09T19:00:00Z"));
        assert!(dt.is_some());
        assert_eq!(dt.unwrap().format("%Y-%m-%d").to_string(), "2025-03-09");
    }

    #[test]
    fn test_parse_api_date_naive_datetime() {
        let dt = parse_api_date(None, Some("2025-03-09T19:00:00"));
        assert!(dt.is_some());
        assert_eq!(dt.unwrap().format("%Y-%m-%d").to_string(), "2025-03-09");
    }

    #[test]
    fn test_parse_api_date_date_only() {
        let dt = parse_api_date(None, Some("2025-03-09"));
        assert!(dt.is_some());
        assert_eq!(dt.unwrap().format("%Y-%m-%d").to_string(), "2025-03-09");
        assert_eq!(dt.unwrap().format("%H:%M:%S").to_string(), "00:00:00");
    }

    #[test]
    fn test_parse_api_date_with_offset() {
        let dt = parse_api_date(None, Some("2025-03-09T19:00:00+0000"));
        assert!(dt.is_some());
        assert_eq!(dt.unwrap().format("%Y-%m-%d").to_string(), "2025-03-09");
    }

    #[test]
    fn test_parse_api_date_prefers_timestamp() {
        let dt = parse_api_date(Some(1709337600), Some("2020-01-01T00:00:00Z"));
        assert!(dt.is_some());
        // Should use timestamp, not date string
        assert_eq!(dt.unwrap().format("%Y").to_string(), "2024"); // 1709337600 = March 2024
    }

    #[test]
    fn test_parse_api_date_invalid_returns_none() {
        assert!(parse_api_date(None, Some("not-a-date")).is_none());
        assert!(parse_api_date(None, Some("")).is_none());
        assert!(parse_api_date(None, None).is_none());
    }

    #[test]
    fn test_build_detail_live_with_timer() {
        // Live in progress with timer
        let detail = build_detail("Q3", Some("3rd Quarter"), Some("4:32"));
        assert!(detail.is_some());
        assert_eq!(detail.unwrap(), "Q3 · 4:32");
    }

    #[test]
    fn test_build_detail_live_no_timer() {
        // Live but no timer → use long status
        let detail = build_detail("HT", Some("Halftime"), None);
        assert!(detail.is_some());
        assert_eq!(detail.unwrap(), "Halftime");
    }

    #[test]
    fn test_build_detail_finished() {
        let detail = build_detail("FT", Some("Full Time"), None);
        assert!(detail.is_some());
        assert_eq!(detail.unwrap(), "Full Time");
    }

    #[test]
    fn test_build_detail_not_started() {
        // NS → not live or final → falls to last match
        let detail = build_detail("NS", Some("Not Started"), None);
        assert!(detail.is_some());
        assert_eq!(detail.unwrap(), "Not Started");
    }

    #[test]
    fn test_build_detail_nil_long() {
        let detail = build_detail("Q3", None, Some("2:00"));
        // Timer exists but no long status — since map_status_to_state("Q3") == "in" and
        // timer exists, it should still format with timer
        assert!(detail.is_some());
        // The match is: (_, _, Some(t)) if map == "in" → format
        assert_eq!(detail.unwrap(), "Q3 · 2:00");
    }

    #[test]
    fn test_build_detail_no_info() {
        let detail = build_detail("???", None, None);
        assert!(detail.is_none());
    }
}
