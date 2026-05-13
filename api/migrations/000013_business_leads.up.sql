-- B2B lead-capture from the marketing /business page.
--
-- One row per submission. The handler validates + rate-limits the
-- request, inserts here as the source of truth, then best-effort
-- dispatches two Resend emails (internal notification + auto-reply).
-- Email failures DO NOT roll back the row — the lead stays captured
-- even if Resend is down, so sales can scan this table for missed
-- notifications. `notified_at` / `auto_replied_at` get set only when
-- their respective Resend call succeeds.
--
-- `ip_redacted` stores the abuse-investigation form (e.g. "192.168.1.x"
-- or "2001:db8::/64") rather than the raw IP, mirroring what we put in
-- log lines. We never need the host-bit precision for sales workflow,
-- and dropping it keeps this table cheaper from a PII standpoint.
--
-- `replied_at` is forward-looking: not set by this code path. A future
-- admin/CRM integration can backfill it when a human responds, so we
-- can compute lead-response-time metrics without touching schema.

CREATE TABLE IF NOT EXISTS business_leads (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    name            TEXT NOT NULL,
    email           TEXT NOT NULL,
    company         TEXT NOT NULL,
    use_case        TEXT NOT NULL,
    message         TEXT NOT NULL,
    ip_redacted     TEXT,
    user_agent      TEXT,
    notified_at     TIMESTAMPTZ,
    auto_replied_at TIMESTAMPTZ,
    replied_at      TIMESTAMPTZ
);

-- Hot query: "latest 50 leads" on an admin dashboard. DESC index keeps
-- the scan cheap once the table grows.
CREATE INDEX IF NOT EXISTS business_leads_created_at_idx
    ON business_leads (created_at DESC);

-- Email lookup: useful when a returning lead submits again and we want
-- to thread them, or when investigating abuse from a known address.
CREATE INDEX IF NOT EXISTS business_leads_email_idx
    ON business_leads (email);
