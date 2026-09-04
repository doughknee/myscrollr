import { useEffect, useRef, useState } from "react";

/**
 * Flash once when either score changes.
 *
 * `resetKey` identifies WHICH game the scores belong to. When it changes
 * the baseline is replaced silently instead of compared: a rotating slot
 * swapping from one game to another looks exactly like a score change
 * to a naive comparison, and every rotation would flash green or red as
 * if somebody had scored. Fixed items pass their id and never trip it.
 */
export function useScoreFlash(
  awayScore: number | string,
  homeScore: number | string,
  resetKey?: string | number,
): boolean {
  const prevRef = useRef({ away: awayScore, home: homeScore, key: resetKey });
  const [flash, setFlash] = useState(false);
  const initialRender = useRef(true);

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      prevRef.current = { away: awayScore, home: homeScore, key: resetKey };
      return;
    }

    const prev = prevRef.current;
    if (prev.key !== resetKey) {
      // A different game, not a different score.
      prevRef.current = { away: awayScore, home: homeScore, key: resetKey };
      return;
    }
    if (prev.away !== awayScore || prev.home !== homeScore) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 800);
      prevRef.current = { away: awayScore, home: homeScore, key: resetKey };
      return () => clearTimeout(t);
    }
  }, [awayScore, homeScore, resetKey]);

  return flash;
}
