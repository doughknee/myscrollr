-- Narrowing back WILL round every stored value to whole cents. That is the
-- point of the up migration, so a rollback necessarily loses the precision.
ALTER TABLE trades
  ALTER COLUMN price             TYPE numeric(10,2),
  ALTER COLUMN previous_close    TYPE numeric(10,2),
  ALTER COLUMN price_change      TYPE numeric(10,2),
  ALTER COLUMN percentage_change TYPE numeric(5,2);
