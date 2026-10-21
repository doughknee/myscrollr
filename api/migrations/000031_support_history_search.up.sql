BEGIN;
-- Package-isolated integration suites may install this shared extension concurrently.
SELECT pg_advisory_xact_lock(362031);
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX support_cases_history_search_idx ON support_cases USING GIN (
    lower(coalesce(ticket_number, '') || ' ' || coalesce(subject, '') || ' ' ||
          coalesce(user_name, '') || ' ' || coalesce(user_email, '') || ' ' ||
          coalesce(summary, '') || ' ' || coalesce(category, '')) public.gin_trgm_ops
);
CREATE INDEX support_cases_history_order_idx ON support_cases (updated_at DESC, ticket_number DESC);
COMMIT;
