-- Irreversible by nature: this migration only DELETED contentless legacy rows
-- (empty 'sports' / 'news' widgets that held no leagues or feeds). They carried
-- no user data, so there is nothing to restore. Forward-only is the norm here
-- anyway (see README "Rollbacks via rolling forward"). No-op.
SELECT 1;
