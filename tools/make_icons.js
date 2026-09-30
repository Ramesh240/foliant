/* Generate Foliant icons (PWA + Android launcher set) without any image library:
   draws the glyph with raw PNG chunks (zlib via Node's built-in zlib). */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* Signed 32-bit CRC for PNG chunks. */
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/* RGBA canvas helper. */
function canvas(w, h) {
  const px = new Uint8Array(w * h * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const blend = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    const na = a / 255, oa = px[i + 3] / 255;
    const outA = na + oa * (1 - na);
    if (outA === 0) return;
    px[i]     = Math.round((r * na + px[i]     * oa * (1 - na)) / outA);
    px[i + 1] = Math.round((g * na + px[i + 1] * oa * (1 - na)) / outA);
    px[i + 2] = Math.round((b * na + px[i + 2] * oa * (1 - na)) / outA);
    px[i + 3] = Math.round(outA * 255);
  };
  return { w, h, px, set, blend };
}

/* Supersampled coverage mask for the "open book" glyph + accent rule.
   Returns alpha in [0,1] at device coordinates. */
function glyphAlpha(size, x, y) {
  // cover: rounded square background
  const m = size * 0.04, rad = size * 0.19;
  const inCover = (px, py) => {
    const x0 = Math.min(Math.max(px, m), size - m), y0 = Math.min(Math.max(py, m), size - m);
    const dx = px - x0, dy = py - y0;
    return (dx * dx + dy * dy <= rad * rad) && px >= m && px <= size - m && py >= m && py <= size - m;
  };
  // normalized coords
  const nx = x / size, ny = y / size;
  // two page "wings" of an open book, drawn as two triangles with a spine gap
  const inWing = (dir) => {
    // dir -1 = left page, +1 = right page; spine at 0.5
    const cx = 0.5 + dir * 0.035;                 // inner edge
    const tipX = 0.5 + dir * 0.30, tipTop = 0.22, tipBot = 0.62;
    const outerX = 0.5 + dir * 0.38;
    if (ny < tipTop || ny > tipBot) return false;
    // wing shape: from spine (cx) widening to outer edge, slanted top/bottom
    const t = (ny - tipTop) / (tipBot - tipTop);          // 0..1 down the page
    const xIn = cx + dir * (tipX - cx) * Math.sin(t * Math.PI) ** 0.35;
    const xOut = cx + dir * (outerX - cx) * Math.sin(t * Math.PI) ** 0.35;
    return dir > 0 ? (nx >= xIn && nx <= xOut + 0.012) : (nx <= xIn && nx >= xOut - 0.012);
  };
  // accent rule under the book
  const inRule = ny >= 0.72 && ny <= 0.78 && nx >= 0.24 && nx <= 0.76;
  return { cover: inCover(x, y), wing: inWing(-1) || inWing(1), rule: inRule };
}

function drawIcon(size, { pad = 0, bg = [47, 93, 80], rounded = true } = {}) {
  const cv = canvas(size, size);
  const S = 4;   // supersampling
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0, wing = 0, rule = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const gx = (x + (sx + .5) / S) * (size - 2 * pad) / size + pad;
        const gy = (y + (sy + .5) / S) * (size - 2 * pad) / size + pad;
        const a = glyphAlpha(size, gx * size / (size - 2 * pad) - pad * size / (size - 2 * pad), gy * size / (size - 2 * pad) - pad * size / (size - 2 * pad));
        cov += a.cover ? 1 : 0; wing += a.wing ? 1 : 0; rule += a.rule ? 1 : 0;
      }
      const n = S * S;
      if (rounded ? cov > 0 : true) {
        const a = rounded ? cov / n : 1;
        if (a > 0) cv.set(x, y, bg[0], bg[1], bg[2], Math.round(a * 255));
      }
      if (wing > 0) cv.blend(x, y, 246, 243, 236, Math.round(wing / n * 255));
      if (rule > 0) cv.blend(x, y, 255, 241, 184, Math.round(rule / n * 255));
    }
  }
  return cv;
}

function encodePNG(cv) {
  const { w, h, px } = cv;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;   // filter: none
    Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

/* PWA icons */
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), encodePNG(drawIcon(size)));
}
/* Maskable: glyph scaled into the safe zone (80%) on a full-bleed background */
fs.writeFileSync(path.join(outDir, 'maskable-512.png'),
  encodePNG(drawIcon(512, { pad: 46, rounded: false })));
/* Android launcher icons (flat, opaque, no rounding — the launcher masks these) */
for (const [size, name] of [[48, 'mdpi'], [72, 'hdpi'], [96, 'xhdpi'], [144, 'xxhdpi'], [192, 'xxxhdpi']]) {
  fs.writeFileSync(path.join(outDir, `ic-launcher-${name}.png`), encodePNG(drawIcon(size, { rounded: false })));
}

console.log('icons written:', fs.readdirSync(outDir).join(', '));
