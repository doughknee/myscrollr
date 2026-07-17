/**
 * Popover-menu primitives for widget bars — one look + one entrance for
 * every bar menu (extracted from the predictions FeedTab, v1.1.6).
 */
import { useEffect } from "react";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { Check, SlidersHorizontal } from "lucide-react";

/** Close an open popover on outside-mousedown or Escape. */
export function useDismiss<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}

/** Shared dropdown panel: one look + one entrance for every bar menu. */
export function MenuPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      role="menu"
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      className={clsx(
        "absolute top-full z-30 mt-1 max-h-80 origin-top overflow-y-auto rounded-xl border border-edge/50 bg-surface p-1 shadow-xl scrollbar-thin",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

export function MenuHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-4 first:pt-1">
      {children}
    </div>
  );
}

export function MenuRow({
  selected,
  onClick,
  children,
  role = "menuitemradio",
  count,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** menuitemcheckbox rows toggle (multi-select) and stay hoverable. */
  role?: "menuitemradio" | "menuitemcheckbox";
  /** Optional right-aligned count (counts live in menu rows, not chrome). */
  count?: number;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onClick}
      className={clsx(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-meta transition-colors hover:bg-surface-hover",
        selected ? "text-accent" : "text-fg-2",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && (
        <span className="shrink-0 font-mono text-ui-chip tabular-nums text-fg-4">
          {count}
        </span>
      )}
      {selected && <Check size={13} className="shrink-0" />}
    </button>
  );
}

/** Narrow-width collapse trigger: one Filter button with an active-count
 *  badge. The host owns the open state + panel; its root should NOT be
 *  position:relative — the panel then anchors to the sticky bar (the
 *  nearest positioned ancestor) and spans the widget width instead of
 *  clipping off-screen at narrow sizes. rounded-lg on the wrapper feeds
 *  the global focus rule's `border-radius: inherit`. */
export function FilterTrigger({
  open,
  badgeCount,
  onClick,
  ariaLabel = "Filters",
}: {
  open: boolean;
  badgeCount: number;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={ariaLabel}
      className={clsx(
        "relative flex h-7 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors",
        open || badgeCount > 0
          ? "border-accent/40 bg-accent/15 text-accent"
          : "border-edge/30 bg-base-150/60 text-fg-3 hover:text-fg-2",
      )}
    >
      <SlidersHorizontal size={13} />
      {badgeCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 font-mono text-[9px] font-bold leading-none text-white">
          {badgeCount}
        </span>
      )}
    </button>
  );
}
