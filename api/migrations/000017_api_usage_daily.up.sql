-- What every request already told us, kept as counts (REL-271).
--
-- Until now core-api discarded the app version and platform on every request,
-- so a bug report like REL-253 ("ticker never scrolls, 1.4.0 and 1.5.0,
-- Windows") could not be scoped: nobody could say whether anyone was still on
-- those builds. The fix is not an event log. It is this table.
--
-- ONE ROW PER (day, version, platform, endpoint, status class). A day of real
-- traffic is a few hundred rows, not a few hundred thousand. There is no
-- per-request table anywhere and none is ever written — the middleware
-- aggregates in memory and upserts these counters on a timer.
--
-- ⚠️ THE LINE. Nothing about what a user watches may ever be stored here, and
-- the schema is the enforcement: there is no column for a symbol, a team, a
-- feed URL, a widget, a query string, a user id or an IP address. `endpoint`
-- is the REGISTERED ROUTE PATTERN ("/users/:username"), never the request
-- path, so a username cannot arrive through it either. Adding a column to
-- this table is the moment to re-read that sentence.
CREATE TABLE api_usage_daily (
    day          date   NOT NULL,
    app_version  text   NOT NULL,
    platform     text   NOT NULL,
    endpoint     text   NOT NULL,
    status_class text   NOT NULL,
    requests     bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (day, app_version, platform, endpoint, status_class)
);

-- Every read on the admin console is "the last N days", so the range scan
-- wants the day leading. The primary key already leads with day; this index
-- exists for the pruner, which deletes by day alone.
CREATE INDEX api_usage_daily_day_idx ON api_usage_daily (day);
