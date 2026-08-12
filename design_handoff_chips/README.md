# Ticker Chip Redesign — Handoff

Redesign of compact + comfort ticker chips for all widgets. Fantasy chips are NOT in scope here — they follow the earlier spine spec (`design_handoff_fantasy_widget/`).

## Files
- `Chip Spec Sheets.dc.html` — **build from this.** Full state matrix per widget + implementation notes.
- `Ticker Rail - Picked Directions.dc.html` — all chips in rail context, both densities.
- `Chip Explorations - All Widgets.dc.html` — rejected directions, for rationale only.
- `screenshots/` — rail + per-section captures.

## Picked directions → repo targets
| Widget | Direction | File |
|---|---|---|
| Sports | 1c Momentum tilt | `desktop/src/components/chips/GameChip.tsx` |
| Finance | 1d Sparkline | `desktop/src/components/chips/TradeChip.tsx` |
| RSS | 1h Kicker stack | `desktop/src/components/chips/RssChip.tsx` |
| Predictions | 1k Probability dial | `desktop/src/components/chips/PredictionChip.tsx` |
| Clock | 1m Zone segments | `desktop/src/components/chips/ConsolidatedChip.tsx` |
| Timer | 1n Depleting spine | `ConsolidatedChip.tsx` (+ `ChipSpine.tsx` reuse) |
| Weather | 1o Day range | `ConsolidatedChip.tsx` |
| Sysmon | 1q Micro gauges (placeholder pick) | `ConsolidatedChip.tsx` |
| Uptime | 1t Status cap | `ConsolidatedChip.tsx` |
| GitHub | 1v Verdict cap | `ConsolidatedChip.tsx` |

ConsolidatedChip likely wants splitting per-type now — the six utility renderings no longer share one row shape. Suggest a `caps` helper (uptime + github share the cap grammar) and a `cells` helper (clock zones, weather hour cells).

## Token mapping (design → Tailwind)
Mockups use default-dark hex; implement with tokens so all themes inherit:
- `#141420` surface · `#282838` edge · `#e2e2ec` fg (dim = fg/60–45)
- Chip base: `bg-{accent}/[0.06] border-{accent}/25` (unchanged from `chipBaseClasses`)
- Accents: finance `primary`, sports `secondary`, rss `info`, predictions `predictions`, utilities `widget-*`
- Semantic: `up` `down` `live` `warning` `error` — all alert tints are semantic, never widget accents
- Type: data = `font-mono` (IBM Plex Mono), RSS headline = sans (Jakarta) 13px/500 — the only sans chip, intentional
- Hero numbers 15px/700 tabular; labels 10px/700 uppercase

## Shared anatomy
- Compact: 28px lane, `px-3 py-1 rounded-sm`, inline row
- Comfort: two rows, `py-1.5`, row 2 = 11px meta at fg/45
- Caps (uptime/github): zero left padding, cap block 16% bg + 30% border-right, maps to `MONITOR_STATUS_COLORS` / `CI_STATUS_COLORS`
- Spines (timer only here): reuse `ChipSpine`, fill = remaining/total; pulses gate on `data-motion` (app-shell stillness rule)
- Sysmon keeps the 5ch reserved value cell (Bug 3 anti-jiggle); gauges are fixed-width

## New data needs
- Finance sparkline: client-side ring buffer of last ~8 ticks (no API change)
- Sports tilt %: odds pre-game, live win-prob later — same sports-service seam as the fantasy handoff; fall back to score share
- Weather high/low: already in provider payload, currently dropped from `WeatherChipData`
- RSS category: first `category` entry when present
- GitHub failed-step name + elapsed: from workflow run jobs payload

## Suggested implementation order
1. Uptime + GitHub caps (shared grammar, pure restyle)
2. Predictions dial (replaces pill, data already there)
3. Finance sparkline (adds ring buffer)
4. RSS kicker (pure restyle, bump truncation 40→64ch)
5. Clock/Timer/Weather cells (ConsolidatedChip split)
6. Sysmon gauges
7. Sports tilt (needs win-prob seam decision)
