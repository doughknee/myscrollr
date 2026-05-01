-- Track whether the AI's draft suggests closing the ticket on send.
-- The triage prompt emits should_close=true when it detects a clear
-- resolution signal in the user's message ("thanks, that worked",
-- "resolved", "close the ticket"). The approval handlers persist this
-- flag through to send time; doSendApprovedReply then passes
-- close_ticket=true to the scrollr-reply-api plugin's reply endpoint
-- so osTicket flips the ticket status to Closed after posting the
-- reply.
--
-- Defaults to FALSE for back-compat with pre-existing rows.
ALTER TABLE support_drafts
  ADD COLUMN IF NOT EXISTS should_close BOOLEAN NOT NULL DEFAULT FALSE;
