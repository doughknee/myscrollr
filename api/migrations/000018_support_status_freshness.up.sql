ALTER TABLE support_cases ADD COLUMN status_observed_at timestamp with time zone;
ALTER TABLE support_cases ALTER COLUMN status SET DEFAULT 'unknown';
