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
        // v1.1.3 Time Controls: finals/postponed retained 7 DAYS (was 12h)
        // so the desktop day-window has data to look back at.
        ("alive_final_6h",     "final", h(-6),  h(-6),  true),   // fresh final
        ("alive_final_3d",     "final", d(-3),  d(-3),  true),   // within 7d window
        ("dead_final_8d",      "final", d(-8),  d(-8),  false),  // past 7d retention
        ("dead_postponed_8d",  "postponed", d(-8), d(-8), false),
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

    // 4 rows in `cases` are marked `should_survive = false` — assert the
    // returned count matches so a regression where the query under-deletes
    // but happens to clean up the rows we check would still fail the test.
    let deleted = cleanup_old_games(&pool).await.unwrap();
    let expected_deleted = cases.iter().filter(|(_, _, _, _, s)| !s).count() as u64;
    assert_eq!(deleted, expected_deleted, "cleanup_old_games deleted {} rows, expected {}", deleted, expected_deleted);

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
