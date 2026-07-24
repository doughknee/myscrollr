/**
 * Multi-select filter popover (ex-predictions CategoryMenu) — empty
 * selection means "all". Toggling keeps the menu open so several options
 * combine in one visit; outside-click or Esc dismisses. Replaces native
 * <select>s, whose OS-drawn popup is unstylable and unanimatable.
 */
import { MenuPopover, MenuRow } from "./Menu";

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
  const label =
    selected.length === 0
      ? "All"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} ${noun}`;

  return (
    <MenuPopover
      ariaLabel={ariaLabel ?? `Filter by ${noun}`}
      active={selected.length > 0}
      align={align}
      trigger={<span className="truncate">{label}</span>}
    >
      {() => (
        <>
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
        </>
      )}
    </MenuPopover>
  );
}
