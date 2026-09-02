-- Today's low/high, backing the ticker chip's day-range rail.
--
-- The rail answers "is this near the top of its day?" without the viewer
-- reading a number, which is the question the previous-close fragment it
-- replaced did not answer. Both values come from the same TwelveData /quote
-- call the daily job already makes, so they cost no extra API credits.
--
-- NULL means "not fetched yet". The client renders an empty track rather
-- than collapsing the row, so chip height stays constant either way.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS day_high numeric(10,2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS day_low  numeric(10,2);

COMMENT ON COLUMN trades.day_high IS
  'Session high. Seeded from /quote, widened by live websocket ticks. NULL until first fetched.';
COMMENT ON COLUMN trades.day_low IS
  'Session low. Seeded from /quote, widened by live websocket ticks. NULL until first fetched.';
