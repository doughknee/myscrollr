-- One vocabulary, all the way down (VISION §4.4) — the support surface.
--
-- The support ticket category named "channel" always meant "help with a
-- specific widget": its UI label was already "Widget Help" and its picker
-- already asked "Which widget?". Only the stored value, the wire field and
-- this column still said channel.
--
-- `ai_channel` holds the triage model's guess at which widget a ticket is
-- about. Renamed alongside SupportRequest.Widget and TriageResult.Widget,
-- which move in the same release.
--
-- A rename, not an add + backfill + drop: every reader moves together and
-- there are no users to stage this for. Existing rows keep their values.

ALTER TABLE support_drafts RENAME COLUMN ai_channel TO ai_widget;
