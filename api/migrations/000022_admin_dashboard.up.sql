-- Admin dashboard redesign (SCROLLR-210): desktop presence, widget display
-- facts, and the dashboard settings that govern how they are reported.
--
-- Everything here is additive. Presence rows reference the existing
-- product_analytics_enrollments row, so opting out of usage analytics (or a
-- GDPR purge, which deletes that row) cascades every presence fact away with
-- it — the same contract the daily activity facts already have.

-- ── Staff measurements are collected, flagged, and hidden by a setting ─────
--
-- Until now a staff account was never enrolled, so its usage facts were never
-- written and no setting could bring them back. From here on staff are
-- enrolled under the same consent as everyone else and every fact they
-- produce carries internal = true; the dashboard's "Exclude staff" setting
-- (default on) decides whether readers see them.
ALTER TABLE product_analytics_enrollments
    ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;

-- ── Dashboard settings ──────────────────────────────────────────────────────
--
-- Two-column key/value, the same shape as support_policy, so the next toggle
-- needs no migration. Values are JSON so a boolean stays a boolean.
CREATE TABLE IF NOT EXISTS admin_settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_by text
);

-- ── Presence: cohort anchor ─────────────────────────────────────────────────
--
-- One row per account that has ever reported presence. first_seen_day is the
-- cohort key for the presence-based retention view; it is never recomputed
-- from the hourly rows, which are pruned, so an old participant cannot be
-- relabelled as new.
CREATE TABLE IF NOT EXISTS presence_accounts (
    logto_sub      text PRIMARY KEY REFERENCES product_analytics_enrollments(logto_sub) ON DELETE CASCADE,
    first_seen_day date NOT NULL,
    internal       boolean NOT NULL DEFAULT false
);

-- ── Presence: per-session hourly credit ─────────────────────────────────────
--
-- A session is one running app process (one computer). Seconds are credited
-- from the interval between two consecutive check-ins of the same session,
-- split at UTC hour boundaries; an interval longer than the reporting window
-- credits nothing. os and app_version come from the request User-Agent.
CREATE TABLE IF NOT EXISTS presence_session_hourly (
    logto_sub          text NOT NULL REFERENCES product_analytics_enrollments(logto_sub) ON DELETE CASCADE,
    session_id         text NOT NULL,
    hour               timestamp with time zone NOT NULL,
    os                 text NOT NULL DEFAULT 'unknown',
    app_version        text NOT NULL DEFAULT 'unknown',
    internal           boolean NOT NULL DEFAULT false,
    running_seconds    integer NOT NULL DEFAULT 0,
    ticker_seconds     integer NOT NULL DEFAULT 0,
    screen_seconds     integer NOT NULL DEFAULT 0,
    max_shown_screens  smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (logto_sub, session_id, hour)
);
CREATE INDEX IF NOT EXISTS presence_session_hourly_hour_idx ON presence_session_hourly (hour);

-- ── Presence: per-account hourly credit (overlaps counted once) ─────────────
--
-- Two computers running at the same time are one account for one hour, not
-- two. presence_watermarks holds the last credited instant per account and
-- key so a later session only adds the part of its interval nobody has
-- credited yet.
CREATE TABLE IF NOT EXISTS presence_account_hourly (
    logto_sub       text NOT NULL REFERENCES product_analytics_enrollments(logto_sub) ON DELETE CASCADE,
    hour            timestamp with time zone NOT NULL,
    internal        boolean NOT NULL DEFAULT false,
    running_seconds integer NOT NULL DEFAULT 0,
    ticker_seconds  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (logto_sub, hour)
);
CREATE INDEX IF NOT EXISTS presence_account_hourly_hour_idx ON presence_account_hourly (hour);

CREATE TABLE IF NOT EXISTS presence_watermarks (
    logto_sub      text NOT NULL REFERENCES product_analytics_enrollments(logto_sub) ON DELETE CASCADE,
    key            text NOT NULL,
    credited_until timestamp with time zone NOT NULL,
    PRIMARY KEY (logto_sub, key)
);

-- ── Presence: displayed widget types ────────────────────────────────────────
--
-- widget_type is a catalog id ("sports_nfl", "news_bbc", "clock"). The
-- vocabulary is validated against the server catalog on receipt; nothing that
-- is not a catalog id is ever stored, so no symbol, team, feed or title can
-- arrive through this table.
CREATE TABLE IF NOT EXISTS presence_widget_hourly (
    logto_sub      text NOT NULL REFERENCES product_analytics_enrollments(logto_sub) ON DELETE CASCADE,
    session_id     text NOT NULL,
    screen         text NOT NULL,
    hour           timestamp with time zone NOT NULL,
    widget_type    text NOT NULL,
    internal       boolean NOT NULL DEFAULT false,
    screen_seconds integer NOT NULL DEFAULT 0,
    PRIMARY KEY (logto_sub, session_id, screen, hour, widget_type)
);
CREATE INDEX IF NOT EXISTS presence_widget_hourly_hour_idx ON presence_widget_hourly (hour);

CREATE TABLE IF NOT EXISTS presence_widget_account_hourly (
    logto_sub    text NOT NULL REFERENCES product_analytics_enrollments(logto_sub) ON DELETE CASCADE,
    hour         timestamp with time zone NOT NULL,
    widget_type  text NOT NULL,
    internal     boolean NOT NULL DEFAULT false,
    user_seconds integer NOT NULL DEFAULT 0,
    PRIMARY KEY (logto_sub, hour, widget_type)
);
CREATE INDEX IF NOT EXISTS presence_widget_account_hourly_hour_idx ON presence_widget_account_hourly (hour);

-- Explicit additions and removals of catalog widgets, written by the widget
-- create/delete handlers for enrolled accounts. One row per real change; a
-- reload writes nothing.
CREATE TABLE IF NOT EXISTS presence_widget_changes (
    id          bigserial PRIMARY KEY,
    logto_sub   text NOT NULL REFERENCES product_analytics_enrollments(logto_sub) ON DELETE CASCADE,
    widget_type text NOT NULL,
    change      text NOT NULL CHECK (change IN ('added', 'removed')),
    internal    boolean NOT NULL DEFAULT false,
    at          timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS presence_widget_changes_at_idx ON presence_widget_changes (at);

-- ── Presence: concurrency samples ───────────────────────────────────────────
--
-- One row per minute, sampled from the live index by every API replica and
-- merged with GREATEST so the replicas agree. Peak concurrency is read from
-- here and always labelled with this 1-minute resolution.
CREATE TABLE IF NOT EXISTS presence_concurrency_minute (
    minute       timestamp with time zone PRIMARY KEY,
    users        integer NOT NULL DEFAULT 0,
    ticker_users integer NOT NULL DEFAULT 0,
    screens      integer NOT NULL DEFAULT 0
);
