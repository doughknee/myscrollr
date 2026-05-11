-- No-op: a cleanup migration cannot be meaningfully reversed. We don't know
-- which (logto_sub, url, name) tuples were deleted, and re-creating "Custom"
-- per-user rows for curated default URLs would re-introduce the bug.
-- If you need to roll back the fix, also revert the rss.go runtime guard and
-- queryUserCatalog filter — the down migration alone won't bring the data back.
SELECT 1;
