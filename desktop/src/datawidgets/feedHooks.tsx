/**
 * Shared FeedTab helpers — automatic paging, set-filter toggles, and
 * freshness timestamps used across data widgets.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from "react";

const PAGE_SIZE = 20;

/**
 * Reveal locally available rows as the page scroller approaches the end.
 * Resets to the first page whenever filters, sort, search, or scope change.
 */
export function useAutoPagination(
  total: number,
  resetDeps: DependencyList,
  footerClassName: string,
): { visible: number; footer: React.ReactNode } {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  const visible = Math.min(visibleCount, total);
  const remaining = Math.max(0, total - visible);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || remaining === 0) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((count) => Math.min(total, count + PAGE_SIZE));
        }
      },
      {
        root: sentinel.closest<HTMLElement>("[data-page-scroll]"),
        rootMargin: "0px 0px 160px",
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [remaining, total]);

  const footer =
    total > PAGE_SIZE ? (
      <div
        ref={sentinelRef}
        role="status"
        className={`flex items-center justify-center text-xs text-fg-3 tabular-nums font-mono ${footerClassName}`}
      >
        {remaining > 0 ? `Loading more… ${visible} of ${total}` : `All ${total} shown`}
      </div>
    ) : null;

  return { visible, footer };
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
