/**
 * Mulberry32 PRNG — deterministic pseudo-random number generator.
 *
 * Used for decorative particle coordinates that must produce identical output
 * on the server (during prerender) and the client (during hydration). Using
 * Math.random() would cause hydration mismatches because the seed differs.
 *
 * Output is visually indistinguishable from Math.random() for decorative use.
 */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
