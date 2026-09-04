-- Widen the price columns so sub-dollar assets survive storage.
--
-- Every price column has been numeric(10,2) since the baseline: two decimals,
-- i.e. whole cents. That is right for equities and destroys crypto. Measured
-- on the live symbol set: 41 symbols trade under $1 and 19 under 10c, so
-- 1INCH/USD at ~$0.0889 is stored as 0.09 and ADA at ~$0.1975 as 0.20.
--
-- It is not only cosmetic. A price rounded UP past its own day high makes the
-- chip's range marker clamp to the end of the track, so the rail says "at the
-- high of the day" for an asset sitting mid-range. The sparkline was immune
-- only because it is jsonb and never went through numeric(10,2).
--
-- Each statement carries its own opt-out below: every one is a WIDENING, so
-- no stored value changes. The guard flags ALTER COLUMN ... TYPE
-- unconditionally because it cannot tell widening from narrowing.

-- allow-destructive: widening numeric(10,2) -> numeric(20,8), non-lossy
ALTER TABLE trades ALTER COLUMN price TYPE numeric(20,8);

-- allow-destructive: widening numeric(10,2) -> numeric(20,8), non-lossy
ALTER TABLE trades ALTER COLUMN previous_close TYPE numeric(20,8);

-- allow-destructive: widening numeric(10,2) -> numeric(20,8), non-lossy
ALTER TABLE trades ALTER COLUMN price_change TYPE numeric(20,8);

-- percentage_change is widened for a different reason: numeric(5,2) caps at
-- 999.99, so a coin that more than 10x'd in a day would overflow the column
-- outright. Largest move currently stored is 18.53%, so this is pre-emptive.
-- allow-destructive: widening numeric(5,2) -> numeric(10,4), non-lossy
ALTER TABLE trades ALTER COLUMN percentage_change TYPE numeric(10,4);
