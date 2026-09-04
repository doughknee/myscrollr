/**
 * Popover-menu primitives for widget bars — one look + one entrance for
 * every bar menu (extracted from the predictions FeedTab, v1.1.6).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { controlTransition, popoverMotion } from "../../lib/motion";

/**
 * The bar's control pill.
 *
 * Every control in a widget bar is this shape -- rounded-full, one border
 * weight, quiet until it is doing something and accented once it is. It
 * lives here rather than inside MenuTrigger because not every control is a
 * menu: the news bar's article limit is a text field wearing the same pill,
 * and it looked like a foreign object while it drew its own box.
 */
export function barPillClasses(lit?: boolean): string {
  return clsx(
    "flex cursor-pointer items-center gap-1 rounded-full border py-1 pl-2.5 pr-2 text-ui-meta font-medium",
    lit
      ? "border-accent/40 bg-accent/15 text-accent"
      : "border-edge/30 bg-base-150/60 text-fg-3 hover:text-fg-2",
  );
}

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

/** Shared dropdown panel. */
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
      variants={popoverMotion}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={clsx(
        "absolute top-full z-30 mt-1 max-h-80 origin-top overflow-y-auto rounded-xl border border-edge/50 bg-surface p-1 shadow-xl scrollbar-thin",
        className,
      )}
    >
      {children}
    </motion.div>
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
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-meta hover:bg-surface-hover",
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

/** Trigger-pill popover shell shared by SelectMenu and MultiSelectMenu:
 *  open state, outside/Esc dismiss, entrance, panel alignment. `children`
 *  is a render prop so a single-select menu can close on pick.
 *
 *  rounded-full on the WRAPPER matters: the app's global focus rule draws
 *  its ring with `border-radius: inherit` (from the parent). */
export function MenuPopover({
  ariaLabel,
  active,
  align = "right",
  trigger,
  children,
}: {
  ariaLabel: string;
  /** Accent the pill beyond the open state (e.g. a non-empty selection). */
  active?: boolean;
  /** Which trigger edge the panel hangs from — use "left" for triggers in
   *  the bar's left cluster so the panel opens into the page. */
  align?: "left" | "right";
  /** Contents of the trigger pill (label, icon, prefix). */
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  return (
    <div ref={rootRef} className="relative shrink-0 rounded-full">
      <MenuTrigger
        open={open}
        active={active}
        onClick={() => setOpen((o) => !o)}
        ariaLabel={ariaLabel}
      >
        {trigger}
      </MenuTrigger>
      <AnimatePresence>
        {open && (
          <MenuPanel
            className={align === "left" ? "left-0 w-56" : "right-0 w-56"}
          >
            {children(close)}
          </MenuPanel>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Rounded trigger pill shared by SelectMenu/MultiSelectMenu: accent when
 *  open (or `active`), truncated content, rotating chevron. */
function MenuTrigger({
  open,
  active,
  onClick,
  ariaLabel,
  children,
}: {
  open: boolean;
  /** Accent the pill beyond the open state (e.g. a non-empty selection). */
  active?: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const lit = open || active;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={ariaLabel}
      className={clsx(barPillClasses(lit), "max-w-40")}
    >
      {children}
      <motion.span
        aria-hidden
        animate={{
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
        }}
        transition={controlTransition}
        className={clsx(
          "inline-flex shrink-0",
          lit ? "text-accent/70" : "text-fg-4",
        )}
      >
        <ChevronDown size={12} />
      </motion.span>
    </button>
  );
}
