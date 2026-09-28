-- Drop the fantasy (Yahoo) and predictions (Kalshi) tables (SCROLLR-242,
-- removal 4/4 of SCROLLR-237/239).
--
-- Prerequisites met: #426 removed the last code readers (yahoo_* GDPR path
-- and the scripts/dev/live.sh markets update), the five yahoo_*/markets
-- tables were removed from the Sequin sink in the console, and the
-- Yahoo/Kalshi upstream keys are gone. 000023_purge_yahoo already deleted
-- the row data; this drops the now-empty tables themselves. Children before
-- parents so the FKs never block a statement.
--
-- allow-destructive: fantasy and predictions removed (SCROLLR-237)
DROP TABLE IF EXISTS yahoo_user_leagues CASCADE;
-- allow-destructive: fantasy and predictions removed (SCROLLR-237)
DROP TABLE IF EXISTS yahoo_users CASCADE;
-- allow-destructive: fantasy and predictions removed (SCROLLR-237)
DROP TABLE IF EXISTS yahoo_standings CASCADE;
-- allow-destructive: fantasy and predictions removed (SCROLLR-237)
DROP TABLE IF EXISTS yahoo_rosters CASCADE;
-- allow-destructive: fantasy and predictions removed (SCROLLR-237)
DROP TABLE IF EXISTS yahoo_matchups CASCADE;
-- allow-destructive: fantasy and predictions removed (SCROLLR-237)
DROP TABLE IF EXISTS yahoo_leagues CASCADE;
-- allow-destructive: fantasy and predictions removed (SCROLLR-237)
DROP TABLE IF EXISTS tracked_markets CASCADE;
-- allow-destructive: fantasy and predictions removed (SCROLLR-237)
DROP TABLE IF EXISTS markets CASCADE;
