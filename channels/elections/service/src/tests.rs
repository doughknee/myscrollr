use super::{INVALIDATION, provider::*, publish, store::*};
use anyhow::{Context, Result, ensure};
use chrono::{DateTime, Duration, Utc};
use futures_util::StreamExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::env;
#[path = "../tests/common/mod.rs"]
mod common;

fn time(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
}

fn raw(corrected: bool) -> Value {
    let (votes_a, votes_b, percent_a, percent_b, updated) = if corrected {
        (110, 140, 44, 56, "2026-11-04T02:08:00Z")
    } else {
        (120, 80, 60, 40, "2026-11-04T02:06:00Z")
    };
    json!({"election_name":"Tennessee Governor","country":"US","province":"TN",
        "election_date":"2026-11-03T05:00:00.000Z","test_data":false,"is_disputed":false,
        "last_updated":updated,"percent_reporting":if corrected {50} else {40},
        "candidates":[{"candidate_id":1,"name":"Preview A","party":"QA replay","votes":votes_a,"percent":percent_a,"winner":false},
            {"candidate_id":2,"name":"Preview B","party":"QA replay","votes":votes_b,"percent":percent_b,"winner":false}]})
}

#[tokio::test]
async fn provider_recovers_from_bad_routes_without_bypassing_rate_limits() -> Result<()> {
    use axum::{Json, Router, http::StatusCode, routing::get};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    let alternate_reads = Arc::new(AtomicUsize::new(0));
    let reads = alternate_reads.clone();
    let app = Router::new()
        .route("/gateway", get(|| async { StatusCode::BAD_GATEWAY }))
        .route("/busy", get(|| async { StatusCode::TOO_MANY_REQUESTS }))
        .route("/html", get(|| async { "temporarily unavailable" }))
        .route("/older", get(|| async { Json(raw(false)) }))
        .route(
            "/ok",
            get(move || {
                let reads = reads.clone();
                async move {
                    reads.fetch_add(1, Ordering::SeqCst);
                    Json(raw(true))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let base = format!("http://{}", listener.local_addr()?);
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::new();
    let race = &catalog()?[0];
    let previous = Some(time("2026-11-04T02:07:00Z"));
    let good = format!("{base}/ok");
    for path in ["gateway", "html", "older"] {
        let recovered =
            fetch_with_fallback(&client, race, previous, &format!("{base}/{path}"), &good).await?;
        assert_eq!(recovered.candidates[0].votes, 110);
    }
    assert_eq!(alternate_reads.load(Ordering::SeqCst), 3);
    assert!(
        fetch_with_fallback(&client, race, previous, &format!("{base}/busy"), &good)
            .await
            .is_err()
    );
    assert_eq!(alternate_reads.load(Ordering::SeqCst), 3);
    assert!(
        fetch_with_fallback(&client, race, previous, &good, &good)
            .await
            .is_ok()
    );
    assert_eq!(alternate_reads.load(Ordering::SeqCst), 4);
    assert!(
        fetch_with_fallback(
            &client,
            race,
            previous,
            &format!("{base}/gateway"),
            &format!("{base}/html")
        )
        .await
        .is_err()
    );
    server.abort();
    Ok(())
}

fn parse(value: &Value, race: &Race) -> Result<Snapshot> {
    decode(
        &serde_json::to_vec(value)?,
        race,
        time("2026-11-04T03:00:00Z"),
    )
}

#[test]
fn reject_bad_results_and_preserve_source_calls() {
    let race = &catalog().unwrap()[0];
    for (path, bad) in [
        ("/test_data", json!(true)),
        ("/test_data", Value::Null),
        ("/country", json!("CA")),
        ("/province", json!("GA")),
        ("/election_name", json!("State Senate")),
        ("/election_date", json!("2022-11-03T00:00:00Z")),
        ("/last_updated", json!("2026-11-04T03:05:00Z")),
        ("/percent_reporting", json!(100.1)),
        ("/candidates", json!([])),
        ("/candidates/0/candidate_id", json!(2)),
        ("/candidates/0/votes", json!(-1)),
        ("/candidates/0/votes", json!(9_007_199_254_740_992_i64)),
        ("/candidates/0/percent", json!(-0.1)),
        ("/candidates/0/name", json!("\n")),
        ("/candidates/0/winner", Value::Null),
    ] {
        let mut value = raw(false);
        *value.pointer_mut(path).unwrap() = bad;
        assert!(parse(&value, race).is_err(), "accepted {path}");
    }
    let mut value = raw(false);
    value["candidates"][0]["votes"] = json!(0);
    value["candidates"][0]["winner"] = json!(true);
    value["candidates"][0]["party"] = Value::Null;
    value["percent_reporting"] = Value::Null;
    let snap = parse(&value, race).unwrap();
    assert!(snap.candidates[0].winner);
    assert!(snap.candidates[0].party.is_empty());
    assert_eq!(snap.candidates[0].votes, 0);
    assert!(snap.percent_reporting.is_none());
    value["candidates"][1]["winner"] = json!(true);
    assert!(parse(&value, race).is_err());
    assert!(decode(&vec![0; BODY_LIMIT + 1], race, Utc::now()).is_err());
}

#[test]
fn future_mayor_uses_own_polling_window() {
    let race = Race {
        id: 4,
        name: "Mayor".into(),
        state: "TN".into(),
        election_date: "2027-05-04".parse().unwrap(),
    };
    let day = time("2027-05-04T00:00:00Z");
    for (days, secs) in [
        (-2, 21600),
        (-1, 30),
        (2, 30),
        (3, 900),
        (13, 900),
        (14, 86400),
    ] {
        assert_eq!(interval(&race, day + Duration::days(days)), secs);
    }
}

async fn due(db: &PgPool, id: i32) -> Result<()> {
    sqlx::query(
        "UPDATE election_results SET next_poll_at=now()-interval '1 minute' WHERE race_id=$1",
    )
    .bind(id)
    .execute(db)
    .await?;
    Ok(())
}

#[tokio::test]
async fn database_claims_corrections_outages_and_fencing() -> Result<()> {
    let Some(db) = common::test_pool("elections").await else {
        return Ok(());
    };
    let race = &catalog()?[0];
    sqlx::raw_sql(
        "DELETE FROM user_widgets WHERE widget_type='elections'; DELETE FROM election_results",
    )
    .execute(&db)
    .await?;
    assert!(claim(&db, race.id).await?.is_none());
    sqlx::query("INSERT INTO user_widgets(logto_sub,widget_type,config) VALUES('tester-a','elections',$1),('tester-b','elections',$1)")
        .bind(json!({"race_ids":[race.id]})).execute(&db).await?;
    let first = claim(&db, race.id).await?.unwrap();
    assert!(claim(&db, race.id).await?.is_none());
    let failed = complete(&db, race, first, Err(anyhow::anyhow!("first outage"))).await?;
    assert!(failed.changed && failed.upstream_error.is_some());
    for (corrected, changed) in [(false, true), (false, false), (true, true)] {
        due(&db, race.id).await?;
        let lease = claim(&db, race.id).await?.unwrap();
        let out = complete(&db, race, lease, parse(&raw(corrected), race)).await?;
        assert!(out.upstream_error.is_none());
        assert_eq!(out.changed, changed);
    }
    due(&db, race.id).await?;
    let older = claim(&db, race.id).await?.unwrap();
    let out = complete(&db, race, older, parse(&raw(false), race)).await?;
    assert!(out.changed && out.upstream_error.is_some());
    let (snapshot, failures): (Value, i32) =
        sqlx::query_as("SELECT snapshot,failures FROM election_results WHERE race_id=$1")
            .bind(race.id)
            .fetch_one(&db)
            .await?;
    assert_eq!(snapshot["candidates"][0]["votes"], 110);
    assert_eq!(snapshot["source_updated_at"], "2026-11-04T02:08:00Z");
    assert_eq!(failures, 1);
    due(&db, race.id).await?;
    let lost = claim(&db, race.id).await?.unwrap();
    due(&db, race.id).await?;
    let _successor = claim(&db, race.id).await?.unwrap();
    assert!(
        !complete(&db, race, lost, parse(&raw(true), race))
            .await?
            .changed
    );
    let failures: i32 =
        sqlx::query_scalar("SELECT failures FROM election_results WHERE race_id=$1")
            .bind(race.id)
            .fetch_one(&db)
            .await?;
    assert_eq!(failures, 1);
    Ok(())
}

#[tokio::test]
async fn invalidates_only_one_redis_race_topic() -> Result<()> {
    let Ok(url) = env::var("TEST_REDIS_URL") else {
        return Ok(());
    };
    let client = redis::Client::open(url)?;
    let mut sub = client.get_async_pubsub().await?;
    sub.subscribe("cdc:elections:120001").await?;
    let mut incoming = sub.on_message();
    publish(&client, 120001).await?;
    let msg = tokio::time::timeout(std::time::Duration::from_secs(3), incoming.next())
        .await?
        .context("no invalidation")?;
    assert_eq!(msg.get_channel_name(), "cdc:elections:120001");
    assert_eq!(msg.get_payload::<String>()?, INVALIDATION);
    Ok(())
}

// Opt-in acceptance rehearsal. Uses the production decoder, lease, write and Redis
// publisher and keeps the real UI's follow. No fixture path is built into the binary.
#[tokio::test]
#[ignore = "disposable private-preview database and running tester session required"]
async fn replay_private_preview() -> Result<()> {
    let phase = env::var("ELECTION_REPLAY_PHASE")?;
    ensure!(
        phase == "first" || phase == "correction",
        "expected first or correction phase"
    );
    let db = PgPool::connect(&env::var("TEST_DATABASE_URL")?).await?;
    let name: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&db)
        .await?;
    ensure!(
        name == "scrollr_preview",
        "refusing replay outside scrollr_preview"
    );
    let redis = redis::Client::open(env::var("TEST_REDIS_URL")?)?;
    let race = &catalog()?[0];
    let mut tx = db.begin().await?;
    let follows: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM user_widgets WHERE enabled AND widget_type='elections'
        AND config->'race_ids' @> jsonb_build_array($1::int))",
    )
    .bind(race.id)
    .fetch_one(&mut *tx)
    .await?;
    ensure!(follows, "follow race 87476 in the preview UI first");
    if phase == "first" {
        sqlx::query("UPDATE election_results SET source_updated_at=NULL,snapshot=NULL,next_poll_at=now(),lease_generation=lease_generation+1 WHERE race_id=$1")
            .bind(race.id).execute(&mut *tx).await?;
    } else {
        let tag=sqlx::query("UPDATE election_results SET next_poll_at=now(),lease_generation=lease_generation+1 WHERE race_id=$1
            AND snapshot#>>'{candidates,0,name}'='Preview A' AND snapshot#>>'{candidates,0,votes}'='120'").bind(race.id).execute(&mut *tx).await?;
        ensure!(tag.rows_affected() == 1, "run the first phase first");
    }
    tx.commit().await?;
    let lease = claim(&db, race.id)
        .await?
        .context("no lease: stop the live polling profile before replay")?;
    let outcome = complete(&db, race, lease, parse(&raw(phase == "correction"), race)).await?;
    ensure!(
        outcome.upstream_error.is_none() && outcome.changed,
        "fixture not committed"
    );
    // Preserve the private fixture until the tester explicitly picks live mode.
    // Both fields are worker bookkeeping; the stored source time remains intact.
    sqlx::query("UPDATE election_results SET next_poll_at='infinity',verified_until='infinity' WHERE race_id=$1")
        .bind(race.id).execute(&db).await?;
    publish(&redis, race.id).await?;
    println!("Published QA {phase} through the Rust election pipeline.");
    Ok(())
}
