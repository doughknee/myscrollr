# Hero screenshots

This document covers how to capture, optimize, and ship product screenshots
for the marketing site's hero showcase (`HeroProductShowcase.tsx`).

The hero rotates through four channels (sports, finance, news, fantasy) in
both light and dark themes — eight raw captures total. The captures are
processed by `scripts/optimize-hero-screenshots.sh` into per-DPR WebP
variants that the showcase consumes via `<picture>`.

---

## Capture

### What to capture

One screenshot per channel × theme:

| File path                                   | Channel | Theme |
| ------------------------------------------- | ------- | ----- |
| `scrollr_screenshots/mac_dark_finance.png`  | finance | dark  |
| `scrollr_screenshots/mac_light_finance.png` | finance | light |
| `scrollr_screenshots/mac_dark_sports.png`   | sports  | dark  |
| `scrollr_screenshots/mac_light_sports.png`  | sports  | light |
| `scrollr_screenshots/mac_dark_news.png`     | news    | dark  |
| `scrollr_screenshots/mac_light_news.png`    | news    | light |
| `scrollr_screenshots/mac_dark_fantasy.png`  | fantasy | dark  |
| `scrollr_screenshots/mac_light_fantasy.png` | fantasy | light |

The `scrollr_screenshots/` directory is gitignored. Files live there
permanently as the source of truth; the optimize script reads from there
and writes finished assets to `myscrollr.com/public/screenshots/hero/`
which is committed.

### Capture tips

1. Set the Scrollr window to a consistent size (~1600×1000 logical pixels).
   All eight captures should be the same size.
2. Don't full-screen the app. The window's rounded corners and title bar
   are part of what signals "this is a desktop product."
3. Capture **only the window**, not the desktop background:
   - macOS: `Cmd+Shift+4` then press Space, hover the Scrollr window,
     click. Output will include a transparent margin and the system
     drop shadow.
   - Windows: Snipping Tool → "Window" mode (`Win+Shift+S`).
   - Linux: `gnome-screenshot --window` or your DE's equivalent.
4. The captured PNG may have a uniform black margin. That is fine.
   The optimize script auto-trims it.
5. Wait for real data to populate in the feed before capturing. Avoid
   loading skeletons, empty states, or partially-loaded UI.
6. Move your cursor off-window and dismiss any open menus / tooltips.
7. Don't capture PII. Yahoo Fantasy team names that contain real-world
   friend names are okay if they're yours; otherwise switch to a
   different league before capturing.
8. Switch the in-app theme between dark and light captures, but keep
   the window position / size locked.

---

## Optimize

```sh
./scripts/optimize-hero-screenshots.sh
```

The script:

1. Reads raw PNGs from `scrollr_screenshots/`
2. Auto-trims the uniform black margin via ImageMagick (`-fuzz 5%`,
   `-trim`)
3. Generates two WebP variants per capture (1× at 1600px wide for
   standard-DPI displays, 2× at 3200px wide for Retina)
4. Writes outputs to `myscrollr.com/public/screenshots/hero/` named
   `<channel>-<theme>@{1x|2x}.webp`
5. Prints byte sizes plus a per-visitor cumulative download estimate
6. Skips files that have not changed since the last run

### Requirements

- ImageMagick 7+ (`brew install imagemagick`)
- libwebp (`brew install webp`)

The script is bash-3.2-compatible (works with the system bash that
ships on macOS).

### Adjusting quality or sizes

Open the script and edit:

- `WIDTH_1X` / `WIDTH_2X` — display dimensions (don't lower 1× below
  the largest hero render width, currently 780px on 2xl)
- `QUALITY` — WebP quality (1-100). 82 is visually lossless for app
  screenshots. Drop to 70-75 if a future capture has a lot of detail
  (e.g. dense news feed) and the per-visitor budget exceeds 1 MB.

### Per-visitor budget

The optimize script reports cumulative download size per theme and DPR.
Target: under 1 MB for the worst case (2× retina light theme), since
that covers the full hero rotation.

Current state (2026-04-28): worst case is ~630 KB. Comfortably under.

---

## Render

The `HeroProductShowcase` component reads the active theme from
`useTheme()` and serves the matching WebP variant via `<picture>`.

- Source order: 2× source first, 1× source second. Browsers pick based
  on `devicePixelRatio`.
- Dark/light is selected by appending the theme class to the asset
  basename (e.g. `finance-dark@1x.webp`).
- Channel order in the rotation matches the `WORDS` array in
  `Typewriter.tsx`: sports, finance, news, fantasy. If the order changes
  in `WORDS`, update the `CHANNELS` constant in `HeroProductShowcase.tsx`
  to match.

### Rounded corners

The captured app window has rounded corners. After auto-trim, small
black artifacts can remain at each corner of the bounding box. The
showcase masks these with `rounded-xl` on the rendered `<img>`. If a
future capture has a different corner radius (Tauri version change, OS
version change, etc.) and the artifacts become visible, bump the
border-radius class up one step.

---

## Adding a new channel

1. Capture two new PNGs (`mac_dark_<channel>.png`, `mac_light_<channel>.png`)
   and drop them in `scrollr_screenshots/`.
2. Add the channel to the `CHANNELS` array in
   `scripts/optimize-hero-screenshots.sh`.
3. Run the script.
4. Add the channel to the `CHANNELS` array in
   `myscrollr.com/src/components/landing/HeroProductShowcase.tsx` plus
   matching entries in `ACCENT_GLOW` and `ALT_TEXT`.
5. Coordinate with `WORDS` in `Typewriter.tsx` and the `WORD_ACCENTS`
   in `HeroSection.tsx` so the rotation matches the new channel order.
