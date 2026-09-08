-- A regenerated draft supersedes the one it replaces (REL-246).
--
-- /regen re-runs triage on a case and writes a NEW support_drafts row. The
-- draft it replaces stays exactly where it is — an `ai_draft` message on the
-- case, carrying the body a user was nearly sent — because the whole point of
-- the case DB is that nothing we wrote disappears. What it lacked was a way to
-- say "this was never the live answer", so a reader of the timeline can tell a
-- draft that was replaced from the one that stands.
--
-- A boolean rather than a superseded_by pointer: the replacement is the next
-- ai_draft on the same ticket, and no reader needs a join to find it.

ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false;
