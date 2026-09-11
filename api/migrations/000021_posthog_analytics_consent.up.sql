CREATE TABLE posthog_analytics_consents (
    logto_sub TEXT PRIMARY KEY,
    decision TEXT NOT NULL CHECK (decision IN ('enabled', 'declined')),
    deletion_status TEXT NOT NULL DEFAULT 'not_requested'
        CHECK (deletion_status IN ('not_requested', 'pending', 'requested')),
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_posthog_analytics_pending_deletions
    ON posthog_analytics_consents (updated_at)
    WHERE deletion_status = 'pending';

CREATE TABLE posthog_analytics_events (
    insert_id TEXT PRIMARY KEY,
    logto_sub TEXT NOT NULL REFERENCES posthog_analytics_consents(logto_sub) ON DELETE CASCADE,
    event TEXT NOT NULL,
    feature TEXT,
    app_version TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    delivered BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_posthog_analytics_events_user
    ON posthog_analytics_events (logto_sub, occurred_at);
