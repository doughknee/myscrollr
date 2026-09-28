-- Recreate the eight tables exactly as 000001_baseline.up.sql defines them.
-- Data is not restored -- 000023_purge_yahoo already deleted it and the
-- rows were dead by SCROLLR-237's decision. Parents before children so the
-- FKs added at the end can resolve.

-- markets (TABLE)

CREATE TABLE markets (
    id text NOT NULL,
    source text DEFAULT 'kalshi'::text NOT NULL,
    ticker text NOT NULL,
    event_ticker text,
    series_ticker text,
    category text,
    title text,
    subtitle text,
    yes_price integer,
    yes_bid integer,
    yes_ask integer,
    prev_yes_price integer,
    volume bigint,
    volume_24h bigint,
    open_interest bigint,
    status text,
    result text,
    is_primary boolean DEFAULT true NOT NULL,
    open_time timestamp with time zone,
    close_time timestamp with time zone,
    link text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    event_title text DEFAULT ''::text NOT NULL,
    event_rank smallint DEFAULT 1 NOT NULL,
    in_sweep boolean DEFAULT true NOT NULL,
    settled_at timestamp with time zone
);

ALTER TABLE ONLY markets REPLICA IDENTITY FULL;

ALTER TABLE ONLY markets
    ADD CONSTRAINT markets_pkey PRIMARY KEY (id);

CREATE INDEX markets_category_idx ON markets USING btree (category);

CREATE INDEX markets_event_ticker_idx ON markets USING btree (event_ticker);

CREATE INDEX markets_updated_at_idx ON markets USING btree (updated_at);

-- tracked_markets (TABLE)

CREATE TABLE tracked_markets (
    id integer NOT NULL,
    ticker text NOT NULL,
    title text,
    category text,
    series_ticker text,
    is_enabled boolean DEFAULT true,
    last_polled_at timestamp with time zone,
    last_poll_success_at timestamp with time zone,
    last_poll_error text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE tracked_markets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE tracked_markets_id_seq OWNED BY tracked_markets.id;

ALTER TABLE ONLY tracked_markets ALTER COLUMN id SET DEFAULT nextval('tracked_markets_id_seq'::regclass);

ALTER TABLE ONLY tracked_markets
    ADD CONSTRAINT tracked_markets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tracked_markets
    ADD CONSTRAINT tracked_markets_ticker_key UNIQUE (ticker);

-- yahoo_leagues (TABLE)

CREATE TABLE yahoo_leagues (
    league_key character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    game_code character varying(10) NOT NULL,
    season character varying(10) NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ONLY yahoo_leagues
    ADD CONSTRAINT yahoo_leagues_pkey PRIMARY KEY (league_key);

-- yahoo_matchups (TABLE)

CREATE TABLE yahoo_matchups (
    league_key character varying(50) NOT NULL,
    week smallint NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ONLY yahoo_matchups
    ADD CONSTRAINT yahoo_matchups_pkey PRIMARY KEY (league_key, week);

CREATE INDEX idx_yahoo_matchups_league_key_week ON yahoo_matchups USING btree (league_key, week DESC);

ALTER TABLE ONLY yahoo_matchups
    ADD CONSTRAINT yahoo_matchups_league_key_fkey FOREIGN KEY (league_key) REFERENCES yahoo_leagues(league_key) ON DELETE CASCADE;

-- yahoo_rosters (TABLE)

CREATE TABLE yahoo_rosters (
    team_key character varying(50) NOT NULL,
    league_key character varying(50) NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ONLY yahoo_rosters
    ADD CONSTRAINT yahoo_rosters_pkey PRIMARY KEY (team_key);

CREATE INDEX idx_yahoo_rosters_league_key ON yahoo_rosters USING btree (league_key);

ALTER TABLE ONLY yahoo_rosters
    ADD CONSTRAINT yahoo_rosters_league_key_fkey FOREIGN KEY (league_key) REFERENCES yahoo_leagues(league_key) ON DELETE CASCADE;

-- yahoo_standings (TABLE)

CREATE TABLE yahoo_standings (
    league_key character varying(50) NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ONLY yahoo_standings
    ADD CONSTRAINT yahoo_standings_pkey PRIMARY KEY (league_key);

ALTER TABLE ONLY yahoo_standings
    ADD CONSTRAINT yahoo_standings_league_key_fkey FOREIGN KEY (league_key) REFERENCES yahoo_leagues(league_key) ON DELETE CASCADE;

-- yahoo_users (TABLE)

CREATE TABLE yahoo_users (
    guid character varying(100) NOT NULL,
    logto_sub character varying(255),
    refresh_token text NOT NULL,
    last_sync timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ONLY yahoo_users
    ADD CONSTRAINT yahoo_users_pkey PRIMARY KEY (guid);

ALTER TABLE ONLY yahoo_users
    ADD CONSTRAINT yahoo_users_logto_sub_key UNIQUE (logto_sub);

-- yahoo_user_leagues (TABLE)

CREATE TABLE yahoo_user_leagues (
    guid character varying(100) NOT NULL,
    league_key character varying(50) NOT NULL,
    team_key character varying(50),
    team_name character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ONLY yahoo_user_leagues
    ADD CONSTRAINT yahoo_user_leagues_pkey PRIMARY KEY (guid, league_key);

CREATE INDEX idx_yahoo_user_leagues_guid ON yahoo_user_leagues USING btree (guid);

CREATE INDEX idx_yahoo_user_leagues_league_key ON yahoo_user_leagues USING btree (league_key);

ALTER TABLE ONLY yahoo_user_leagues
    ADD CONSTRAINT yahoo_user_leagues_guid_fkey FOREIGN KEY (guid) REFERENCES yahoo_users(guid) ON DELETE CASCADE;

ALTER TABLE ONLY yahoo_user_leagues
    ADD CONSTRAINT yahoo_user_leagues_league_key_fkey FOREIGN KEY (league_key) REFERENCES yahoo_leagues(league_key) ON DELETE CASCADE;
