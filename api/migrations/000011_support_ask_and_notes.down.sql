-- Reverse of 000011. The three triage columns are left in place: REL-244
-- also declares them and dropping them here would break that migration's
-- forward state. Only the status CHECK goes back to its baseline values.

UPDATE support_drafts SET status = 'skipped' WHERE status = 'asked';

-- The UPDATE above has already moved every 'asked' row out of the way, so
-- the narrower constraint is satisfiable when it goes back on.
-- allow-destructive: reverting the widened constraint is the point of a down
ALTER TABLE support_drafts DROP CONSTRAINT IF EXISTS support_drafts_status_check;
ALTER TABLE support_drafts ADD CONSTRAINT support_drafts_status_check
    CHECK (status = ANY (ARRAY['pending', 'approved', 'edited', 'skipped', 'sent', 'failed']));
