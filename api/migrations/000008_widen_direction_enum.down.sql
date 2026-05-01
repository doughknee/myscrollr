ALTER TABLE osticket_message_ids
  DROP CONSTRAINT IF EXISTS osticket_message_ids_direction_check;

ALTER TABLE osticket_message_ids
  ADD CONSTRAINT osticket_message_ids_direction_check
  CHECK (direction IN (
    'outbound_osticket',
    'outbound_ai',
    'inbound_user'
  ));
