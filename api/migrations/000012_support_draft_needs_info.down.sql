-- allow-destructive: reverting the columns this migration added
ALTER TABLE support_drafts DROP COLUMN IF EXISTS needs_info;
ALTER TABLE support_drafts DROP COLUMN IF EXISTS unknowns;
