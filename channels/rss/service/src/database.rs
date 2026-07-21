use std::{env, time::Duration, sync::Arc};
use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
pub use sqlx::PgPool;
use sqlx::{FromRow, query, query_as};
use serde::Deserialize;
use chrono::{DateTime, Utc};

pub async fn initialize_pool() -> Result<PgPool> {
    let pool_options = PgPoolOptions::new()
        // Pool sizing rationale: rss runs up to 20 concurrent feed polls
        // per cycle (see the semaphore in lib.rs), each doing a batch
        // upsert. Ten connections left us fighting for them; 20 matches
        // the concurrency ceiling and removes the contention.
        .max_connections(20)
        // Keep one warm connection so the first query after an idle period
        // doesn't eat the TLS/auth handshake latency.
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
    eprintln!("[DB] Connected successfully");

    // No migrations here. core-api owns every shared table and runs the
    // single migration chain (VISION 4.3); this service is a pure writer.

    Ok(pool)
}

// ── Config types ─────────────────────────────────────────────────

#[derive(Deserialize, Clone, Debug)]
pub struct FeedConfig {
    pub name: String,
    pub url: String,
    pub category: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct TrackedFeed {
    pub url: String,
    pub name: String,
    pub category: String,
    pub is_default: bool,
    pub is_enabled: bool,
    pub consecutive_failures: i32,
}

// ── Parsed article ready for DB insertion ────────────────────────

pub struct ParsedArticle {
    pub feed_url: String,
    pub guid: String,
    pub title: String,
    pub link: String,
    pub description: String,
    pub source_name: String,
    pub published_at: Option<DateTime<Utc>>,
}

// ── Seed default feeds from config file (batched) ───────────────

pub async fn seed_tracked_feeds(pool: Arc<PgPool>, feeds: Vec<FeedConfig>) -> Result<()> {
    if feeds.is_empty() {
        return Ok(());
    }

    let urls: Vec<&str> = feeds.iter().map(|f| f.url.as_str()).collect();
    let names: Vec<&str> = feeds.iter().map(|f| f.name.as_str()).collect();
    let categories: Vec<&str> = feeds.iter().map(|f| f.category.as_str()).collect();

    // On conflict we want a default feed to always end up `is_enabled = true`
    // and `is_default = true`, even if somebody previously flipped it off or
    // it got quarantined. Before this change a default feed that hit the 288
    // consecutive-failure quarantine threshold would stay quarantined forever
    // because the upsert only touched name/category.
    //
    // Quarantine reset uses a CASE that clamps to 287 instead of 0 so we
    // don't lose the "this feed has been flaky" signal entirely — one more
    // failure still re-quarantines it, which is what we want for a source
    // that's been down all week and is only temporarily back up.
    let statement = "
        INSERT INTO tracked_feeds (url, name, category, is_default, is_enabled, consecutive_failures)
        SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])
            AS t(url, name, category),
            LATERAL (SELECT true AS is_default, true AS is_enabled, 0 AS consecutive_failures) defaults
        ON CONFLICT (url) DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            is_default = true,
            is_enabled = true,
            consecutive_failures = CASE
                WHEN tracked_feeds.consecutive_failures >= 288 THEN 287
                ELSE tracked_feeds.consecutive_failures
            END
    ";
    let mut connection = pool.acquire().await?;
    query(statement)
        .bind(&urls)
        .bind(&names)
        .bind(&categories)
        .execute(&mut *connection)
        .await
        .context("Failed to batch seed tracked feeds")?;
    Ok(())
}

// ── Get all enabled, non-quarantined feeds ──────────────────────

pub async fn get_tracked_feeds(pool: Arc<PgPool>) -> Vec<TrackedFeed> {
    let statement = "
        SELECT url, name, category, is_default, is_enabled, consecutive_failures
        FROM tracked_feeds
        WHERE is_enabled = TRUE AND consecutive_failures < 288
    ";
    let res: Result<Vec<TrackedFeed>, sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        let data = query_as(statement).fetch_all(&mut *connection).await?;
        Ok(data)
    }.await;

    match res {
        Ok(data) => data,
        Err(e) => {
            log::error!("Failed to get tracked feeds: {}", e);
            Vec::new()
        }
    }
}

// ── Get quarantined feeds (for periodic retry) ──────────────────

pub async fn get_quarantined_feeds(pool: Arc<PgPool>) -> Vec<TrackedFeed> {
    let statement = "
        SELECT url, name, category, is_default, is_enabled, consecutive_failures
        FROM tracked_feeds
        WHERE is_enabled = TRUE AND consecutive_failures >= 288
    ";
    let res: Result<Vec<TrackedFeed>, sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        let data = query_as(statement).fetch_all(&mut *connection).await?;
        Ok(data)
    }.await;

    match res {
        Ok(data) => data,
        Err(e) => {
            log::error!("Failed to get quarantined feeds: {}", e);
            Vec::new()
        }
    }
}

// ── Batch record feed poll successes ─────────────────────────────

pub async fn batch_record_feed_successes(pool: &Arc<PgPool>, feed_urls: &[String]) {
    if feed_urls.is_empty() {
        return;
    }
    let statement = "
        UPDATE tracked_feeds
        SET consecutive_failures = 0, last_success_at = NOW()
        WHERE url = ANY($1)
    ";
    let res: Result<(), sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        query(statement).bind(feed_urls).execute(&mut *connection).await?;
        Ok(())
    }.await;

    if let Err(e) = res {
        log::error!("Failed to batch record feed successes: {}", e);
    }
}

// ── Batch record feed poll failures ─────────────────────────────

pub async fn batch_record_feed_failures(pool: &Arc<PgPool>, feed_urls: &[String], errors: &[String]) {
    if feed_urls.is_empty() {
        return;
    }
    // Each feed gets its own error message, and we increment consecutive_failures
    let statement = "
        UPDATE tracked_feeds AS tf
        SET consecutive_failures = tf.consecutive_failures + 1,
            last_error = u.error_msg,
            last_error_at = NOW()
        FROM UNNEST($1::text[], $2::text[]) AS u(url, error_msg)
        WHERE tf.url = u.url
    ";
    let res: Result<(), sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        query(statement)
            .bind(feed_urls)
            .bind(errors)
            .execute(&mut *connection)
            .await?;
        Ok(())
    }.await;

    if let Err(e) = res {
        log::error!("Failed to batch record feed failures: {}", e);
    }
}

// ── Batch upsert RSS items ──────────────────────────────────────

pub async fn batch_upsert_rss_items(pool: &Arc<PgPool>, articles: Vec<ParsedArticle>) -> Result<()> {
    if articles.is_empty() {
        return Ok(());
    }

    let feed_urls: Vec<&str> = articles.iter().map(|a| a.feed_url.as_str()).collect();
    let guids: Vec<&str> = articles.iter().map(|a| a.guid.as_str()).collect();
    let titles: Vec<&str> = articles.iter().map(|a| a.title.as_str()).collect();
    let links: Vec<&str> = articles.iter().map(|a| a.link.as_str()).collect();
    let descriptions: Vec<&str> = articles.iter().map(|a| a.description.as_str()).collect();
    let source_names: Vec<&str> = articles.iter().map(|a| a.source_name.as_str()).collect();
    let published_ats: Vec<Option<DateTime<Utc>>> = articles.iter().map(|a| a.published_at).collect();

    // Only touch the row when content actually changed — unchanged articles
    // are skipped so Sequin CDC won't fire redundant UPDATE events on repoll.
    let statement = "
        INSERT INTO rss_items (feed_url, guid, title, link, description, source_name, published_at)
        SELECT * FROM UNNEST(
            $1::text[], $2::text[], $3::text[], $4::text[],
            $5::text[], $6::text[], $7::timestamptz[]
        ) AS t(feed_url, guid, title, link, description, source_name, published_at)
        ON CONFLICT (feed_url, guid)
        DO UPDATE SET
            title = EXCLUDED.title,
            link = EXCLUDED.link,
            description = EXCLUDED.description,
            source_name = EXCLUDED.source_name,
            published_at = EXCLUDED.published_at,
            updated_at = CURRENT_TIMESTAMP
        WHERE
            rss_items.title        IS DISTINCT FROM EXCLUDED.title
            OR rss_items.link         IS DISTINCT FROM EXCLUDED.link
            OR rss_items.description  IS DISTINCT FROM EXCLUDED.description
            OR rss_items.source_name  IS DISTINCT FROM EXCLUDED.source_name
            OR rss_items.published_at IS DISTINCT FROM EXCLUDED.published_at
    ";
    let mut connection = pool.acquire().await?;
    query(statement)
        .bind(&feed_urls)
        .bind(&guids)
        .bind(&titles)
        .bind(&links)
        .bind(&descriptions)
        .bind(&source_names)
        .bind(&published_ats)
        .execute(&mut *connection)
        .await
        .context("Failed to batch upsert RSS items")?;
    Ok(())
}

// ── Cleanup old articles (batched to keep transactions small) ────

pub async fn cleanup_old_articles(pool: &Arc<PgPool>) -> Result<u64> {
    let statement = "
        DELETE FROM rss_items
        WHERE id IN (
            SELECT id FROM rss_items
            WHERE published_at < now() - interval '7 days'
            LIMIT 1000
        )
    ";
    let mut total: u64 = 0;
    let mut connection = pool.acquire().await?;
    loop {
        let result = query(statement).execute(&mut *connection).await?;
        let deleted = result.rows_affected();
        total += deleted;
        if deleted < 1000 {
            break;
        }
    }
    Ok(total)
}
