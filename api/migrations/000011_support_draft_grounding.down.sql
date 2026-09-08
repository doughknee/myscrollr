ALTER TABLE support_drafts
    DROP COLUMN ai_needs_info,
    DROP COLUMN ai_grounded_in,
    DROP COLUMN ai_unknowns,
    DROP COLUMN ai_ask_user_for,
    DROP COLUMN ai_internal_note;
