-- v1.1.5: record WHEN a market resolved, not just that it did.
--
-- "Resolved today" was previously approximated by `updated_at`, which any
-- write refreshes — a sweep volume touch (or the reconcile demotion) made
-- markets that settled weeks ago look freshly resolved. `settled_at` is
-- stamped exactly once, by the write that transitions the row INTO a
-- resolved state (status settled/determined/finalized, or result yes/no),
-- whether that write came from the lifecycle WS, the sweep, or the
-- dropped-market recheck.
--
-- Left NULL for rows that resolved before this migration — they are
-- history, not "today", so the API's resolved-recently branch correctly
-- never serves them.
ALTER TABLE markets
    ADD COLUMN settled_at TIMESTAMPTZ;
