# REL-263 captures

Screenshots of the staff Support console (`/admin/support`), rendered by the
real Go handlers against real production rows seeded into a test schema.

- `case-view.png` — production ticket #819835 (Linux AppImage login), escalated
  on "account access or identity", REL-255 linked but not shipped.
- `hold-view.png` — the hold countdown. That one row is CONSTRUCTED and says so
  in its own subject: no production draft is on a live hold right now.
