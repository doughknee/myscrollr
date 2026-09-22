/**
 * What the app says when a pin has nothing to show (SCROLLR-9).
 *
 * One string, one place: the toast fired at the moment of pinning and
 * the pin control's own label have to agree, or the user gets two
 * different explanations for one silence.
 */
export function nothingToShow(label: string): string {
  return `Nothing to show for ${label} right now`;
}
