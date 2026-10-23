CREATE TABLE rss_security_events (
    hour timestamptz NOT NULL,
    actor text NOT NULL,
    reason text NOT NULL,
    attempts integer NOT NULL DEFAULT 1,
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (hour, actor, reason)
);
