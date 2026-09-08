-- The two grounding fields REL-244's drafter reports that 000011 did not
-- already declare.
--
-- 000011 (REL-245) added internal_note, ask_user_for and grounded_in for the
-- Discord thread header, which is where all three are read. These two are the
-- rest of what the drafting call returns: whether we can troubleshoot the
-- ticket at all with what we have, and what the reply had to leave open.
--
-- Nullable, and text rather than text[] to match the three beside them: the
-- Go side joins the model's list before writing, and every reader renders
-- them as a line.

ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS needs_info boolean;
ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS unknowns   text;
