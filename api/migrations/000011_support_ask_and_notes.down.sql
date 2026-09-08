-- Reverse of 000011. The three triage columns are left in place: REL-244
-- also declares them and dropping them here would break that migration's
-- forward state. Only the status CHECK goes back to its baseline values.

UPDATE support_drafts SET status = 'skipped' WHERE status = 'asked';

ALTER TABLE support_drafts DROP CONSTRAINT IF EXISTS support_drafts_status_check;
ALTER TABLE support_drafts ADD CONSTRAINT support_drafts_status_check
    CHECK (status = ANY (ARRAY['pending', 'approved', 'edited', 'skipped', 'sent', 'failed']));
