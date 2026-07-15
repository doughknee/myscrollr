use std::{env, time::Duration, sync::Arc};
use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
pub use sqlx::PgPool;
use sqlx::{FromRow, query, query_as};
pub use chrono::Utc;

/// Build the sqlx migrator for this service.
///
/// `set_ignore_missing(true)` is required because all Rust services
/// (finance, sports, rss, predictions) share a single `_sqlx_migrations`
/// table in the scrollr Postgres DB — sqlx 0.8.x has no API to name the
/// table per service (see PRs #106 / #107). Without this flag, each service
/// sees the other services' rows and errors out with `VersionMissing` because
/// e.g. predictions has no `11*` files on disk.
///
/// With each service on a unique numeric version prefix (finance 11*,
/// sports 12*, rss 20250601*/13*, predictions 14*), the flag tolerates
/// "versions recorded for *other* services" without hiding checksum drift on
/// *this* service's own rows — VersionMismatch (drift on an applied row whose
/// file *is* on disk) still fires and fails the boot loudly, which is
/// the behavior PR #106 was after.
fn migrator() -> sqlx::migrate::Migrator {
    let mut m = sqlx::migrate!("./migrations");
    m.set_ignore_missing(true);
    m
}

/// Numeric version range that uniquely identifies predictions-service
/// migrations in the shared `_sqlx_migrations` table. Must match the prefix
/// enforced by `tests/migration_versions.rs` (PREFIX_LO / PREFIX_HI).
///
/// Predictions migration filenames start with `14` and are 12 digits long,
/// e.g. `140000000001_initial.up.sql`. That's a version of 140_000_000_001
/// (one hundred forty billion and one), so the prefix range is 140B..<150B.
/// An earlier (finance) version of these constants was off by exactly 10×
/// (e.g. `14_000_000_000` — TEN zeros, not eleven) which silently matches
/// NO real migration rows; that caused the invariant check below to reliably
/// fail on production boot because `recorded` was always 0. See
/// tests/migration_versions.rs for the matching test-side constants.
pub const PREDICTIONS_MIGRATION_MIN: i64 = 140_000_000_000;
pub const PREDICTIONS_MIGRATION_MAX: i64 = 149_999_999_999;

pub async fn initialize_pool() -> Result<PgPool> {
    let pool_options = PgPoolOptions::new()
        // Pool sizing rationale: on a busy minute predictions can run many WS
        // ticker events through `upsert_market` which each open a connection
        // to update `markets`. Twenty is well within Postgres' per-database
        // connection budget and leaves headroom.
        .max_connections(20)
        // Keep one warm connection so the first query after an idle period
        // doesn't eat the 200-500ms TLS/auth handshake latency.
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
    // `_sqlx_migrations`. We use `set_ignore_missing(true)` on the migrator
    // so it tolerates rows for *other* services, but that same flag would
    // also silently hide "someone deleted a migration file locally but the
    // row is still in the DB" — which is exactly the kind of drift that
    // caused the April 2026 silent migration failure. This check catches
    // the mismatch loudly and refuses to boot.
    //
    // IMPORTANT: only count UP migrations. `migrator().iter()` yields both
    // halves of each reversible migration (`ReversibleUp` + `ReversibleDown`),
    // so for 3 `.up.sql` + 3 `.down.sql` files the iter returns 6 entries
    // while `_sqlx_migrations` records only 3 rows (one per UP apply). The
    // initial version of this check compared 6 ≠ 3 and crashed every pod;
    // see commit 2cb0e90 (advisory-only), 2026-04-24 fix.
    let on_disk: i64 = migrator()
        .iter()
        .filter(|m| m.migration_type.is_up_migration())
        .count() as i64;
    let recorded: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM _sqlx_migrations WHERE version >= $1 AND version <= $2",
    )
    .bind(PREDICTIONS_MIGRATION_MIN)
    .bind(PREDICTIONS_MIGRATION_MAX)
    .fetch_one(&pool)
    .await
    .context("query migration count")?;

    if recorded != on_disk {
        anyhow::bail!(
            "migration invariant violated: {} up-migrations on disk but {} recorded in DB \
             (predictions prefix {}-{}). Someone deleted a migration file, or this service is \
             pointing at a DB whose migrations haven't been applied. Run \
             `kubectl exec deploy/predictions-service -- /bin/sh -c 'ls migrations/'` and \
             compare against `SELECT version, description FROM _sqlx_migrations WHERE \
             version BETWEEN {} AND {}`.",
            on_disk,
            recorded,
            PREDICTIONS_MIGRATION_MIN,
            PREDICTIONS_MIGRATION_MAX,
            PREDICTIONS_MIGRATION_MIN,
            PREDICTIONS_MIGRATION_MAX
        );
    }

    eprintln!(
        "[DB] Migration invariant check ok: {on_disk} up-migrations on disk / \
         {recorded} recorded in {PREDICTIONS_MIGRATION_MIN}..={PREDICTIONS_MIGRATION_MAX}"
    );

    Ok(pool)
}

/// A row in the `markets` display table, as read for change-detection.
#[derive(FromRow, Clone, Debug)]
pub struct MarketRow {
    pub id: String,
    pub yes_price: Option<i32>,
    pub yes_bid: Option<i32>,
    pub yes_ask: Option<i32>,
    pub volume: Option<i64>,
    pub volume_24h: Option<i64>,
    pub open_interest: Option<i64>,
    pub status: Option<String>,
    pub result: Option<String>,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub category: Option<String>,
    pub event_title: Option<String>,
    pub event_rank: Option<i16>,
    pub in_sweep: Option<bool>,
}

/// The full set of displayed fields for a market upsert. All optional so a
/// sparse WS ticker event can update only what it carries (change-detection
/// uses COALESCE semantics — a `None` field leaves the stored value alone).
#[derive(Clone, Debug, Default)]
pub struct MarketUpsert {
    pub ticker: String,
    pub event_ticker: Option<String>,
    pub series_ticker: Option<String>,
    pub category: Option<String>,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub yes_price: Option<i32>,
    pub yes_bid: Option<i32>,
    pub yes_ask: Option<i32>,
    pub volume: Option<i64>,
    pub volume_24h: Option<i64>,
    pub open_interest: Option<i64>,
    pub status: Option<String>,
    pub result: Option<String>,
    pub is_primary: Option<bool>,
    pub open_time: Option<chrono::DateTime<Utc>>,
    pub close_time: Option<chrono::DateTime<Utc>>,
    pub link: Option<String>,
    /// Event context (v1.1.4): the event's human question + this market's
    /// rank within its event (1 = primary, 2 = second outcome). Only the
    /// catalog sweep sets these; WS ticks leave them None (COALESCE keeps
    /// the stored value).
    pub event_title: Option<String>,
    pub event_rank: Option<i16>,
    /// Sweep membership (v1.1.5): Some(true) from the catalog sweep, None
    /// from WS ticks (COALESCE keeps the stored value). Demotion to false
    /// happens only via `reconcile_sweep_selection`.
    pub in_sweep: Option<bool>,
}

impl MarketUpsert {
    pub fn new(ticker: impl Into<String>) -> Self {
        Self {
            ticker: ticker.into(),
            ..Default::default()
        }
    }

    fn id(&self) -> String {
        format!("kalshi:{}", self.ticker)
    }
}

/// Read the existing `markets` row for change-detection (None if not present).
async fn get_market_row(pool: &Arc<PgPool>, id: &str) -> Result<Option<MarketRow>, sqlx::Error> {
    let mut conn = pool.acquire().await?;
    let row: Option<MarketRow> = query_as(
        "SELECT id, yes_price, yes_bid, yes_ask, volume, volume_24h, open_interest,
                status, result, title, subtitle, category, event_title, event_rank,
                in_sweep
         FROM markets WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row)
}

/// True when a status/result pair represents a resolved market. Mirrors the
/// desktop's `isResolved` (view.ts) and the Go API's resolved-recently
/// predicate — keep the three in sync (CONTRACT.md).
fn is_resolved(status: Option<&str>, result: Option<&str>) -> bool {
    let status_resolved = status
        .map(|s| {
            let s = s.to_ascii_lowercase();
            s == "settled" || s == "determined" || s == "finalized"
        })
        .unwrap_or(false);
    let result_resolved = result
        .map(|r| {
            let r = r.to_ascii_lowercase();
            r == "yes" || r == "no"
        })
        .unwrap_or(false);
    status_resolved || result_resolved
}

/// The `settled_at` stamp for a write that may transition a row into a
/// resolved state: Some(now) only when the effective next state is resolved
/// and the previous state was not. Stamped once; COALESCE in SQL keeps the
/// first value if a later write would stamp again.
fn settled_at_stamp(
    prev_status: Option<&str>,
    prev_result: Option<&str>,
    next_status: Option<&str>,
    next_result: Option<&str>,
) -> Option<chrono::DateTime<Utc>> {
    let effective_status = next_status.or(prev_status);
    let effective_result = next_result.or(prev_result);
    if is_resolved(effective_status, effective_result)
        && !is_resolved(prev_status, prev_result)
    {
        Some(Utc::now())
    } else {
        None
    }
}

/// Returns true when any displayed field in `next` differs from `prev`.
/// A `None` field in `next` is treated as "no change" (COALESCE semantics).
fn displayed_field_changed(prev: &MarketRow, next: &MarketUpsert) -> bool {
    macro_rules! changed {
        ($field:ident) => {
            next.$field.is_some() && next.$field != prev.$field
        };
    }
    changed!(yes_price)
        || changed!(yes_bid)
        || changed!(yes_ask)
        || changed!(volume)
        || changed!(volume_24h)
        || changed!(open_interest)
        || changed!(status)
        || changed!(result)
        || changed!(title)
        || changed!(subtitle)
        || changed!(category)
        || changed!(event_title)
        || changed!(event_rank)
        || changed!(in_sweep)
}

/// Upsert a market into the `markets` display table with CHANGE-DETECTION.
///
/// Kalshi ticks are high-frequency; finance has no such guard but predictions
/// needs one. The flow:
///   - If the row does not exist → INSERT it.
///   - If it exists but NO displayed field changed → skip the UPDATE entirely
///     (no `updated_at` churn, no needless CDC event).
///   - If a displayed field changed → UPDATE, and set `prev_yes_price` from
///     the OLD `yes_price` so the desktop "movers" delta works.
///
/// Returns `true` when a write (insert or update) actually happened.
/// `create_missing` gates the INSERT branch: the catalog sweep passes true
/// (it owns row creation), the WS ticker path passes false (it must never
/// create rows -- see websocket.rs flush_ticker).
pub async fn upsert_market(
    pool: &Arc<PgPool>,
    upsert: &MarketUpsert,
    create_missing: bool,
) -> Result<bool> {
    let id = upsert.id();
    let existing = get_market_row(pool, &id).await.context("read existing market row")?;

    match existing {
        Some(prev) => {
            // Dormant row + WS tick (v1.1.5): the ticker firehose covers
            // every open Kalshi market, including thousands that dropped
            // out of the curated sweep. Once demoted, those rows must stop
            // generating writes/CDC events — only the sweep (create_missing
            // = true) may touch them again, which is also how a market that
            // re-enters the selection gets promoted back.
            if !create_missing && prev.in_sweep == Some(false) {
                return Ok(false);
            }

            if !displayed_field_changed(&prev, upsert) {
                // No-op tick — skip the write entirely to avoid CDC churn.
                return Ok(false);
            }

            // A displayed field changed. COALESCE each column so a sparse
            // ticker event only overwrites the fields it carries; carry the
            // OLD yes_price into prev_yes_price for the movers delta.
            // settled_at is stamped once, on the transition into a resolved
            // state (COALESCE on the COLUMN keeps the first stamp).
            let settled_at = settled_at_stamp(
                prev.status.as_deref(),
                prev.result.as_deref(),
                upsert.status.as_deref(),
                upsert.result.as_deref(),
            );
            let mut conn = pool.acquire().await?;
            query(
                "UPDATE markets SET
                    event_ticker  = COALESCE($2, event_ticker),
                    series_ticker = COALESCE($3, series_ticker),
                    category      = COALESCE($4, category),
                    title         = COALESCE($5, title),
                    subtitle      = COALESCE($6, subtitle),
                    prev_yes_price = $7,
                    yes_price     = COALESCE($8, yes_price),
                    yes_bid       = COALESCE($9, yes_bid),
                    yes_ask       = COALESCE($10, yes_ask),
                    volume        = COALESCE($11, volume),
                    volume_24h    = COALESCE($12, volume_24h),
                    open_interest = COALESCE($13, open_interest),
                    status        = COALESCE($14, status),
                    result        = COALESCE($15, result),
                    is_primary    = COALESCE($16, is_primary),
                    open_time     = COALESCE($17, open_time),
                    close_time    = COALESCE($18, close_time),
                    link          = COALESCE($19, link),
                    event_title   = COALESCE($20, event_title),
                    event_rank    = COALESCE($21, event_rank),
                    in_sweep      = COALESCE($22, in_sweep),
                    settled_at    = COALESCE(settled_at, $23),
                    updated_at    = now()
                 WHERE id = $1",
            )
            .bind(&id)
            .bind(&upsert.event_ticker)
            .bind(&upsert.series_ticker)
            .bind(&upsert.category)
            .bind(&upsert.title)
            .bind(&upsert.subtitle)
            .bind(prev.yes_price) // prev_yes_price <- OLD yes_price
            .bind(upsert.yes_price)
            .bind(upsert.yes_bid)
            .bind(upsert.yes_ask)
            .bind(upsert.volume)
            .bind(upsert.volume_24h)
            .bind(upsert.open_interest)
            .bind(&upsert.status)
            .bind(&upsert.result)
            .bind(upsert.is_primary)
            .bind(upsert.open_time)
            .bind(upsert.close_time)
            .bind(&upsert.link)
            .bind(&upsert.event_title)
            .bind(upsert.event_rank)
            .bind(upsert.in_sweep)
            .bind(settled_at)
            .execute(&mut *conn)
            .await
            .context("update market")?;
            Ok(true)
        }
        None => {
            if !create_missing {
                // Unknown market and this caller doesn't own creation
                // (WS ticker path) -- drop the tick.
                return Ok(false);
            }
            // A row that is resolved at insert (rare: a settled leg of a
            // still-open event entering the selection) is stamped now — it
            // just became visible to us, which is the best signal we have.
            let settled_at = settled_at_stamp(
                None,
                None,
                upsert.status.as_deref(),
                upsert.result.as_deref(),
            );
            let mut conn = pool.acquire().await?;
            query(
                "INSERT INTO markets (
                    id, source, ticker, event_ticker, series_ticker, category, title,
                    subtitle, yes_price, yes_bid, yes_ask, prev_yes_price, volume,
                    volume_24h, open_interest, status, result, is_primary, open_time,
                    close_time, link, event_title, event_rank, in_sweep, settled_at
                 ) VALUES (
                    $1, 'kalshi', $2, $3, $4, $5, $6, $7, $8, $9, $10, $8, $11, $12, $13,
                    $14, $15, COALESCE($16, TRUE), $17, $18, $19,
                    COALESCE($20, ''), COALESCE($21, 1), COALESCE($22, TRUE), $23
                 )
                 ON CONFLICT (id) DO NOTHING",
            )
            .bind(&id)
            .bind(&upsert.ticker)
            .bind(&upsert.event_ticker)
            .bind(&upsert.series_ticker)
            .bind(&upsert.category)
            .bind(&upsert.title)
            .bind(&upsert.subtitle)
            .bind(upsert.yes_price) // also seeds prev_yes_price ($8 reused)
            .bind(upsert.yes_bid)
            .bind(upsert.yes_ask)
            .bind(upsert.volume)
            .bind(upsert.volume_24h)
            .bind(upsert.open_interest)
            .bind(&upsert.status)
            .bind(&upsert.result)
            .bind(upsert.is_primary)
            .bind(upsert.open_time)
            .bind(upsert.close_time)
            .bind(&upsert.link)
            .bind(&upsert.event_title)
            .bind(upsert.event_rank)
            .bind(upsert.in_sweep)
            .bind(settled_at)
            .execute(&mut *conn)
            .await
            .context("insert market")?;
            Ok(true)
        }
    }
}

/// Demote every `in_sweep = TRUE` row that is NOT part of the current sweep
/// selection (v1.1.5 reconciliation). Returns the demoted tickers so the
/// caller can REST-check their real settlement status.
///
/// One statement, sweep-cadence (every 15 min): the demotion write bumps
/// `updated_at` and fires a CDC event per row, which is intended — clients
/// learn the market left the curated set. Re-promotion happens naturally via
/// the sweep's own upsert (`in_sweep: Some(true)`) *before* this runs, so a
/// market that re-enters the selection is never demoted in the same cycle.
pub async fn reconcile_sweep_selection(
    pool: &Arc<PgPool>,
    selected_ids: &[String],
) -> Result<Vec<String>> {
    let mut conn = pool.acquire().await?;
    // Deliberately does NOT touch updated_at: demotion is a membership
    // change, not a data refresh. updated_at feeds "how fresh is this
    // market" displays and the resolved-today window used to key off it —
    // bumping it here made every long-settled row in a bulk demotion look
    // freshly resolved (found during v1.1.5 verification).
    let rows: Vec<(String,)> = query_as(
        "UPDATE markets SET in_sweep = FALSE
         WHERE in_sweep = TRUE AND NOT (id = ANY($1))
         RETURNING ticker",
    )
    .bind(selected_ids)
    .fetch_all(&mut *conn)
    .await
    .context("reconcile sweep selection")?;
    Ok(rows.into_iter().map(|(t,)| t).collect())
}

/// Update only the lifecycle status/result of a market (from
/// `market_lifecycle_v2` WS events). Skips the write when nothing changed.
pub async fn update_market_lifecycle(
    pool: &Arc<PgPool>,
    ticker: &str,
    status: Option<&str>,
    result: Option<&str>,
) -> Result<bool> {
    let id = format!("kalshi:{}", ticker);
    let existing = get_market_row(pool, &id).await.context("read market row for lifecycle")?;
    let Some(prev) = existing else {
        // We don't know this market yet; the catalog sweep will create it.
        return Ok(false);
    };

    let status_changed = status.is_some() && status != prev.status.as_deref();
    let result_changed = result.is_some() && result != prev.result.as_deref();
    if !status_changed && !result_changed {
        return Ok(false);
    }

    // Stamp settled_at when THIS write is the transition into a resolved
    // state (lifecycle WS event or the sweep's dropped-market recheck).
    let settled_at = settled_at_stamp(
        prev.status.as_deref(),
        prev.result.as_deref(),
        status,
        result,
    );

    let mut conn = pool.acquire().await?;
    query(
        "UPDATE markets SET
            status = COALESCE($2, status),
            result = COALESCE($3, result),
            settled_at = COALESCE(settled_at, $4),
            updated_at = now()
         WHERE id = $1",
    )
    .bind(&id)
    .bind(status)
    .bind(result)
    .bind(settled_at)
    .execute(&mut *conn)
    .await
    .context("update market lifecycle")?;
    Ok(true)
}

/// Returns the enabled tickers from `tracked_markets` (the runtime
/// subscription source of truth).
pub async fn get_enabled_markets(pool: Arc<PgPool>) -> Vec<String> {
    let statement = "SELECT ticker FROM tracked_markets WHERE is_enabled = TRUE";
    let res: Result<Vec<(String,)>, sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        let data = query_as(statement).fetch_all(&mut *connection).await?;
        Ok(data)
    }
    .await;

    match res {
        Ok(data) => data.into_iter().map(|(s,)| s).collect(),
        Err(e) => {
            log::error!("Failed to get enabled markets: {}", e);
            Vec::new()
        }
    }
}

/// Seed/sync the `tracked_markets` catalog. Idempotent upsert run on every
/// boot: ON CONFLICT(ticker) DO UPDATE keeps title/category/series in sync
/// while preserving the in-DB enabled/disabled state.
pub async fn seed_tracked_markets(
    pool: Arc<PgPool>,
    markets: Vec<crate::types::TrackedMarketConfig>,
) -> Result<()> {
    let statement = "INSERT INTO tracked_markets (ticker, title, category, series_ticker)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (ticker) DO UPDATE SET
                        title = EXCLUDED.title,
                        category = EXCLUDED.category,
                        series_ticker = COALESCE(EXCLUDED.series_ticker, tracked_markets.series_ticker)";
    let mut connection = pool.acquire().await?;
    for entry in markets {
        query(statement)
            .bind(&entry.ticker)
            .bind(&entry.title)
            .bind(&entry.category)
            .bind(&entry.series_ticker)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

/// Upsert a single tracked market discovered by the REST catalog sweep.
pub async fn upsert_tracked_market(
    pool: &Arc<PgPool>,
    ticker: &str,
    title: &str,
    category: &str,
    series_ticker: Option<&str>,
) -> Result<()> {
    let statement = "INSERT INTO tracked_markets (ticker, title, category, series_ticker)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (ticker) DO UPDATE SET
                        title = EXCLUDED.title,
                        category = EXCLUDED.category,
                        series_ticker = COALESCE(EXCLUDED.series_ticker, tracked_markets.series_ticker)";
    let mut connection = pool.acquire().await?;
    query(statement)
        .bind(ticker)
        .bind(title)
        .bind(category)
        .bind(series_ticker)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

// ─── per-market polling-health write-back (borrowed from sports) ─────────

/// Record a successful poll for a market. Updates `last_polled_at` and
/// `last_poll_success_at` to NOW(), and clears any previous error.
///
/// Errors are logged but not returned — polling-health bookkeeping must
/// never block the actual data ingestion. If the bookkeeping update fails,
/// the market will appear stale to the API; on the next successful poll it
/// will recover.
pub async fn record_poll_success(pool: &Arc<PgPool>, ticker: &str) {
    let res = async {
        let mut conn = pool.acquire().await?;
        query(
            "UPDATE tracked_markets
             SET last_polled_at = NOW(),
                 last_poll_success_at = NOW(),
                 last_poll_error = NULL
             WHERE ticker = $1",
        )
        .bind(ticker)
        .execute(&mut *conn)
        .await?;
        Ok::<_, sqlx::Error>(())
    }
    .await;
    if let Err(e) = res {
        log::warn!("Failed to record poll success for {}: {}", ticker, e);
    }
}

/// Record a failed poll for a market. Updates `last_polled_at` and
/// `last_poll_error`, but does NOT touch `last_poll_success_at` — that
/// timestamp must only move forward on actual successes so staleness
/// detection works.
pub async fn record_poll_error(pool: &Arc<PgPool>, ticker: &str, err_msg: &str) {
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
            "UPDATE tracked_markets
             SET last_polled_at = NOW(),
                 last_poll_error = $2
             WHERE ticker = $1",
        )
        .bind(ticker)
        .bind(truncated)
        .execute(&mut *conn)
        .await?;
        Ok::<_, sqlx::Error>(())
    }
    .await;
    if let Err(e) = res {
        log::warn!("Failed to record poll error for {}: {}", ticker, e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(yes_price: Option<i32>, status: Option<&str>) -> MarketRow {
        MarketRow {
            id: "kalshi:TEST".into(),
            yes_price,
            yes_bid: None,
            yes_ask: None,
            volume: None,
            volume_24h: None,
            open_interest: None,
            status: status.map(|s| s.to_string()),
            result: None,
            title: None,
            subtitle: None,
            category: None,
            event_title: None,
            event_rank: None,
            in_sweep: Some(true),
        }
    }

    #[test]
    fn no_change_when_next_matches_prev() {
        let prev = row(Some(62), Some("active"));
        let mut next = MarketUpsert::new("TEST");
        next.yes_price = Some(62);
        next.status = Some("active".into());
        assert!(!displayed_field_changed(&prev, &next));
    }

    #[test]
    fn change_detected_on_price_move() {
        let prev = row(Some(62), Some("active"));
        let mut next = MarketUpsert::new("TEST");
        next.yes_price = Some(63);
        assert!(displayed_field_changed(&prev, &next));
    }

    #[test]
    fn none_fields_are_no_change() {
        let prev = row(Some(62), Some("active"));
        // A sparse event carrying nothing displayed is a no-op.
        let next = MarketUpsert::new("TEST");
        assert!(!displayed_field_changed(&prev, &next));
    }

    #[test]
    fn status_change_detected() {
        let prev = row(Some(62), Some("active"));
        let mut next = MarketUpsert::new("TEST");
        next.status = Some("closed".into());
        assert!(displayed_field_changed(&prev, &next));
    }

    #[test]
    fn resolved_state_detection() {
        assert!(is_resolved(Some("settled"), None));
        assert!(is_resolved(Some("Determined"), None));
        assert!(is_resolved(Some("FINALIZED"), None));
        assert!(is_resolved(Some("active"), Some("yes")));
        assert!(is_resolved(None, Some("no")));
        assert!(!is_resolved(Some("active"), Some("")));
        assert!(!is_resolved(Some("closed"), None)); // closed trades no more but isn't resolved
        assert!(!is_resolved(None, None));
    }

    #[test]
    fn settled_at_stamps_only_on_transition() {
        // active -> finalized: stamp.
        assert!(settled_at_stamp(Some("active"), None, Some("finalized"), None).is_some());
        // result arrives while status stays active: stamp.
        assert!(settled_at_stamp(Some("active"), Some(""), None, Some("yes")).is_some());
        // already resolved -> another resolved write: no re-stamp.
        assert!(settled_at_stamp(Some("finalized"), None, Some("settled"), None).is_none());
        assert!(settled_at_stamp(Some("active"), Some("yes"), Some("finalized"), None).is_none());
        // sparse write carrying nothing lifecycle-ish on an active row: no stamp.
        assert!(settled_at_stamp(Some("active"), None, None, None).is_none());
        // insert-time resolution (no prev state): stamp.
        assert!(settled_at_stamp(None, None, Some("finalized"), None).is_some());
    }

    #[test]
    fn in_sweep_transition_detected() {
        // v1.1.5: demotion/promotion must count as a displayed change so a
        // CDC event tells clients the market left/re-entered the curated
        // set; a sweep re-asserting the current value is a no-op.
        let prev = row(Some(62), Some("active")); // in_sweep: Some(true)
        let mut demote = MarketUpsert::new("TEST");
        demote.in_sweep = Some(false);
        assert!(displayed_field_changed(&prev, &demote));

        let mut reassert = MarketUpsert::new("TEST");
        reassert.in_sweep = Some(true);
        assert!(!displayed_field_changed(&prev, &reassert));

        // WS ticks (in_sweep: None) never count as a membership change.
        let ws_tick = MarketUpsert::new("TEST");
        assert!(!displayed_field_changed(&prev, &ws_tick));
    }

    #[test]
    fn event_context_change_detected() {
        // v1.1.4: the sweep back-filling event_title (or a rank flip when
        // volumes reorder an event's legs) must count as a displayed
        // change so CDC broadcasts it.
        let prev = row(Some(62), Some("active"));
        let mut next = MarketUpsert::new("TEST");
        next.event_title = Some("More tech layoffs in 2026 than in 2025?".into());
        assert!(displayed_field_changed(&prev, &next));

        let mut rank_only = MarketUpsert::new("TEST");
        rank_only.event_rank = Some(2);
        assert!(displayed_field_changed(&prev, &rank_only));
    }
}
