-- Persist the user's original message body alongside each support
-- draft. This is the body the user actually wrote (after stripping/
-- sanitising), separate from the AI's drafted reply
-- (draft_body_html). We surface it in the partner-notification email
-- so the partner can compare what the user wrote vs. what the AI
-- proposes — much faster triage than clicking through to osTicket.
--
-- Nullable for back-compat with rows created before this column
-- existed. New writes always populate it.
ALTER TABLE support_drafts
  ADD COLUMN IF NOT EXISTS user_message_html TEXT;
