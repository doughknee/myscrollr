DROP INDEX IF EXISTS user_preferences_created_at_idx;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS created_at;
DROP TABLE IF EXISTS admin_users;
