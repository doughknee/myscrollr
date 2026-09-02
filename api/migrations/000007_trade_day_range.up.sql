-- Today's low/high, backing the ticker chip's day-range rail.
--
-- The rail answers "is this near the top of its day?" without the viewer
-- reading a number, which is the question the previous-close fragment it
-- replaced did not answer. Both values come from the same TwelveData /quote
-- call the daily job already makes, so they cost no extra API credits.
--
-- numeric(20,8), NOT the numeric(10,2) the older price columns use. Two
-- decimals is whole cents, which is fine for equities and useless for crypto:
-- 1INCH/USD trades near $0.09, so its real low and high both round to 0.09,
-- the range collapses to zero width and the rail renders empty. Measured on
-- the live symbol set, 19 of 41 sub-dollar symbols lost their range that way.
-- Eight decimals is the usual floor for crypto quoting.
--
-- NULL means "not fetched yet". The client renders an empty track rather
-- than collapsing the row, so chip height stays constant either way.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS day_high numeric(20,8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS day_low  numeric(20,8);

COMMENT ON COLUMN trades.day_high IS
  'Session high. Seeded from /quote, widened by live websocket ticks. NULL until first fetched.';
COMMENT ON COLUMN trades.day_low IS
  'Session low. Seeded from /quote, widened by live websocket ticks. NULL until first fetched.';
