/**
 * Home's live mini-ticker.
 *
 * The bar used to carry a status sentence about the ticker. This shows
 * the ticker instead — the same chips, drifting — because "what is
 * scrolling right now" is a question a sentence answers worse than the
 * thing itself does.
 *
 * The chip sequence is rendered TWICE inside a width:max-content track
 * and the track translates -50%. At exactly half, chip N+1 sits where
 * chip 1 started, so the loop lands on the seam and there is no jump to
 * hide. Duration is fixed rather than proportional to content: a
 * constant 22s reads as a steady drift whether you have three chips or
 * thirty.
 */
import { useState } from "react";
import { Pause, Play, SlidersHorizontal } from "lucide-react";

export interface TickerChip {
  /** Widget id — chips deep-link like everything else on Home. */
  id: string;
  text: string;
  hex: string;
}

export default function HomeTicker({
  chips,
  onManage,
  onOpen,
}: {
  chips: TickerChip[];
  onManage: () => void;
  onOpen: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);

  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded bg-accent/12 px-1.5 py-0.5 font-mono text-ui-chip font-bold text-accent">
        <span data-motion="pulse" className="size-1.5 rounded-full bg-accent" />
        LIVE
      </span>

      <div
        className="relative min-w-0 flex-1 overflow-hidden"
        // Edge fade so chips arrive and leave rather than pop.
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)",
        }}
      >
        {chips.length === 0 ? (
          <span className="text-ui-meta text-fg-4">
            Nothing scrolling yet — add a widget below.
          </span>
        ) : (
          <div
            // Attribute, not an animate-* class: the app-wide
            // `#app-shell * { animation: none !important }` rule silences
            // every Tailwind animation inside the app. style.css grants
            // marquees an explicit exception keyed off this attribute,
            // and still honours prefers-reduced-motion.
            data-motion="marquee"
            data-paused={paused ? "true" : "false"}
            style={{ "--marquee-duration": "22s" } as React.CSSProperties}
            className="flex w-max gap-2"
          >
            {[...chips, ...chips].map((c, i) => (
              <button
                key={`${c.id}-${i}`}
                type="button"
                onClick={() => onOpen(c.id)}
                aria-hidden={i >= chips.length}
                tabIndex={i >= chips.length ? -1 : 0}
                className="flex h-[22px] shrink-0 cursor-pointer items-center rounded border px-2 font-mono text-ui-chip whitespace-nowrap"
                style={{
                  borderColor: `${c.hex}3d`,
                  background: `${c.hex}10`,
                }}
              >
                {c.text}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {chips.length > 0 && (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Resume ticker" : "Pause ticker"}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-4 hover:bg-surface-hover hover:text-fg-2"
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        )}
        <button
          type="button"
          onClick={onManage}
          aria-label="Manage ticker"
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-4 hover:bg-surface-hover hover:text-fg-2"
        >
          <SlidersHorizontal size={13} />
        </button>
      </div>
    </div>
  );
}
