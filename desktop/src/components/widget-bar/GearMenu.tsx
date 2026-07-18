/**
 * Gear popover — the proportionate settings surface. Full-bar widgets put
 * it in the bar's right cluster; utility widgets float it top-right.
 * Contents are per-widget JSX rows (the existing SettingsControls
 * primitives) — no settings-schema abstraction.
 */
import { useCallback, useRef, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence } from "motion/react";
import { Settings } from "lucide-react";
import { MenuPanel, useDismiss } from "./Menu";

export function GearMenu({
  ariaLabel = "Widget settings",
  panelClassName = "right-0 w-64",
  children,
}: {
  ariaLabel?: string;
  /** Panel anchor/size classes (MenuPanel is absolute to this wrapper). */
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  return (
    // rounded-lg on the wrapper feeds the global focus rule's
    // `border-radius: inherit`.
    <div ref={rootRef} className="relative shrink-0 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className={clsx(
          "flex h-7 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors",
          open
            ? "border-accent/40 bg-accent/15 text-accent"
            : "border-edge/30 bg-base-150/60 text-fg-3 hover:text-fg-2",
        )}
      >
        <Settings size={13} />
      </button>
      <AnimatePresence>
        {open && <MenuPanel className={panelClassName}>{children}</MenuPanel>}
      </AnimatePresence>
    </div>
  );
}
