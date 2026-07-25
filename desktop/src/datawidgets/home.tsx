/**
 * The Home feed's `source → preview` contract.
 *
 * Mirrors `ticker.ts`: each data source owns how it renders on Home, in its
 * own folder (`datawidgets/{source}/home.tsx`), instead of `routes/feed.tsx`
 * carrying an if-ladder over source names. Adding a source is a folder plus
 * a manifest field — feed.tsx never changes.
 *
 * The pieces live on `DataWidgetManifest` rather than in a separate registry
 * (which is how the ticker does it) for one reason: `widgetManifest()` spreads
 * the per-source renderer manifest, so `WidgetSection` already holds the right
 * manifest and needs no lookup at all.
 */
import { Settings } from "lucide-react";

/** Rows shown per widget on Home. Also caps how many group chips you can pin. */
export const HOME_PREVIEW_MAX = 5;

/**
 * The empty state inside a Home preview card.
 *
 * Each source passes its own copy. This replaced an `EMPTY_HINTS` map keyed
 * by source name in feed.tsx — a sixth place source knowledge lived, and one
 * that had silently gone stale: it had no `predictions` entry, so that
 * widget's empty state lost its call to action.
 */
export function HomeEmptyRow({
  message,
  openLabel,
  onConfigure,
}: {
  /** e.g. "No stocks configured yet" */
  message: string;
  /** Widget name for the CTA — "Open Finance". Omit to render no CTA. */
  openLabel?: string;
  onConfigure?: () => void;
}) {
  return (
    <div className="px-4 py-5 text-center">
      <p className="text-ui-meta text-fg-3 font-medium mb-1">{message}</p>
      {openLabel && onConfigure && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onConfigure();
          }}
          className="inline-flex items-center gap-1.5 text-ui-chip text-accent hover:text-accent/80 transition-colors"
        >
          <Settings size={11} />
          Open {openLabel}
        </button>
      )}
    </div>
  );
}
