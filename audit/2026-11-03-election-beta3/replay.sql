-- Manual, offline UI replay. Run only in the private beta's disposable Postgres.
-- PowerShell, from the checkout:
-- Get-Content -Raw audit/2026-11-03-election-beta3/replay.sql | docker exec -i scrollr-election-beta3-pg psql -X -U postgres -d scrollr_preview -v phase=first
-- Supported phases: waiting, first, correction, delayed, called, disputed, reset.
-- Following and unfollowing must still go through the normal UI. Wait for the
-- dashboard's fallback refresh or refresh manually after each phase. This replay
-- exercises persisted reads, not upstream availability or push delivery.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
    IF current_database() <> 'scrollr_preview' THEN
        RAISE EXCEPTION 'Replay requires the disposable scrollr_preview database';
    END IF;
END;
$guard$;
CREATE TEMP TABLE replay_step (
    phase text NOT NULL CHECK (phase IN ('waiting','first','correction','delayed','called','disputed','reset'))
) ON COMMIT DROP;
INSERT INTO replay_step VALUES (:'phase');

-- Fence in-flight requests and prevent live polling from replacing fixture data.
-- The original source date stays visible throughout the replay, including outages.
WITH moment AS (
    SELECT phase, CASE phase
        WHEN 'waiting' THEN NULL
        WHEN 'first' THEN timestamptz '2026-11-04 02:06:00Z'
        WHEN 'called' THEN timestamptz '2026-11-04 02:20:00Z'
        WHEN 'disputed' THEN timestamptz '2026-11-04 02:21:00Z'
        ELSE timestamptz '2026-11-04 02:08:00Z' END AS source_time
    FROM replay_step WHERE phase <> 'reset'
)
INSERT INTO election_results(race_id,snapshot,source_updated_at,next_poll_at,verified_until,failures)
SELECT 87476, CASE WHEN source_time IS NOT NULL THEN jsonb_build_object(
    'id',87476,'name','Tennessee Governor (QA replay)','state','TN','election_date','2026-11-03',
    'source_updated_at',source_time,'percent_reporting',CASE WHEN phase='first' THEN 40 ELSE 50 END,
    'disputed',phase='disputed','delayed',false,
    'candidates',jsonb_build_array(
        jsonb_build_object('id',1,'name','Preview A','party','Test','votes',CASE WHEN phase='first' THEN 120 ELSE 110 END,
            'percent',CASE WHEN phase='first' THEN 60 ELSE 44 END,'winner',false),
        jsonb_build_object('id',2,'name','Preview B','party','Test','votes',CASE WHEN phase='first' THEN 80 ELSE 140 END,
            'percent',CASE WHEN phase='first' THEN 40 ELSE 56 END,'winner',phase='called')
    )) END, source_time, 'infinity', 'infinity', CASE WHEN phase='delayed' THEN 1 ELSE 0 END
FROM moment
ON CONFLICT (race_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,source_updated_at=EXCLUDED.source_updated_at,
    failures=EXCLUDED.failures,next_poll_at=EXCLUDED.next_poll_at,verified_until=EXCLUDED.verified_until,
    lease_generation=election_results.lease_generation+1;

-- Remove the fixture and let the next ordinary poll repopulate the snapshot.
-- Keep an advancing generation so a slow pre-reset worker cannot overwrite it.
UPDATE election_results SET snapshot=NULL,source_updated_at=NULL,failures=0,
    next_poll_at=now(),verified_until=now()+interval '90 seconds',lease_generation=lease_generation+1
WHERE race_id=87476 AND (SELECT phase FROM replay_step)='reset';
COMMIT;
