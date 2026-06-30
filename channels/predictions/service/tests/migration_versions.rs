//! Assert that every migration version in this service's `migrations/`
//! directory uses the service-specific 140_000_000_000..=149_999_999_999
//! prefix range AND that the runtime invariant-check constants in
//! `database.rs` agree with the test-side range.
//!
//! This prevents three classes of regression:
//!
//! 1. Someone adds a new migration with a copy-pasted version from a different
//!    service — would reintroduce the same shared-table collision that caused
//!    sports-service to be dead for three days on 2026-04-19.
//! 2. Someone renames a migration file on disk without updating
//!    `scripts/migrations/seed-service-migrations.sql` — the seed script's
//!    hash would no longer match the on-disk file, and the next deploy
//!    would fail with `VersionMismatch`.
//! 3. Someone edits the `PREDICTIONS_MIGRATION_MIN/MAX` constants in
//!    `database.rs` so they no longer match this range. The runtime
//!    invariant check would then fire on every production boot because
//!    its query would match zero rows (the class of bug that caused
//!    CrashLoopBackOff on 2026-04-24 — range constants were 11_* instead
//!    of 110_*, off by exactly 10×).

use predictions_service::database::{PREDICTIONS_MIGRATION_MAX, PREDICTIONS_MIGRATION_MIN};

/// Every predictions migration must live in this range. Adjust alongside the
/// runtime constants in `src/database.rs` (and `seed-service-migrations.sql`)
/// if the numbering scheme ever needs to change.
const PREFIX_LO: i64 = 140_000_000_000;
const PREFIX_HI: i64 = 149_999_999_999;

#[test]
fn production_constants_match_test_prefix() {
    assert_eq!(
        PREDICTIONS_MIGRATION_MIN, PREFIX_LO,
        "database.rs PREDICTIONS_MIGRATION_MIN ({}) must equal PREFIX_LO ({}); \
         a mismatch would silently make the runtime invariant check match \
         zero DB rows and crash the pod on every boot.",
        PREDICTIONS_MIGRATION_MIN, PREFIX_LO
    );
    assert_eq!(
        PREDICTIONS_MIGRATION_MAX, PREFIX_HI,
        "database.rs PREDICTIONS_MIGRATION_MAX ({}) must equal PREFIX_HI ({}).",
        PREDICTIONS_MIGRATION_MAX, PREFIX_HI
    );
}

#[tokio::test]
async fn every_migration_version_has_the_service_prefix() {
    let migrator =
        sqlx::migrate::Migrator::new(std::path::Path::new("./migrations"))
            .await
            .expect("Failed to read migrations directory");

    assert!(
        migrator.iter().count() > 0,
        "Expected at least one migration in ./migrations"
    );

    for m in migrator.iter() {
        assert!(
            (PREFIX_LO..=PREFIX_HI).contains(&m.version),
            "Migration version {} ({}) is outside the predictions-service prefix range \
             {}..={}. Every predictions migration must start with `14` to avoid colliding \
             with finance (11*), sports (12*), rss (20250601*/13*), or any future service.",
            m.version,
            m.description,
            PREFIX_LO,
            PREFIX_HI,
        );
    }
}
