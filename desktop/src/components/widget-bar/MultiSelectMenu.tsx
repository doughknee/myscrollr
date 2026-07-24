/**
 * Multi-select filter popover (ex-predictions CategoryMenu) — empty
 * selection means "all". Toggling keeps the menu open so several options
 * combine in one visit; outside-click or Esc dismisses. Replaces native
 * <select>s, whose OS-drawn popup is unstylable and unanimatable.
 */
import { useCallback, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { MenuPanel, MenuRow, MenuTrigger, useDismiss } from "./Menu";

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
      <MenuTrigger
        open={open}
        active={selected.length > 0}
        onClick={() => setOpen((o) => !o)}
        ariaLabel={ariaLabel ?? `Filter by ${noun}`}
      >
        <span className="truncate">{label}</span>
      </MenuTrigger>
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
