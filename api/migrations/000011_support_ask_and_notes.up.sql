-- Discord support workspace (REL-245).
--
-- Two things the Discord queue needs from support_drafts:
--
--   1. An 'asked' status. The Ask button sends a single clarifying line to
--      the user instead of the drafted reply; the draft is decided but it
--      is neither sent-as-drafted nor skipped, and the status CHECK from
--      the baseline rejected anything outside its five values.
--
--   2. The three nullable triage columns REL-244 adds (internal_note,
--      ask_user_for, grounded_in). Declared IF NOT EXISTS so whichever of
--      the two migrations lands second is a no-op rather than a failure —
--      the columns are read here (rendered in the thread header, and
--      ask_user_for gates auto-send) and written there.

ALTER TABLE support_drafts DROP CONSTRAINT IF EXISTS support_drafts_status_check;
ALTER TABLE support_drafts ADD CONSTRAINT support_drafts_status_check
    CHECK (status = ANY (ARRAY['pending', 'approved', 'edited', 'skipped', 'asked', 'sent', 'failed']));

ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS internal_note text;
ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS ask_user_for  text;
ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS grounded_in   text;
