/**
 * Marks a row as a search-jump target.
 *
 * The id becomes `data-row`, which `flashRow` looks up after a search
 * result is clicked. Kept as a wrapper rather than a prop on every
 * control so the control kit stays unaware of search.
 */
export function Row({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return <div data-row={id}>{children}</div>;
}
