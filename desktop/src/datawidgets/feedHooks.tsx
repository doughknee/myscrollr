/**
 * Shared FeedTab helpers — load-more paging, price-flash animation,
 * set-filter toggles, and freshness timestamps used across data widgets.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from "react";

const PAGE_SIZE = 20;
const LOAD_MORE_INCREMENT = 20;

/**
 * Incremental "load more" paging: render a progressively larger slice and
 * append more on click, keeping scroll position stable as users continue
 * down the list. Resets to the first page whenever `resetDeps` change
 * (filters, sort, query).
 */
export function useLoadMore(
  total: number,
  resetDeps: DependencyList,
  footerClassName: string,
): { visible: number; footer: React.ReactNode } {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  const visible = Math.min(visibleCount, total);
  const remaining = Math.max(0, total - visible);

  const footer =
    remaining > 0 ? (
      <div className={`flex items-center justify-center gap-3 ${footerClassName}`}>
        <button
          onClick={() =>
            setVisibleCount((c) => Math.min(total, c + LOAD_MORE_INCREMENT))
          }
          className="px-4 py-1.5 rounded-md text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20  cursor-pointer"
        >
          Load more
        </button>
        <span className="text-xs text-fg-3 tabular-nums font-mono">
          {visible} of {total}
        </span>
      </div>
    ) : null;

  return { visible, footer };
}

/**
 * Flash "up"/"down" for 800ms when `value` changes between renders. A
 * single effect owns the previous-value ref so rapid back-to-back CDC
 * events can't swallow a flash.
 */
export function usePriceFlash(
  value: number | null | undefined,
): "up" | "down" | null {
  const prevRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const current = typeof value === "number" ? value : NaN;
    const prev = prevRef.current;
    prevRef.current = current;

    if (prev === null || isNaN(current) || current === prev) {
      return;
    }

    setFlash(current > prev ? "up" : "down");
    const timer = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(timer);
  }, [value]);

  return flash;
}

/** Set-membership filter state: [set, toggle(value), clear]. */
export function useSetToggle(): [
  Set<string>,
  (value: string) => void,
  () => void,
] {
  const [set, setSet] = useState<Set<string>>(new Set());
  const toggle = useCallback((value: string) => {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSet(new Set()), []);
  return [set, toggle, clear];
}

/** Most-recent timestamp across `items` as an ISO string (null when none)
 *  — drives the FreshnessPill. */
export function latestTimestamp<T>(
  items: T[],
  getTs: (item: T) => string | null | undefined,
): string | null {
  let latest = 0;
  for (const item of items) {
    const raw = getTs(item);
    if (!raw) continue;
    const ts = new Date(raw).getTime();
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}
