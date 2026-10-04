/* ============================================================
   test-structure.js — regression tests for js/structure.js
   Runs build() in Node (no DOM, no framework) over synthetic
   parse.js line shapes:
     - TOC pages: dot-leader entries, bare page numbers with no
       leaders (the maxPg ReferenceError that failed every book
       with a leader-less contents page), roman numerals, and
       page numbers larger than the book (must be rejected).
     - Chapter grouping: multi-line headings, glued titles.
     - Cover/front-matter title cleanup (cleanTitle).
   Exit code 0 = all pass. Run: node tools/test-structure.js
   (or: npm test). Wired into CI (.github/workflows/test.yml).
   ============================================================ */
'use strict';

const fs = require('fs'), path = require('path');

/* structure.js is plain top-level functions; eval the source inside a
   function scope and return what the tests need. */
const { build, cleanTitle } = new Function(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'structure.js'), 'utf8') +
  '\nreturn { build, cleanTitle };'
)();

/* ---- Synthetic line factory, mimicking parse.js row output ----
   y decreases within a page (top-to-bottom reading order); o.pg
   starts a new page (y resets). Body text height 10. */
let Y = 0, PG = 1;
function ln(t, o = {}) {
  if (o.pg !== undefined && o.pg !== PG) { PG = o.pg; Y = 0; }
  const h = o.h || 10;
  Y -= h + (o.gap !== undefined ? o.gap : 8);
  return { t, h, x: o.x !== undefined ? o.x : 12, y: Y, code: false, dc: false, pg: PG };
}
const fill = n => Array.from({ length: n }, (_, i) => 'word' + (i % 9)).join(' ');

/* A minimal 5-chapter book so build() picks h1 as the chapter level. */
function book(extra) {
  const L = (extra || []).slice();
  L.push(
    ln('CHAPTER ONE: The Forest', { h: 16, pg: 2 }),
    ln(fill(260), { pg: 2 }),
    ln('CHAPTER TWO: The River', { h: 16, pg: 3 }),
    ln(fill(260), { pg: 3 }),
    ln('CHAPTER THREE: The Stars', { h: 16, pg: 4 }),
    ln(fill(260), { pg: 4 }),
    ln('CHAPTER FOUR: The Storm', { h: 16, pg: 5 }),
    ln(fill(260), { pg: 5 }),
    ln('CHAPTER FIVE: The Harbor', { h: 16, pg: 6 }),
    ln(fill(260), { pg: 6 })
  );
  return L;
}
const flat = ch => ch.reduce((a, c) => a.concat(c.b), []);
const tocBlock = ch => flat(ch).find(b => b.k === 'toc');

/* ---- Assertions ---- */
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.error('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(what + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));
}

/* ---- 1. THE maxPg REGRESSION: leader-less TOC entry must not throw.
   Pre-fix, any contents page listing entries that end in a bare page
   number (no dot leaders) threw ReferenceError: maxPg is not defined,
   failing the whole open with "Could not read this PDF". ---- */
test('leader-less TOC entries do not throw (maxPg regression)', () => {
  const ch = build(book([
    ln('CONTENTS', { h: 14, pg: 1, gap: 4 }),
    ln('Preface 7', { pg: 1 }),
    ln('The Self Image 23', { pg: 1 }),
    ln('Epilogue 999', { pg: 1 })
  ]));
  if (!Array.isArray(ch) || ch.length < 2) throw new Error('book did not build');
});

/* ---- 2. Bare page numbers are accepted when within the book and
   rejected when beyond it (that is exactly what maxPg guards). ---- */
test('bare TOC page numbers: in-range kept, out-of-range rejected', () => {
  const ch = build(book([
    ln('CONTENTS', { h: 14, pg: 1, gap: 4 }),
    ln('Preface 5', { pg: 1 }),
    ln('Epilogue 999', { pg: 1 })
  ]));
  const toc = tocBlock(ch);
  if (!toc) throw new Error('no toc block found');
  eq(toc.items.find(i => i.t === 'Preface').pg, '5', 'in-range entry keeps its page');
  eq(toc.items.find(i => i.t === 'Epilogue 999').pg, '', 'out-of-range entry loses its page');
});

/* ---- 3. Dot-leader entries: the classic contents line. ---- */
test('dot-leader TOC entries parse title and page', () => {
  const ch = build(book([
    ln('CONTENTS', { h: 14, pg: 1, gap: 4 }),
    ln('Chapter One: The Forest........1', { pg: 1 }),
    ln('Chapter Two: The River........2', { pg: 1 })
  ]));
  const toc = tocBlock(ch);
  if (!toc) throw new Error('no toc block found');
  eq(toc.items.find(i => /^Chapter One/.test(i.t)).pg, '1', 'leader entry page');
});

/* ---- 4. Roman-numeral page numbers never touch maxPg (isNaN short-
   circuit) and survive as entries. ---- */
test('roman-numeral TOC entries are kept', () => {
  const ch = build(book([
    ln('CONTENTS', { h: 14, pg: 1, gap: 4 }),
    ln('Preface vi', { pg: 1 }),
    ln('Introduction ix', { pg: 1 })
  ]));
  const toc = tocBlock(ch);
  if (!toc) throw new Error('no toc block found');
  eq(toc.items.find(i => i.t === 'Preface').pg, 'vi', 'roman page kept');
});

/* ---- 5. Multi-line chapter headings glue into one title. ---- */
test('chapter number + title glue across heading lines', () => {
  const ch = build(book([
    ln('Chapter Three', { h: 16, pg: 2 }),
    ln('The Theory', { h: 13, pg: 2 }),
    ln(fill(260), { pg: 2 })
  ]));
  const c = ch.find(c => /The Theory/.test(c.title));
  if (!c) throw new Error('glued chapter missing');
  eq(c.title, 'Chapter Three: The Theory', 'glued title');
});

/* ---- 6. Cover/front-matter stacking: hyphenated split words reattach
   and the BY <author> run is dropped from the long glued title. ---- */
test('cover title is cleaned (de-hyphenated, BY run dropped)', () => {
  const ch = build(book([
    ln('PSYCHO-', { h: 22, pg: 1, gap: 4 }),
    ln('CYBERNETICS,', { h: 22, pg: 1 }),
    ln('A New Way to Get More Living Out of Life', { h: 16, pg: 1 }),
    ln('BY', { h: 12, pg: 1 }),
    ln('MAXWELL MALTZ', { h: 12, pg: 1 })
  ]));
  eq(ch[0].title, 'PSYCHO-CYBERNETICS, A New Way to Get More Living Out of Life',
    'cover chapter title');
});

/* ---- 7. cleanTitle unit cases: trim separators, keep real headings,
   keep short all-caps titles with BY, keep lowercase "by" phrases. ---- */
test('cleanTitle unit cases', () => {
  eq(cleanTitle('The Forest: '), 'The Forest', 'trailing separator trimmed');
  eq(cleanTitle('Chapter One: The Forest'), 'Chapter One: The Forest', 'real heading untouched');
  eq(cleanTitle('Down by the Bay'), 'Down by the Bay', 'lowercase by untouched');
  eq(cleanTitle('TRAPPED BY THE LAKE'), 'TRAPPED BY THE LAKE', 'short title with BY untouched');
  eq(cleanTitle('A Very Long Stacked Cover Title That Goes On And On Forever: BY: John Smith'),
     'A Very Long Stacked Cover Title That Goes On And On Forever', 'BY run dropped on long titles');
  eq(cleanTitle('PSYCHO- CYBERNETICS'), 'PSYCHO-CYBERNETICS', 'split hyphenated word reattached');
});

/* ---- 8. Empty/degenerate input must not throw. ---- */
test('empty and single-line inputs do not throw', () => {
  eq(build([]).length, 0, 'empty input yields no chapters (empty prologue is dropped)');
  eq(build([ln('Hello world.')]).length, 1, 'single line yields one chapter');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
