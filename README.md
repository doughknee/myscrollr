# REL-239 — a pin follows a subject, not a widget

Captures of the real ticker (Tauri debug build, dev stack, `make seed` data
with the dev clock ticked so one MLB game is live). Taken with
`scripts/dev/capture-window.ps1` (PrintWindow, no screen grab), so these are
the window's own pixels at the display's DPI.

The bar is 3440px wide here. Each `*-right.png` is the rightmost 1500px of
the same frame — that is where the fixed zone sits.

| File | What it shows |
|---|---|
| `01-pinned-clock` | A pinned Clock. Identical to how a pinned clock has always looked — the widget IS the subject for a single-chip utility. It is gone from the scrolling tape. |
| `02-pinned-live-team` | A pinned team (Miami Marlins), showing its LIVE game: red dot, `B1`. The subject is the team; the chip is whatever that team is doing now. |
| `03-pinned-symbol` | A pinned symbol (AAPL). The tape carries the rest of the watchlist and no second AAPL. |
| `04-two-pins-at-cap` | Both pins used (`MAX_PINS = 2`). Measured zone width 724px. A third is refused, not evicted. |

Measured live: zone 724px on a 3440px bar with a clock + a game pinned —
which is over the 640px budget derived for a 1280px bar, exactly the cost
stated in the PR (the cap is on count, not width).
