ALTER TABLE support_cases ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE support_cases DROP COLUMN status_observed_at;
