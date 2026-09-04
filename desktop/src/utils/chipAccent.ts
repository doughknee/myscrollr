/**
 * A brand colour, made usable as a TINT on the dark surface.
 *
 * Catalog colours are true brand values: MLS #001838, NFL #013369, NHL
 * #111827. Painted solid on a card they are fine. Mixed at 6% into a
 * #141420 surface, or used as 25% of a border, they disappear -- an MLS
 * chip read as uncoloured beside an F1 one. The fix is not to change the
 * brand, it is to derive a display colour from it: same hue, lightness
 * lifted to a floor where a tint can be seen, saturation floored so a
 * lifted navy becomes a clear blue rather than a grey.
 *
 * HSL, not OKLCH: the inputs are a dozen fixed brand colours and the
 * output is a tint, not a palette. Perceptual uniformity would not change
 * a decision here, and HSL needs no dependency.
 */

const L_FLOOR = 0.6;
const S_FLOOR = 0.55;

/**
 * Gate on perceived luminance, not HSL lightness. A saturated red like F1's
 * #e10600 has an HSL lightness of 44% -- "dark" by that measure -- yet reads
 * bright and tints fine; gating on lightness lifted it to a salmon. Navy
 * #001838 scores ~20 on this 0-255 scale, the vivid reds 63-71, so 60
 * separates the colours that vanish from the ones that do not.
 */
const LUM_DARK = 60;

export function liftForTint(hex: string): string {
  const rgb = parse(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  if (r * 0.299 + g * 0.587 + b * 0.114 >= LUM_DARK) return hex;
  let [h, s, l] = rgbToHsl(rgb);
  if (l < L_FLOOR) l = L_FLOOR;
  if (s < S_FLOOR) s = S_FLOOR;
  return toHex(hslToRgb(h, s, l));
}

function parse(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
