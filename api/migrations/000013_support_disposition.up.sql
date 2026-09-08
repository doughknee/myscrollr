-- Autonomous support: the server's decision, written down (REL-249).
--
-- REL-245 decided auto-send from environment variables and a category
-- allow-list, and left no record of why a draft did or did not go out.
-- Approval is now the exception rather than the rule, so the decision has
-- to be auditable: disposition says what the server chose, and
-- disposition_reason says which rule chose it.
--
--   disposition        auto_send | auto_ask | escalate | auto_close
--   disposition_reason the rule that fired, in words, for the thread and the digest
--   hold_until         when the sweeper may send it; NULL means no timer is running
--   intervened         Hold, Edit or Skip happened — the numerator of the
--                      per-category intervention rate that demotes a category
--   sentiment          the classifier's read of the user's tone
--   drafter_category   what the drafting call thought this was; a disagreement
--                      with ai_category escalates
--
-- hold_until is a column rather than an in-process timer because a pod
-- restart used to mean "a human still has to click", which was the safe
-- direction when clicking was required. Now doing nothing is what sends,
-- so a dropped timer is a reply that never happens.

ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS disposition        text;
ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS disposition_reason text;
ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS hold_until         timestamp with time zone;
ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS intervened         boolean NOT NULL DEFAULT false;
ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS sentiment          text;
ALTER TABLE support_drafts ADD COLUMN IF NOT EXISTS drafter_category   text;

-- The sweeper's query: pending drafts whose hold has expired. Partial, so
-- it stays the size of the queue rather than the size of the table.
CREATE INDEX IF NOT EXISTS support_drafts_hold_idx
    ON support_drafts (hold_until)
    WHERE status = 'pending' AND hold_until IS NOT NULL;

-- Operator state that has to outlive a pod: the /pause kill switch, and
-- the per-category watermark /resume writes to forgive a demotion. A
-- two-column key/value table rather than a column per switch, because the
-- next switch should not need a migration.
CREATE TABLE IF NOT EXISTS support_policy (
    key        text PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);
