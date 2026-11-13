-- allow-destructive: development rollback only, the column was added by 000034
ALTER TABLE support_cases DROP COLUMN IF EXISTS purged_at;
