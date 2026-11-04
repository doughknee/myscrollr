-- One shared snapshot and polling lease per curated race. No voter/user data here.
CREATE TABLE election_results (
    race_id integer PRIMARY KEY,
    snapshot jsonb,
    source_updated_at timestamptz,
    next_poll_at timestamptz NOT NULL,
    lease_generation bigint NOT NULL DEFAULT 1,
    failures integer NOT NULL DEFAULT 0,
    verified_until timestamptz NOT NULL,
    CHECK ((snapshot IS NULL) = (source_updated_at IS NULL))
);

-- The poller checks for a follower before making a network request. Scan
-- only enabled election widgets, including when no account follows a race.
CREATE INDEX user_widgets_election_follows ON user_widgets
    USING gin ((config->'race_ids') jsonb_path_ops)
    WHERE enabled AND widget_type='elections';
