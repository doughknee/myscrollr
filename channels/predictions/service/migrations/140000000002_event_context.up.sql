-- v1.1.4 Kalshi Grows Up: carry the EVENT context on every market row.
--
-- The catalog sweep has always fetched /events?with_nested_markets=true —
-- which includes each event's human-readable question ("More tech layoffs
-- in 2026 than in 2025?") — but only stored the market's own leg label
-- ("Yes", "Atlanta"). The desktop rendered legs without their question,
-- which is why the feed read as nonsense on first contact.
--
--   event_title: the event's question, denormalized per market row so the
--                CDC payload (REPLICA IDENTITY FULL) and the dashboard API
--                inherit it with zero routing changes. Backfills on the
--                next sweep (~minutes); '' until then and the desktop
--                falls back to the leg title.
--   event_rank:  1 = highest-volume market of its event (is_primary
--                stays in lockstep for back-compat), 2 = second outcome.
--                The sweep now keeps the top TWO outcomes per event so
--                the desktop can render Kalshi-style event cards.
ALTER TABLE markets
    ADD COLUMN event_title TEXT NOT NULL DEFAULT '',
    ADD COLUMN event_rank SMALLINT NOT NULL DEFAULT 1;
