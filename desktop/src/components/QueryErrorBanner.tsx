/**
 * Inline error banner for failed TanStack Query refreshes.
 *
 * Renders nothing when error is null, otherwise shows friendly copy and
 * an optional deduplicated Retry action. Technical details stay out of UI.
 */

interface QueryErrorBannerProps {
  error: Error | null;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export default function QueryErrorBanner({
  error,
  message = "Couldn't refresh this data.",
  onRetry,
  retrying = false,
}: QueryErrorBannerProps) {
  if (!error) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded border border-error/15 bg-error/5 px-2 py-1.5 text-[11px] font-mono text-error/80"
    >
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="shrink-0 rounded px-2 py-1 font-semibold text-error hover:bg-error/10 disabled:cursor-wait disabled:opacity-50"
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}
