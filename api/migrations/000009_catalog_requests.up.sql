-- Catalog requests — what people searched for and did not find.
--
-- The catalog's zero-match state offers a one-click "request it" card
-- (design_handoff_catalog, "Behavior rules"). Each click lands here, keyed
-- on the user and the normalised query (lower-cased, trimmed) so one person
-- counts once however many times they ask; the count across users is what
-- the card shows back and what the roadmap reads.
--
-- There is no admin endpoint yet: `SELECT query, count(*) FROM
-- catalog_requests GROUP BY 1 ORDER BY 2 DESC` is the roadmap for now. The
-- row keeps the user and created_at so "notify me when it ships" can be
-- built on it later without a second table.

CREATE TABLE catalog_requests (
    logto_sub  text NOT NULL,
    query      text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (logto_sub, query)
);

-- The read path is "how many people asked for this query".
CREATE INDEX catalog_requests_query_idx ON catalog_requests (query);
