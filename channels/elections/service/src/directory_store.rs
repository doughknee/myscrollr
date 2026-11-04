use crate::provider::Race;
use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use std::collections::{BTreeMap, HashMap};
use std::time::Duration;

// At most one bounded nationwide download per cycle. Rotate requested rows,
// including rows missing from a valid response, so a bad listing cannot starve others.
const MAX_WANTED: usize = 256;

// A healthy HTTP response can replay its last detail. Keep checking the
// directory until the detail confirms those votes or publishes a newer
// correction. A changed ordering of candidates is not conflicting evidence.
const NEEDS_DIRECTORY: &str = "(r.failures>0 OR (
    r.directory_observed_at>r.source_updated_at AND
    (SELECT jsonb_object_agg(c->>'id',c->'votes') FROM jsonb_array_elements(r.snapshot->'candidates') c)
    IS DISTINCT FROM
    (SELECT jsonb_object_agg(c->>'id',c->'votes') FROM jsonb_array_elements(r.directory_snapshot->'candidates') c)
)) AND r.next_poll_at<'infinity' AND EXISTS (
    SELECT 1 FROM user_widgets WHERE enabled AND widget_type='elections'
        AND config->'race_ids' @> jsonb_build_array(r.race_id))";

pub(super) async fn failing_by_date(
    db: &PgPool,
    catalog: &HashMap<i32, Race>,
) -> Result<BTreeMap<NaiveDate, HashMap<i32, Race>>> {
    let ids: Vec<i32> = sqlx::query_scalar(&format!(
        "SELECT r.race_id FROM election_results r WHERE {NEEDS_DIRECTORY}
        ORDER BY r.directory_checked_at NULLS FIRST,r.race_id"
    ))
    .fetch_all(db)
    .await?;
    let mut groups = BTreeMap::new();
    for id in ids {
        if let Some(race) = catalog.get(&id) {
            let group: &mut HashMap<i32, Race> = groups.entry(race.election_date).or_default();
            if group.len() < MAX_WANTED {
                group.insert(id, race.clone());
            }
        }
    }
    Ok(groups)
}

#[derive(FromRow)]
pub(super) struct DirectoryLease {
    election_date: NaiveDate,
    generation: i64,
    failures: i32,
}

pub(super) async fn claim(db: &PgPool, date: NaiveDate) -> Result<Option<DirectoryLease>> {
    // A worker can lose a network request or die before completion. The next
    // generation becomes eligible automatically and fences that worker's writes.
    Ok(sqlx::query_as("INSERT INTO election_directory_refreshes(election_date,next_check_at)
        VALUES ($1,now()+interval '105 seconds')
        ON CONFLICT(election_date) DO UPDATE SET generation=election_directory_refreshes.generation+1,
            next_check_at=excluded.next_check_at WHERE election_directory_refreshes.next_check_at<=now()
        RETURNING election_date,generation,failures").bind(date).fetch_optional(db).await?)
}

pub(super) async fn fail(
    db: &PgPool,
    lease: &DirectoryLease,
    cadence: i32,
    retry_after: Option<Duration>,
) -> Result<()> {
    let backoff = i64::from(cadence) * (1 << (lease.failures + 1).min(4));
    let retry = retry_after
        .map(|d| d.as_secs().saturating_add(u64::from(d.subsec_nanos() > 0)))
        .unwrap_or(0);
    let seconds = backoff
        .max(i64::try_from(retry).unwrap_or(i64::MAX))
        .min(i32::MAX.into());
    sqlx::query(
        "UPDATE election_directory_refreshes SET failures=least(failures+1,16),
        next_check_at=now()+$3::int*interval '1 second' WHERE election_date=$1 AND generation=$2",
    )
    .bind(lease.election_date)
    .bind(lease.generation)
    .bind(seconds as i32)
    .execute(db)
    .await?;
    Ok(())
}

pub(super) async fn save(
    db: &PgPool,
    lease: &DirectoryLease,
    wanted: &HashMap<i32, Race>,
    observed: DateTime<Utc>,
    snapshots: &HashMap<i32, Value>,
    cadence: i32,
) -> Result<Vec<i32>> {
    let mut tx = db.begin().await?;
    let saved = sqlx::query(
        "UPDATE election_directory_refreshes SET failures=0,
        next_check_at=now()+$3::int*interval '1 second' WHERE election_date=$1 AND generation=$2",
    )
    .bind(lease.election_date)
    .bind(lease.generation)
    .bind(cadence)
    .execute(&mut *tx)
    .await?;
    if saved.rows_affected() == 0 {
        return Ok(vec![]);
    }
    let wanted_ids: Vec<_> = wanted.keys().copied().collect();
    // Recheck both follow and detail eligibility after the HTTP roundtrip. A recovered
    // or unfollowed race should not produce a parallel result or notification.
    let eligible: Vec<i32> = sqlx::query_scalar(&format!(
        "UPDATE election_results r SET directory_checked_at=now()
        WHERE race_id=ANY($1) AND {NEEDS_DIRECTORY} RETURNING race_id"
    ))
    .bind(&wanted_ids)
    .fetch_all(&mut *tx)
    .await?;
    let mut rows = Vec::new();
    for id in eligible {
        if let Some(snapshot) = snapshots.get(&id) {
            rows.push(serde_json::json!({"id":id, "snapshot":snapshot}));
        }
    }
    // A count-vector change between two observations bounds when it happened.
    // Candidate order and changes in formatting or reporting are not vote movement.
    let changed:Vec<i32> = sqlx::query_scalar("WITH incoming AS (
        SELECT id,snapshot FROM jsonb_to_recordset($1::jsonb) AS i(id int,snapshot jsonb)
    ), compared AS (
        SELECT i.*, r.directory_observed_at AS previous, r.directory_snapshot->'change_after' AS known_change,
            (SELECT jsonb_object_agg(c->>'id',c->'votes') FROM jsonb_array_elements(r.directory_snapshot->'candidates') c) AS old_votes,
            (SELECT jsonb_object_agg(c->>'id',c->'votes') FROM jsonb_array_elements(i.snapshot->'candidates') c) AS new_votes
        FROM incoming i JOIN election_results r ON r.race_id=i.id
        WHERE r.directory_observed_at IS NULL OR r.directory_observed_at<$2
    ) UPDATE election_results r SET directory_observed_at=$2,
        directory_snapshot=(c.snapshot-'change_after') || jsonb_strip_nulls(jsonb_build_object(
            'observed_at',$2::timestamptz,
            'change_after',CASE WHEN c.old_votes IS DISTINCT FROM c.new_votes THEN to_jsonb(c.previous) ELSE c.known_change END))
        FROM compared c WHERE r.race_id=c.id RETURNING r.race_id")
        .bind(sqlx::types::Json(rows)).bind(observed).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(changed)
}
