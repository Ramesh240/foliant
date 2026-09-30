/* ============================================================
   main.js — entry point: open a PDF (new import or shelf reopen),
   then hand off to parse -> structure -> render.
   Also wires the file input and drag & drop.
   ============================================================ */

'use strict';

/* Core open pipeline, shared by fresh imports and shelf reopens.
   resume = {ci, y} restores the exact viewport position (shelf reopens). */
async function openFromBuffer(key, buf, resume) {
  try {
    name = key;
    $('#msg').textContent = 'Opening…';

    const L = await parse(buf.slice(0));
    if (!L.length) {
      $('#msg').textContent = 'No text found. This PDF may be scanned images, which need OCR first.';
      return false;
    }

    chapters = build(L);
    cur = 0;
    loadR(); loadH();

    /* A shapeless single chapter gets the file name as its title. */
    if (chapters.length === 1 && chapters[0].title === 'Beginning') {
      chapters[0].title = key.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
    }

    /* Restore position: exact viewport offset if we have one, else the
       legacy localStorage bookmark, else chapter 0. */
    let want = null;
    try {
      const s = +localStorage.getItem('foliant-pos-' + name);
      if (s >= 0 && s < chapters.length) cur = s;
    } catch (e) {}
    if (resume && resume.ci >= 0 && resume.ci < chapters.length) {
      cur = resume.ci;
      want = resume;   // the whole {ci, y, f} spot — restoreScroll needs y AND f
    }

    $('#title').textContent = key.replace(/\.pdf$/i, '');
    $('#home').classList.add('hide');
    $('#reader').classList.remove('hide');
    /* When restoring, skip render()'s scroll reset AND its position save
       (scrollY is 0 here and would clobber the stored spot before restore). */
    if (want) SKIP_RENDER_SCROLL = true;
    render();
    SKIP_RENDER_SCROLL = false;

    /* Re-scroll after async figure work; figures only grow the page. */
    if (want) restoreScroll(want);
    return true;
  } catch (err) {
    $('#msg').textContent = 'Could not read this PDF. It may be password protected or damaged.';
    return false;
  }
}

/* Fresh import: persist the bytes + metadata, then run the pipeline. */
async function open(file) {
  if (!file || file.type !== 'application/pdf') {
    $('#msg').textContent = 'That file is not a PDF. Choose a .pdf file.';
    return;
  }
  $('#msg').textContent = 'Opening…';
  const buf = await file.arrayBuffer();
  await openFromBuffer(file.name, buf);
  if (chapters.length) {
    $('#msg').textContent = 'Saved to your shelf';
    setTimeout(() => { if ($('#msg').textContent === 'Saved to your shelf') $('#msg').textContent = ''; }, 1600);
    shelfRemember(file.name, buf.slice(0), totalWords());
  }
}

$('#file').onchange = e => open(e.target.files[0]);

const dz = $('#drop');
['dragover', 'dragenter'].forEach(v => dz.addEventListener(v, e => { e.preventDefault(); dz.classList.add('on'); }));
['dragleave', 'drop'].forEach(v => dz.addEventListener(v, e => { e.preventDefault(); dz.classList.remove('on'); }));
dz.addEventListener('drop', e => open(e.dataTransfer.files[0]));

/* Kick off the shelf once the DOM is ready. */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', shelfInit);
else shelfInit();
