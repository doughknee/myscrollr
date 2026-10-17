//! SCROLLR-320: `upsert_game` records a game_transitions row only when score,
//! period or status changed. Skips without `TEST_DATABASE_URL`.

mod common;

use std::sync::Arc;
use chrono::Utc;
use sports_service::database::{cleanup_old_games, upsert_game, CleanedData, Team};
use sqlx::query_scalar;

const LEAGUE: &str = "__transitions__";
const GAME: &str = "g1";

fn game(home: i32, status: &str, state: &str, timer: &str) -> CleanedData {
    let team = |n: &str, score| Team { name: n.into(), logo: None, score: Some(score), code: None };
    CleanedData {
        league: LEAGUE.into(), sport: "football".into(), external_game_id: GAME.into(), link: None,
        home_team: team("H", home), away_team: team("A", 0),
        start_time: Utc::now(), short_detail: None, state: state.into(),
        status_short: Some(status.into()), status_long: None, timer: Some(timer.into()),
        venue: None, season: None,
    }
}

#[tokio::test]
async fn transition_only_on_score_period_or_status_change() {
    let Some(pool) = common::test_pool("game transitions").await else { return };
    let pool = Arc::new(pool);
    let count = || async { query_scalar::<_, i64>("SELECT COUNT(*) FROM game_transitions WHERE league = $1")
        .bind(LEAGUE).fetch_one(&*pool).await.unwrap() };
    for t in ["game_transitions", "games"] {
        sqlx::query(&format!("DELETE FROM {t} WHERE league = $1")).bind(LEAGUE).execute(&*pool).await.unwrap();
    }

    upsert_game(pool.clone(), game(0, "Q1", "in", "10:00")).await.unwrap();
    assert_eq!(count().await, 1, "first sight of a game");
    upsert_game(pool.clone(), game(0, "Q1", "in", "09:00")).await.unwrap();
    assert_eq!(count().await, 1, "clock-only change writes nothing");
    upsert_game(pool.clone(), game(7, "Q1", "in", "08:00")).await.unwrap();
    assert_eq!(count().await, 2, "score change writes exactly one");
    upsert_game(pool.clone(), game(7, "Q2", "in", "15:00")).await.unwrap();
    assert_eq!(count().await, 3, "period change");

    // retention: an old transition goes with the next cleanup
    sqlx::query("UPDATE game_transitions SET at = NOW() - INTERVAL '31 days' WHERE league = $1 AND home_score = 0")
        .bind(LEAGUE).execute(&*pool).await.unwrap();
    cleanup_old_games(&pool).await.unwrap();
    assert_eq!(count().await, 1);

    for t in ["game_transitions", "games"] {
        sqlx::query(&format!("DELETE FROM {t} WHERE league = $1")).bind(LEAGUE).execute(&*pool).await.unwrap();
    }
}
