-- Connect installs the app (SCROLLR-309): /github/connect now sends the user
-- through the GitHub App's install page, and the callback records which
-- installation the account's repos come from. NULL for rows connected before.
ALTER TABLE github_connections ADD COLUMN IF NOT EXISTS installation_id bigint;
