-- Backfill support_drafts.sent_at from the reply that actually went out (REL-256).
--
-- markDraftSent was only ever called from the email approval-URL path, and
-- nobody uses that surface: every real reply goes out through a Discord button
-- or, since REL-249, by itself. So sent_at was null for all 23 replies the
-- pipeline had sent as of 2026-09-08 — including the eight the bot sent
-- unattended that day — and /stats read a busy day as an idle one.
--
-- The truth is in support_messages: doSendApprovedReply writes a kind='sent'
-- row with the real body every time osTicket accepts the reply, and a unique
-- index on (ai_draft_id, kind) means each draft has at most one. A draft with
-- no such row was never sent and is left exactly as it is.
--
-- The status is fixed in the same pass, on the same rule the code now follows:
-- 'sent' means an approved draft that went out, while 'edited' and 'asked' say
-- which decision sent it and are counted separately by the digest, so they
-- keep their status.
UPDATE support_drafts d
SET sent_at = m.created_at,
    status  = CASE WHEN d.status = 'approved' THEN 'sent' ELSE d.status END
FROM support_messages m
WHERE m.ai_draft_id = d.id
  AND m.kind = 'sent'
  AND d.sent_at IS NULL;
