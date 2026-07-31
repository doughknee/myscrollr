/**
 * The settings rail: search, grouped navigation, version footer.
 *
 * This is intra-settings navigation and lives inside the content panel,
 * beside the pane — distinct from the app sidebar, which is for getting
 * *into* a surface from anywhere. The rail owns movement between the
 * seven settings pages, which is why SectionNav no longer carries them.
 */
import { forwardRef } from "react";
import { clsx } from "clsx";
import { Search } from "lucide-react";
import {
  SETTINGS_PAGE_META,
  SETTINGS_RAIL_GROUPS,
  type SettingsPage,
} from "./pages";

interface SettingsRailProps {
  /** Null while a search query is active — no rail item is current then. */
  active: SettingsPage | null;
  onSelect: (page: SettingsPage) => void;
  query: string;
  onQueryChange: (query: string) => void;
  appVersion: string;
  onWhatsNew: () => void;
}

const SettingsRail = forwardRef<HTMLInputElement, SettingsRailProps>(
  function SettingsRail(
    { active, onSelect, query, onQueryChange, appVersion, onWhatsNew },
    searchRef,
  ) {
    return (
      <div className="flex h-full w-56 shrink-0 flex-col border-r border-edge/45">
        {/* ── Search ─────────────────────────────────────────── */}
        <div className="px-3 pt-3">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-4"
              aria-hidden
            />
            <input
              ref={searchRef}
              // `search`, not `text`: suppresses the webview's saved-value
              // autofill dropdown, which otherwise covers the first rail
              // group as soon as the field has been used once.
              type="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              aria-label="Search settings"
              placeholder="Search settings"
              className="w-full rounded-lg border border-edge/55 bg-surface-raised py-1.5 pr-9 pl-7 text-ui-meta text-fg placeholder:text-fg-4 focus:border-accent/50 focus:outline-none"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded bg-base-250/60 px-1.5 py-0.5 font-mono text-ui-chip text-fg-4">
              ⌘F
            </kbd>
          </div>
        </div>

        {/* ── Groups ─────────────────────────────────────────── */}
        <nav
          aria-label="Settings sections"
          className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-3 pt-4 pb-3"
        >
          {SETTINGS_RAIL_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              {/* Not a heading element: the rail precedes the pane in
                  the DOM, so an <h2> here would sit above the page's own
                  <h1> and invert the document outline. It labels its
                  list instead. */}
              <div
                id={`rail-group-${group.label}`}
                className="mb-1 px-2.5 font-mono text-ui-section text-fg-4"
              >
                {group.label}
              </div>
              <ul aria-labelledby={`rail-group-${group.label}`}>
                {group.pages.map((page) => {
                  const meta = SETTINGS_PAGE_META[page];
                  const Icon = meta.icon;
                  const isActive = active === page;
                  return (
                    <li key={page}>
                      <button
                        type="button"
                        onClick={() => onSelect(page)}
                        aria-current={isActive ? "page" : undefined}
                        className={clsx(
                          "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-body",
                          isActive
                            ? "bg-accent/12 font-semibold text-fg"
                            : "font-medium text-fg-3 hover:bg-surface-hover",
                        )}
                      >
                        <Icon
                          size={14}
                          className={clsx(
                            "shrink-0",
                            isActive ? "text-accent" : "text-fg-4",
                          )}
                          aria-hidden
                        />
                        <span className="truncate">{meta.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="shrink-0 px-5 py-3 text-ui-chip text-fg-4">
          Scrollr v{appVersion || "—"} ·{" "}
          <button
            type="button"
            onClick={onWhatsNew}
            className="cursor-pointer underline underline-offset-2 hover:text-fg-3"
          >
            What's new
          </button>
        </div>
      </div>
    );
  },
);

export default SettingsRail;
