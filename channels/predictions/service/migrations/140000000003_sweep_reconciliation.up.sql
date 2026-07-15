-- v1.1.5 Kalshi Cleans Up: track sweep membership so dead markets leave
-- the feed.
--
-- The catalog sweep upserts the current top-240 open markets but never
-- demoted rows that dropped out of the selection, so `markets` accumulated
-- every market that was EVER curated — 3,905 rows served against 240
-- maintained in prod, with settled World Cup/UFC giants permanently
-- outranking live markets on all-time volume.
--
--   in_sweep: TRUE  = part of the current sweep selection (live, curated).
--             FALSE = dropped out; kept for history/"Resolved today" but
--                     excluded from the live feed and skipped by the WS
--                     ticker path so it stops generating CDC churn.
--
-- Default TRUE so existing rows stay visible until the first post-deploy
-- sweep reconciles them (~15 minutes worst case).
ALTER TABLE markets
    ADD COLUMN in_sweep BOOLEAN NOT NULL DEFAULT TRUE;
