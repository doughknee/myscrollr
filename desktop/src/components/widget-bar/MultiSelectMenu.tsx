/**
 * Multi-select filter popover (ex-predictions CategoryMenu) — empty
 * selection means "all". Toggling keeps the menu open so several options
 * combine in one visit; outside-click or Esc dismisses. Replaces native
 * <select>s, whose OS-drawn popup is unstylable and unanimatable.
 */
import { useCallback, useRef, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { MenuPanel, MenuRow, useDismiss } from "./Menu";

export function MultiSelectMenu({
  options,
  selected,
  onToggle,
  onClear,
  noun,
  ariaLabel,
  counts,
  align = "right",
}: {
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  onClear: () => void;
  /** Plural noun for the labels: "All {noun}" / "{n} {noun}". */
  noun: string;
  /** Trigger aria-label; defaults to `Filter by ${noun}`. */
  ariaLabel?: string;
  /** Optional per-option counts, right-aligned in the rows. */
  counts?: Record<string, number>;
  /** Which trigger edge the panel hangs from — use "left" for triggers
   *  in the bar's left cluster so the panel opens into the page. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const label =
    selected.length === 0
      ? "All"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} ${noun}`;

  return (
    // rounded-full on the WRAPPER matters: the app's global focus rule
    // draws its ring with `border-radius: inherit` (from the parent).
    <div ref={rootRef} className="relative shrink-0 rounded-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel ?? `Filter by ${noun}`}
        className={clsx(
          "flex max-w-40 cursor-pointer items-center gap-1 rounded-full border py-1 pl-2.5 pr-2 text-ui-meta font-medium transition-colors",
          selected.length > 0 || open
            ? "border-accent/40 bg-accent/15 text-accent"
            : "border-edge/30 bg-base-150/60 text-fg-3 hover:text-fg-2",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={12}
          aria-hidden
          className={clsx(
            "shrink-0 transition-transform duration-150",
            open && "rotate-180",
            selected.length > 0 || open ? "text-accent/70" : "text-fg-4",
          )}
        />
      </button>
      <AnimatePresence>
        {open && (
          <MenuPanel className={align === "left" ? "left-0 w-56" : "right-0 w-56"}>
            <MenuRow
              selected={selected.length === 0}
              onClick={onClear}
              role="menuitemradio"
            >
              All {noun}
            </MenuRow>
            {options.map((c) => (
              <MenuRow
                key={c}
                selected={selected.includes(c)}
                onClick={() => onToggle(c)}
                role="menuitemcheckbox"
                count={counts?.[c]}
              >
                {c}
              </MenuRow>
            ))}
          </MenuPanel>
        )}
      </AnimatePresence>
    </div>
  );
}
