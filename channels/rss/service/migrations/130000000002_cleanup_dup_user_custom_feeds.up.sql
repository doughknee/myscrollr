-- Cleanup: remove rows from user_custom_feeds whose URL is already a curated
-- default in tracked_feeds. These rows were created by the pre-fix
-- syncRSSFeedsToTracked path (channels/rss/api/rss.go), which blindly upserted
-- every feed in a user's config — including curated defaults the user simply
-- clicked in the picker — into user_custom_feeds with category='Custom'. The
-- catalog UNION then returned the URL twice and FeedTab re-labeled the row to
-- "Custom" when building its category map.
--
-- The runtime guard added in the same change prevents new pollution; this
-- migration backfills existing accounts. The query filter in
-- queryUserCatalog provides defense in depth.
DELETE FROM user_custom_feeds
WHERE url IN (
    SELECT url FROM tracked_feeds WHERE is_default = true
);
