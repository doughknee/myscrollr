ALTER TABLE markets
    DROP COLUMN IF EXISTS event_title,
    DROP COLUMN IF EXISTS event_rank;
