-- Explicitly enrolled accounts only. Removing this row is opt-out and
-- cascades every measured daily fact for the account.
CREATE TABLE product_analytics_enrollments (
    logto_sub       text PRIMARY KEY,
    enrolled_at     timestamp with time zone NOT NULL DEFAULT now(),
    first_active_day date,
    retained_d1     boolean,
    retained_d7     boolean,
    retained_d30    boolean
);

-- One idempotent fact per participating account and UTC receipt day. The
-- closed boolean vocabulary cannot hold symbols, teams, feeds, URLs or titles.
CREATE TABLE product_activity_daily (
    logto_sub  text NOT NULL REFERENCES product_analytics_enrollments(logto_sub) ON DELETE CASCADE,
    day        date NOT NULL,
    sports     boolean NOT NULL DEFAULT false,
    markets    boolean NOT NULL DEFAULT false,
    news       boolean NOT NULL DEFAULT false,
    fantasy    boolean NOT NULL DEFAULT false,
    predictions boolean NOT NULL DEFAULT false,
    utilities  boolean NOT NULL DEFAULT false,
    PRIMARY KEY (logto_sub, day)
);

CREATE INDEX product_activity_daily_day_idx ON product_activity_daily (day);
CREATE INDEX product_analytics_first_active_day_idx
    ON product_analytics_enrollments (first_active_day)
    WHERE first_active_day IS NOT NULL;
