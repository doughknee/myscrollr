-- Predictions channel initial schema.
-- See channels/predictions/CONTRACT.md for the canonical column contract.

-- `markets` — the CDC/display table (one row per tracked Kalshi market).
CREATE TABLE IF NOT EXISTS markets (
    id             TEXT PRIMARY KEY,                       -- "kalshi:" || ticker
    source         TEXT NOT NULL DEFAULT 'kalshi',
    ticker         TEXT NOT NULL,
    event_ticker   TEXT,
    series_ticker  TEXT,
    category       TEXT,
    title          TEXT,
    subtitle       TEXT,
    yes_price      INT,                                    -- cents 0-100 == implied %
    yes_bid        INT,
    yes_ask        INT,
    prev_yes_price INT,
    volume         BIGINT,
    volume_24h     BIGINT,
    open_interest  BIGINT,
    status         TEXT,
    result         TEXT,
    is_primary     BOOLEAN NOT NULL DEFAULT TRUE,
    open_time      TIMESTAMPTZ,
    close_time     TIMESTAMPTZ,
    link           TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Full row image in the WAL so the CDC pipeline can emit complete before/after
-- snapshots (needed for the desktop "movers" delta to be computed downstream).
ALTER TABLE markets REPLICA IDENTITY FULL;

CREATE INDEX IF NOT EXISTS markets_category_idx ON markets (category);
CREATE INDEX IF NOT EXISTS markets_event_ticker_idx ON markets (event_ticker);
CREATE INDEX IF NOT EXISTS markets_updated_at_idx ON markets (updated_at);

-- `tracked_markets` — catalog (mirrors finance `tracked_symbols`).
CREATE TABLE IF NOT EXISTS tracked_markets (
    id                   SERIAL PRIMARY KEY,
    ticker               TEXT UNIQUE NOT NULL,
    title                TEXT,
    category             TEXT,
    series_ticker        TEXT,
    is_enabled           BOOLEAN DEFAULT TRUE,
    last_polled_at       TIMESTAMPTZ,
    last_poll_success_at TIMESTAMPTZ,
    last_poll_error      TEXT,
    created_at           TIMESTAMPTZ DEFAULT now()
);
