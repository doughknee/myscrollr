-- allow-destructive: development rollback only, the column was added by 000035
ALTER TABLE user_deletion_requests DROP COLUMN IF EXISTS purge_email;
