/* Generate a tiny multi-page sample.pdf for smoke-testing Foliant.
   Usage: node tools/make_sample_pdf.js [pageRepeats] [outfile]
   e.g. `node tools/make_sample_pdf.js 80 big.pdf` -> a ~320-page stress book
   (the 4 page specs repeated 80 times) for first-open performance testing. */
const fs = require('fs');

const REPS = Math.max(1, parseInt(process.argv[2] || '1', 10) || 1);
const OUT = process.argv[3] || 'sample.pdf';

const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const FILLER = [
  "The villagers measured the year not in months but in tasks, and every task had its own quiet music.",
  "Bread was baked on Thursdays, bees were kept behind the chapel, and letters arrived whenever the road allowed.",
  "Nobody in the village was in a hurry, and yet everything that needed doing was done before the first snow.",
  "The elders said that patience was simply love stretched over time, and the young pretended not to listen.",
  "When the wind turned from the north the whole valley smelled of iron and coming rain, and the dogs would sing.",
  "Every family kept a book of small debts and smaller grudges, and both were forgiven at the harvest table.",
  "There was a bell for fires, a bell for weddings, and a slow sad bell that nobody liked to explain to guests.",
  "In winter the stories grew longer, because the nights were long and the woodpile measured the hour.",
  "Travelers said the village was unremarkable, which suited the villagers, who worked hard at being left alone.",
  "The school had one room, one stove, and one teacher who believed that questions mattered more than answers.",
];

function filler(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(FILLER[(i + seed) % FILLER.length]);
  return out.map(t => [t, 12]);
}
const pages = [
  ["Chapter One: The Forest", [
    ["O", 36],
    ["nce upon a time there was a small village at the edge of a wide green forest. The", 12],
    ...filler(24, 0),
    ["Tip: bring a lantern when you visit the forest at night.", 12, 2],
    ["Q: What did the villagers keep behind the chapel? A: Bees.", 12, 2],
  ]],
  ["Chapter Two: The River", [
    ["The river ran cold and quick beside the mill, turning the great wheel from dawn", 12],
    ...filler(24, 3),
    ["How the mill works", 14, 2],
    ["\u2022 The wheel turns from dawn until dusk, unless the river freezes over.", 12],
    ["\u2022 The stones are dressed twice a year, always after the spring floods.", 12],
    ["\u2022 The miller keeps one tenth of the flour, as his father did before him.", 12],
  ]],
  ["Chapter Three: The Stars", [
    ["On clear nights the whole village climbed the hill behind the church to watch", 12],
    ...filler(24, 6),
  ]],
  ["Chapter Four: The Road", [
    ["The road left the village at the eastern gate and promptly forgot where it was going", 12],
    ...filler(24, 2),
  ]],
];

function pageStream(title, lines) {
  let y = 750;
  let s = `BT /F1 18 Tf 1 0 0 1 72 ${y} Tm (${esc(title)}) Tj ET\n`;
  y -= 30;
  for (let i = 0; i < lines.length; i++) {
    const [text, fsz, extra] = lines[i];
    y -= 18 * (extra || 1);   // extra blank lines = paragraph gap
    if (fsz === 36) {
      // drop cap: big glyph at left, the next line starts further right,
      // same baseline — exactly how real decorated first letters are drawn
      const [ntext] = lines[i + 1];
      s += `BT /F1 36 Tf 1 0 0 1 72 ${y + 9} Tm (${esc(text)}) Tj ET\n`;
      s += `BT /F1 12 Tf 1 0 0 1 100 ${y} Tm (${esc(ntext)}) Tj ET\n`;
      i++;   // the body line was consumed
      continue;
    }
    s += `BT /F1 ${fsz} Tf 1 0 0 1 72 ${y} Tm (${esc(text)}) Tj ET\n`;
  }
  return s;
}

const allPages = [];
for (let r = 0; r < REPS; r++) allPages.push(...pages);

const n = allPages.length;
const streams = allPages.map(([t, l]) => pageStream(t, l));
const fontId = 3 + 2 * n;
const kids = allPages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');

const objects = {};
objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`;
allPages.forEach((_, i) => {
  const pid = 3 + i * 2, cid = 4 + i * 2;
  objects[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cid} 0 R >>`;
  const body = streams[i];
  objects[cid] = `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}endstream`;
});
objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>';

const out = [];
out.push('%PDF-1.4\n');
const offsets = {};
for (let id = 1; id <= fontId; id++) {
  offsets[id] = Buffer.byteLength(out.join(''));
  out.push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
}
const xref = Buffer.byteLength(out.join(''));
let x = `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
for (let id = 1; id <= fontId; id++) x += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
x += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
out.push(x);

fs.writeFileSync(OUT, out.join(''), 'binary');
console.log(`wrote ${OUT} (${n} pages)`, Buffer.byteLength(out.join('')), 'bytes');
