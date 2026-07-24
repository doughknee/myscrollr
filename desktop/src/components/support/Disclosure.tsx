import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";

/**
 * Disclosure — controlled accordion row shared by the support
 * sections: header button with a rotating chevron, max-height/opacity
 * reveal. Headers, containers, and expand policy stay at call sites.
 */
export default function Disclosure({
  open,
  onToggle,
  header,
  className,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** Header content rendered inside the toggle button, before the chevron. */
  header: ReactNode;
  /** Extra classes on the header button (e.g. "justify-between"). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={clsx(
          "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-base-150/50 cursor-pointer",
          className,
        )}
      >
        {header}
        <ChevronDown
          size={16}
          className={clsx(
            "shrink-0 text-fg-3 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        className={clsx(
          "overflow-hidden transition-all duration-200",
          open ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        {children}
      </div>
    </>
  );
}
