-- user_deletion_requests.purge_email: the verified address read from Logto
-- before the account is deleted there, kept only until the purge commits so a
-- failed pass can still match email-keyed support rows. Cleared on commit,
-- cancel and re-request. Personal data: never read it for anything else.
ALTER TABLE user_deletion_requests ADD COLUMN IF NOT EXISTS purge_email text;
