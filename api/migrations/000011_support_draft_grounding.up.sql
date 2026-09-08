-- Grounding fields on the AI draft (REL-244).
--
-- Triage split into two calls: a Haiku classifier and a Sonnet drafter.
-- The drafter now says what its reply rests on, what it could not answer,
-- and what it needs from the user. Those come back as first-class fields
-- instead of being buried in the reply prose, so the partner can see at a
-- glance whether a draft is grounded before sending it.
--
-- All nullable: every row written before this migration has none of them,
-- and a triage call that fails soft still writes the columns it did get.
-- internal_note is partner-only and never reaches the user.

ALTER TABLE support_drafts
    ADD COLUMN ai_needs_info    boolean,
    ADD COLUMN ai_grounded_in   text[],
    ADD COLUMN ai_unknowns      text[],
    ADD COLUMN ai_ask_user_for  text[],
    ADD COLUMN ai_internal_note text;
