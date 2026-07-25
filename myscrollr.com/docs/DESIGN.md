# Scrollr Design System

> Written 2026-02-18. Audited 2026-07-25: every color token, the type
> scale, and the component patterns still match `src/styles.css`. Two stack
> rows were corrected (TanStack Start, and where fonts are actually loaded).

Canonical design reference extracted from the homepage. Every new page, component, or feature must follow these principles. The homepage is the gold standard — when in doubt, match it.

---

## Table of Contents

1. [Stack & Tooling](#stack--tooling)
2. [Typography](#typography)
3. [Color System](#color-system)
4. [Opacity Ladder](#opacity-ladder)
5. [Shadows & Glows](#shadows--glows)
6. [Spacing & Layout](#spacing--layout)
7. [Border Radius](#border-radius)
8. [Motion & Animation](#motion--animation)
9. [Section Structure](#section-structure)
10. [Surface & Card Patterns](#surface--card-patterns)
11. [Icon Patterns](#icon-patterns)
12. [Button System](#button-system)
13. [Badge & Tag System](#badge--tag-system)
14. [Decorative Patterns](#decorative-patterns)
15. [Responsive Strategy](#responsive-strategy)
16. [Accessibility](#accessibility)
17. [Anti-Patterns](#anti-patterns)

---

## Stack & Tooling

| Layer     | Tool                                            |
| --------- | ----------------------------------------------- |
| Framework | React 19                                        |
| Bundler   | Vite 7                                          |
| Router    | TanStack Start (file-based routes, static prerender) |
| Styling   | Tailwind CSS v4                                 |
| Animation | Motion (framer-motion successor)                |
| Icons     | Lucide React                                    |
| Auth      | Logto (via `useScrollrAuth` hook)               |
| Fonts     | Self-hosted via `@font-face` in `src/styles.css` (no CDN) |

Dark mode is **class-based** (`html.dark`), toggled via `ThemeToggle` component, with smooth 300ms transitions applied through a temporary `theme-transition` class on `<html>`.

---

## Typography

### Font Stack

| Role             | Family            | Weights            | Tailwind Token   |
| ---------------- | ----------------- | ------------------ | ---------------- |
| Display / body   | Plus Jakarta Sans | 300-800 (variable) | `--font-display` |
| Monospace / code | IBM Plex Mono     | 400, 500, 600      | `--font-mono`    |

Both are self-hosted `.woff2` files with `font-display: swap` and Latin unicode-range.

### Scale

Headings use `clamp()` for fluid sizing. All headings: `font-weight: 700`, `line-height: 1.15`, `letter-spacing: -0.02em`.

| Element | Size                          |
| ------- | ----------------------------- |
| `h1`    | `clamp(2.5rem, 5vw, 4.5rem)`  |
| `h2`    | `clamp(2rem, 4vw, 3rem)`      |
| `h3`    | `clamp(1.5rem, 3vw, 2rem)`    |
| `h4`    | `clamp(1.25rem, 2vw, 1.5rem)` |
| `p`     | 16px, `line-height: 1.7`      |
| Body    | 16px, `line-height: 1.6`      |

### Homepage Heading Overrides

Section headers on the homepage use explicit Tailwind classes that override the base scale for more dramatic sizing:

```
h2: text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95]
```

This is intentional. The `clamp()` scale is the default; the homepage pushes it further with utility classes.

### Monospace Numbers

Use `.font-mono-numbers` for tabular data, counters, and stats:

```css
font-family: var(--font-mono);
font-variant-numeric: tabular-lining;
letter-spacing: -0.03em;
```

### Text Gradients

Three gradient text classes, all using `background-clip: text`:

| Class                    | Direction | Stops                        | Use Case                                   |
| ------------------------ | --------- | ---------------------------- | ------------------------------------------ |
| `.text-gradient-primary` | 135deg    | primary -> info -> secondary | Section headlines, hero text               |
| `.text-gradient-warm`    | 135deg    | primary -> secondary         | Warm emphasis                              |
| `.text-rainbow`          | 90deg     | 7-color, `200% auto` size    | Playful / celebratory (animated, 4s cycle) |

`.text-gradient-primary` includes `padding-bottom: 0.15em; margin-bottom: -0.15em` to prevent descender clipping.

---

## Color System

### Core Palette (theme-invariant)

| Token       | Hex                                  | Role                        |
| ----------- | ------------------------------------ | --------------------------- |
| `primary`   | `#34d399`                            | Brand green, Finance accent |
| `secondary` | `#ff4757`                            | Red, Sports accent          |
| `accent`    | `#a855f7`                            | Purple, Fantasy accent      |
| `info`      | `#00b8db` (light) / `#00d4ff` (dark) | Cyan, News/RSS accent       |
| `success`   | `#22c55e`                            | Positive states             |
| `warning`   | `#f59e0b` (light) / `#fbbf24` (dark) | Caution states              |
| `error`     | `#ef4444`                            | Error states                |

### 4-Color Integration Accent System

Each integration owns one accent color used consistently everywhere:

| Integration | Color Token | Hex                   |
| ----------- | ----------- | --------------------- |
| Finance     | `primary`   | `#34d399`             |
| Sports      | `secondary` | `#ff4757`             |
| News/RSS    | `info`      | `#00b8db` / `#00d4ff` |
| Fantasy     | `accent`    | `#a855f7`             |

When building UI for a specific integration, always use that integration's assigned color for backgrounds, borders, glows, and text accents.

### Base Palette

A 9-step neutral scale from near-white to near-black:

| Token          | Light     | Dark      |
| -------------- | --------- | --------- |
| `base-50`      | `#f8f8fc` | `#f8f8fc` |
| `base-100`     | `#ffffff` | `#141420` |
| `base-150`     | `#f6f7fb` | `#171726` |
| `base-200`     | `#eef0f6` | `#1c1c2a` |
| `base-250`     | `#e4e6ee` | `#21212e` |
| `base-300`     | `#d5d7e2` | `#282838` |
| `base-350`     | `#c4c6d4` | `#303040` |
| `base-400`     | `#b0b3c4` | `#383848` |
| `base-content` | `#1a1b2e` | `#e2e2ec` |

### Content Colors

| Token               | Light     | Dark      |
| ------------------- | --------- | --------- |
| `primary-content`   | `#ffffff` | `#141420` |
| `secondary-content` | `#ffffff` | `#141420` |
| `accent-content`    | `#ffffff` | `#141420` |
| `info-content`      | `#ffffff` | `#141420` |

### Ambient Body Gradients

The `body::before` pseudo-element paints two fixed radial gradients that provide a subtle environmental tint across the entire viewport:

- **Top center**: primary green, 70% wide, 50% tall, 4-5% opacity
- **Bottom right**: info cyan, 50% wide, 50% tall, 2-3% opacity

Dark mode uses slightly higher opacity for the top gradient and substitutes `#00d4ff` for cyan.

---

## Opacity Ladder

This ladder is used **everywhere** and must be followed precisely. It creates the visual depth hierarchy that defines the Scrollr aesthetic.

| Opacity       | Usage                                           |
| ------------- | ----------------------------------------------- |
| `/[0.025]`    | Watermark icons inside cards                    |
| `/[0.04]`     | Dot grids, ambient glows, decorative patterns   |
| `/5` - `/8`   | Tinted backgrounds (`bg-primary/8`)             |
| `/10` - `/15` | Resting borders (`border-primary/15`)           |
| `/20` - `/25` | Active/hover borders, focus rings               |
| `/30`         | Muted text, dividers, subtle separators         |
| `/40` - `/45` | Body text in secondary roles, section subtitles |
| `/50` - `/60` | Secondary text, labels                          |
| `/70` - `/80` | Emphasized text, icon default color             |
| `100%`        | Headlines, active elements, buttons             |

### Rules

- Never jump more than 2 tiers in a single component
- Borders are always 1-2 tiers above their fill (e.g., `bg-primary/8` + `border-primary/15`)
- Hover states increase the border 1 tier (e.g., `border-primary/15` -> `border-primary/25`)
- Text on tinted backgrounds starts at `/60` minimum for readability

---

## Shadows & Glows

### Glow System (primary-colored)

4-tier glow, used sparingly for emphasis. Dark mode is slightly more intense.

| Token     | Light                             | Dark       |
| --------- | --------------------------------- | ---------- |
| `glow-sm` | `0 0 20px rgba(52,211,153, 0.04)` | `... 0.06` |
| `glow-md` | `0 0 30px rgba(52,211,153, 0.06)` | `... 0.10` |
| `glow-lg` | `0 0 50px rgba(52,211,153, 0.08)` | `... 0.12` |
| `glow-xl` | `0 0 80px rgba(52,211,153, 0.10)` | `... 0.15` |

### Soft Shadows (neutral)

3-tier elevation system:

| Token     | Light                                                      | Dark                          |
| --------- | ---------------------------------------------------------- | ----------------------------- |
| `soft-sm` | `0 1px 3px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.06)`   | `0 2px 8px rgba(0,0,0,0.25)`  |
| `soft-md` | `0 2px 6px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.08)`  | `0 4px 16px rgba(0,0,0,0.30)` |
| `soft-lg` | `0 4px 12px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.10)` | `0 8px 32px rgba(0,0,0,0.35)` |

### Inner Glow

`inset 0 0 20px rgba(52,211,153, 0.01)` (light) / `0.02` (dark). Used on focused inputs and selected card states.

### Border Glow

For highlighted elements:

```css
border-color: var(--color-primary);
box-shadow:
  0 0 15px color-mix(in srgb, var(--color-primary) 20%, transparent),
  inset 0 0 20px color-mix(in srgb, var(--color-primary) 5%, transparent);
```

---

## Spacing & Layout

### Container System

| Class           | Max Width | Vertical Padding | Use Case                    |
| --------------- | --------- | ---------------- | --------------------------- |
| `.container`    | 1400px    | `py-16 lg:py-24` | Standard sections           |
| `.container-sm` | 800px     | `py-12 lg:py-16` | Narrow content (FAQ, forms) |
| `.container-lg` | 1600px    | `py-16 lg:py-32` | Hero, full-width showcases  |

All containers: `mx-auto px-5 sm:px-6 lg:px-8` (`.container-lg` uses `lg:px-10`).

### Section Spacing

Sections use `relative` positioning with `overflow: hidden`. Vertical spacing between sections is handled by container padding (no explicit gaps on the parent).

### Internal Spacing Patterns

| Pattern                   | Value                                                   |
| ------------------------- | ------------------------------------------------------- |
| Section header to content | `mb-4` on heading, `mb-12` to `mb-16` on subtitle group |
| Card padding              | `p-5` to `p-8` depending on card size                   |
| Card grid gaps            | `gap-4` to `gap-6`                                      |
| Icon-to-text in badges    | `gap-2`                                                 |
| Button padding            | See [Button System](#button-system)                     |

---

## Border Radius

| Token         | Value            | Use Case                     |
| ------------- | ---------------- | ---------------------------- |
| `--radius-sm` | `0.5rem` (8px)   | Small elements, badges, tags |
| `--radius-md` | `0.75rem` (12px) | Buttons, inputs              |
| `--radius-lg` | `1rem` (16px)    | Cards, modals                |

### Tailwind Class Mapping

| Tailwind       | Used For                                  |
| -------------- | ----------------------------------------- |
| `rounded-lg`   | Buttons, inputs, small cards, icon badges |
| `rounded-xl`   | Standard cards, card surfaces             |
| `rounded-2xl`  | Large cards, hero elements, modals        |
| `rounded-full` | Badges, dots, avatars, circular elements  |

---

## Motion & Animation

### Signature Easing

**All** Motion (framer-motion) animations use this easing curve:

```ts
const EASE = [0.22, 1, 0.36, 1]
```

This is a fast-attack, gentle-settle curve. It is used in every single section of the homepage. Do not use other easings for `whileInView`, `animate`, or `initial` transitions unless there is a strong reason.

### CSS Transitions

```css
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1); /* Hover states, small toggles */
--transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1); /* Standard interactions */
--transition-slow: 400ms cubic-bezier(0.4, 0, 0.2, 1); /* Cards, panels, larger elements */
```

### Spring Configs

| Use Case             | Config                            |
| -------------------- | --------------------------------- |
| Card hover / press   | `{ stiffness: 500, damping: 35 }` |
| Sliding panels (FAQ) | `{ stiffness: 400, damping: 60 }` |
| Floating elements    | `{ stiffness: 300, damping: 30 }` |
| Counter animations   | `{ stiffness: 100, damping: 30 }` |

### Scroll-Triggered Animations

Standard `whileInView` pattern used everywhere:

```tsx
<motion.div
  style={{ opacity: 0 }}           // FOUC prevention
  initial={{ opacity: 0, y: 30 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, margin: '-80px' }}
  transition={{ duration: 0.7, ease: EASE }}
>
```

Key rules:

- **Always** include `style={{ opacity: 0 }}` for FOUC prevention
- **Always** use `viewport={{ once: true }}` (animations play once, never reverse)
- Default viewport margin: `-80px` (triggers slightly before element enters)
- Default duration: `0.5` to `0.8` seconds
- Stagger children with `delay: index * 0.1` (never more than `0.15`)

### Reduced Motion

Two layers of protection:

1. `<MotionConfig reducedMotion="user">` wraps the entire app at root level
2. CSS `@media (prefers-reduced-motion: reduce)` kills all animations and transitions

### Ticker / Infinite Scroll

The `StreamsShowcase` uses a `requestAnimationFrame`-based ticker (not CSS animation) for precise control. The CSS utility `.animate-ticker-scroll` (40s linear infinite) exists as a fallback/utility.

---

## Section Structure

### Section Header Pattern

Used in **every** section (7/7). Copy this exactly:

```tsx
{
  /* Header group — always centered */
}
;<motion.div className="text-center mb-12 sm:mb-16">
  <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
    Plain text <span className="text-gradient-primary">Gradient highlight</span>
  </h2>
  <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
    Subtitle text goes here
  </p>
</motion.div>
```

Rules:

- Heading is always `font-black` (900 weight), not `font-bold`
- `leading-[0.95]` is tighter than the base heading line-height
- `tracking-tight` for that dense, modern feel
- Gradient span highlights the **key phrase**, not the whole heading
- Subtitle is `text-base`, `/45` or `/50` opacity, `max-w-lg`, centered

### Section Background Pattern

Sections alternate between transparent and subtly tinted backgrounds. Between sections, a gradient divider creates "room" transitions:

```tsx
<div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />
```

### Section Ordering

1. Hero (`.container-lg`)
2. HowItWorks (`.container`)
3. StreamsShowcase (`.container-lg` for ticker, `.container` for content)
4. Benefits (`.container`)
5. Trust (`.container`)
6. FAQ (`.container-sm`)
7. CTA (full width, no container padding)

---

## Surface & Card Patterns

### Standard Card

```tsx
<div className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-6 overflow-hidden">
  {/* Top accent line */}
  <div
    className="absolute top-0 left-0 right-0 h-px"
    style={{
      background: `linear-gradient(90deg, transparent, ${accentColor} 50%, transparent)`,
    }}
  />

  {/* Corner dot grid */}
  <div
    className="absolute top-0 right-0 w-20 h-20 opacity-[0.04] text-base-content"
    style={{
      backgroundImage:
        'radial-gradient(circle, currentColor 1px, transparent 1px)',
      backgroundSize: '8px 8px',
    }}
  />

  {/* Content */}
  {children}

  {/* Watermark icon (bottom-right) */}
  <WatermarkIcon
    size={130}
    strokeWidth={0.4}
    className="absolute -bottom-4 -right-4 text-base-content/[0.025] pointer-events-none"
  />
</div>
```

### Card Variants (from `styles.css`)

| Class               | Background    | Border        | Shadow    | Hover                          |
| ------------------- | ------------- | ------------- | --------- | ------------------------------ |
| `.card-frame`       | `base-200/60` | `base-300/60` | none      | border darkens                 |
| `.card-elevated`    | `base-200/70` | `base-300/60` | `soft-sm` | `soft-md`                      |
| `.card-interactive` | `base-200/50` | `base-300/60` | none      | `soft-sm` + `translateY(-2px)` |

All card variants include `backdrop-blur-xl` and `rounded-xl`.

### Accent Ambient Glow

Cards with integration-specific theming include an ambient gradient orb:

```tsx
<div
  className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none blur-3xl"
  style={{ background: `${accentColor}10` }} // ~6% opacity
/>
```

---

## Icon Patterns

### Icon Badge (Integration-colored)

Used whenever an icon needs a colored container:

```tsx
<div
  className="w-11 h-11 rounded-xl flex items-center justify-center"
  style={{
    background: `${color}15`, // ~8% fill
    boxShadow: `0 0 20px ${color}15, 0 0 0 1px ${color}20`, // glow + ring
  }}
>
  <IconComponent size={20} className="text-base-content/80" />
</div>
```

Note: The icon itself is **not** colored with the accent — it uses `text-base-content/80`. Only the container carries the accent color.

### Watermark Icon

Large, ultra-faint icons placed inside cards for texture:

```tsx
<Icon
  size={130}
  strokeWidth={0.4}
  className="absolute -bottom-4 -right-4 text-base-content/[0.025] pointer-events-none"
/>
```

### Live Indicator Dot

Pulsing green dot used across Header, Footer, HeroBrowserStack, StreamsShowcase, HowItWorks:

```tsx
<span className="relative flex h-1.5 w-1.5">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
</span>
```

---

## Button System

All buttons use `font-family: var(--font-display)` and `active:scale-97`.

### Variants

| Class            | Fill              | Text                   | Border                | Hover Effect                                                      |
| ---------------- | ----------------- | ---------------------- | --------------------- | ----------------------------------------------------------------- |
| `.btn-primary`   | `bg-primary`      | `text-primary-content` | `border-primary/80`   | `opacity-90` + `glow-sm` + `translateY(-1px)`                     |
| `.btn-ghost`     | transparent       | `text-base-content`    | none                  | `bg-base-200`                                                     |
| `.btn-outline`   | `bg-base-200/50`  | `text-base-content`    | `border-base-300`     | `border-primary/40` + `text-primary` + `bg-primary/5` + `glow-sm` |
| `.btn-secondary` | `bg-secondary/10` | `text-secondary`       | `border-secondary/30` | `bg-secondary/20`                                                 |
| `.btn-info`      | `bg-info/10`      | `text-info`            | `border-info/30`      | `bg-info/20`                                                      |
| `.btn-success`   | `bg-success/10`   | `text-success`         | `border-success/30`   | —                                                                 |
| `.btn-pulse`     | `bg-primary`      | `text-primary-content` | none                  | `bg-primary/90` + `40px glow` + `translateY(-2px)`                |

### Sizes

| Class            | Padding         | Font Size     |
| ---------------- | --------------- | ------------- |
| `.btn-xs`        | `px-2.5 py-1.5` | `text-[10px]` |
| `.btn-sm`        | `px-3.5 py-2`   | `text-xs`     |
| `.btn` (default) | `px-5 py-2.5`   | `text-sm`     |
| `.btn-lg`        | `px-7 py-3.5`   | `text-base`   |

### Signature CTA Button

`.btn-pulse` is the hero-level call-to-action button. It has a permanent glow (`20px` at rest, `40px` on hover) and `rounded-xl` instead of `rounded-lg`. Use it only for the most important action on a page (1 per viewport).

---

## Badge & Tag System

### Badges (`.badge`)

`rounded-full`, `px-2.5 py-0.5`, `text-xs font-semibold`, with `backdrop-blur-md`.

Each color variant follows: `bg-{color}/20 text-{color} border border-{color}/30`.

Available: `badge-primary`, `badge-secondary`, `badge-info`, `badge-success`, `badge-warning`, `badge-error`.

### Tags (`.tag`)

`rounded-lg`, `px-2.5 py-0.5`, `text-xs font-medium`, with `bg-base-300/50 border border-base-300/50`.

Color variants: `tag-primary` (`bg-primary/10 text-primary border-primary/20`), `tag-info`.

---

## Decorative Patterns

### Dot Grid

Small corner decoration on cards:

```tsx
style={{
  backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
  backgroundSize: '8px 8px',
}}
className="opacity-[0.04]"
```

### Grid Lines

```css
--grid-line-color: rgba(0, 0, 0, 0.06); /* light */
--grid-line-color: rgba(255, 255, 255, 0.3); /* dark */
```

### Accent Top Line

Horizontal gradient line at the top of cards:

```tsx
<div
  className="absolute top-0 left-0 right-0 h-px"
  style={{
    background: `linear-gradient(90deg, transparent, ${color} 50%, transparent)`,
  }}
/>
```

### Section Divider

```tsx
<div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />
```

### CSS Dividers

```
.divider — h-px, via-base-300
.divider-primary — h-px, via-primary/30
```

### Particle / Convergence Beams (CTA only)

The CTA section uses custom canvas-like SVG animations (convergence beams, floating particles, pulse rings). These are unique to the CTA and should not be replicated elsewhere — they signal "final destination" in the page flow.

---

## Responsive Strategy

### Breakpoints

Standard Tailwind: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px).

### Common Patterns

| Pattern           | Mobile             | Desktop                                          |
| ----------------- | ------------------ | ------------------------------------------------ |
| Section grids     | 1 column           | 2-3 columns (`lg:grid-cols-2`, `lg:grid-cols-3`) |
| Hero              | Stacked, centered  | Side-by-side or wider                            |
| Section headings  | `text-4xl`         | `lg:text-6xl`                                    |
| Container padding | `px-5`             | `sm:px-6 lg:px-8`                                |
| FAQ               | Accordion          | Side-by-side sliding panels                      |
| HowItWorks        | Tabbed interface   | Split layout (nav left, content right)           |
| StreamsShowcase   | Vertically stacked | Full-width ticker + grid                         |

### Hidden/Shown Patterns

- Desktop-only elements: `hidden lg:block` or `hidden lg:flex`
- Mobile-only elements: `lg:hidden`
- Never hide critical content — only hide alternative UI treatments

---

## Accessibility

### Focus States

Global `focus-visible` ring on all interactive elements:

```css
*:focus-visible {
  outline: none;
  ring: 2px solid primary/50;
  ring-offset: 2px;
  ring-offset-color: base-100;
}
```

### Skip-to-Content

Present in `__root.tsx`:

```tsx
<a href="#main-content" className="sr-only focus:not-sr-only ...">
  Skip to content
</a>
```

### ARIA

- `aria-label` on all icon-only buttons
- `aria-expanded` on collapsible FAQ items
- `aria-pressed` on toggle states
- `role="tablist"` / `role="tab"` on tabbed interfaces
- Focus management: `mainRef.focus()` on route change with `tabIndex={-1}`

### Reduced Motion

- Root-level: `<MotionConfig reducedMotion="user">`
- CSS-level: `@media (prefers-reduced-motion: reduce)` zeroes all durations

### Color Contrast

Text at `/45` opacity on `base-content` meets WCAG AA on both light and dark backgrounds. Never go below `/40` for body text.

### Selection

```css
::selection {
  background: primary/30;
  color: base-content;
}
```

---

## Anti-Patterns

Things the homepage intentionally avoids. New pages should avoid them too.

1. **No hard borders** — borders are always translucent (`/15` to `/40`), never solid `border-gray-300`
2. **No pure black or white backgrounds** — always `base-100` (which is white/near-black but named), plus ambient gradients
3. **No elevation stacking** — cards don't cast shadows onto other cards; the glow system provides depth instead
4. **No color on icons directly** — icons use `text-base-content/80`; color is carried by their container background/glow
5. **No animation replays** — all `whileInView` animations fire once (`once: true`) and never re-trigger on scroll
6. **No scroll-linked opacity** — the page doesn't fade sections in/out as you scroll past them; sections appear and stay
7. **No arbitrary z-index** — only the header, modals, and skip-link use z-index
8. **No inline font-family** — always use the token (`var(--font-display)` or `var(--font-mono)`)
9. **No gradients on large surfaces** — gradients are reserved for text, accent lines, and decorative elements; backgrounds are flat
10. **No component libraries** — every UI element is hand-built with Tailwind utilities and Motion
