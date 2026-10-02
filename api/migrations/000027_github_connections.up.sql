-- Connect GitHub (SCROLLR-304): one row per account that approved the
-- Scrollr Desktop GitHub App. Core holds the user-to-server tokens; the
-- desktop never sees them. Tokens are AES-GCM ciphertext (platform.Encrypt)
-- keyed on ENCRYPTION_KEY. Per-user and read on demand, so no CDC.
CREATE TABLE IF NOT EXISTS github_connections (
    logto_sub          text PRIMARY KEY,
    github_user_id     bigint NOT NULL,
    github_login       text NOT NULL,
    access_token       text NOT NULL,
    refresh_token      text NOT NULL DEFAULT '',
    -- NULL when the app has token expiration turned off.
    expires_at         timestamptz,
    refresh_expires_at timestamptz,
    -- 'ok' or 'broken' (GitHub refused the token and the refresh).
    status             text NOT NULL DEFAULT 'ok',
    broken_reason      text,
    last_ok_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
