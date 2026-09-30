/* ============================================================
   main.js — entry point: open a PDF, then hand off to parse ->
   structure -> render. Also wires the file input and drag & drop.
   ============================================================ */

'use strict';

async function open(file) {
  if (!file || file.type !== 'application/pdf') {
    $('#msg').textContent = 'That file is not a PDF. Choose a .pdf file.';
    return;
  }
  try {
    name = file.name;
    $('#msg').textContent = 'Opening…';

    const L = await parse(await file.arrayBuffer());
    if (!L.length) {
      $('#msg').textContent = 'No text found. This PDF may be scanned images, which need OCR first.';
      return;
    }

    chapters = build(L);
    cur = 0;
    loadR(); loadH();

    /* A shapeless single chapter gets the file name as its title. */
    if (chapters.length === 1 && chapters[0].title === 'Beginning') {
      chapters[0].title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
    }

    /* Restore last-read chapter for this file. */
    try {
      const s = +localStorage.getItem('foliant-pos-' + name);
      if (s >= 0 && s < chapters.length) cur = s;
    } catch (e) {}

    $('#title').textContent = file.name.replace(/\.pdf$/i, '');
    $('#home').classList.add('hide');
    $('#reader').classList.remove('hide');
    render();
  } catch (err) {
    $('#msg').textContent = 'Could not read this PDF. It may be password protected or damaged.';
  }
}

$('#file').onchange = e => open(e.target.files[0]);

const dz = $('#drop');
['dragover', 'dragenter'].forEach(v => dz.addEventListener(v, e => { e.preventDefault(); dz.classList.add('on'); }));
['dragleave', 'drop'].forEach(v => dz.addEventListener(v, e => { e.preventDefault(); dz.classList.remove('on'); }));
dz.addEventListener('drop', e => open(e.dataTransfer.files[0]));
