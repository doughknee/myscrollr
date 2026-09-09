-- Staff access, as its own list (REL-260).
--
-- Admin is NOT a subscription tier. `super_user` is a product tier — an
-- invite-only early-access programme granting Ultimate caps free — and other
-- people already hold it. Deriving staff tooling from it would hand every
-- user's email and ticket history to those people. So: an explicit list,
-- seeded with exactly one row, extended from the dashboard itself.
--
-- `logto_sub` is pinned on the first successful match and used thereafter.
-- Matching on email forever would mean a later email change locks the owner
-- out, and a re-registered address lets a stranger in; matching on sub after
-- the bootstrap closes both.
--
-- Email is `text` with a functional unique index rather than `citext`: the
-- extension is not installed in this database and CREATE EXTENSION needs a
-- privilege the migration runner is not guaranteed to have. lower(email)
-- gives the same case-insensitive uniqueness with no privilege at all.

CREATE TABLE admin_users (
    id           bigserial PRIMARY KEY,
    email        text NOT NULL,
    logto_sub    text UNIQUE,
    added_by     text,
    added_at     timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone,
    note         text
);

CREATE UNIQUE INDEX admin_users_email_idx ON admin_users (lower(email));

INSERT INTO admin_users (email, added_by, note)
VALUES ('bch713@pm.me', 'migration 000016', 'Seeded by REL-260. Every other admin is added from the dashboard.');

-- Signups over time.
--
-- The Overview page wants "new accounts per day". `user_preferences` is the
-- account row (accounts/preferences.go creates it on first read) but has only
-- `updated_at`, which every preference write moves — it cannot answer "when
-- did this account appear".
--
-- Added nullable and deliberately NOT backfilled. A backfill would have to
-- invent a date for all existing rows, and a dashboard that invents numbers
-- is the exact thing REL-260 exists to avoid. NULL means "predates tracking",
-- and the tile says so.
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS created_at timestamp with time zone;

ALTER TABLE user_preferences ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX user_preferences_created_at_idx ON user_preferences (created_at)
    WHERE created_at IS NOT NULL;
