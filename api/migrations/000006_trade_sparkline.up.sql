-- Intraday price series backing the ticker chip sparkline.
--
-- The chip previously built its series client-side from prices the app
-- happened to observe while running, so it drew nothing until a second
-- distinct price arrived -- an empty 44-56px gap on every launch that read
-- as a broken graph. There is no other price history in the system: trades
-- holds one row per symbol.
--
-- Stored as jsonb rather than its own table because it is a fixed-size,
-- write-whole/read-whole blob owned entirely by the row it hangs off. A
-- separate table would buy ordering and per-point queries that nothing wants.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS sparkline jsonb;

COMMENT ON COLUMN trades.sparkline IS
  'Closing prices for the last session, oldest first, written daily by the finance ingester. NULL until first fetched.';
