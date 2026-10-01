/**
 * Pin control for a widget page's item rows.
 *
 * The chip's hover pin icon is gone (REL-239): it sat on a moving target
 * and could only ever say "pin this widget". A widget page row already
 * names one durable subject -- a symbol, a feed, a team -- so the pin
 * belongs beside it, where the thing being pinned is unambiguous.
 *
 * Deliberately NOT the star / favourite / watchlist control next to it.
 * A star means "always on the tape, exempt from slots"; a pin means
 * "parked in the fixed zone, out of the tape". They compose, so they
 * stay two controls.
 */
import { clsx } from "clsx";
import { Pin, PinOff } from "lucide-react";

import { usePinSubject } from "../hooks/usePinSubject";
import { usePinnedSubjectEmpty } from "../hooks/usePinnedSubjectEmpty";
import { nothingToShow } from "../lib/pinMessages";

export default function PinSubjectButton({
  widget,
  subject,
  label,
  className,
}: {
  widget: string;
  subject: string;
  /** Human name for the subject, used in the tooltip and the toast. */
  label: string;
  className?: string;
}) {
  const { isPinned, refusal, toggle } = usePinSubject();
  const pinned = isPinned(widget, subject);
  // The server guarantees a row for every pinned subject, so still
  // nothing means the subject itself is empty. §8.5 keeps the zone blank
  // in that case; this is what explains the blank (SCROLLR-9).
  const empty = usePinnedSubjectEmpty(widget, subject);
  // A row whose subject is missing (a standings row with no team name)
  // gets no control rather than a dead one.
  if (!subject) return null;
  // Not disabled: a click on a full edge says why, in a toast (SCROLLR-284).
  const refused = pinned ? null : refusal(widget, subject, label);
  const Icon = pinned ? PinOff : Pin;
  const title = pinned
    ? empty
      ? `${nothingToShow(label)} — unpin from the ticker`
      : `Unpin ${label} from the ticker`
    : refused
      ? refused
      : `Pin ${label} to the ticker`;

  return (
    <button
      type="button"
      aria-label={title}
      aria-pressed={pinned}
      title={title}
      aria-disabled={refused ? true : undefined}
      onClick={(e) => {
        e.stopPropagation();
        toggle(widget, subject, label, empty);
      }}
      className={clsx(
        "rounded p-1 transition-colors",
        pinned
          ? // Pinned but empty reads as pinned-and-waiting, not as
            // broken: still the primary colour, dimmed.
            empty
            ? "text-primary/50 hover:text-primary/70"
            : "text-primary hover:text-primary/80"
          : "text-fg-4 hover:text-fg-2",
        refused && "opacity-40 cursor-not-allowed hover:text-fg-4",
        className,
      )}
    >
      <Icon size={14} />
    </button>
  );
}
