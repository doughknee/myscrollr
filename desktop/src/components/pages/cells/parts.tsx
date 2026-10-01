/**
 * Shared pieces of the page cells (SCROLLR-271, design SCROLLR-268).
 *
 * A page has no chip shells: cells sit straight on the bar in equal
 * columns. The widget's colour reaches a cell through ONE CSS variable,
 * `--accent`, set by whoever lays the page out (the engine, 3/8). Cells
 * only ever read it through `mix()`, so the colour is a
 * single decision made outside them (`accentFor`).
 */
import type { CSSProperties } from "react";
import { liftForTint } from "../../../utils/chipAccent";
import TeamLogo from "../../TeamLogo";

/**
 * The colour a widget's page is painted in, for the `--accent` variable.
 *
 * The league's or feed's own colour, lifted on dark so a navy brand
 * shows (CHIP_SPEC §7.2), raw on light; grey when there is none. Red,
 * green and amber stay semantic: they are never the accent.
 */
export function accentFor(hex: string | undefined, dark: boolean): string {
  if (!hex) return "var(--color-fg-3)";
  return dark ? liftForTint(hex) : hex;
}

/** `--accent` at `pct`% over whatever is behind it. Inline style, not a class. */
export function mix(pct: number): string {
  return `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;
}

/** Sets `--accent` on an element; spread into its `style`. */
export function accentStyle(accent: string): CSSProperties {
  return { "--accent": accent } as CSSProperties;
}

/**
 * The hairline between columns, and between a game and its clock. Inset
 * 9px top and bottom so it reads as a divider, not a cage. Its parent must
 * be `relative`.
 */
export function Rule() {
  return <span aria-hidden className="absolute bottom-[9px] left-0 top-[9px] w-px" style={{ background: mix(28) }} />;
}

/**
 * A crest that always holds its box. TeamLogo renders nothing when the image
 * is missing or fails, which would pull the name sideways; the box keeps the
 * name where it was.
 */
export function Crest({ src, alt, size }: { src: string; alt: string; size: "md" | "lg" }) {
  return (
    <span className={size === "lg" ? "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center" : "inline-flex h-4 w-4 shrink-0 items-center justify-center"}>
      <TeamLogo src={src} alt={alt} size={size} />
    </span>
  );
}
