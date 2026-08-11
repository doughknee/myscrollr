/**
 * The rail's drift, as CUMULATIVE POSITION rather than speed.
 *
 * `p(f)` runs 0 -> 1 across the composition and the strip is translated
 * by `-p(f) * TILE_WIDTH`. Two consequences fall out for free:
 *
 *   1. The loop is exact. p(600) = 1 means the strip has advanced by
 *      precisely one tile, and the tile is rendered twice, so frame 600
 *      is pixel-identical to frame 0.
 *   2. Slowing the rail is just a flatter section of the curve. Animating
 *      SPEED instead would make the total distance depend on the shape of
 *      the easing, and any tuning would break the seam.
 *
 * The flat run between 114 and 248 is deliberate: the camera is at 6.2x
 * there, which multiplies apparent drift, and the frame the score lands
 * on needs the eye parked.
 */

/** Keyframes from the spec. Must stay monotonic in both columns. */
const KEYS: readonly (readonly [frame: number, p: number])[] = [
  [0, 0.0],
  [114, 0.233],
  [174, 0.307],
  [248, 0.337],
  [318, 0.423],
  [600, 1.0],
];

/**
 * Fritsch–Carlson monotone cubic Hermite.
 *
 * Monotone rather than a plain spline because a natural cubic through
 * these points overshoots on the flat section — the rail would visibly
 * creep BACKWARDS around frame 248, which on a ticker reads as a bug.
 * Linear would hold monotonicity but steps velocity at every knot, and
 * those steps are visible under a 6.2x camera.
 */
const SLOPES: number[] = (() => {
  const n = KEYS.length;
  const dx: number[] = [];
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(KEYS[i + 1][0] - KEYS[i][0]);
    secant.push((KEYS[i + 1][1] - KEYS[i][1]) / dx[i]);
  }

  const m: number[] = new Array(n);
  m[0] = secant[0];
  m[n - 1] = secant[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2;
  }

  // Clamp so no segment can overshoot and reverse direction.
  for (let i = 0; i < n - 1; i++) {
    if (secant[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / secant[i];
    const b = m[i + 1] / secant[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      m[i] = ((3 / h) * a) * secant[i];
      m[i + 1] = ((3 / h) * b) * secant[i];
    }
  }
  return m;
})();

/** Cumulative rail position, 0 at frame 0 and exactly 1 at frame 600. */
export function railProgress(frame: number): number {
  const n = KEYS.length;
  if (frame <= KEYS[0][0]) return KEYS[0][1];
  if (frame >= KEYS[n - 1][0]) return KEYS[n - 1][1];

  let i = 0;
  while (i < n - 2 && frame > KEYS[i + 1][0]) i++;

  const [x0, y0] = KEYS[i];
  const [x1, y1] = KEYS[i + 1];
  const h = x1 - x0;
  const t = (frame - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * SLOPES[i] +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * SLOPES[i + 1]
  );
}

/**
 * The seam depends on the rail leaving at the speed it arrives at. Both
 * end segments run at full speed by design, but this is exactly the kind
 * of invariant that a later tuning pass breaks silently, so it is checked
 * at import rather than trusted.
 */
{
  const d = 0.5;
  const vIn = (railProgress(d) - railProgress(0)) / d;
  const vOut = (railProgress(600) - railProgress(600 - d)) / d;
  if (Math.abs(vIn - vOut) > 1e-4) {
    throw new Error(
      `[promo] Rail loop seam would jump: entry velocity ${vIn.toFixed(6)} ` +
        `vs exit ${vOut.toFixed(6)}. Re-tune the KEYS in src/rail.ts.`,
    );
  }
  if (railProgress(600) !== 1) {
    throw new Error("[promo] railProgress(600) must be exactly 1.");
  }
}
