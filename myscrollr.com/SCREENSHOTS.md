# Product screenshots

This document covers how product screenshots are captured, optimized, and
consumed by the marketing site.

The site uses a **single pipeline** for every screenshot — hero, customization,
channels, support, themes — driven by `scripts/optimize-screenshots.mjs` and
rendered through the shared `<ProductScreenshot>` component.

---

## Source of truth

Raw, full-resolution PNGs live at the **repo root** under `ss/cropped/`:

```
ss/cropped/
  darkmode/       dark-<slug>.png            ← every dark-mode capture
  lightmode/      light-<slug>.png           ← every light-mode capture
  themes/dark/    theme-<name>-dark-settings.png
  themes/light/   theme-<name>-light-settings.png
```

All sources are **2478×1478** (aspect ≈ `1600 / 954`, i.e. 1.677). Keep this
size locked when adding new captures so the optimize script and the
`<ProductScreenshot>` aspect-ratio defaults stay aligned.

`ss/cropped/` is committed so screenshots regenerate deterministically on CI.

---

## Capture

### Conventions

- One screenshot per slug × theme (dark + light). Theme-named accent palettes
  (Catppuccin, Dracula, etc.) are captured only for the **settings panel**
  since that's the canonical "theme preview" surface.
- Resolution: capture at the same display zoom level every time. macOS
  `Cmd+Shift+4` → Space → click the Scrollr window works well.
- Don't full-screen — the window's rounded corners and title bar are part of
  the "this is a desktop product" signal.
- Wait for real data to populate before capturing; avoid loading skeletons,
  empty states, partially-loaded UI.
- Move the cursor off-window, dismiss menus/tooltips.
- Don't capture PII. If the in-app data shows friend names or private league
  titles, switch to a different league or scrub before committing.
- Crop to exactly 2478×1478. If your tool produces a different output, batch
  through ImageMagick / sips before dropping into `ss/cropped/`.

### Adding a new screenshot

1. Capture the new dark + light PNGs.
2. Drop them in `ss/cropped/darkmode/dark-<slug>.png` and
   `ss/cropped/lightmode/light-<slug>.png`.
3. Add an entry to the `FEED_MAP` table in
   `myscrollr.com/scripts/optimize-screenshots.mjs`, picking a category
   (`channels`, `widgets`, `configure`, `display`, `overview`, `support`)
   and a basename:

   ```js
   { slug: 'my-new-feature', category: 'overview', basename: 'my-feature' }
   ```

4. Run `npm run optimize:screenshots`.
5. Reference it from a component as
   `<ProductScreenshot basename="overview/my-feature" alt="…" />`.

For single-theme captures (only dark or only light), use the
`SINGLE_THEME_MAP` table instead.

For new accent themes, add the slug to the `THEME_NAMES` array; the optimize
script handles the `themes/dark/` and `themes/light/` source folders.

---

## Optimize

```sh
npm run optimize:screenshots          # incremental
npm run optimize:screenshots -- --force   # full rebuild
```

The script (`myscrollr.com/scripts/optimize-screenshots.mjs`):

1. Verifies every source PNG declared in its mapping tables actually exists,
   failing loudly on the first missing file rather than partially writing.
2. Reads each PNG via `sharp`.
3. Emits two WebP variants per source into
   `myscrollr.com/public/screenshots/<category>/<basename>-<theme>@{1,2}x.webp`:

   | Variant | Width  | Quality | Used for                    |
   |---------|--------|---------|-----------------------------|
   | `@1x`   | 1600w  | 78      | Standard-DPI displays       |
   | `@2x`   | 3200w  | 72      | Retina / hidpi (`sharp`'s `withoutEnlargement: true` keeps it at native 2478w since the source is smaller) |

4. Skips files that already exist and are newer than the source (idempotent).
5. Runs as part of `prebuild`, so every deploy ships fresh, optimized assets.

### Requirements

- `sharp` (installed as a dev dependency in `myscrollr.com/package.json`).
  No ImageMagick / libwebp / shell prerequisites — pure Node + `sharp`'s
  bundled libvips.

---

## Render

The shared `<ProductScreenshot>` component (`src/components/ProductScreenshot.tsx`)
is the only consumer. It handles:

- **Theme resolution**: reads `useTheme()` and serves the matching variant.
  `themeOverride` forces a specific theme; `variantSuffix` forces an
  arbitrary suffix for cases like the theme switcher rendering Dracula
  regardless of the site theme.
- **`<picture>` + `srcset`**: serves 1× or 2× WebP based on
  `devicePixelRatio`.
- **Decoding hints**: `priority` flips `loading=eager` + `fetchpriority=high`
  + `decoding=sync` for above-the-fold images. Everything else lazy-loads.
- **Aspect ratio**: defaults to `1600 / 954` (matches the optimized output).
  Override only if you're rendering a non-standard crop.

Example:

```tsx
<ProductScreenshot
  basename="channels/finance"
  alt="Scrollr finance feed showing live ticker symbols."
  priority={false}
/>
```

The basename joins to `/screenshots/${basename}-${theme}@{1,2}x.webp`.

### Aspect ratio

The captured app window is **2478×1478**, optimized to **1600×954** at @1x
(same aspect, scaled down). The component renders at this exact aspect by
default. If the captured window size changes (Tauri version, OS chrome
change, multi-monitor at a different DPR), the source dimensions and the
default aspect in `<ProductScreenshot>` must move together — otherwise
`object-cover` will start cropping and `object-contain` will letterbox.

### Rounded corners

The captured app window has rounded corners. After capture, small black
artifacts can remain at each corner of the bounding box. The renderer masks
these with `rounded-xl` on the `<img>` (consumers apply this through
`imgClassName`). If a future capture has a different corner radius, bump
the radius class up one step.

---

## Where each screenshot is used

| Category        | Used in                                                |
|-----------------|--------------------------------------------------------|
| `channels/`     | `HeroProductShowcase` (home hero rotation, 4 channels) |
| `configure/`    | `CustomizationShowcase` (style card)                   |
| `overview/`     | `CustomizationShowcase` (catalog card)                 |
| `themes/`       | `MakeItYoursSection` (switcher + decorative deck)      |
| `widgets/`      | Reserved for `/channels` page (planned)                |
| `display/`      | Reserved for `/channels` configure mosaic (planned)    |
| `support/`      | Reserved for `/support` section illustrations (planned)|

Refresh the placements as new pages adopt the asset set.
