/* Validate generated icons: parse PNG, decode IDAT, sample pixels. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function check(file) {
  const buf = fs.readFileSync(file);
  const okSig = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let off = 8, w = 0, h = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4 + 1;
  /* Sample a grid: count opaque/colored pixels. */
  let opaque = 0, green = 0, cream = 0, yellow = 0, total = 0;
  for (let y = 0; y < h; y += Math.max(1, h >> 5)) {
    for (let x = 0; x < w; x += Math.max(1, w >> 5)) {
      const i = y * stride + 1 + x * 4;
      const r = raw[i], g = raw[i + 1], b = raw[i + 2], a = raw[i + 3];
      total++;
      if (a > 128) {
        opaque++;
        if (g > r && g > b) green++;
        else if (r > 230 && g > 230 && b > 210) cream++;
        else if (r > 240 && g > 220 && b < 210) yellow++;
      }
    }
  }
  return { file: path.basename(file), w, h, okSig,
    opaquePct: Math.round(opaque / total * 100),
    greenPct: Math.round(green / total * 100),
    creamPct: Math.round(cream / total * 100),
    yellowPct: Math.round(yellow / total * 100) };
}

const dir = path.join(__dirname, '..', 'icons');
for (const f of fs.readdirSync(dir)) console.log(JSON.stringify(check(path.join(dir, f))));
