# SCROLLR-411 / SCROLLR-412 — balanced pages and reserved actions

The user approved three follow-ups: remove sparse-page holes, keep Fill controls clear of data, and identify pins. This extends the shared Pages renderer and TickerSurface in PR #529. No animation or native renderer changes.

## Behavior

- Selection still uses the existing family minimums and maximum grid capacity. Each frozen page distributes its actual items into the fewest complete rows with counts differing by at most one. Seven entries at 3x3 capacity use 3/2/2; four use 2/2. Rows have equal height, cells within each row have equal width, and type sizes stay bounded. Live values cannot change row assignments or identities.
- Settings and Exit have an 84px reservation in the header's 64px coordinate system. Both remain visible and keyboard reachable; after five idle seconds their ink is muted rather than hiding a blank space. Grid utility slots use 140px so portrait still shows clock and weather beside the band and actions. Strip places the controls beside the content and preserves at least 780 logical pixels for that content.
- Each Fill header pin has a pin glyph in the existing left gutter, preserving its family width and dashed rule. The glyph is non-interactive and labeled for assistive technology. Missing-data reservation, overflow restoration and the shared menu admission plan remain intact.
- Tradeoff: the reserved controls can reduce header pin capacity at some widths. Overflow remains saved and returns to pages; this is preferable to obscuring values or shrinking text when controls wake.

## Verification

Production build and all 1,045 unit tests passed; 65 relevant unit cases were rerun after the strip minimum-width adjustment. All 63 focused browser cases passed across the main/follow-up runs. One initial test could not mount because the local server refused `/@react-refresh`, producing a Vite preamble error; its isolated rerun passed. Eight cases covering the final strip adjustment, sparse rows and that failed startup case passed together.

New checks cover 3/2/2 row coverage and unique identities, a one-game page, geometry frozen after data removal, pin glyph clearance, non-overlapping control/header bounds at five sizes and both reading sizes, keyboard Settings activation, Exit, and unchanged idle geometry. Existing hover, score reservations, backward slides, resize, missing pin payload, menu admission, empty recovery and continuous strip overflow checks passed.

Visually inspected actual shared-renderer fixtures at 1920x360, 1920x1080 and 1080x1920; also short light mode and strip layouts. On the running Windows dev app (3440x1440), captured the actual stock grid, measured the utility edge ending at x3233.81 and controls starting at x3233.83, and verified keyboard paging through the dev bus. User preferences were not changed, and the app was not restarted.

This is not a new visible-cursor, physical sleep/wake or reconnect certification. Qtqc's mini-PC is not accessible here. `MINI-PC-PILOT.md` records the prepared hardware checklist; those acceptance checks remain pending before release. Work remains in draft review, not released.
