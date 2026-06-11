-- Per-host daily request consumption for the api-sports.io rate budget.
--
-- The in-memory RateLimiter (src/types.rs) budgets 7,500 requests/day per
-- sport host, but a pod restart (deploy, OOM, node drain) used to reset
-- every bucket back to the full quota while the upstream counter only
-- resets at UTC midnight — letting a restarted pod overshoot the daily
-- quota. The service flushes its consumed counts here periodically and
-- seeds the limiter from today's row on startup.
--
-- One row per (host, UTC day). `consumed` is monotonically increasing
-- within a day; rows older than a week are pruned by the daily reset task.

CREATE TABLE IF NOT EXISTS sports_rate_budget (
    host TEXT NOT NULL,
    day DATE NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (host, day)
);
