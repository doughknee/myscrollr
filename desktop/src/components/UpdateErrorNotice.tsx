import { updateErrorView } from "../lib/updateState";
import type { UpdateSnapshot } from "../lib/updateState";

/** Plain sentence for an update failure; the raw native text sits behind a disclosure. */
export default function UpdateErrorNotice({ state, className = "" }: { state: UpdateSnapshot; className?: string }) {
  const view = updateErrorView(state);
  if (!view) return null;
  return (
    <div role="alert" className={`break-words text-left ${className}`}>
      <p className="text-ui-meta text-error">{view.message}</p>
      {view.detail && (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-ui-chip text-fg-3 hover:text-fg">Technical details</summary>
          <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 font-mono text-[11px] text-fg-3">{view.detail}</pre>
        </details>
      )}
    </div>
  );
}
