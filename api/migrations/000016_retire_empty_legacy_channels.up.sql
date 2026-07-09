-- Retire the contentless legacy coarse widget rows left by the channel→widget
-- split, so no coarse ids linger to break catalog dedup / slot counting.
--
--   * 000014 KEPT coarse 'sports' rows whose leagues array was empty/malformed
--     (splitting per-league produced nothing to keep).
--   * 000015 leaves coarse 'news' rows with no feeds (nothing to split).
--
-- Both are husks: they render nothing, yet occupy a slot AND — being coarse
-- ids — never match a per-item catalog card, so the user sees every league/
-- feed as addable. Delete ONLY rows with no content. A coarse row that still
-- carries leagues/feeds is left untouched — there is real config to lose, so it
-- stays grandfathered (this is a near-impossible state post-000014/000015, but
-- the guard makes the cleanup safe regardless).
--
-- (CASE, not chained AND: Postgres may reorder WHERE predicates, so the
-- array-length call must be provably guarded by the typeof check. The ELSE
-- branch deletes rows whose content key is absent or a non-array scalar.)

DELETE FROM user_channels
WHERE channel_type = 'sports'
  AND CASE WHEN jsonb_typeof(config -> 'leagues') = 'array'
           THEN jsonb_array_length(config -> 'leagues') = 0
           ELSE true END;

DELETE FROM user_channels
WHERE channel_type = 'news'
  AND CASE WHEN jsonb_typeof(config -> 'feeds') = 'array'
           THEN jsonb_array_length(config -> 'feeds') = 0
           ELSE true END;
