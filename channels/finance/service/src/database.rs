use std::{env, time::Duration, sync::Arc};
use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
pub use sqlx::PgPool;
use sqlx::{FromRow, query, query_as};
pub use chrono::Utc;

pub async fn initialize_pool() -> Result<PgPool> {
    let pool_options = PgPoolOptions::new()
        // Pool sizing rationale: on a busy minute finance can run 500+ WS
        // price events through `process_single_trade` which each open a
        // connection to update `trades`. Ten connections was creating
        // `acquire_timeout` pressure. Twenty is still well within Postgres'
        // per-database connection budget and leaves headroom.
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
    eprintln!("[DB] Connected successfully");

    // No migrations here. core-api owns every shared table and runs the
    // single migration chain (VISION 4.3); this service is a pure writer.

    Ok(pool)
}

#[derive(FromRow, Clone, Debug)]
pub struct DatabaseTradeData {
    pub symbol: String, 
    pub price: f64, 
    pub previous_close: f64, 
    pub price_change: f64,
    pub percentage_change: f64,
    pub direction: String,
    pub day_volume: i64,
    pub last_updated: chrono::DateTime<Utc>
}

pub async fn get_tracked_symbols(pool: Arc<PgPool>) -> Vec<String> {
    let statement = "SELECT symbol FROM tracked_symbols WHERE is_enabled = TRUE";
    let res: Result<Vec<(String,)>, sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        let data = query_as(statement).fetch_all(&mut *connection).await?;
        Ok(data)
    }.await;

    match res {
        Ok(data) => data.into_iter().map(|(s,)| s).collect(),
        Err(e) => {
            log::error!("Failed to get tracked symbols: {}", e);
            Vec::new()
        }
    }
}

pub async fn seed_tracked_symbols(pool: Arc<PgPool>, symbols: Vec<crate::types::TrackedSymbolConfig>) -> Result<()> {
    let statement = "INSERT INTO tracked_symbols (symbol, name, category, exchange) VALUES ($1, $2, $3, $4) ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, exchange = COALESCE(EXCLUDED.exchange, tracked_symbols.exchange)";
    let mut connection = pool.acquire().await?;
    for entry in symbols {
        query(statement)
            .bind(&entry.symbol)
            .bind(&entry.name)
            .bind(&entry.category)
            .bind(&entry.exchange)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

pub async fn insert_symbol(pool: Arc<PgPool>, symbol: String) -> Result<()> {
    let statement = "INSERT INTO trades (symbol, price, previous_close, price_change, percentage_change, direction) VALUES ($1, 0, 0, 0, 0, 'flat') ON CONFLICT (symbol) DO NOTHING";
    let mut connection = pool.acquire().await?;
    query(statement).bind(symbol).execute(&mut *connection).await?;
    Ok(())
}

pub async fn update_previous_close(pool: Arc<PgPool>, symbol: String, prev_close: f64) -> Result<()> {
    let statement = "UPDATE trades SET previous_close = $1 WHERE symbol = $2";
    let mut connection = pool.acquire().await?;
    query(statement).bind(prev_close).bind(symbol).execute(&mut *connection).await?;
    Ok(())
}

pub async fn update_trade(pool: Arc<PgPool>, symbol: String, price: f64, price_change: f64, percentage_change: f64, direction: &str, day_volume: Option<u64>) -> Result<()> {
    let statement = "UPDATE trades SET price = $1, price_change = $2, percentage_change = $3, direction = $4, day_volume = COALESCE($5, day_volume), last_updated = CURRENT_TIMESTAMP WHERE symbol = $6";
    let mut connection = pool.acquire().await?;
    let day_volume = day_volume.and_then(|value| i64::try_from(value).ok());
    query(statement).bind(price).bind(price_change).bind(percentage_change).bind(direction).bind(day_volume).bind(symbol).execute(&mut *connection).await?;
    Ok(())
}

pub async fn get_trades(pool: Arc<PgPool>) -> Vec<DatabaseTradeData> {
    let statement = "
        SELECT
            symbol,
            price::FLOAT8 as price,
            previous_close::FLOAT8 as previous_close,
            price_change::FLOAT8 as price_change,
            percentage_change::FLOAT8 as percentage_change,
            direction,
            day_volume,
            last_updated
        FROM trades
        ORDER BY symbol ASC
    ";

    let res: Result<Vec<DatabaseTradeData>, sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        let data = query_as(statement).fetch_all(&mut *connection).await?;
        Ok(data)
    }.await;

    match res {
        Ok(data) => data,
        Err(e) => {
            log::error!("Failed to get trades: {}", e);
            Vec::new()
        }
    }
}

/// Returns symbols where exchange is NULL (need metadata fetch).
pub async fn get_symbols_without_exchange(pool: Arc<PgPool>) -> Vec<String> {
    let statement = "SELECT symbol FROM tracked_symbols WHERE exchange IS NULL AND is_enabled = TRUE";
    let res: Result<Vec<(String,)>, sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        let data = query_as(statement).fetch_all(&mut *connection).await?;
        Ok(data)
    }.await;

    match res {
        Ok(data) => data.into_iter().map(|(s,)| s).collect(),
        Err(e) => {
            log::error!("Failed to get symbols without exchange: {}", e);
            Vec::new()
        }
    }
}

/// Returns all enabled symbols (for background verification).
pub async fn get_all_enabled_symbols(pool: Arc<PgPool>) -> Vec<String> {
    let statement = "SELECT symbol FROM tracked_symbols WHERE is_enabled = TRUE";
    let res: Result<Vec<(String,)>, sqlx::Error> = async {
        let mut connection = pool.acquire().await?;
        let data = query_as(statement).fetch_all(&mut *connection).await?;
        Ok(data)
    }.await;

    match res {
        Ok(data) => data.into_iter().map(|(s,)| s).collect(),
        Err(e) => {
            log::error!("Failed to get all enabled symbols: {}", e);
            Vec::new()
        }
    }
}

/// Updates exchange and link for a symbol.
pub async fn update_symbol_exchange_link(
    pool: Arc<PgPool>,
    symbol: &str,
    exchange: Option<&str>,
    link: &str,
) -> Result<()> {
    let statement = "UPDATE tracked_symbols SET exchange = $1, link = $2 WHERE symbol = $3";
    let mut connection = pool.acquire().await?;
    query(statement)
        .bind(exchange)
        .bind(link)
        .bind(symbol)
        .execute(&mut *connection)
        .await?;
    Ok(())
}
