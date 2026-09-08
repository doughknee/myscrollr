-- allow-destructive: reverting exactly what this migration added
ALTER TABLE support_messages DROP COLUMN IF EXISTS superseded;
