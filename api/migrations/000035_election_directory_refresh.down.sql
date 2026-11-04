DROP TABLE election_directory_refreshes;
ALTER TABLE election_results
    DROP COLUMN directory_checked_at,
    DROP COLUMN directory_observed_at,
    DROP COLUMN directory_snapshot;
