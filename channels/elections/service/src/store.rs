use crate::provider::{Race, Snapshot, interval};
use anyhow::{Result, anyhow};
use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

#[derive(FromRow)]
pub struct Lease {
    lease_generation: i64,
    failures: i32,
    source_updated_at: Option<DateTime<Utc>>,
    delayed: bool,
}

pub async fn claim(db: &PgPool, id: i32) -> Result<Option<Lease>> {
    Ok(sqlx::query_as("INSERT INTO election_results (race_id,next_poll_at,verified_until)
        SELECT $1,now()+interval '30 seconds',now()+interval '90 seconds'
        WHERE EXISTS (SELECT 1 FROM user_widgets WHERE enabled AND widget_type='elections'
            AND config->'race_ids' @> jsonb_build_array($1::int))
        ON CONFLICT (race_id) DO UPDATE SET next_poll_at=excluded.next_poll_at,
            lease_generation=election_results.lease_generation+1
        WHERE election_results.next_poll_at <= now()
        RETURNING lease_generation,failures,source_updated_at,failures>0 OR verified_until<now() AS delayed")
        .bind(id).fetch_optional(db).await?)
}

pub struct PollOutcome {
    pub changed: bool,
    pub upstream_error: Option<anyhow::Error>,
}

// Generation fences a worker whose lease expired during its network request.
pub async fn complete(
    db: &PgPool,
    race: &Race,
    lease: Lease,
    result: Result<Snapshot>,
) -> Result<PollOutcome> {
    let seconds = interval(race, Utc::now());
    let result = result.and_then(|snap| {
        if lease
            .source_updated_at
            .is_some_and(|old| old > snap.source_updated_at)
        {
            Err(anyhow!("older civicAPI snapshot"))
        } else {
            Ok(snap)
        }
    });
    match result {
        Ok(snap) => {
            let newer = lease.source_updated_at != Some(snap.source_updated_at);
            let saved = sqlx::query("UPDATE election_results SET snapshot=CASE WHEN $3 THEN $4 ELSE snapshot END,
                source_updated_at=CASE WHEN $3 THEN $5 ELSE source_updated_at END, failures=0,
                next_poll_at=now()+$6::int*interval '1 second',verified_until=now()+3*$6::int*interval '1 second'
                WHERE race_id=$1 AND lease_generation=$2")
                .bind(race.id).bind(lease.lease_generation).bind(newer).bind(sqlx::types::Json(&snap))
                .bind(snap.source_updated_at).bind(seconds).execute(db).await?;
            Ok(PollOutcome {
                changed: saved.rows_affected() == 1 && (newer || lease.delayed),
                upstream_error: None,
            })
        }
        Err(error) => {
            let backoff = (seconds * (1 << lease.failures.clamp(0, 4))).min(seconds.max(300));
            let saved = sqlx::query("UPDATE election_results SET failures=LEAST(failures+1,16),
                next_poll_at=now()+$3::int*interval '1 second' WHERE race_id=$1 AND lease_generation=$2")
                .bind(race.id).bind(lease.lease_generation).bind(backoff).execute(db).await?;
            Ok(PollOutcome {
                changed: saved.rows_affected() == 1 && lease.failures == 0,
                upstream_error: Some(error),
            })
        }
    }
}
