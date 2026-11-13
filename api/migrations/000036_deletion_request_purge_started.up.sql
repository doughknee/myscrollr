-- user_deletion_requests.purge_started_at: set, in its own statement, just
-- before the purge's first irreversible step (Stripe cancel, Logto delete).
-- Once set the deletion can no longer be canceled or re-scheduled, and the row
-- stays pending until the purge commits, so a failed pass is retried.
ALTER TABLE user_deletion_requests ADD COLUMN IF NOT EXISTS purge_started_at timestamptz;
