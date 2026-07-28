/**
 * The ONE feed-card recipe — every widget's feed items share this shell
 * so the app reads as a single design (REL-43 unification; derived from
 * CatalogCard's resting tint, which is why cards are visible WITHOUT
 * hover: bg-base-150 separates them from the bg-surface panel, where
 * the old bg-surface-on-bg-surface cards blended together).
 *
 * Compose with clsx: `clsx(FEED_CARD, FEED_CARD_INTERACTIVE, …extras)`.
 * Widget-specific accents layer on top — they don't replace the shell.
 */

/** Resting shell: tinted surface + hairline border, dense padding. */
export const FEED_CARD =
  "rounded-lg border border-edge/40 bg-base-150/40 p-3";

/** Hover/press affordances for clickable cards. */
export const FEED_CARD_INTERACTIVE =
  "cursor-pointer hover:border-edge/70 hover:bg-base-150/60 hover:shadow-soft-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

/** Static variant for non-clickable rows (status readouts, summaries). */
export const FEED_CARD_STATIC = "";
