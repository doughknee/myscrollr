# Settings audit — every setting, one by one

Written 2026-09-06 against main at `b90dc30e` (monitor management merged, v1.5.2 released). Input: every settings page captured from the running app, plus a code inventory of every preference (`preferences.ts`), what reads it, and what writes it from outside Settings.

The lens, in the order Brandon asked for:

- **a. Clear at a glance** — does the label say what happens, without the description?
- **b. Earns its place** — would a normal person ever change it? If not, it is a default, not a setting.
- **c. Grouped right** — is it next to the things it belongs with, and in one place only?
- **d. Right control** — does the control match the shape of the value? A few named choices → segmented. On/off → switch. A number nobody can picture → presets, never a raw slider.

Verdicts: **Keep** · **Rework** (same setting, better control or copy) · **Move** · **Fold** (delete the setting, keep the best default) · **Fix** (a bug, not a design choice).

The single biggest finding is structural, so it comes first.

## 1. The shape is wrong before any row is

Settings has three pages about the ticker's environment spread across two names, and no page that owns the ticker as a whole:

- "Window & startup" holds *Always on top* and *Hide when fullscreen*, which are ticker behaviours, next to *Monitors*, which is ticker placement, next to *Launch on startup*, which is about the app.
- "Ticker" holds *Screen edge* (a `window.*` pref) and *Scale* (an `appearance.*` pref) beside the motion settings.
- The most consequential switch in the app, **Show the ticker**, has no settings row at all. It exists as the green pill in the top bar, a shortcut, a tray item and a right-click item. A stale code comment still claims a "Customize → Ticker → Enable ticker" row.

The fix is one mental model: **Appearance is the app window. Ticker is the bar. Startup is the computer.** Everything about the bar, including where it lives, moves onto the Ticker page in the order a person thinks about it: is it on → where → what it looks like → how it moves → how it behaves.

Proposed page map (7 pages → 7 pages, but each with one job):

| Page | Contents |
|---|---|
| **Appearance** | Theme · Color mode · App size · Readability (font weight, high contrast) · **Units & formats** (new) |
| **Ticker** | **Show the ticker** (new row) · Where: Monitors, Screen edge · Look: Detail level, Size, Chip colors · Motion: Scroll mode, Speed, On hover, Time per page · Behaviour: Stay above other windows, Hide when an app goes fullscreen, Item order |
| **Startup** | Launch at login · **Start in the background** (new) |
| **Shortcuts** | unchanged, copy fixed |
| **Profile & plan** | unchanged, copy fixed |
| **Data & privacy** | Export · **Send crash reports** (new) · Reset all settings (scope fixed) |
| **Updates** | unchanged, copy fixed |

Row count goes from 24 settings to about 20, and three of the removed ones were duplicates of something else.

## 2. Appearance

| Setting | Today | Verdict | Notes |
|---|---|---|---|
| **Theme** | Select with 10 palettes; three preview dots | **Rework** | a: fine. d: the dots preview the *active* palette, never the one you are about to pick, so the preview is decorative. Replace select+dots with a grid of 10 swatches (name + three dots each) so all palettes are visible at once and the choice *is* the preview. |
| **Color mode** | Light / Dark / Auto | **Keep** | a: good. Fix: the Ctrl+Shift+T cycle order (dark→light→system in code) disagrees with the Shortcuts page (light→dark→auto). Pick the page's order. |
| **Display size** | 85 / 100 / 115 / 130 % presets | **Keep**, rename **App size** | d: presets are right, and the reason the ticker's slider feels wrong is that this one already got it right. Fix: a stored value outside the four presets (old 75/90/150) leaves nothing selected — snap on load. |
| **Font weight** | Normal / Medium / Bold | **Keep**, group as **Readability** with High contrast | b: rarely changed, but it is accessibility, and accessibility settings stay even when few use them. |
| **High contrast text** | switch | **Keep** under Readability | Fine as is. |
| **Units & formats** | does not exist; °F/°C lives in the Weather bar *and again* in the Sysmon bar; 12h/24h lives in the Clock bar; each in an ad-hoc storage key outside prefs | **Add** | c: a person's temperature unit is not a per-widget opinion. One row pair here — Temperature (°F / °C), Time (12h / 24h) — read by Weather, Sysmon and Clock. The widget bars lose those controls. The ad-hoc keys move into `preferences.ts` so reset and export see them. |

## 3. Ticker

Order matters here. Today the page opens with *Scroll mode*, which is the fourth thing anyone cares about.

### On

| Setting | Today | Verdict | Notes |
|---|---|---|---|
| **Show the ticker** | no row; pill / Ctrl+T / tray / right-click only | **Add** as the first row | The pill stays. A settings page that cannot turn the product on is missing its first row. |

### Where

| Setting | Today | Verdict | Notes |
|---|---|---|---|
| **Monitors** | Window & startup: map + one switch per display | **Move** here; **Fix** REL-203 | a: labels are `DISPLAY1`, the driver name. Show what Windows shows: **Display 1 · 3440 × 1440**, primary badge kept. d: map must draw physical rects (a 300 % 4K screen currently draws at a third size, overlapping). The last switch is disabled with no reason given — a tooltip: "Keep at least one". Add **Identify** (flash each screen's number on it) and make clicking a rectangle toggle it. |
| **Screen edge** | Top / Bottom, on the Ticker page but stored as `window.tickerPosition` | **Keep** here, under Where | Fine. Keep the right-click Position submenu as the quick path. Dev: drop the legacy mirror key `scrollr:tickerPosition` that can drift from the real pref. |

### Look

| Setting | Today | Verdict | Notes |
|---|---|---|---|
| **Detail level** | Compact / Detailed | **Keep**, first in Look | This is *the* choice on the bar. Values are `compact` / `comfort` internally; rename the value to match the label in a migration so the prefs file reads like the UI. |
| **Scale** | slider 75–150 % | **Rework** → **Size**, presets 85 / 100 / 115 / 130 % | d: the slider Brandon does not like. Same four presets as App size, same control, same word. The 75–150 range was never reachable for the app anyway. |
| **Chip colors** | Widget / Theme / Subtle | **Keep** | b: real, visible effect. Values `widget/accent/muted`; align in the same migration. |
| **Spacing** | Tight / Normal / Wide | **Fold** | b: gap between chips, 8/12/20 px. Nobody opens Settings to change chip gap. Keep one gap (the current default, tight, reads best with the redrawn chips) and delete the row. |

### Motion

| Setting | Today | Verdict | Notes |
|---|---|---|---|
| **Scroll mode** | Continuous / Page / Rotate | **Rework** → Continuous / Page | b: Page and Rotate differ only in the transition between pages. One paged mode with the better transition; two is a choice nobody can reason about from the labels. Question for Brandon: does anyone use Rotate? If yes, keep it and the rest still stands. |
| **Speed** | slider 5–150, shows a bare number ("20") | **Rework** → Slow / Normal / Fast | d: "20" means nothing; it is pixels per second. Three presets mapped to the values people actually land on. Keeps the pref as a number, so nothing downstream changes. |
| **Slow down on hover** + **Hover speed** | switch + slider 0–100 %, the slider hidden unless the switch is on and mode is Continuous | **Fold** into one row: **On hover** — Keep moving / Slow down / Pause | a: "Slow down" is the label even when it means "pause" in Page mode. d: a switch that reveals a slider is two controls for one decision. Three words cover every case and read at a glance. Default Slow down. |
| **Time per page** | slider 1–10 s, only in Page mode | **Rework** → 3 / 5 / 8 s presets, only in Page mode | d: same slider argument. Fix: settings search jumps here in Continuous mode where the row is not rendered. |
| **Direction** | ← Left / Right → | **Fold** | b: tickers go left. If a right-to-left reader ever asks, add it back. |

### Behaviour

| Setting | Today | Verdict | Notes |
|---|---|---|---|
| **Always on top** | Window & startup; also the right-click menu; also the tray | **Move** here as **Stay above other windows**; keep the right-click item; **drop the tray item** | c: one setting, three surfaces, plus a legacy mirror key. Settings + one quick path is enough. The tray is for when the app is hidden; it needs Show/Hide ticker, not this. |
| **Hide when an app goes fullscreen** | Window & startup, "Windows" badge; shown and writable on macOS and Linux where it does nothing | **Move** here; **hide** it on platforms where it is inert | An inert control with a badge is still an inert control. |
| **Item order** | By source / Mixed | **Keep** | Fine. Value `weave` → rename to match in the migration. |
| **Reset ticker settings** (page button) | resets `ticker.*` only, so Screen edge and Size stay; toast says "Reset ticker style" | **Fix** | Reset everything on the page, and one name for the button, the toast and the undo. |

## 4. Startup (today "Window & startup")

| Setting | Today | Verdict | Notes |
|---|---|---|---|
| **Launch on system startup** | switch, owned by the autostart plugin, not in prefs | **Keep** as **Launch at login** | Fix: "Reset all settings" does not turn it off because it is not a pref. Either include it in reset or say so in the reset copy. |
| **Check for updates on startup** | switch, default on | **Fold** | b: nobody wants to be *not told* about an update; the Updates page has a manual check for the impatient. Default on, row gone, and the Updates page loses its odd sentence pointing here. |
| **Start in the background** | does not exist | **Add** | For a tray app that launches at login, "open the ticker only, keep the main window closed" is the expected companion switch. Today launch-at-login opens whatever it opens with no say. |

## 5. Shortcuts

Read-only list, no prefs. **Keep**. Fix the cycle-order copy (see Color mode) and add **Show/hide the ticker** wording that matches the tray and right-click, since this page is currently the only documentation that the ticker can be hidden at all.

## 6. Profile & plan

All server state, no local prefs. **Keep** the page. Three fixes:

- Search index describes rows with text that appears nowhere on the page ("Manage widgets", "Signed in as" while signed out). Generate the index from the rendered rows instead of maintaining it by hand — this drift is everywhere, not just here.
- Changing the account **email** is a one-click inline edit with no confirmation. Add a confirm step; it is the account's identity.
- The `data-row="plan"` anchor is on a 20 px badge, so searching "plan" focuses a chip. Put it on the card.

## 7. Data & privacy

| Setting | Today | Verdict | Notes |
|---|---|---|---|
| **Export your data** | "as JSON"; the file is a `.zip` | **Fix** copy | Say what it is. |
| **Reset all settings** | "Clear every local preference"; also removes your local widgets (back to Clock only), does *not* reset autostart or the ad-hoc keys (clock format, weather unit and cities, uptime, github) | **Fix** scope and copy | Reset should reset everything local, including the keys that live outside `preferences.ts` (which should stop living there, see Units), and the copy must say widgets are removed. |
| **Send crash reports** | does not exist; Sentry is always on | **Add** | Standard expectation for a desktop app, and the honest thing. Default on, one switch, clear sentence about what is sent. |

## 8. Updates

**Keep.** Fix the label mismatch ("Check for new versions" on the page, "Check for updates" in search). The release-history sort is component-local and unpersisted; that is fine, but it does not need to be in the search index.

## 9. Outside the settings pages

These are settings too; people find them here first.

**Ticker right-click menu** — Open Scrollr · Widgets ▸ · Always on Top · Customize Ticker · Position ▸ · Hide Ticker · Quit.
- **Fix:** "Customize Ticker" opens the *Appearance* page. It must open the Ticker page.
- Keep Widgets ▸, Position ▸, Always on Top, Hide Ticker: these are the right quick actions. Wording of Hide/Show should match the tray.

**Tray** — Open Scrollr · Toggle Ticker · Always on Top · Report a Bug · Quit.
- "Toggle Ticker" → **Show ticker** as a checked item, same words as everywhere else.
- Drop Always on Top (third copy). The check state also starts wrong until JS syncs it.

**Widget bars** (per-widget controls):
- **Clock 12h/24h, Weather °F/°C, Sysmon °F/°C** → move to Units & formats (above). The bars lose those controls.
- **Sysmon "Every 1s/2s/3s/5s"** → **Fold**. The select is *inert*: the feed polls at a hard-coded 2 s. Remove it.
- **Uptime refresh, GitHub refresh** selects → **Fold**. Poll intervals are not a user decision; pick good defaults.
- **Fantasy "Advanced — ticker items"** (six toggles that pick what the ticker shows) → **Fold**. This contradicts the locked rule that nothing on the ticker is user-selected (`docs/CHIP_SPEC.md` §8). Keep the single "What shows on the ticker: Essential / Standard / Everything" mode, delete the six toggles and the eight dead venue prefs behind them.
- **RSS Show N, time window, Finance sort, Sports favourite team and time window** → **Keep**. These are feed-page reading controls, exactly where the feed-versus-ticker philosophy says they belong.

## 10. Dead weight to delete (developer-facing, zero user impact)

- `taskbar.*` pref block (five fields, `TASKBAR_HEIGHTS`): migrated, defaulted, reset, never read.
- `widgetDisplay.fantasy.{showStandings, showMatchups, defaultSort}` and the eight venue prefs with no control.
- `widgetDisplay.rss.articlesPerSource`: read and even described in the feed, never written.
- Per-widget `ticker.excluded*` and clock/timer ticker fields: force-reset to defaults on every load since July, so they are constants wearing pref clothes.
- Legacy single-key mirrors: `scrollr:feedPinned`, `scrollr:tickerPosition`.

## 11. What is missing (beyond the three Adds above)

- **Reduce motion.** The app already passes the OS setting to Motion. The ticker *is* motion; when the OS asks for reduced motion, default to Page mode. No new setting, one behaviour.
- **Notifications.** Timer alerts ask for permission inside the widget. Fine for now; if a second widget ever notifies, this becomes an app-level row.
- **Custom shortcuts.** "Not available yet" is honest. Leave it.
- **Friendly monitor names** (the actual model, from EDID) are a nicer version of the Display N label. Medium effort in Rust; the numbered label is the cheap 90 %.

## 12. Work plan

Each of these is one task session. They are independent except where noted.

1. **REL-203** — Monitors map: physical rects, Display N labels, Identify, click-to-toggle. (Filed.)
2. **Ticker page rebuild** — the new order and groups; Show the ticker row; Monitors and Always-on-top and Hide-on-fullscreen move in; Size, Speed, Time per page become presets; On hover becomes one row; Spacing and Direction removed; Scroll mode reduced to two; reset button fixed. Depends on 1 for the map component.
3. **Appearance + Units & formats** — theme swatch grid; App size snap; Readability group; Units row pair; Clock/Weather/Sysmon read the shared units; ad-hoc keys migrate into prefs.
4. **Startup page + folds** — page rename; auto-check-updates folded; Start in the background added; Sysmon/Uptime/GitHub interval selects removed.
5. **Copy and consistency** — search index generated from rendered rows; label/value migration (`comfort`→`detailed` etc.); right-click "Customize Ticker" target; tray wording and third Always-on-top removed; export/reset copy and reset scope; email confirm; Updates label.
6. **Fantasy ticker toggles removed** and the dead prefs deleted (section 10).
7. **Crash-report switch** wired to Sentry init in both windows.

Then the 1.6.0 cut carries monitor management *and* a settings page that a first-time user can read top to bottom.
