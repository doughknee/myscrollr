/**
 * Bar search field (ex-predictions) — compact by default, expands on
 * focus. Two-stage Escape lives HERE: first Escape clears the query,
 * second blurs. Hosts pass extra key handling (roving ↑/↓ + Enter)
 * through `onKeyDown`.
 */
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Search, X } from "lucide-react";

/** "/" focuses the input from anywhere in the widget — unless the user is
 *  already typing somewhere, or a modal dialog is open. */
export function useSlashFocus(
  inputRef: React.RefObject<HTMLInputElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      // Don't steal focus out of an open modal.
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, inputRef]);
}

/** Compact-by-default search field; expands on focus (or while a query is
 *  set). Same contained shape as the Segmented control so the bar stays
 *  one family. Results filter the host's grid in place as the user types. */
export function SearchBox({
  inputRef,
  query,
  onQueryChange,
  onKeyDown,
  resultCount,
  ariaLabel = "Search",
  noun = "results",
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (next: string) => void;
  /** Extra key handling (e.g. roving selection); Escape is handled here. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Matched-item count while searching, null when search is inactive. */
  resultCount: number | null;
  ariaLabel?: string;
  /** Plural noun for the sr-only result announcement (e.g. "markets"). */
  noun?: string;
}) {
  const [focused, setFocused] = useState(false);
  const expanded = focused || query.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // First Escape clears, second blurs.
      e.preventDefault();
      if (query) onQueryChange("");
      else e.currentTarget.blur();
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <div
      className={clsx(
        "relative flex items-center rounded-lg border transition-all duration-200",
        expanded
          ? "w-40 border-accent/50 bg-surface ring-1 ring-accent/25 sm:w-64"
          : "w-24 border-edge/30 bg-base-150/60 sm:w-32",
      )}
    >
      <Search
        size={13}
        className={clsx(
          "pointer-events-none absolute left-2",
          expanded ? "text-accent" : "text-fg-4",
        )}
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search"
        aria-label={ariaLabel}
        spellCheck={false}
        autoCorrect="off"
        autoComplete="off"
        className="w-full bg-transparent py-1 pl-7 pr-6 text-ui-meta text-fg outline-none placeholder:text-fg-4"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          // Keep focus in the input across the click (mousedown blurs).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onQueryChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-1.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded text-fg-4 transition-colors hover:text-fg-2"
        >
          <X size={12} />
        </button>
      ) : (
        !focused && (
          <kbd
            aria-hidden
            className="pointer-events-none absolute right-1.5 rounded border border-edge/40 bg-base-150 px-1 font-mono text-[9px] leading-4 text-fg-4"
          >
            /
          </kbd>
        )
      )}
      {resultCount !== null && (
        <span role="status" className="sr-only">
          {resultCount === 0
            ? `No ${noun} match`
            : `${resultCount} ${noun} match`}
        </span>
      )}
    </div>
  );
}
