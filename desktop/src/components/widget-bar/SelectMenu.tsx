/**
 * Single-select popover — the bar's replacement for native <select>s
 * (OS popups are unstylable/unanimatable by design). Same anatomy and
 * trigger shape as MultiSelectMenu; radio rows, closes on pick.
 */
import { useCallback, useRef, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { MenuPanel, MenuRow, useDismiss } from "./Menu";

export interface SelectOption<T extends string> {
  value: T;
  /** Usually a string; richer nodes (icon + text) render fine in both
   *  the trigger and the rows. */
  label: React.ReactNode;
}

export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  prefix,
  align = "right",
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
  /** Optional quiet label prefix on the trigger (e.g. "Sort"). */
  prefix?: string;
  /** Which trigger edge the panel hangs from — use "left" for triggers
   *  in the bar's left cluster so the panel opens into the page. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const current = options.find((o) => o.value === value);

  return (
    // rounded-full on the WRAPPER feeds the global focus rule's
    // `border-radius: inherit`.
    <div ref={rootRef} className="relative shrink-0 rounded-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className={clsx(
          "flex max-w-40 cursor-pointer items-center gap-1 rounded-full border py-1 pl-2.5 pr-2 text-ui-meta font-medium transition-colors",
          open
            ? "border-accent/40 bg-accent/15 text-accent"
            : "border-edge/30 bg-base-150/60 text-fg-3 hover:text-fg-2",
        )}
      >
        {prefix && <span className="shrink-0 text-fg-4">{prefix}</span>}
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown
          size={12}
          aria-hidden
          className={clsx(
            "shrink-0 transition-transform duration-150",
            open ? "rotate-180 text-accent/70" : "text-fg-4",
          )}
        />
      </button>
      <AnimatePresence>
        {open && (
          <MenuPanel className={align === "left" ? "left-0 w-56" : "right-0 w-56"}>
            {options.map((o) => (
              <MenuRow
                key={o.value}
                selected={o.value === value}
                role="menuitemradio"
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                {o.label}
              </MenuRow>
            ))}
          </MenuPanel>
        )}
      </AnimatePresence>
    </div>
  );
}
