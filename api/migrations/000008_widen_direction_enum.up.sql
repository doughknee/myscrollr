-- Widen the osticket_message_ids.direction enum to cover the new
-- direction tags emitted by classifyMessageDirection in
-- handlers_resend_webhook.go. The original migration restricted the
-- column to {outbound_osticket, outbound_ai, inbound_user}; we now
-- additionally need outbound_partner_notification (our internal
-- approval emails to the support agent) and unknown (fallback when
-- the from-address does not match any known address).

ALTER TABLE osticket_message_ids
  DROP CONSTRAINT IF EXISTS osticket_message_ids_direction_check;

ALTER TABLE osticket_message_ids
  ADD CONSTRAINT osticket_message_ids_direction_check
  CHECK (direction IN (
    'outbound_osticket',
    'outbound_ai',
    'outbound_partner_notification',
    'inbound_user',
    'unknown'
  ));
