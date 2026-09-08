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
  const { isPinned, hasRoom, toggle } = usePinSubject();
  const pinned = isPinned(widget, subject);
  // A row whose subject is missing (a standings row with no team name)
  // gets no control rather than a dead one.
  if (!subject) return null;
  const full = !pinned && !hasRoom;
  const Icon = pinned ? PinOff : Pin;
  const title = pinned
    ? `Unpin ${label} from the ticker`
    : full
      ? "The ticker's pinned zone is full"
      : `Pin ${label} to the ticker`;

  return (
    <button
      type="button"
      aria-label={title}
      aria-pressed={pinned}
      title={title}
      disabled={full}
      onClick={(e) => {
        e.stopPropagation();
        toggle(widget, subject, label);
      }}
      className={clsx(
        "rounded p-1 transition-colors",
        pinned
          ? "text-primary hover:text-primary/80"
          : "text-fg-4 hover:text-fg-2 disabled:hover:text-fg-4",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
    >
      <Icon size={14} />
    </button>
  );
}
