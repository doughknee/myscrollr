-- allow-destructive: reverting exactly what this migration added
DROP TABLE IF EXISTS support_policy;
DROP INDEX IF EXISTS support_drafts_hold_idx;
ALTER TABLE support_drafts DROP COLUMN IF EXISTS disposition;
ALTER TABLE support_drafts DROP COLUMN IF EXISTS disposition_reason;
ALTER TABLE support_drafts DROP COLUMN IF EXISTS hold_until;
ALTER TABLE support_drafts DROP COLUMN IF EXISTS intervened;
ALTER TABLE support_drafts DROP COLUMN IF EXISTS sentiment;
ALTER TABLE support_drafts DROP COLUMN IF EXISTS drafter_category;
