/**
 * Wraps the ONE chip that just scored and makes it react.
 *
 * This started life inside `Stage`, which was fine while every comp
 * held a single chip and wrong the moment `TickerRail` arrived: the
 * wash, the ring and the impact scale applied to the whole bar, so
 * three leagues lit up when one of them scored. That reads as a global
 * alert rather than a league scoring, which is the opposite of the
 * point — the other leagues carrying on unbothered is exactly what
 * makes the reacting one feel live.
 *
 * So the reaction belongs to a chip, not to a stage.
 */
import type { ReactNode } from "react";

export function Reactor({
  children,
  impact = 0,
  flash = 0,
  flare = 0,
}: {
  children: ReactNode;
  /** Envelope from `scoring.impact()`, roughly -0.3..1. */
  impact?: number;
  /** 0..1 wash on a scoring play. */
  flash?: number;
  /** 0..1 ring marking a lead change. */
  flare?: number;
}) {
  const quiet = impact === 0 && flash === 0 && flare === 0;

  return (
    <div
      style={{
        // `inline-flex`, not `block`: the wrapper has to shrink to the
        // chip so the overlay below covers the chip and not a
        // full-width band of empty rail.
        display: "inline-flex",
        position: "relative",
        // Scale from the centre so a reacting chip grows into its
        // neighbours symmetrically instead of shoving the rail one way.
        transform: quiet ? undefined : `scale(${1 + impact * 0.09})`,
        transformOrigin: "center center",
      }}
    >
      {children}
      {(flash > 0 || flare > 0) && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            // Matches chipBaseClasses' `rounded-sm`. Hardcoded because
            // the chip is a sibling, not a parent, so `inherit` would
            // pick up this wrapper's radius rather than the chip's.
            borderRadius: 2,
            pointerEvents: "none",
            backgroundColor: `color-mix(in srgb, var(--color-up) ${(
              flash * 20
            ).toFixed(1)}%, transparent)`,
            boxShadow:
              flare > 0
                ? `0 0 0 ${(flare * 2).toFixed(2)}px color-mix(in srgb, var(--color-up) ${(
                    flare * 70
                  ).toFixed(0)}%, transparent), 0 0 ${(flare * 26).toFixed(
                    0,
                  )}px color-mix(in srgb, var(--color-up) ${(flare * 45).toFixed(
                    0,
                  )}%, transparent)`
                : undefined,
          }}
        />
      )}
    </div>
  );
}
