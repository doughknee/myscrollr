# Screenshots

Marketing and documentation captures of the Scrollr desktop app.

Captured 2026-05-10 from a live dev build with real data flowing through the realtime stream.

## Inventory

| File | Surface | Best for |
|---|---|---|
| `01-hero-home.png` | Home — live feed at a glance (Finance + Sports sections) | Landing page hero, README top |
| `02-sports.png` | Sports source — 16 MLB games with team logos, tabs, filters | Feature section "Sports" |
| `03-fantasy.png` | Fantasy overview — live Yahoo matchup, win probability, multi-league | Feature section "Fantasy", differentiator shot |
| `04-news.png` | News source — TechCrunch articles, source/category filters | Feature section "News" |
| `05-ticker-bar.png` | Standalone ticker bar — fantasy intel + game chips (no chrome, fills width) | "Always-on ticker" feature, top of README |
| `06-display-preferences.png` | Sports display preferences — live preview of Feed vs Ticker | Customization / "your data, your way" section |

### ⚠️ Stale — do not use (`07`–`12`)

`07-configure-sports.png`, `08-configure-fantasy.png`, `09-configure-news.png`,
`10-configure-finance.png`, `11-configure-clock.png`, `12-configure-weather.png`

These show the **Configure pages, which were retired in v1.1.9** ("One Bar" —
every widget's controls moved into its own persistent top bar; there is no
`configure` route any more). They are six screenshots of a UI that no longer
exists. Publishing one would misrepresent the product.

They were left undocumented in this inventory for two months, which is how a
stale asset gets used by accident. Kept for now as a historical record of the
pre-v1.1.9 IA — delete them if that's not worth the confusion risk.

## How these were made

Two-tool hybrid:

1. **Tauri MCP server** drives the UI: `webview_execute_js` to navigate routes, dismiss tooltips, and prep state.
2. **macOS `screencapture -l <windowID>`** captures the window with native chrome (traffic lights, title bar, rounded corners, drop shadow).

Window IDs are looked up via a small Swift one-liner against `CGWindowListCopyWindowInfo`.

> The original note here pointed at "the workflow notes in the chat history"
> for the exact command sequence. That isn't a place anyone can look. The
> sequence was not committed; treat the two steps above as the whole recipe
> and expect to rediscover the specifics.

## Notes / known issues spotted while capturing

- **Finance source page hit the error boundary** ("Something went wrong") when these were captured on 2026-05-10. Several releases have shipped since (v1.1.5–v1.1.13, including the One Bar rewrite that replaced this page entirely) — **unverified against current builds**; re-check before treating it as a live bug.
- **Fantasy league name contains profanity** ("Stanton Again A Fuck League") — the `03-fantasy.png` shot needs a name swap or crop before being used on the website or in any public-facing marketing material. The Scrollr League card below it is publication-safe.
- **Ticker `05-ticker-bar.png` is borderless by design** — it's a permanent overlay window, so no traffic lights. Looks intentional in marketing.
