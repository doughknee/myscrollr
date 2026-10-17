-- SCROLLR-320: one row each time a game's score, period or status changes, so
-- live-lag is measurable after the fact. Written by the sports ingester,
-- pruned there after 30 days.
CREATE TABLE IF NOT EXISTS game_transitions (
    id bigserial PRIMARY KEY,
    league text NOT NULL,
    external_game_id text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    home_score int,
    away_score int,
    period text,
    status text
);
CREATE INDEX IF NOT EXISTS game_transitions_game_at_idx ON game_transitions (league, external_game_id, at);
