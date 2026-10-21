DROP INDEX IF EXISTS support_cases_history_search_idx;
DROP INDEX IF EXISTS support_cases_history_order_idx;
-- pg_trgm can be shared with other schemas or features; leave it installed.
