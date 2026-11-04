-- Isolated QA database. Both candidates and timestamps are test fixtures.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'scrollr_preview' THEN RAISE EXCEPTION 'Private QA database required'; END IF;
END $$;
UPDATE election_results SET
    snapshot = jsonb_set(snapshot,'{source_updated_at}',to_jsonb(now() - interval '5 minutes')),
    source_updated_at = now() - interval '5 minutes',
    failures = 2, next_poll_at = now() + interval '1 minute',
    directory_observed_at = now(),
    directory_snapshot = jsonb_build_object('observed_at', now(), 'candidates', (
       SELECT jsonb_agg(c || jsonb_build_object('votes',(c->>'votes')::int + 100))
       FROM jsonb_array_elements(snapshot->'candidates') c))
WHERE race_id = 87476 AND :'phase'='nationwide' AND snapshot->>'name' LIKE '%(QA replay)';
UPDATE election_results SET
    source_updated_at=now(), snapshot=jsonb_set(snapshot,'{source_updated_at}',to_jsonb(now())),
    failures=0, verified_until=now()+interval '1 minute'
WHERE race_id=87476 AND :'phase'='recovery' AND snapshot->>'name' LIKE '%(QA replay)';
COMMIT;
