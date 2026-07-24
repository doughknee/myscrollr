/**
 * Single-select popover — the bar's replacement for native <select>s
 * (OS popups are unstylable/unanimatable by design). Same anatomy and
 * trigger shape as MultiSelectMenu; radio rows, closes on pick.
 */
import { type LucideIcon } from "lucide-react";
import { MenuPopover, MenuRow } from "./Menu";

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
  icon: Icon,
  align = "right",
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
  /** Optional quiet label prefix on the trigger (e.g. "Sort"). */
  prefix?: string;
  /** Optional quiet icon before the value — a glyph in place of (or
   *  alongside) the text prefix, e.g. CalendarRange for time windows. */
  icon?: LucideIcon;
  /** Which trigger edge the panel hangs from — use "left" for triggers
   *  in the bar's left cluster so the panel opens into the page. */
  align?: "left" | "right";
}) {
  const current = options.find((o) => o.value === value);

  return (
    <MenuPopover
      ariaLabel={ariaLabel}
      align={align}
      trigger={
        <>
          {Icon && <Icon size={12} aria-hidden className="shrink-0 text-fg-4" />}
          {prefix && <span className="shrink-0 text-fg-4">{prefix}</span>}
          <span className="truncate">{current?.label ?? value}</span>
        </>
      }
    >
      {(close) =>
        options.map((o) => (
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
        ))
      }
    </MenuPopover>
  );
}
