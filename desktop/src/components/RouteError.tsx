/**
 * Shared error boundary component for route-level errors.
 *
 * Displays a user-friendly message and a retry button that resets
 * the TanStack Router error boundary. The raw error message is
 * hidden behind a disclosure to avoid leaking stack traces, paths,
 * or internal identifiers to casual viewers (e.g. during screen
 * sharing or screenshots).
 */
import type { ErrorComponentProps } from "@tanstack/react-router";

export default function RouteError({ error, reset }: ErrorComponentProps) {
  const rawMessage =
    typeof error?.message === "string" && error.message.length > 0
      ? error.message
      : String(error ?? "Unknown error");

  return (
    <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto gap-3 p-6">
      <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center mb-1">
        <span className="text-error text-lg font-bold">!</span>
      </div>
      <h2 className="text-base font-semibold text-fg">Something went wrong</h2>
      <p className="text-sm text-fg-3 leading-relaxed">
        An unexpected error occurred while loading this view. You can retry, and
        if the problem persists, include the details below in a bug report.
      </p>
      <button
        onClick={reset}
        className="mt-2 px-4 py-1.5 rounded-lg text-xs font-medium bg-surface-3/50 hover:bg-surface-3 text-fg-3 hover:text-fg "
      >
        Try again
      </button>
      <details className="w-full mt-3 text-left">
        <summary className="text-xs text-fg-3 cursor-pointer select-none hover:text-fg ">
          Technical details
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto text-[11px] font-mono text-fg-3 bg-surface-2 rounded-lg p-2 whitespace-pre-wrap break-words">
          {rawMessage}
        </pre>
      </details>
    </div>
  );
}
