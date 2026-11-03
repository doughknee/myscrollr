# Qtqc monitor pilot — pending hardware access

Use a Windows test build from PR #529 after review, not the currently installed public release. This checklist is prepared; none of these customer-hardware checks have been performed here. Local desktop and browser evidence does not substitute for this pilot.

Record the build commit/version, Windows version, monitor resolution and scaling, connection type, and intended viewing distance. Physical panel dimensions alone do not establish its resolution.

1. Select the dedicated monitor in Settings → Ticker → Displays and choose Fill this display. Compare Page grid and Ticker strip at Auto, Larger and Largest from the actual viewing position. Confirm names, scores, clock/weather and pinned values can be read comfortably.
2. Try a busy sports page, a sparse schedule, a stock page and news. Check that rows use the available space, long names remain recognizable, and no text or controls are clipped. Pins should appear once, stay saved when they cannot fit, and return when space permits.
3. Use page arrows, keyboard arrows and the scroll wheel, then move the pointer over cards and the Settings/Exit buttons. Confirm the visible pointer stays responsive, slides remain smooth and the controls do not cover data.
4. Open Settings, return to Fill, then exit with both the icon and Escape. Check the original docked placement and the Windows work area are restored. Re-enter Fill and confirm the saved reading size.
5. Restart the app and the mini-PC. Confirm the intended monitor and mode return. Sleep/wake once, then unplug/reconnect the dedicated display. Confirm the app recovers on that display and does not unexpectedly fill another monitor.
6. Leave the intended configuration running for at least an hour. Check animation, cursor, CPU/memory trend and temperature/noise at the beginning and end. Report repeatable growth or stutter with the active widgets and reading size.

Acceptance: no cursor freeze, overlap, off-screen controls, incorrect monitor restoration or persistent rendering errors; comfortable readability at the intended distance. Note any failure with the exact step, build, screen settings and a screenshot if useful. Keep release approval pending until hardware issues are resolved.
