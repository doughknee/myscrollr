//! Which rows the stale-live sweep picks up (REL-230): the query behind
//! `sweep_stale_live`, against a real Postgres. Skips without
//! `TEST_DATABASE_URL`.

mod common;

use std::sync::Arc;
use sports_service::database::get_stale_live_games;
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
