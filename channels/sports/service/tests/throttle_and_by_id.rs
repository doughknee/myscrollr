//! api-sports' per-minute throttle and the stale-live re-fetch by id, against
//! a local mock of the api-sports envelope (REL-229 / REL-230).
//!
//! The throttle is in-band: HTTP 200, `errors.rateLimit`, empty `response`.
//! Before REL-229 that read as "0 games found" and the league was marked
//! healthy; a throttled poll must instead surface as `PollError::Throttled`,
//! back the host off, and touch nothing.

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use axum::{extract::{Query, State}, http::HeaderMap, response::IntoResponse, routing::get, Json, Router};
use serde_json::{json, Value};
use sports_service::{
    database::TrackedLeague,
    fetch_games, fetch_response, PollError, RateLimiter,
};

fn mlb() -> TrackedLeague {
    TrackedLeague {
        name: "MLB".to_string(),
        sport_api: "baseball".to_string(),
        api_host: "v1.baseball.api-sports.io".to_string(),
        league_id: 1,
        category: "Baseball".to_string(),
        country: None,
        logo_url: None,
        season: Some("2026".to_string()),
        season_format: None,
        offseason_months: None,
    }
}

fn game(id: i64, short: &str, long: &str, inning: Option<i64>) -> Value {
    json!({
        "id": id,
        "date": "2026-09-06T22:20:00+00:00",
        "timestamp": 1788740400,
        "status": {"short": short, "long": long, "inning": inning},
        "teams": {
            "home": {"name": "Chicago White Sox", "code": "CWS", "logo": null},
            "away": {"name": "Minnesota Twins", "code": "MIN", "logo": null}
        },
        "scores": {
            "home": {"innings": {"1": 3, "2": 7}},
            "away": {"innings": {"1": 1, "2": 0}}
        }
    })
}

/// The mock: `/games?date=` answers live-then-throttled-then-live,
/// `/games?id=` answers final. Every response carries the per-minute pair.
#[derive(Clone)]
struct Mock {
    date_calls: Arc<AtomicUsize>,
}

async fn games(State(mock): State<Mock>, Query(q): Query<std::collections::HashMap<String, String>>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert("X-RateLimit-Limit", "300".parse().unwrap());
    headers.insert("x-ratelimit-requests-limit", "75000".parse().unwrap());
    headers.insert("x-ratelimit-requests-remaining", "74000".parse().unwrap());

    let body = if q.contains_key("id") {
        headers.insert("X-RateLimit-Remaining", "297".parse().unwrap());
        json!({"get": "games", "results": 1, "errors": [],
               "response": [game(184965, "FT", "Finished", None)]})
    } else {
        let n = mock.date_calls.fetch_add(1, Ordering::SeqCst);
        if n == 1 {
            // Exactly what production logged on 2026-09-07: a 200 with the
            // throttle message and nothing else.
            headers.insert("X-RateLimit-Remaining", "0".parse().unwrap());
            json!({"get": "games", "results": 0, "response": [],
                   "errors": {"rateLimit": "Too many requests. You have exceeded the limit of requests per minute of your subscription."}})
        } else {
            headers.insert("X-RateLimit-Remaining", "299".parse().unwrap());
            json!({"get": "games", "results": 1, "errors": [],
                   "response": [game(184965, "IN1", "Inning 1", Some(1))]})
        }
    };
    (headers, Json(body))
}

async fn serve() -> (String, Mock) {
    let mock = Mock { date_calls: Arc::new(AtomicUsize::new(0)) };
    let app = Router::new().route("/games", get(games)).with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, mock)
}

#[tokio::test]
async fn throttled_response_is_throttled_not_zero_games_and_by_id_finalises_the_row() {
    let (base, mock) = serve().await;
    let league = mlb();
    let rl = RateLimiter::new_per_league(std::slice::from_ref(&league), 7500);
    let client = reqwest::Client::new();
    let by_date = format!("{base}/games?league=1&season=2026&date=2026-09-06");

    // 1. Live: one game, in progress, per-minute limit adopted from the headers.
    let games = fetch_games(&client, &league, &by_date, &rl).await.expect("first poll succeeds");
    assert_eq!(games.len(), 1);
    assert_eq!(games[0].state, "in");
    assert_eq!(games[0].status_short.as_deref(), Some("IN1"));
    let (hosts, budget) = rl.minute_snapshot();
    assert_eq!((hosts["baseball"].limit, hosts["baseball"].remaining, hosts["baseball"].throttle_events), (Some(300), Some(299), 0));
    assert_eq!((budget.limit, budget.sent_last_minute, budget.backoff_secs), (Some(300), 1, 0));

    // 2. Gap: the throttle answers. Not an empty result — a throttle event
    //    that backs the host off and is counted as such.
    match fetch_games(&client, &league, &by_date, &rl).await {
        Err(PollError::Throttled(backoff)) => assert_eq!(backoff.as_secs(), 10),
        other => panic!("expected Throttled, got {other:?}"),
    }
    let (hosts, budget) = rl.minute_snapshot();
    assert_eq!((hosts["baseball"].throttle_events, hosts["baseball"].remaining), (1, Some(0)));
    // remaining == 0 blocks for a full minute, longer than the 10 s backoff,
    // and the block is account-wide: the whole process waits, not one host.
    assert!(budget.backoff_secs >= 55, "{budget:?}");
    assert!(rl.minute_wait().unwrap().as_secs() >= 55);
    assert_eq!(mock.date_calls.load(Ordering::SeqCst), 2);

    // 3. Final by id: the sweep's request shape. A fresh limiter stands in
    //    for the minute that would otherwise have to pass.
    let rl2 = RateLimiter::new_per_league(std::slice::from_ref(&league), 7500);
    let by_id = format!("{base}/games?id=184965");
    let games = fetch_games(&client, &league, &by_id, &rl2).await.expect("by-id succeeds");
    assert_eq!(games.len(), 1);
    assert_eq!(games[0].external_game_id, "184965");
    assert_eq!(games[0].state, "final");
    assert_eq!(games[0].status_short.as_deref(), Some("FT"));
    assert_eq!((games[0].home_team.score, games[0].away_team.score), (Some(10), Some(1)));
    // The daily headers were adopted too.
    assert_eq!(rl2.daily_quota("baseball"), 75_000);
}

#[tokio::test]
async fn a_429_is_a_throttle_and_other_errors_are_errors() {
    let app = Router::new()
        .route("/games", get(|| async { (axum::http::StatusCode::TOO_MANY_REQUESTS, "slow down") }))
        .route("/fixtures", get(|| async { (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "boom") }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let rl = RateLimiter::new(&["baseball".to_string(), "football".to_string()], 100);
    let client = reqwest::Client::new();

    // The 500 first: after the 429 the whole account backs off for 10 s.
    match fetch_response(&client, "football", "Serie A", &format!("{base}/fixtures?id=1"), &rl).await {
        Err(PollError::Other(e)) => assert!(e.to_string().contains("500"), "{e}"),
        other => panic!("500 must be Other, got {other:?}"),
    }
    assert_eq!(rl.minute_snapshot().0["football"].throttle_events, 0);

    match fetch_response(&client, "baseball", "MLB", &format!("{base}/games?id=1"), &rl).await {
        Err(PollError::Throttled(backoff)) => assert_eq!(backoff.as_secs(), 10),
        other => panic!("429 must be Throttled, got {other:?}"),
    }
    let (hosts, budget) = rl.minute_snapshot();
    assert_eq!(hosts["baseball"].throttle_events, 1);
    assert_eq!(budget.backoff_secs, 9);
}
