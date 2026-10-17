-- SCROLLR-320: one JSON line per recorded transition for one league and UTC
-- start day, joined to the game row for team names. Run against prod with the
-- psql-pod recipe (see memory prod-db-via-psql-pod), keep stdout as the file
-- `live-lag.mjs retro --transitions` reads:
--   psql -At -v league=NFL -v day=2026-10-18 -f scripts/measure/transitions.sql > results/nfl-2026-10-18-transitions.jsonl
-- Needs the games row (kept 7 days after kickoff); transitions themselves live 30.
SELECT row_to_json(x) FROM (
  SELECT g.home_team_name, g.away_team_name, g.start_time,
         t.at, t.home_score, t.away_score, t.period, t.status
  FROM game_transitions t
  JOIN games g ON g.league = t.league AND g.external_game_id = t.external_game_id
  WHERE t.league = :'league' AND (g.start_time AT TIME ZONE 'UTC')::date = :'day'::date
  ORDER BY t.at
) x;
