/**
 * The app's dark themes, as render targets.
 *
 * `scrollr-dark` has no `[data-theme]` block of its own in the app's
 * stylesheet — it IS the `@theme` default, so the attribute matches
 * nothing and the defaults apply. That is why it is written here by
 * hand rather than scraped from the CSS: a list built by grepping for
 * `[data-theme="*-dark"]` finds nine and silently omits the house one.
 *
 * Each theme overrides the accent, up/down and surface tokens, so the
 * chips genuinely change — border, score colour, and the flash on a
 * scoring play all follow. If a theme only moved the background these
 * clips would not be worth cutting together.
 */
export const DARK_THEMES = [
  "scrollr-dark",
  "catppuccin-dark",
  "dracula-dark",
  "everforest-dark",
  "gruvbox-dark",
  "nord-dark",
  "one-dark",
  "rose-pine-dark",
  "solarized-dark",
  "tokyo-night-dark",
] as const;

export type DarkTheme = (typeof DARK_THEMES)[number];
