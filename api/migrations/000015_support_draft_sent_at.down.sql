-- Reverse the backfill: forget when the reply went out, and put a promoted
-- draft back on the status it had. Exact today — no row was 'sent' before this
-- migration ran, so every 'sent' row is one it promoted.
UPDATE support_drafts d
SET sent_at = NULL,
    status  = CASE WHEN d.status = 'sent' THEN 'approved' ELSE d.status END
FROM support_messages m
WHERE m.ai_draft_id = d.id
  AND m.kind = 'sent';
