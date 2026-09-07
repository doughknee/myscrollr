//! Which rows the stale-live sweep picks up (REL-230): the query behind
//! `sweep_stale_live`, against a real Postgres. Skips without
//! `TEST_DATABASE_URL`.
//!
//! The MLB statsapi fallback (REL-233) is covered below with a fixture
//! response instead — it's pure parsing/mapping, no database needed.

mod common;

use std::sync::Arc;
use chrono::{TimeZone, Utc};
use serde_json::json;
use sports_service::database::{get_stale_live_games, GameRow};
use sports_service::{parse_statsapi_schedule, statsapi_game_to_cleaned_data, statsapi_status_to_api_sports};
use sqlx::query;

const LEAGUE: &str = "__stale_sweep__";

#[tokio::test]
async fn sweep_picks_frozen_and_overdue_rows_only() {
    let Some(pool) = common::test_pool("stale sweep").await else { return };
    let pool = Arc::new(pool);

    query("DELETE FROM games WHERE league = $1").bind(LEAGUE).execute(&*pool).await.unwrap();

    // (id, state, status, start offset, updated offset) — offsets are SQL intervals from NOW().
    let rows: &[(&str, &str, &str, &str, &str)] = &[
        ("A_in_fell_out_of_window", "in", "IN8", "-3 hours", "-30 minutes"),
        ("B_in_live_and_fresh", "in", "IN3", "-1 hour", "-20 seconds"),
        ("C_in_stuck_upstream", "in", "IN1", "-6 hours", "-20 seconds"),
        ("D_pre_should_have_started", "pre", "NS", "-1 hour", "-20 seconds"),
        ("E_pre_uncovered_fixture", "pre", "NS", "-6 hours", "-20 seconds"),
        ("F_pre_upcoming", "pre", "NS", "+2 hours", "-20 seconds"),
        ("G_pre_just_started", "pre", "NS", "-5 minutes", "-20 seconds"),
        ("H_final", "final", "FT", "-1 hour", "-2 hours"),
        ("I_in_ancient", "in", "IN9", "-3 days", "-3 days"),
    ];
    for (id, state, status, start, updated) in rows {
        query(&format!(
            "INSERT INTO games (league, sport, external_game_id, home_team_name, away_team_name,
                                start_time, state, status_short, updated_at)
             VALUES ($1, 'baseball', $2, 'Home', 'Away',
                     NOW() + INTERVAL '{start}', $3, $4, NOW() + INTERVAL '{updated}')"
        ))
        .bind(LEAGUE).bind(id).bind(state).bind(status)
        .execute(&*pool).await.unwrap();
    }

    let picked = get_stale_live_games(&pool, 10, 20).await.unwrap();
    let picked: Vec<_> = picked.into_iter().filter(|g| g.league == LEAGUE).collect();
    let ids: Vec<&str> = picked.iter().map(|g| g.external_game_id.as_str()).collect();

    // Newest first: D (1 h), A (3 h), C (6 h). Fresh live rows, upcoming and
    // barely-late fixtures, old uncovered fixtures, finals and anything older
    // than two days are left alone.
    assert_eq!(ids, ["D_pre_should_have_started", "A_in_fell_out_of_window", "C_in_stuck_upstream"]);

    let a = &picked[1];
    assert_eq!((a.state.as_str(), a.status_short.as_deref()), ("in", Some("IN8")));
    assert!((29..=31).contains(&a.updated_mins_ago), "{}", a.updated_mins_ago);
    assert!((179..=181).contains(&a.started_mins_ago), "{}", a.started_mins_ago);

    // The cap is honoured.
    let capped = get_stale_live_games(&pool, 10, 1).await.unwrap();
    assert!(capped.len() <= 1);

    query("DELETE FROM games WHERE league = $1").bind(LEAGUE).execute(&*pool).await.unwrap();
}

/// A row stuck reporting "IN1" for hours (the Sep 6 2026 stall) gets
/// corrected from a fixture statsapi schedule response: matched by exact
/// team name, mapped onto the api-sports status vocabulary, and everything
/// statsapi doesn't know (logo, code, venue, season, start_time) is carried
/// forward from the row untouched — the fallback must never null those out.
#[test]
fn statsapi_fallback_maps_final_score_and_preserves_the_rest() {
    let existing = GameRow {
        league: "MLB".to_string(),
        sport: "baseball".to_string(),
        external_game_id: "184965".to_string(),
        link: None,
        home_team_name: "Chicago White Sox".to_string(),
        home_team_logo: Some("https://example.com/cws.png".to_string()),
        home_team_score: Some(0),
        home_team_code: Some("CWS".to_string()),
        away_team_name: "Minnesota Twins".to_string(),
        away_team_logo: Some("https://example.com/min.png".to_string()),
        away_team_score: Some(0),
        away_team_code: Some("MIN".to_string()),
        start_time: Utc.with_ymd_and_hms(2026, 9, 6, 22, 20, 0).unwrap(),
        short_detail: Some("IN1 · Inn 1".to_string()),
        state: "in".to_string(),
        status_short: Some("IN1".to_string()),
        status_long: Some("Inning 1".to_string()),
        timer: Some("Inn 1".to_string()),
        venue: Some("Guaranteed Rate Field".to_string()),
        season: Some("2026".to_string()),
    };

    // Real statsapi shape: dates[].games[].{status.detailedState, teams.home/away.{score,team.name}, linescore.currentInning}.
    let fixture = json!({
        "dates": [{
            "date": "2026-09-06",
            "games": [{
                "status": {"detailedState": "Final"},
                "teams": {
                    "home": {"score": 10, "team": {"name": "Chicago White Sox"}},
                    "away": {"score": 1, "team": {"name": "Minnesota Twins"}}
                },
                "linescore": {"currentInning": 9}
            }]
        }]
    });

    let games = parse_statsapi_schedule(&fixture);
    assert_eq!(games.len(), 1);
    let game = games.into_iter()
        .find(|g| g.home_name == existing.home_team_name && g.away_name == existing.away_team_name)
        .expect("exact team-name match");
    assert_eq!(game.detailed_state, "Final");
    assert_eq!((game.home_score, game.away_score), (Some(10), Some(1)));

    let mapped = statsapi_status_to_api_sports(&game.detailed_state, game.inning)
        .expect("Final is recognized vocabulary");
    assert_eq!(mapped, ("FT".to_string(), "Final".to_string()));

    let cleaned = statsapi_game_to_cleaned_data(&existing, &game, mapped);
    assert_eq!(cleaned.state, "final");
    assert_eq!(cleaned.status_short.as_deref(), Some("FT"));
    assert_eq!((cleaned.home_team.score, cleaned.away_team.score), (Some(10), Some(1)));
    // Nothing statsapi doesn't know got nulled out.
    assert_eq!(cleaned.home_team.logo.as_deref(), Some("https://example.com/cws.png"));
    assert_eq!(cleaned.home_team.code.as_deref(), Some("CWS"));
    assert_eq!(cleaned.venue.as_deref(), Some("Guaranteed Rate Field"));
    assert_eq!(cleaned.season.as_deref(), Some("2026"));
    assert_eq!(cleaned.start_time, existing.start_time);

    // No match for a team pair not in the fixture: never guess.
    let fixture_games = parse_statsapi_schedule(&fixture);
    assert!(fixture_games.iter().find(|g| g.home_name == "Some Other Team").is_none());

    // A detailedState this ticket didn't name maps to nothing — the fallback
    // must leave the row alone rather than invent a status.
    assert_eq!(statsapi_status_to_api_sports("Warmup", None), None);
}
