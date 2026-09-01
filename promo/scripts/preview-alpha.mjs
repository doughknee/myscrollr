/**
 * Composite a transparent frame over a solid colour and write a PNG, so
 * an overlay can be judged the way it will actually be seen.
 *
 * A transparent PNG opened on its own tells you almost nothing: the
 * viewer picks the backdrop, so a chip with no plate looks fine on
 * white and vanishes on grey. This forces the question.
 *
 *   node scripts/preview-alpha.mjs out/alpha-check.png out/on-grey.png 60
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const [, , input, output, levelArg] = process.argv;
const level = Number(levelArg ?? 60); // 0-255 grey backdrop

const png = readFileSync(input);
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);

// ── Read: concatenate IDAT, inflate, undo per-row filters ──────────
let offset = 8;
const idat = [];
while (offset < png.length) {
  const len = png.readUInt32BE(offset);
  const type = png.toString("ascii", offset + 4, offset + 8);
  if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + len));
  offset += 12 + len;
}
const raw = inflateSync(Buffer.concat(idat));

const BPP = 4;
const stride = width * BPP;
const rgba = Buffer.alloc(height * stride);
let p = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[p++];
  for (let x = 0; x < stride; x++) {
    const v = raw[p + x];
    const a = x >= BPP ? rgba[y * stride + x - BPP] : 0;
    const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
    const c = x >= BPP && y > 0 ? rgba[(y - 1) * stride + x - BPP] : 0;
    let out;
    if (filter === 0) out = v;
    else if (filter === 1) out = v + a;
    else if (filter === 2) out = v + b;
    else if (filter === 3) out = v + ((a + b) >> 1);
    else {
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
    }
    rgba[y * stride + x] = out & 255;
  }
  p += stride;
}

// ── Composite over the backdrop, source-over ───────────────────────
const flat = Buffer.alloc(height * (width * 3 + 1));
let q = 0;
for (let y = 0; y < height; y++) {
  flat[q++] = 0; // filter: none
  for (let x = 0; x < width; x++) {
    const i = y * stride + x * BPP;
    const alpha = rgba[i + 3] / 255;
    for (let ch = 0; ch < 3; ch++) {
      flat[q++] = Math.round(rgba[i + ch] * alpha + level * (1 - alpha));
    }
  }
}

// ── Write a minimal RGB PNG ────────────────────────────────────────
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const cr = Buffer.alloc(4);
  cr.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, cr]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: RGB
writeFileSync(
  output,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(flat)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
console.log(`wrote ${output} — ${width}x${height} over grey ${level}`);
