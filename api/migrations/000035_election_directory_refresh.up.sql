-- Directory observations have no publisher timestamp. Keep the detail and
-- directory histories independent so a provider outage cannot overwrite a call.
ALTER TABLE election_results
    ADD COLUMN directory_snapshot jsonb,
    ADD COLUMN directory_observed_at timestamptz,
    ADD COLUMN directory_checked_at timestamptz,
    ADD CHECK ((directory_snapshot IS NULL) = (directory_observed_at IS NULL));

CREATE TABLE election_directory_refreshes (
    election_date date PRIMARY KEY,
    next_check_at timestamptz NOT NULL,
    generation bigint NOT NULL DEFAULT 1,
    failures integer NOT NULL DEFAULT 0
);
