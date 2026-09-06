/**
 * The settings search index — generated from the row copy in rows.ts,
 * so a search result always shows the words the page shows.
 *
 * Rows that come and go with preference state (Time per page only in
 * Page mode, Hide when fullscreen only on Windows) stay in the index:
 * a search that could only find the settings you had already configured
 * your way into would be worse than useless. Rows that only exist with
 * or without an account are the exception — `when` filters them, so a
 * signed-out user searching "email" is not sent to a sign-in card.
 */
import type { SettingsPage } from "./pages";
import { SETTINGS_ROWS, type RowCopy } from "./rows";

export interface SettingsSearchEntry extends RowCopy {
  page: SettingsPage;
  /** Matches the row's `data-row` attribute, for the jump-flash. */
  rowId: string;
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = (
  Object.keys(SETTINGS_ROWS) as SettingsPage[]
).flatMap((page) =>
  Object.entries<RowCopy>(SETTINGS_ROWS[page]).map(([rowId, copy]) => ({
    page,
    rowId,
    ...copy,
  })),
);

/** Case-insensitive substring match over label + description + keywords. */
export function searchSettings(
  query: string,
  authenticated: boolean,
): SettingsSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const state = authenticated ? "signedIn" : "signedOut";
  return SETTINGS_SEARCH_INDEX.filter(
    (e) =>
      (!e.when || e.when === state) &&
      `${e.label} ${e.description} ${e.keywords ?? ""}`
        .toLowerCase()
        .includes(q),
  );
}

/**
 * Briefly tint a row so the eye lands on it after a search jump.
 *
 * Uses the Web Animations API rather than an inline `style.animation`:
 * the animation cleans itself up, repeat jumps to the same row restart
 * rather than no-op, and honouring prefers-reduced-motion is a single
 * early return. Scrolls the row into view either way — the scroll is
 * the functional half, the flash is only decoration.
 */
// `~=` because one element can be the target of several ids
// (`data-row="signedIn plan"` on the identity card).
export function flashRow(rowId: string): void {
  const el = document.querySelector<HTMLElement>(`[data-row~="${rowId}"]`);
  if (!el) return;

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({
    block: "center",
    behavior: reduced ? "auto" : "smooth",
  });

  // Move focus to the row as well as the eye. Following a result used to
  // leave focus on the results list that had just been replaced, which
  // drops a keyboard user back at the top of the document — the flash
  // told sighted users where they landed and nobody else. Prefer the
  // row's own control so the next Tab continues from the right place.
  const target =
    el.querySelector<HTMLElement>(
      'button, input, [role="switch"], [role="radiogroup"]',
    ) ?? el;
  if (target === el && !el.hasAttribute("tabindex")) el.tabIndex = -1;
  target.focus({ preventScroll: true });

  if (reduced) return;

  el.animate(
    [
      { backgroundColor: "rgb(from var(--color-accent) r g b / 0.18)" },
      { backgroundColor: "rgb(from var(--color-accent) r g b / 0)" },
    ],
    { duration: 1600, easing: "ease-out" },
  );
}
