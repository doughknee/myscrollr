import { useTheme } from '@/hooks/useTheme'

// ── Constants ────────────────────────────────────────────────────

// Source PNGs are 2478x1478 (≈1.677:1). They get resized to 1600w
// at @1x, which preserves the ratio at 1600x954. These constants
// are exposed as defaults so consumers don't have to repeat them,
// and so the declared aspect-ratio always matches the actual image
// (a mismatch causes `object-cover` to crop and `object-contain` to
// letterbox, both of which are wrong here).
const DEFAULT_WIDTH = 1600
const DEFAULT_HEIGHT = 954
const DEFAULT_ASPECT = '1600 / 954'

// ── Types ────────────────────────────────────────────────────────

export interface ProductScreenshotProps {
  /**
   * Path prefix under `/screenshots/`. Combined with the resolved theme
   * (`dark` | `light`) to form the final srcset:
   *
   *   `/screenshots/${basename}-${theme}@1x.webp`
   *   `/screenshots/${basename}-${theme}@2x.webp`
   *
   * Examples:
   *   `channels/finance`              -> public/screenshots/channels/finance-*
   *   `themes/dracula`                -> public/screenshots/themes/dracula-*
   *   `support/getting-started`       -> public/screenshots/support/getting-started-*
   */
  basename: string
  /** Required alt text. Describe what the screenshot shows, not its purpose. */
  alt: string
  /**
   * Override the theme. When omitted the component reads the site theme
   * via `useTheme()`. Useful inside the theme gallery, where each tile
   * forces its own theme regardless of the site setting.
   */
  themeOverride?: 'light' | 'dark'
  /**
   * Force a specific theme suffix that isn't `light`/`dark`. Used by the
   * theme switcher to render a named accent theme:
   *
   *   variantSuffix="dracula-dark"  ->  `/screenshots/themes/dracula-dark@*.webp`
   *
   * When set, `themeOverride` and the resolved site theme are ignored.
   */
  variantSuffix?: string
  /** Aspect ratio as `w / h`. Defaults to `1600 / 1134`. */
  aspect?: string
  /** Intrinsic image width attribute. Defaults to 1600. */
  width?: number
  /** Intrinsic image height attribute. Defaults to 1134. */
  height?: number
  /**
   * Marks this image as above-the-fold. Sets `loading=eager`,
   * `fetchpriority=high`, and skips the `lazy`/`async` decode hint.
   * Off by default; turn on only for hero or first-paint images.
   */
  priority?: boolean
  /** Extra classes for the outer `<picture>`. */
  pictureClassName?: string
  /** Extra classes for the inner `<img>`. */
  imgClassName?: string
  /** Inline styles applied to the outer `<picture>`. */
  style?: React.CSSProperties
  /** Draggable flag for the `<img>`. Defaults to `false`. */
  draggable?: boolean
}

// ── Component ────────────────────────────────────────────────────

/**
 * Renders an optimized product screenshot from `/public/screenshots/`
 * with 1x/2x WebP sources, light/dark theming, and SSR-safe defaults.
 *
 * The component is intentionally thin: it does not animate, fade,
 * crossfade, or coordinate with siblings. Consumers wrap it in motion
 * components when they need movement (see HeroProductShowcase /
 * MakeItYoursSection for the crossfade pattern).
 *
 * Theme resolution order:
 *   1. `variantSuffix` (explicit, wins)
 *   2. `themeOverride` (forces light/dark)
 *   3. Site theme via `useTheme()`
 *
 * SSR safety: `useTheme()` returns `'dark'` during server rendering, so
 * the prerendered HTML always references the dark variant. On hydration,
 * if the user is on light, the `<picture>` swaps to the light variant
 * without layout shift (same aspect ratio).
 */
export function ProductScreenshot({
  basename,
  alt,
  themeOverride,
  variantSuffix,
  aspect = DEFAULT_ASPECT,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  priority = false,
  pictureClassName,
  imgClassName,
  style,
  draggable = false,
}: ProductScreenshotProps) {
  const { theme: siteTheme } = useTheme()
  const suffix = variantSuffix ?? themeOverride ?? siteTheme
  const base = `/screenshots/${basename}-${suffix}`

  return (
    <picture
      className={pictureClassName}
      style={{
        aspectRatio: aspect,
        display: 'block',
        ...style,
      }}
    >
      <source
        srcSet={`${base}@1x.webp 1x, ${base}@2x.webp 2x`}
        type="image/webp"
      />
      <img
        src={`${base}@1x.webp`}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
        className={imgClassName}
        draggable={draggable}
      />
    </picture>
  )
}
