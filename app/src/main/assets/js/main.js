/* main.js — starting, leaving and the Back button; the self-test used by the automatic phone tests */

/* ---------- leaving the app (home button, another app, screen off): everything is saved at once ---------- */
window.__paused = () => {
  storeLocal(); if (SAVE.pend) autoSave();
  if (R.on) { R.resumeAt = { p: R.page, wi: R.wi }; stopReading(); }
  if (AS.on) stopAutoScroll();
  saveStateNow();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) window.__paused(); });

/* ---------- Back: closes what is open, one thing at a time ---------- */
window.__back = () => {
  if (!fb.hidden) { fbUp(true); return true; }
  if (!sp.hidden) { if (sp.classList.contains('mini2')) sp.classList.remove('mini2'); else { sp.hidden = true; clearSearch(); } return true; }
  if (PANELS.some(q => !$(q).hidden)) { closePanels(); return true; }
  if (!cm.hidden) { cm.hidden = true; return true; }
  if ([sbar, ebar, ibar].some(b => !b.hidden)) { showOnly(null); return true; }
  if (ED) { setTool('scroll'); return true; }
  if (inGrid()) { closeGrid(); return true; }
  return false;
};

/* ---------- self-test of the phone's tools (started only by the automatic tests) ---------- */
window.__selfTest = async () => {
  const log = (...a) => console.log('SELFTEST ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
  try {
    const nid = pages[0].nid, st = { t: 'hl', c: '#facc15', a: .4, w: 14, segs: [[60, 90, 300, 104]] };
    log('book', pages.length, 'pages, prepared in parts', !!BOOK);
    const r1 = await pdfJob({ op: 'export', src: nid, pages: [...Array(60).keys()].map(i => i + 1), marks: { 1: [st] }, parts: 2, name: 'selftest' });
    log('export 2 parts', r1.ok, r1.files);
    const r2 = await pdfJob({ op: 'export', src: nid, pages: [1, 2, 3, 4, 5], parts: 1, dest: 'temp', name: 't' });
    const r3 = await pdfJob({ op: 'export', src: nid, pages: [6, 7, 8], parts: 1, dest: 'temp', name: 't' });
    const r4 = await pdfJob({ op: 'merge', files: [r2.files[0], r3.files[0]], name: 'selftest-merged', deleteSources: true });
    log('merge', r4.ok, r4.files);
    const t0 = Date.now(); let last = '';
    await exportBig(pages.slice(0, 30), 40, t => { last = t; }, { tries: 2, cap: 6e6, off: 0 }, 1);
    log('compress 40%', last, (Date.now() - t0) + 'ms');
    const r6 = await pdfJob({ op: 'rebuild', src: nid, order: [...Array(12).keys()].map(i => ({ pn: i + 1 })).concat([{ blank: [595, 842] }]), marks: {}, mode: 'copyr', name: 'selftest-copy.pdf' });
    log('rebuild copy', r6.ok, r6.where);
    const tx = { t: 'tx', x: 60, y: 300, runs: [[{ t: 'नमस्ते ', sz: 18, c: '#dc2626', a: 1 }, { t: 'Hello', sz: 24, c: '#2563eb', a: .8 }]], text: '', w: 0, h: 0 };
    txLayout(tx);
    const r7 = await pdfJob({ op: 'marks', src: nid, marks: { 2: [st], 3: wire([tx]) }, mode: 'copyr', name: 'x' });
    log('marks into copy', r7.ok, 'incremental', r7.incremental, r7.where);
    const yellowOf = async show => {
      const ab = new Uint8Array(await (await fetchOk('/__file/' + A.registerFile(r7.where))).arrayBuffer());
      const d = await pdfjsLib.getDocument({ data: ab }).promise, pg2 = await d.getPage(2), vp = pg2.getViewport({ scale: .5 }), c = el('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      const o = { canvasContext: x, viewport: vp }; if (show) o.optionalContentConfigPromise = d.getOptionalContentConfig();
      await pg2.render(o).promise; const px = x.getImageData(0, 0, c.width, c.height).data; let yellow = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 225 && px[i + 1] > 195 && px[i + 2] < 205) yellow++;
      const n = d.numPages; await d.destroy(); return { yellow, n };
    };
    let y1 = await yellowOf(true); const y0 = await yellowOf(false);
    log('copy check: pages', y1.n, 'marks seen by other apps', y1.yellow, y1.yellow > 200 ? 'PASS' : 'FAIL', '· hidden in this app', y0.yellow, y0.yellow < 80 ? 'PASS' : 'FAIL');
    const rm1 = await pdfJob({ op: 'readmarks', src: A.registerFile(r7.where) }), m2 = (rm1.marks || {})['2'] || [], m3 = (rm1.marks || {})['3'] || [];
    log('marks read back', m2.length === 1 && m2[0].t === 'hl' ? 'PASS' : 'FAIL', 'text read back', m3.length === 1 && m3[0].text === tx.text && m3[0].runs && !m3[0].img ? 'PASS' : 'FAIL');
    await pdfJob({ op: 'marks', src: nid, marks: { 2: [] }, mode: 'copyr', name: 'x' });
    y1 = await yellowOf(true); const rm2 = await pdfJob({ op: 'readmarks', src: A.registerFile(r7.where) });
    log('erased after saving', y1.yellow < 80 && !(rm2.marks || {})['2'] && (rm2.marks || {})['3'] ? 'PASS' : 'FAIL', y1.yellow);
    const cv = el('canvas'); cv.width = 1400; cv.height = 420; const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 1400, 420); g.fillStyle = '#111'; g.font = '56px sans-serif';
    g.fillText('भारत एक विशाल देश है', 60, 120); g.fillText('Health is wealth', 60, 240); g.fillText('डॉक्टर Doctor 25 mg', 60, 360);
    const or = await ocrCall(cv.toDataURL('image/jpeg', .92)), all = (or.lines || []).map(l => l.t).join(' | ');
    log('text recognition', or.ok, all, /भारत/.test(all) && /Health/.test(all) ? 'PASS' : 'FAIL ' + (or.err || ''));
    /* scanned book -> searchable copy: invisible words on the original pages */
    const textIn = async (path, pn) => {
      if (path[0] !== '/') path = '/storage/emulated/0/' + path;
      const ab = new Uint8Array(await (await fetchOk('/__file/' + A.registerFile(path))).arrayBuffer()), d = await pdfjsLib.getDocument({ data: ab }).promise;
      const pg = await d.getPage(pn), tc = await pg.getTextContent(), s = tc.items.map(i => i.str).join(' '), n = d.numPages, vp = pg.getViewport({ scale: .5 }), c = el('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: x, viewport: vp }).promise; const px = x.getImageData(0, 0, c.width, c.height).data; let blue = 0, dark = 0;
      for (let i = 0; i < px.length; i += 4) { if (px[i + 2] > 150 && px[i] < 90) blue++; if (px[i] < 100 && px[i + 1] < 100 && px[i + 2] < 100) dark++; }
      await d.destroy(); return { s, n, blue, dark };
    };
    const wj = await saveBlob(new Blob([JSON.stringify({ 1: [[60, 120, 200, 14, 'भारत'], [210, 120, 320, 14, 'Health']] })]), 'temp', 'ocr.json', 0);
    const r8 = await pdfJob({ op: 'ocrpdf', src: nid, pages: [1, 2], words: wj.where, marks: {}, name: 'selftest-searchable' });
    const s8 = await textIn(r8.files[0], 1);
    log('searchable copy', r8.ok, r8.words, 'words, pages', s8.n, /भारत/.test(s8.s) && /Health/.test(s8.s) ? 'PASS' : 'FAIL ' + s8.s.slice(-80));
    /* scanned page -> typed page with its picture */
    const sc = el('canvas'); sc.width = 1240; sc.height = 1754; const h = sc.getContext('2d');
    h.fillStyle = '#f3eedf'; h.fillRect(0, 0, 1240, 1754); h.fillStyle = '#1a1a1a'; h.font = '44px sans-serif';
    ['भारत एक विशाल देश है', 'Health is wealth', 'डॉक्टर Doctor 25 mg'].forEach((t, i) => h.fillText(t, 90, 160 + i * 80));
    h.fillStyle = '#1e40af'; h.fillRect(300, 600, 600, 400); h.fillStyle = '#facc15'; h.beginPath(); h.arc(600, 800, 120, 0, 7); h.fill();
    h.fillStyle = '#1a1a1a'; h.fillText('Last line under the picture', 90, 1200);
    const fp = { w: 595, h: 842 }, ln = await recognise(sc), tp = typedPage(fp, sc, ln);
    A.typedBegin(); const tr = A.typedPage(JSON.stringify(tp)), te = JP(A.typedEnd(false), {});
    const r9 = await pdfJob({ op: 'merge', files: te.files || [], name: 'selftest-typed', deleteSources: true });
    const s9 = await textIn(r9.files[0], 1);
    log('typed page', tr, 'pictures', tp.imgs.length, 'lines', tp.lines.length, /Health/.test(s9.s) ? 'PASS' : 'FAIL', 'picture kept', s9.blue > 2000 ? 'PASS' : 'FAIL', s9.blue, 'text:', s9.s.slice(0, 160));
    log('ALL DONE');
  } catch (e) { log('FAILED', e && e.message || String(e)); }
};

/* ---------- start: files sent to the app, else the last document ---------- */
(async function start() {
  setTool('scroll'); applyPic(); updBars(); A.ttsInit();
  A.jsReady();
  const pend = JP(A.takePending(), []);
  if (pend.length) { await openDocs(pend, 'replace'); return; }
  if (pref('resume', '1') === '0') return;
  if (A.safeStart()) { toast('The last book was not reopened because the viewer ran out of memory. Open it again from 📂.', 7000); return; }
  const last = JP(A.reopenLast(), null);
  if (last && last.entries && last.entries.length) await openDocs(last.entries, 'replace', { page: last.page, frac: last.frac });
})();
