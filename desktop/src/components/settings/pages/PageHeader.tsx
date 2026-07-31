/**
 * Page heading for the settings pane.
 *
 * Owned by each page rather than the surface because two pages need
 * more than a static string: Ticker hangs a "Reset ticker settings"
 * button off the right of the header row, and Updates swaps its
 * subtitle for live updater state.
 */
export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[18px] leading-tight font-bold text-fg">{title}</h1>
        <p className="mt-1.5 text-ui-meta text-fg-3">{subtitle}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
