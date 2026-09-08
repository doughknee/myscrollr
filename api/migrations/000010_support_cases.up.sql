-- Support case database (REL-243).
--
-- osTicket holds the tickets; this is the copy the support bot can read
-- and search. One row per ticket, one row per thread event. Written on
-- every event the API already sees (ticket create, osTicket follow-up
-- webhook, draft send/edit/skip) and backfilled from the osTicket plugin's
-- list/detail endpoints by cmd/support-backfill, which also runs nightly
-- for tickets updated in the last 48 h.
--
-- Deliberately no PII beyond what support_drafts already stores: the user
-- email (the ticket's identity in osTicket) and the parsed app version + OS
-- from the desktop diagnostics blob. Not the diagnostics blob itself.
--
-- Search is Postgres full-text (tsvector generated columns + GIN). No
-- embeddings, no pgvector.

CREATE TABLE support_cases (
    ticket_number     text PRIMARY KEY,
    user_email        text,
    logto_sub         text,
    subject           text NOT NULL DEFAULT '',
    category          text,
    priority          text,
    status            text NOT NULL DEFAULT 'open',
    summary           text,
    app_version       text,
    os                text,
    tier_at_open      text,
    linear_issue_key  text,
    discord_thread_id text,
    opened_at         timestamp with time zone NOT NULL DEFAULT now(),
    updated_at        timestamp with time zone NOT NULL DEFAULT now(),
    closed_at         timestamp with time zone,
    search            tsvector GENERATED ALWAYS AS
        (to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(summary, ''))) STORED
);

CREATE INDEX support_cases_updated_idx ON support_cases (updated_at DESC);
CREATE INDEX support_cases_search_idx  ON support_cases USING GIN (search);

CREATE TABLE support_messages (
    id                 bigserial PRIMARY KEY,
    ticket_number      text NOT NULL REFERENCES support_cases (ticket_number),
    kind               text NOT NULL CHECK (kind IN ('user', 'ai_draft', 'sent', 'note')),
    body_html          text,
    body_text          text NOT NULL,
    ai_draft_id        bigint REFERENCES support_drafts (id),
    osticket_entry_id  bigint,
    created_at         timestamp with time zone NOT NULL DEFAULT now(),
    search             tsvector GENERATED ALWAYS AS (to_tsvector('english', body_text)) STORED
);

-- Idempotency: an osTicket thread entry lands once, and a draft yields at
-- most one message per kind (its ai_draft, its sent copy, its skip note).
CREATE UNIQUE INDEX support_messages_entry_idx ON support_messages (osticket_entry_id)
    WHERE osticket_entry_id IS NOT NULL;
CREATE UNIQUE INDEX support_messages_draft_idx ON support_messages (ai_draft_id, kind)
    WHERE ai_draft_id IS NOT NULL;
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_number, created_at);
CREATE INDEX support_messages_search_idx ON support_messages USING GIN (search);
