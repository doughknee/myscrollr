/**
 * Render a four-corner gradient and composite a real chip frame on it,
 * so a background palette can be judged against the thing that has to
 * sit on it rather than on its own.
 *
 *   node scripts/corner-bg.mjs <chipFrame.png> <out.png> TL TR BL BR
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const [, , chipPath, outPath, ...corners] = process.argv;
const [TL, TR, BL, BR] = corners.map(hex);

const W = 1920;
const H = 1080;

function hex(h) {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── The gradient: bilinear between the four corners, then a radial
// falloff toward the middle. The falloff is what keeps the centre dark
// enough for content — without it the corner colours average to a flat
// mid-tone exactly where the chips sit.
const bg = new Float64Array(W * H * 3);
for (let y = 0; y < H; y++) {
  const v = y / (H - 1);
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1);
    const dx = (u - 0.5) * 2;
    const dy = (v - 0.5) * 2;
    // 1 at the corners, 0 in the middle.
    const vignette = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.15) ** 1.6;
    for (let c = 0; c < 3; c++) {
      const top = TL[c] * (1 - u) + TR[c] * u;
      const bot = BL[c] * (1 - u) + BR[c] * u;
      bg[(y * W + x) * 3 + c] = (top * (1 - v) + bot * v) * vignette;
    }
  }
}

// ── Grain. Gradients this dark band badly in 8-bit; a little noise is
// what stops the contours showing as rings.
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let i = 0; i < bg.length; i++) bg[i] += (rand() - 0.5) * 5;

// ── Read the chip frame (RGBA PNG) and composite it centred.
const png = readFileSync(chipPath);
const cw = png.readUInt32BE(16);
const ch = png.readUInt32BE(20);
let off = 8;
const idat = [];
while (off < png.length) {
  const len = png.readUInt32BE(off);
  if (png.toString("ascii", off + 4, off + 8) === "IDAT")
    idat.push(png.subarray(off + 8, off + 8 + len));
  off += 12 + len;
}
const raw = inflateSync(Buffer.concat(idat));
const stride = cw * 4;
const chip = Buffer.alloc(ch * stride);
let p = 0;
for (let y = 0; y < ch; y++) {
  const f = raw[p++];
  for (let x = 0; x < stride; x++) {
    const rv = raw[p + x];
    const a = x >= 4 ? chip[y * stride + x - 4] : 0;
    const b = y > 0 ? chip[(y - 1) * stride + x] : 0;
    const c = x >= 4 && y > 0 ? chip[(y - 1) * stride + x - 4] : 0;
    let out;
    if (f === 0) out = rv;
    else if (f === 1) out = rv + a;
    else if (f === 2) out = rv + b;
    else if (f === 3) out = rv + ((a + b) >> 1);
    else {
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      out = rv + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
    }
    chip[y * stride + x] = out & 255;
  }
  p += stride;
}

const ox = Math.round((W - cw) / 2);
const oy = Math.round((H - ch) / 2);
const flat = Buffer.alloc(H * (W * 3 + 1));
let q = 0;
for (let y = 0; y < H; y++) {
  flat[q++] = 0;
  for (let x = 0; x < W; x++) {
    const cx = x - ox;
    const cy = y - oy;
    let alpha = 0;
    let src = [0, 0, 0];
    if (cx >= 0 && cx < cw && cy >= 0 && cy < ch) {
      const i = cy * stride + cx * 4;
      alpha = chip[i + 3] / 255;
      src = [chip[i], chip[i + 1], chip[i + 2]];
    }
    for (let c = 0; c < 3; c++) {
      const under = Math.max(0, Math.min(255, bg[(y * W + x) * 3 + c]));
      flat[q++] = Math.round(src[c] * alpha + under * (1 - alpha));
    }
  }
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([l, body, c]); };
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(outPath, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", deflateSync(flat)), chunk("IEND", Buffer.alloc(0)),
]));
console.log(`wrote ${outPath}`);
