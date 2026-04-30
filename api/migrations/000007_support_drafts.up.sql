CREATE TABLE IF NOT EXISTS support_drafts (
  id BIGSERIAL PRIMARY KEY,
  ticket_number TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_name TEXT,
  original_subject TEXT NOT NULL,
  draft_body_html TEXT NOT NULL,
  ai_summary TEXT,
  ai_category TEXT,
  ai_priority TEXT,
  ai_channel TEXT,
  ai_duplicate_of TEXT,
  ai_confidence TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','edited','skipped','sent','failed')),
  edited_body_html TEXT,
  decided_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_drafts_status ON support_drafts(status);
CREATE INDEX IF NOT EXISTS idx_support_drafts_ticket ON support_drafts(ticket_number);

CREATE TABLE IF NOT EXISTS osticket_message_ids (
  id BIGSERIAL PRIMARY KEY,
  ticket_number TEXT NOT NULL,
  message_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('outbound_osticket','outbound_ai','inbound_user')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id)
);
CREATE INDEX IF NOT EXISTS idx_osticket_msgids_ticket ON osticket_message_ids(ticket_number);
