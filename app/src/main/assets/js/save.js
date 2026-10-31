/* save.js — every change is saved by itself, quietly: into the original file, or into one "-edited" copy.
   Each page's marks go into the PDF as a separate layer plus the marks themselves, so after saving they can still be
   erased or changed (the phone does this: jobs 'marks', 'rebuild', 'readmarks').
   Per page: ver = changes of its marks; vO / vC = the version already in the original / copy;
   opn = where the page was in the original when it was opened (the phone keeps a backup to rebuild from);
   fo / cpn = where the page is now in the original / copy file. */

const SAVE = { t: 0, busy: false, again: false, pend: false, fails: 0, oN: 0, cN: 0, og: 1 };
/* copy mode keeps the original untouched; a file that already is an "-edited" copy is simply saved into */
const saveMode = () => { const m = pref('saveMode', 'copy'); return m === 'copy' && /-edited(-\d+)?$/i.test(DOC.name) ? 'original' : m; };
const firstPdf = () => pages.find(p => p.kind === 'pdf');
const nativeDoc = () => { const f = firstPdf(); return !!(f && f.nid && pages.every(p => p.kind === 'blank' || (p.kind === 'pdf' && p.nid === f.nid && p.opn))); };
const pageDirty = (p, mode) => (p.ver || 0) !== ((mode === 'original' ? p.vO : p.vC) || 0);
const orderOk = (key, n) => n > 0 && pages.length === n && pages.every((p, i) => p[key] === i + 1);
const wire = l => l.map(s => s.t === 'tx' ? Object.assign({}, s, { img: txImg(s) }) : s);   // text also travels as a picture

/* ---------- marks not saved yet survive closing the app or a crash ---------- */
const MK = 'ms.marks';
const loadLocal = () => ls(MK, {});
const pageKey = p => p.nid ? A.entryKey(p.nid) + '|' + (p.sidx || p.pn) : null;
const plain = l => l.map(s => { const o = Object.assign({}, s); delete o.img; return o; });
function storeLocal() {
  try {
    const all = loadLocal(), mode = saveMode();
    for (const p of pages) { const k = pageKey(p); if (!k) continue; if (pageDirty(p, mode)) all[k] = plain(p.strokes); else delete all[k]; }
    const s = JSON.stringify(all); if (s.length < 4e6) localStorage.setItem(MK, s);
  } catch (e) {}
}
let lst = 0; const storeLocalSoon = () => { clearTimeout(lst); lst = setTimeout(storeLocal, 250); };

/* ---------- something changed ---------- */
function changedMarks(p) { storeLocalSoon(); scheduleSave(); }
function changedPages() { scheduleSave(); }
function scheduleSave(ms) { if (!pages.length) return; SAVE.pend = true; clearTimeout(SAVE.t); SAVE.t = setTimeout(autoSave, ms != null ? ms : (BOOK || pages.length > 400 ? 1200 : 500)); }
function beforeReplace() { storeLocal(); saveStateNow(); }

/* ---------- a document was opened: marks saved inside it come back as marks that can be erased or changed ---------- */
function applyMarks(list, saved) {
  const local = loadLocal(); let n = 0;
  for (const p of list) {
    if (saved && saved[p.pn] && !p.ver) { p.strokes.splice(0, p.strokes.length, ...saved[p.pn]); p.tstale = true; redraw(p); }
    const k = pageKey(p);
    if (k && local[k] && JSON.stringify(local[k]) !== JSON.stringify(plain(p.strokes))) { p.strokes.splice(0, p.strokes.length, ...local[k]); p.ver = (p.ver || 0) + 1; p.tstale = true; redraw(p); n++; }
  }
  if (n) scheduleSave();
}
function docOpened(fresh, added) {
  if (fresh) {
    resetSave(); const f = firstPdf(); SAVE.oN = 0; SAVE.og = 1;
    pages.forEach(p => { p.ver = p.vO = p.vC = 0; p.og = 1; p.opn = p.fo = p.kind === 'pdf' && f && p.nid === f.nid ? p.pn : 0; if (p.opn) SAVE.oN++; });
  } else added.forEach(p => { p.ver = p.strokes.length ? 1 : 0; p.vO = p.vC = 0; p.opn = p.fo = 0; });
  const byNid = {};
  added.forEach(p => { if (p.kind === 'pdf' && p.nid) (byNid[p.nid] = byNid[p.nid] || []).push(p); });
  const other = added.filter(p => !(p.kind === 'pdf' && p.nid)); if (other.length) applyMarks(other, null);
  for (const nid in byNid) pdfJob({ op: 'readmarks', src: +nid }).then(r => applyMarks(byNid[nid].filter(p => pages.includes(p)), r.marks || {})).catch(() => applyMarks(byNid[nid], null));
  searchDocChanged(fresh); readerDocChanged(); saveStateSoon();
}

/* ---------- saving ---------- */
async function saveNative(mode) {
  const toCopy = mode !== 'original', primary = firstPdf().nid, name = DOC.name + '-edited.pdf';
  const key = toCopy ? 'cpn' : 'fo', vk = toCopy ? 'vC' : 'vO', ver = pages.map(p => p.ver || 0);
  if (!orderOk(key, toCopy ? SAVE.cN : SAVE.oN)) {            // first copy, or pages moved / added / deleted: write the whole file
    const order = pages.map(p => p.kind === 'blank' ? { blank: [p.w, p.h] } : { pn: p.og === SAVE.og ? p.opn : -1 }), marks = {};
    pages.forEach((p, i) => { if (p.strokes.length) marks[i + 1] = wire(p.strokes); });
    const r = await pdfJob({ op: 'rebuild', src: primary, order, marks, mode: toCopy ? 'copyr' : 'original', name });
    const intoOrig = r.mode === 'original';
    if (intoOrig && !r.backup) SAVE.og++;                     // no backup kept: the rewritten original is the source from now on
    pages.forEach((p, i) => {
      if (intoOrig) { p.fo = i + 1; p.vO = ver[i]; if (!r.backup && p.kind !== 'blank') { p.opn = i + 1; p.og = SAVE.og; } }
      else { p.cpn = i + 1; p.vC = ver[i]; }
    });
    if (intoOrig) SAVE.oN = pages.length; else SAVE.cN = pages.length;
    return r;
  }
  const marks = {}, sent = [];
  pages.forEach((p, i) => { if (pageDirty(p, mode)) { marks[p[key]] = wire(p.strokes); sent.push([p, ver[i]]); } });
  if (!sent.length) return null;
  let r;
  try { r = await pdfJob({ op: 'marks', src: primary, marks, mode: toCopy ? 'copyr' : 'original', name, book: BOOK ? BOOK.key : '', partSize: BOOK ? BOOK.size : 0 }); }
  catch (e) { if (/nocopy/.test(e.message)) { SAVE.cN = 0; return saveNative(mode); } throw e; }
  sent.forEach(([p, v]) => { p[vk] = v; });
  if (r.key && BOOK) BOOK.key = r.key;
  return r;
}
/* the original bytes, fetched again only while saving or exporting */
async function withBytes(list, fn) {
  const srcs = new Set(); for (const p of list) if (p.src && !p.bytes) srcs.add(p.src);
  for (const s of srcs) if (!s.bytes) s.bytes = new Uint8Array(await (await fetchOk(s.url)).arrayBuffer());
  for (const p of list) if (p.src && !p.bytes) p.bytes = p.src.bytes;
  try { return await fn(); } finally { for (const p of pages) if (p.src) p.bytes = null; for (const s of srcs) s.bytes = null; }
}
const refOf = async p => { try { await ensure(p); return p.page && p.page.ref || null; } catch (e) { return null; } };
/* pictures, Word, text, several files: a PDF copy is made once, then marks are written into it the same way */
async function saveOther() {
  const primary = DOC.primary, ver = pages.map(p => p.ver || 0); if (!primary) return null;
  if (!orderOk('cpn', SAVE.cN)) {
    for (const p of pages) { try { await ensure(p); } catch (e) {} }
    await lib(LIB.pdflib);
    const bare = p => Object.assign(Object.create(p), { strokes: [] });
    const bytes = await withBytes(pages, () => MarkupSaver.build(PDFLib, pages.map(bare), async p => new Uint8Array(await (await blobOf(await pageCanvas(bare(p), 2), 'image/jpeg', .9)).arrayBuffer()), refOf));
    await saveBlob(new Blob([bytes], { type: 'application/pdf' }), 'copyr', DOC.name + '-edited.pdf', primary);
    pages.forEach((p, i) => { p.cpn = i + 1; p.vC = p.strokes.length ? -1 : ver[i]; });
    SAVE.cN = pages.length;
  }
  const marks = {}, sent = [];
  pages.forEach((p, i) => { if (pageDirty(p, 'copy')) { marks[p.cpn] = wire(p.strokes); sent.push([p, ver[i]]); } });
  if (!sent.length) return { mode: 'copy' };
  const r = await pdfJob({ op: 'marks', src: primary, marks, mode: 'copyr', name: DOC.name + '-edited.pdf' });
  sent.forEach(([p, v]) => { p.vC = v; });
  return r;
}
async function autoSave() {
  clearTimeout(SAVE.t); if (!SAVE.pend || !pages.length) return;
  if (SAVE.busy) { SAVE.again = true; return; }
  SAVE.busy = true; SAVE.pend = false;
  try { if (nativeDoc()) await saveNative(saveMode()); else await saveOther(); SAVE.fails = 0; storeLocal(); }
  catch (e) {
    SAVE.pend = true; SAVE.fails++;
    if (SAVE.fails === 3) toast('Could not save the changes yet: ' + (e && e.message || e) + ' — trying again.', 6000);
    clearTimeout(SAVE.t); SAVE.t = setTimeout(autoSave, Math.min(30000, 3000 * SAVE.fails));
  } finally { SAVE.busy = false; }
  if (SAVE.again) { SAVE.again = false; scheduleSave(300); }
}
async function flushSave() {
  if (SAVE.pend && !SAVE.busy) await autoSave();
  let n = 0; while (SAVE.busy && n++ < 900) await sleep(200);
  if (SAVE.pend) await autoSave();
}
function resetSave() { clearTimeout(SAVE.t); SAVE.cN = 0; SAVE.pend = false; SAVE.fails = 0; }
