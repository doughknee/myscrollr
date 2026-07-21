//! Schema contract: every column this ingester writes must still exist, with
//! a type that accepts what it sends.
//!
//! Why a test and not a compile error: this service uses runtime
//! `sqlx::query`, not the `query!` macro, so a core column rename compiles
//! cleanly. It then fails at runtime -- where nothing notices either. The
//! write error is logged and the poll loop continues, reads return an empty
//! Vec indistinguishable from "no data", and `/health/ready` stays 200
//! because it tracks poll success, not writes. A rename in core could
//! silently stop this source ever storing another row.
//!
//! Core owns every migration (VISION 4.3), so this file is how the core repo
//! finds out it broke a downstream writer.
//!
//! Skips without TEST_DATABASE_URL, matching the Go integration tests. CI
//! provides one; the test applies core's migrations itself when the database
//! is empty, the same way channels/fantasy/api/schema_contract_test.go does.
//!
//! Add a column to a query in this service, add it here too.

use std::collections::HashMap;
use std::env;

use sqlx::Row;

/// (table, &[(column, information_schema.data_type)])
const CONTRACT: &[(&str, &[(&str, &str)])] = &[
    ("trades", &[
        ("symbol", "character varying"),
        ("price", "numeric"),
        ("previous_close", "numeric"),
        ("price_change", "numeric"),
        ("percentage_change", "numeric"),
        ("direction", "character varying"),
    ]),
    ("tracked_symbols", &[
        ("symbol", "character varying"),
        ("name", "character varying"),
        ("category", "character varying"),
        ("exchange", "character varying"),
    ]),
];

#[tokio::test]
async fn writes_match_the_live_schema() {
    let Ok(url) = env::var("TEST_DATABASE_URL") else {
        eprintln!("TEST_DATABASE_URL not set -- skipping schema contract");
        return;
    };

    let pool = sqlx::PgPool::connect(&url)
        .await
        .expect("connect to TEST_DATABASE_URL");

    ensure_schema(&pool).await;

    let mut problems = Vec::new();
    for (table, columns) in CONTRACT {
        let rows = sqlx::query(
            "SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1",
        )
        .bind(table)
        .fetch_all(&pool)
        .await
        .expect("read information_schema");

        if rows.is_empty() {
            problems.push(format!("table `{table}` does not exist"));
            continue;
        }

        let actual: HashMap<String, String> = rows
            .iter()
            .map(|r| (r.get("column_name"), r.get("data_type")))
            .collect();

        for (col, want) in *columns {
            match actual.get(*col) {
                None => problems.push(format!("{table}.{col} is missing")),
                Some(got) if got != want => {
                    problems.push(format!("{table}.{col} is `{got}`, expected `{want}`"))
                }
                Some(_) => {}
            }
        }
    }

    assert!(
        problems.is_empty(),
        "schema drift between core's migrations and what this service writes:\n  {}",
        problems.join("\n  ")
    );
}

/// Apply core's migration chain when the database is empty. CI hands each job
/// a fresh Postgres and this service has no migration tool of its own.
async fn ensure_schema(pool: &sqlx::PgPool) {
    let probe = CONTRACT[0].0;
    let present: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1)",
    )
    .bind(probe)
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
