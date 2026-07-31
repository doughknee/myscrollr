/**
 * Shortcuts — read-only.
 *
 * SHORTCUTS is the single source of truth for what this page lists; the
 * handlers themselves are registered in __root.tsx (and, for search, in
 * the settings surface). Adding a binding means touching both.
 */
import { CARD_SURFACE, RowList } from "../SettingsControls";
import { Row } from "./Row";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘/Ctrl", ","], label: "Open Settings" },
  { keys: ["⌘/Ctrl", "F"], label: "Search settings" },
  { keys: ["⌘/Ctrl", "T"], label: "Toggle ticker visibility" },
  { keys: ["⌘/Ctrl", "Shift", "T"], label: "Cycle theme (light → dark → auto)" },
  { keys: ["Esc"], label: "Back / close current view" },
];

export default function ShortcutsPage() {
  return (
    <div data-row="shortcuts">
      <div className={CARD_SURFACE + " overflow-hidden"}>
        <RowList>
          {SHORTCUTS.map(({ keys, label }) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="text-ui-body font-medium text-fg">{label}</span>
              <div className="flex shrink-0 items-center gap-1">
                {keys.map((k, i) => (
                  <span key={k} className="flex items-center gap-1">
                    {i > 0 && <span className="text-ui-chip text-fg-4">+</span>}
                    <kbd className="rounded border border-edge/40 bg-base-250 px-[7px] py-[3px] font-mono text-ui-chip font-medium text-fg-2 shadow-sm">
                      {k}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </RowList>
      </div>
      <p className="mt-3 px-1 text-ui-meta text-fg-4">
        Custom shortcuts aren't available yet.
      </p>
    </div>
  );
}

export { SHORTCUTS };
