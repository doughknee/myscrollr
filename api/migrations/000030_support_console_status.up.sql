-- Console dismissal is independent of the ticket's status in osTicket.
ALTER TABLE support_cases ADD COLUMN console_status text NOT NULL DEFAULT ''
    CHECK (console_status IN ('', 'dismissed', 'review'));
