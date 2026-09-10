ALTER TABLE support_cases
    ADD COLUMN user_name text,
    ADD COLUMN contact_source text,
    ADD COLUMN contact_observed_at timestamptz,
    ADD COLUMN account_source text;
