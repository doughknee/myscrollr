-- Drop REPLICA IDENTITY FULL from two tables that are not replicated.
--
-- FULL makes Postgres log the entire old row to WAL on every UPDATE/DELETE so
-- logical decoding can populate Sequin's `changes` field. `standings` and
-- `teams` are not in `sequin_pub` at all, so nothing can ever decode them —
-- the cost is paid and the output discarded. (Note `yahoo_standings` IS
-- published; plain `standings` is a different, sports-side table.)
--
-- `markets` keeps FULL: it is published, and it is low-volume.
--
-- Deliberately NOT restoring FULL on user_widgets, user_preferences or the
-- yahoo_* tables. docs/cdc-runbook.md lists them as FULL — set 2026-04-23 to
-- silence a Sequin health-check warning, not because anything reads the field.
-- The runbook's own reasoning says so: the desktop reads `cdc.record` and
-- `cdc.action`, never `cdc.changes`. The 2026-07-21 database reset cleared
-- them and CDC has been correct since. Restoring it would buy WAL volume and
-- a quieter dashboard, nothing else.

ALTER TABLE standings REPLICA IDENTITY DEFAULT;
ALTER TABLE teams REPLICA IDENTITY DEFAULT;
