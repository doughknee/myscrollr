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
   *   `support/getting-started`       -> public/screenshots/support/getting-started-*
   */
  basename: string
  /** Required alt text. Describe what the screenshot shows, not its purpose. */
  alt: string
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
  /**
   * `sizes` attribute hint for the browser so it can pick the right
   * rendition from the width-descriptor `srcset`. Defaults to a
   * conservative pattern that matches the hero/channel-card layout
   * (full-width on phones, ~half-width on tablets, ~800px on desktop).
   * Override for layouts that diverge significantly — e.g. the theme
   * gallery tiles render at ~330 CSS px regardless of viewport, so a
   * narrower `sizes` lets the browser pick `@sm` on non-retina desktop.
   */
  sizes?: string
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
 * components when they need movement.
 *
 * The theme comes from the site theme via `useTheme()`.
 *
 * SSR safety: `useTheme()` returns `'dark'` during server rendering, so
 * the prerendered HTML always references the dark variant. On hydration,
 * if the user is on light, the `<picture>` swaps to the light variant
 * without layout shift (same aspect ratio).
 */
// Width-descriptor srcset enumerating all four renditions emitted by
// `scripts/optimize-screenshots.mjs` for dashboard screenshots. The
// browser pairs this with the `sizes` hint and the device pixel ratio
// to pick the smallest file that still meets the displayed dimensions.
// Phones at ~388 CSS px land on `@sm` (≈30 KB) instead of `@2x`
// (≈120 KB), which was the dominant LCP regression Lighthouse flagged
// on mobile.
//
// The legacy `@1x` and `@2x` files remain in the srcset so retina
// desktops and large tablets keep getting the high-density renditions
// they had before. They also remain on disk so any consumer that
// hardcodes those URLs (OG image script, the hero's prefetch hints)
// keeps working unchanged.
const buildWidthSrcSet = (base: string) =>
  `${base}@sm.webp 800w, ${base}@md.webp 1200w, ${base}@1x.webp 1600w, ${base}@2x.webp 3200w`

// Default `sizes` hint. Calibrated to the hero/channel-card layout:
// full viewport width on phones, ~half on tablets, fixed-ish on desktop.
// Overshooting `sizes` is safe (browser picks a larger file than needed);
// undershooting hurts quality (browser picks too small). This default
// favours quality at the slight cost of a few KB on the largest hero
// breakpoints — the LCP win on mobile dwarfs the difference.
const DEFAULT_SIZES =
  '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 800px'

export function ProductScreenshot({
  basename,
  alt,
  aspect = DEFAULT_ASPECT,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  priority = false,
  sizes = DEFAULT_SIZES,
  pictureClassName,
  imgClassName,
  style,
  draggable = false,
}: ProductScreenshotProps) {
  const { theme: siteTheme } = useTheme()
  const base = `/screenshots/${basename}-${siteTheme}`

  const srcSet = buildWidthSrcSet(base)

  return (
    <picture
      className={pictureClassName}
      style={{
        aspectRatio: aspect,
        display: 'block',
        ...style,
      }}
    >
      <source srcSet={srcSet} sizes={sizes} type="image/webp" />
      <img
        src={`${base}@1x.webp`}
        srcSet={srcSet}
        sizes={sizes}
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
