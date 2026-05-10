/**
 * useNavHistory — exposes a Spotify-style forward/back navigation
 * model on top of TanStack Router's memory history.
 *
 * Uses TanStack's official `useCanGoBack()` for back, and computes
 * canForward from the history's `__TSR_index` (current position) and
 * `length` (total entries) — the memory-history shape exposed via
 * @tanstack/history. We subscribe to the history directly so the
 * forward/back state recomputes on every PUSH/BACK/FORWARD/GO.
 *
 * Behavior:
 *   - canBack: true when not at index 0
 *   - canForward: true when index < length - 1
 *   - back() / forward() are no-ops when not allowed
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter, useCanGoBack } from "@tanstack/react-router";

interface NavHistory {
  canBack: boolean;
  canForward: boolean;
  back: () => void;
  forward: () => void;
}

export function useNavHistory(): NavHistory {
  const router = useRouter();
  const canBack = useCanGoBack();
  const [canForward, setCanForward] = useState(false);

  // Subscribe directly to the history so we recompute on every action,
  // not just route resolution. The router's onResolved subscriber fires
  // AFTER the URL changes but the history index update is synchronous,
  // so subscribing to history itself gives us the freshest answer.
  useEffect(() => {
    const compute = () => {
      const h = router.history;
      const state = h.location.state as { __TSR_index?: number } | undefined;
      const idx = state?.__TSR_index ?? 0;
      setCanForward(idx < h.length - 1);
    };
    compute();
    const unsub = router.history.subscribe(compute);
    return () => unsub();
  }, [router]);

  const back = useCallback(() => {
    if (!canBack) return;
    router.history.back();
  }, [canBack, router]);

  const forward = useCallback(() => {
    if (!canForward) return;
    router.history.forward();
  }, [canForward, router]);

  return { canBack, canForward, back, forward };
}
