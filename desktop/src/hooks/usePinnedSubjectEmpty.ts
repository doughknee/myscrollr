/**
 * Does a subject have anything to show on the bar right now?
 *
 * The (b) half of SCROLLR-9. The server now guarantees a row per pinned
 * subject, so a pinned chip that still renders nothing means the subject
 * is genuinely empty — a team between seasons, a feed that has never
 * published. CHIP_SPEC §8.5 rule 3 keeps the fixed zone blank in that
 * case (no placeholder, ever), which is honest but silent, so the pin
 * control says the sentence instead.
 *
 * The predicate is the source's own `pinnedChip` rather than a second
 * copy of the subject-matching rules: it IS the question being asked, it
 * is pure, and a duplicate would be free to drift from what the bar
 * actually does. The node it builds is discarded.
 */
import { useQuery } from "@tanstack/react-query";

import { dashboardQueryOptions } from "../api/queries";
import { TICKER_SOURCES } from "../datawidgets/tickerRegistry";
import { sourceForWidget } from "../marketplace";

/**
 * True only when the subject is pinnable, the dashboard has loaded, and
 * the source resolves it to nothing. Unknown states (no dashboard yet, a
 * source with no `pinnedChip`, a single-chip utility) are false: say
 * nothing rather than something that might be wrong.
 */
export function usePinnedSubjectEmpty(widget: string, subject: string): boolean {
  const { data: dashboard } = useQuery(dashboardQueryOptions());
  if (!dashboard || !subject) return false;

  const source = sourceForWidget(widget);
  if (!source) return false;
  const tickerSource = TICKER_SOURCES[source];
  if (!tickerSource?.pinnedChip) return false;

  return (
    tickerSource.pinnedChip(dashboard.data?.[source], {
      tab: widget,
      source,
      dashboard,
      comfort: false,
      chipColorMode: "theme",
      predictionsWatchlist: new Set<string>(),
      pinnedSubject: subject,
    }) === null
  );
}
