/**
 * Three-dot palette preview for the theme row.
 *
 * Shows the *active* palette's accent, purple, and info — the same three
 * the prototype samples — straight from the live tokens, so it restyles
 * itself when the family changes and needs no per-family color table.
 * (Previewing every family in the dropdown would need one, since only
 * the active theme's variables are resolvable.)
 */
export default function ThemeDots() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden>
      <span className="size-2 rounded-full bg-accent" />
      <span className="size-2 rounded-full bg-accent-purple" />
      <span className="size-2 rounded-full bg-info" />
    </span>
  );
}
