-- support_cases.purged_at: set by the account purge when it anonymises a case,
-- so the osTicket backfill and thread-message webhook never copy that ticket's
-- text back in. Staff dismissing a case by hand leaves it NULL.
ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS purged_at timestamptz;
