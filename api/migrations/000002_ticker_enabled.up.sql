-- One vocabulary, all the way down (VISION §4.4).
--
-- `visible` was the original column name; the wire later grew a clearer
-- `ticker_enabled` alias alongside it, and the two have been emitted in
-- parallel ever since. Phase 3 renames the wire outright, so the column
-- follows and the duplicate goes away.
--
-- A rename, not an add + backfill + drop: every reader moves in the same
-- release, and there are no users to stage this for.

ALTER TABLE user_widgets RENAME COLUMN visible TO ticker_enabled;

-- The Phase 2 table rename left these internal identifiers behind, since
-- Postgres does not rename a table's sequence, primary key, or constraints
-- along with it. Nothing reads them by name, but "one vocabulary" means the
-- whole schema, not just the parts queries mention.
ALTER SEQUENCE user_channels_id_seq RENAME TO user_widgets_id_seq;
ALTER INDEX user_channels_pkey RENAME TO user_widgets_pkey;
ALTER INDEX user_channels_logto_sub_channel_type_key
    RENAME TO user_widgets_logto_sub_widget_type_key;
