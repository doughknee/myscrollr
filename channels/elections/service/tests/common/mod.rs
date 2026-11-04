//! Shared bootstrap for the Postgres-backed integration tests. Gate on
//! `TEST_DATABASE_URL`, matching the Go integration tests and CI.

#![allow(dead_code)]

use std::env;

/// A pool on `TEST_DATABASE_URL` with the core schema present, or `None`
/// (after printing why) when the test should skip.
pub async fn test_pool(what: &str) -> Option<sqlx::PgPool> {
    let Ok(url) = env::var("TEST_DATABASE_URL") else {
        eprintln!("TEST_DATABASE_URL not set -- skipping {what}");
        return None;
    };
    let pool = sqlx::PgPool::connect(&url)
        .await
        .expect("connect to TEST_DATABASE_URL");
    ensure_schema(&pool).await;
    Some(pool)
}

/// Apply core's migration chain when the database is empty. Core owns the
/// schema (VISION 4.3); this service is a pure writer, so the tests read
/// the same `.up.sql` files core runs at startup.
pub async fn ensure_schema(pool: &sqlx::PgPool) {
    let present: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'games')",
    )
    .fetch_one(pool)
    .await
    .expect("probe schema");
    if present {
        return;
    }

    let dir = std::path::Path::new("../../../api/migrations");
    let mut ups: Vec<_> = std::fs::read_dir(dir)
        .expect("core owns the schema (VISION 4.3) -- api/migrations must be readable")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.to_string_lossy().ends_with(".up.sql"))
        .collect();
    ups.sort();

    for path in ups {
        let sql = std::fs::read_to_string(&path).expect("read migration");
        sqlx::raw_sql(&sql)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("apply {}: {e}", path.display()));
    }
}
