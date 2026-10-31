/* native.js — Android-only layer on top of the viewer:
   open-with / share / resume, save (original or copy), reader (TTS), auto-scroll, tap-to-read. */
(function () {
'use strict';
if (!window.Android) return;
const A = window.Android, RC = window.ReaderCore, SV = window.MarkupSaver, view = $('#view');
const JP = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const pref = (k, d) => { const v = A.getPref(k, ''); return v === '' ? d : v; };
const meta = {};                                   // native id -> {name,mime}

/* ---------- styles + small UI helpers ---------- */
const st = document.createElement('style');
st.textContent = `#toast{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);background:rgba(0,0,0,.82);color:#fff;padding:8px 14px;border-radius:18px;font-size:13px;z-index:30;max-width:90vw;opacity:0;transition:opacity .25s;pointer-events:none;text-align:center}
.panel{position:fixed;left:50%;transform:translateX(-50%);bottom:74px;width:min(390px,94vw);max-height:68vh;overflow:auto;background:var(--bar);border:1px solid var(--bd);border-radius:14px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.35);z-index:8;display:flex;flex-direction:column;gap:9px}
.panel[hidden]{display:none}.panel .row{display:flex;gap:8px;align-items:center;justify-content:space-between}.panel .row>span{color:var(--mut);font-size:13px}
.panel select{background:var(--bar);color:var(--fg);border:1px solid var(--bd);border-radius:8px;padding:6px;font:inherit;font-size:13px;max-width:64%;min-width:0}
.panel input[type=range]{flex:1;min-width:0}.panel label{font-size:13px;color:var(--fg);white-space:normal;align-items:flex-start;line-height:1.35}.panel label input{margin-top:2px;flex:none}.panel small{color:var(--mut);font-size:12px;line-height:1.35}.panel hr{border:0;border-top:1px solid var(--bd);margin:0;width:100%}
.panel .big{flex:1;padding:8px 6px}
.rh{position:absolute;pointer-events:none;background:rgba(255,196,0,.5);border-radius:3px;z-index:3}.rl{position:absolute;pointer-events:none;background:rgba(37,99,235,.13);z-index:2}
#sv.dirty::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#e11d48;margin-left:4px;vertical-align:middle}
body.grid .panel{display:none!important}
.lay{position:absolute;pointer-events:none;z-index:2;border-radius:3px}
.lr{border:2px solid rgba(22,163,74,.8);background:rgba(22,163,74,.05)}
.lr::before{content:attr(data-n);position:absolute;left:0;top:0;transform:translate(-45%,-45%);background:#16a34a;color:#fff;font:700 11px system-ui,sans-serif;border-radius:9px;min-width:18px;height:18px;line-height:18px;text-align:center;padding:0 4px}
.ls{background:rgba(220,38,38,.2);outline:1px dashed rgba(220,38,38,.75)}
#fb{position:fixed;left:0;top:0;right:0;bottom:0;background:var(--bg);z-index:20;display:flex;flex-direction:column}#fb[hidden]{display:none}
#fbh,#fbf{display:flex;gap:6px;align-items:center;padding:8px;background:var(--bar);border-bottom:1px solid var(--bd)}#fbf{border-top:1px solid var(--bd);border-bottom:0;flex-wrap:wrap}
#fbt{flex:1;font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fbr{display:flex;gap:6px;overflow-x:auto;padding:6px 8px;border-bottom:1px solid var(--bd);scrollbar-width:none}#fbr button{flex:none}
#fbp{font-size:12px;color:var(--mut);padding:5px 10px;white-space:nowrap;overflow-x:auto;direction:rtl;text-align:left}
#fbl{flex:1;overflow:auto;-webkit-overflow-scrolling:touch}
.fi{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--bd);cursor:pointer;user-select:none}.fi:active{background:var(--ac2)}
.fi .ic{font-size:22px;width:28px;text-align:center;flex:none}.fi .nm{flex:1;min-width:0}.fi .nm div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fi .mt{font-size:11px;color:var(--mut)}
#fbm{padding:22px 16px;color:var(--mut);text-align:center;line-height:1.5}#fbm button{margin-top:10px;background:var(--ac);color:#fff;border:none;padding:9px 16px}`;
document.head.appendChild(st);
let tt;
function toast(m, ms) { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = m; el.style.opacity = 1; clearTimeout(tt); tt = setTimeout(() => el.style.opacity = 0, ms || 2600); }
window.__toast = toast;
const mk = (tag, props, html) => { const e = document.createElement(tag); Object.assign(e, props || {}); if (html != null) e.innerHTML = html; return e; };
const btn = (id, txt, title) => mk('button', { id, title }, txt);

/* ---------- bar buttons ---------- */
const pm = btn('pm', '📄', 'This page: move, delete, bookmark…'), rd = btn('rd', '🔊', 'Read aloud / auto-scroll'), mn = btn('mn', '⋮', 'Settings'), ob = btn('ob', '📂', 'Open a file');
$('#exbtn').after(pm, rd); $('#info').before(mn); $('#pgs').before(ob);

/* ---------- opening files from Android (open with / share / picker / resume) ---------- */
async function fetchEntry(e) {
  const url = '/__file/' + e.id; meta[e.id] = { name: e.name, mime: e.mime, size: e.size };
  if ((/pdf/i.test(e.mime || '') || /\.pdf$/i.test(e.name || '')) && e.size > BIGPDF) {   // big book: do not load it all into memory
    const get = () => fetch(url, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r; });
    return { name: e.name || 'document.pdf', type: 'application/pdf', size: e.size, _nid: e.id, _url: url, arrayBuffer: () => get().then(r => r.arrayBuffer()), text: () => get().then(r => r.text()) };
  }
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const b = await r.blob(), f = new File([b], e.name || 'document', { type: e.mime || b.type || '' });
  f._nid = e.id; f._url = url; return f;
}
window.__nativeOpen = async function (list, mode, pos) {
  const files = [], bad = [];
  for (const e of list) { try { files.push(await fetchEntry(e)); } catch (x) { bad.push(e.name || 'file'); } }
  if (bad.length) toast('Could not read: ' + bad.join(', '), 4200);
  if (!files.length) return;
  stopAll();
  window.__wantPage = pos && mode !== 'add' ? pos.page : 0;
  await openFiles(files, mode !== 'add');
  if (pos) { if (window.__book()) window.__gotoGlobal(pos.page, pos.frac); else restorePos(pos.page, pos.frac); }
};
$('#open2').onclick = () => fbOpen('open');
$('#gfile').onclick = () => fbOpen('add');
ob.onclick = () => fbOpen('open');

/* ---------- remembering the last document / position ---------- */
let userTouched = false;
function topPage() {                          // fast for books of thousands of pages
  if (!pages.length) return null; const v = view; let lo = 0, hi = pages.length - 1, y = v.scrollTop + 4;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pages[m].wrap.offsetTop <= y) lo = m; else hi = m - 1; }
  const p = pages[lo], top = p.wrap.offsetTop, hgt = p.wrap.offsetHeight || 1; return { p, frac: Math.max(0, Math.min(1, (y - top) / hgt)) };
}
function restorePos(idx, frac) {
  if (!pages.length) return; idx = Math.max(0, Math.min(pages.length - 1, idx | 0)); userTouched = false;
  const go = () => { const t = pages[idx]; if (!t || userTouched) return; const vr = view.getBoundingClientRect(), r = t.wrap.getBoundingClientRect(); view.scrollTop += r.top - vr.top + (frac || 0) * r.height; };
  go(); [250, 800, 1800].forEach(ms => setTimeout(go, ms));
}
function saveStateNow() {
  if (!pages.length) return; const t = topPage(); if (!t) return;
  const ids = [...new Set(pages.map(q => q.nid).filter(Boolean))];
  if (ids.length) A.saveState(ids.join(','), window.__pageNo(t.p) - 1, t.frac);
}
let sst; const saveStateSoon = () => { clearTimeout(sst); sst = setTimeout(saveStateNow, 700); };
view.addEventListener('scroll', saveStateSoon, { passive: true });
view.addEventListener('touchstart', () => { userTouched = true; R.userUntil = performance.now() + 2500; AS.touching = true; }, { passive: true });
view.addEventListener('touchend', () => { AS.touching = false; AS.resumeAt = performance.now() + 600; }, { passive: true });
view.addEventListener('touchcancel', () => { AS.touching = false; }, { passive: true });
view.addEventListener('wheel', () => { R.userUntil = performance.now() + 2500; }, { passive: true });

/* ---------- marks not saved yet survive closing the app or a crash ---------- */
const MK = 'ms.marks';
const loadMarks = () => { try { return JSON.parse(localStorage.getItem(MK) || '{}'); } catch (e) { return {}; } };
const pageKey = p => p.nid ? A.entryKey(p.nid) + '|' + (p.sidx || p.pn) : null;
const clean = l => l.map(s => { const o = Object.assign({}, s); delete o.inOrig; delete o.inCopy; delete o.img; return o; });
/* every page whose marks are not yet in the file: its whole list of marks */
function saveMarks() {
  try {
    const all = loadMarks(), mode = saveMode();
    for (const p of pages) { const k = pageKey(p); if (!k) continue; if (pDirty(p, mode)) all[k] = clean(p.strokes); else delete all[k]; }
    const s = JSON.stringify(all); if (s.length < 4e6) localStorage.setItem(MK, s);
  } catch (e) {}
}
let mst; const saveMarksSoon = () => { clearTimeout(mst); mst = setTimeout(saveMarks, 250); };
window.__dirtyChanged = d => { if (d) { saveMarksSoon(); scheduleSave(); } };
let skipMarks = false;
window.__beforeReplace = () => { if (skipMarks) { skipMarks = false; } else saveMarks(); saveStateNow(); };
/* a freshly opened PDF: the marks saved inside it come back as marks that can be erased or changed */
function applyMarks(list, saved) {
  const local = loadMarks(); let n = 0;
  for (const p of list) {
    if (saved && saved[p.pn] && !p.ver) { p.strokes.splice(0, p.strokes.length, ...saved[p.pn]); p.thumb = null; p.tstale = true; redraw(p); }
    const k = pageKey(p);
    if (k && local[k] && JSON.stringify(local[k]) !== JSON.stringify(clean(p.strokes))) { p.strokes.splice(0, p.strokes.length, ...local[k]); p.ver = (p.ver || 0) + 1; p.tstale = true; redraw(p); n++; }
  }
  if (n) setDirty();
  if (window.__txFonts) window.__txFonts(list);
}
window.__docChanged = (fresh, added) => {
  if (fresh) {
    window.__resetSave();
    const f = firstPdf(); AS2.oN = 0;
    AS2.og = 1;
    pages.forEach(p => { p.ver = 0; p.vO = 0; p.vC = 0; p.og = 1; p.opn = p.kind === 'pdf' && f && p.nid === f.nid ? p.pn : 0; p.fo = p.opn; if (p.opn) AS2.oN++; });
  } else added.forEach(p => { p.ver = p.strokes.length ? 1 : 0; p.vO = p.vC = 0; p.opn = p.fo = 0; });
  const byNid = {};
  added.forEach(p => { if (p.kind === 'pdf' && p.nid && window.__pdfJob) (byNid[p.nid] = byNid[p.nid] || []).push(p); });
  const other = added.filter(p => !(p.kind === 'pdf' && p.nid && window.__pdfJob)); if (other.length) applyMarks(other, null);
  for (const nid in byNid) window.__pdfJob({ op: 'readmarks', src: +nid }).then(r => applyMarks(byNid[nid].filter(p => pages.includes(p)), r.marks || {})).catch(() => applyMarks(byNid[nid], null));
  saveStateSoon(); if (RS.show) setTimeout(layoutAll, 600);
};

/* ---------- the phone's own PDF tools (big books): jobs with progress ---------- */
const jobs = {};
window.__job = (id, type, d) => { const j = jobs[id]; if (!j) return; if (type === 'progress') { if (j.prog) j.prog(d); } else if (type !== 'done') { if (j.on) j.on(type, d); } else { delete jobs[id]; A.keepAwake(false); if (d.ok) j.ok(d); else j.no(new Error(d.err || 'failed')); } };
window.__pdfJob = (o, prog, on) => new Promise((ok, no) => { A.keepAwake(true); const id = A.job(JSON.stringify(o)); jobs[id] = { ok, no, prog, on }; });
/* ---------- auto-save: every change goes into the original file or into one "-edited" copy, quietly ----------
   Each page's marks are written into the file as a separate layer plus the marks themselves, so after saving they can
   still be erased or changed. Pages moved, added or deleted: the file is written again in the new order.
   p.ver counts changes of a page's marks; p.vO / p.vC = the version already in the original / copy;
   p.opn = where the page was in the original when it was opened (rebuilds take pages from there, a kept backup);
   p.fo / p.cpn = where the page is now in the original / copy file. */
const saveMode = () => pref('saveMode', 'copy');
const AS2 = { t: 0, busy: false, again: false, pend: false, fails: 0, oN: 0, cN: 0, og: 1 };
window.__structChanged = () => {};
const firstPdf = () => pages.find(p => p.kind === 'pdf');
const nativeDoc = () => { const f = firstPdf(); return !!(window.__pdfJob && f && f.nid && pages.every(p => p.kind === 'blank' || (p.kind === 'pdf' && p.nid === f.nid && p.opn))); };
const isBig = () => { const f = firstPdf(); return nativeDoc() && (!!window.__book() || (f.src && f.src.size > JSBIG) || pages.length > 400); };
function pDirty(p, mode) { const v = p.ver || 0; return mode === 'original' ? v !== (p.vO || 0) : v !== (p.vC || 0); }
window.__pDirty = pDirty;
function scheduleSave(ms) { if (!pages.length) return; AS2.pend = true; clearTimeout(AS2.t); AS2.t = setTimeout(autoSave, ms != null ? ms : (isBig() ? 1200 : 500)); }
const posNow = () => { const t = topPage(); return { page: t ? pages.indexOf(t.p) : 0, frac: t ? t.frac : 0 }; };
const orderOk = (key, n) => n > 0 && pages.length === n && pages.every((p, i) => p[key] === i + 1);
/* text marks travel to the file as a picture as well (Hindi and English look exactly as on screen) */
const wire = l => l.map(s => s.t === 'tx' && window.__txImg ? Object.assign({}, s, { img: window.__txImg(s) }) : s);
async function saveNative(mode) {
  const toCopy = mode !== 'original', f = firstPdf(), primary = f.nid, B = window.__book(), name = docName + '-edited.pdf';
  const key = toCopy ? 'cpn' : 'fo', vk = toCopy ? 'vC' : 'vO', ver = pages.map(p => p.ver || 0);
  if (!orderOk(key, toCopy ? AS2.cN : AS2.oN)) {            // first copy, or pages moved / added / deleted: write the whole file
    const order = pages.map(p => p.kind === 'blank' ? { blank: [p.w, p.h] } : { pn: p.og === AS2.og ? p.opn : -1 }), marks = {};
    pages.forEach((p, i) => { if (p.strokes.length) marks[i + 1] = wire(p.strokes); });
    const r = await window.__pdfJob({ op: 'rebuild', src: primary, order, marks, mode: toCopy ? 'copyr' : 'original', name });
    const into = r.mode === 'original' ? 'o' : 'c';
    if (into === 'o' && !r.backup) AS2.og++;                  // no backup kept: the rewritten original is the source from now on
    pages.forEach((p, i) => { if (into === 'o') { p.fo = i + 1; p.vO = ver[i]; if (!r.backup && p.kind !== 'blank') { p.opn = i + 1; p.og = AS2.og; } } else { p.cpn = i + 1; p.vC = ver[i]; } });
    if (into === 'o') AS2.oN = pages.length; else AS2.cN = pages.length;
    return r;
  }
  const marks = {}, sent = [];
  pages.forEach((p, i) => { if (pDirty(p, mode)) { marks[p[key]] = wire(p.strokes); sent.push([p, ver[i]]); } });
  if (!sent.length) return null;
  let r;
  try { r = await window.__pdfJob({ op: 'marks', src: primary, marks, mode: toCopy ? 'copyr' : 'original', name, book: B && B.key || '', partSize: B ? B.size : 0 }); }
  catch (e) { if (/nocopy/.test(e.message)) { AS2.cN = 0; return saveNative(mode); } throw e; }
  sent.forEach(([p, v]) => { p[vk] = v; });
  if (r.key && B) B.key = r.key;
  return r;
}
/* pictures, Word, text, several files: a PDF copy is made once, then marks are written into it like above */
async function saveOther() {
  const primary = docPrimary || 0, ver = pages.map(p => p.ver || 0);
  if (!primary) return null;
  if (!orderOk('cpn', AS2.cN)) {
    for (const p of pages) { try { await ensure(p); } catch (e) {} }
    await lib(PDFLIB);
    const views = pages.map(p => Object.assign(Object.create(p), { strokes: [] }));
    const bytes = await window.__withBytes(pages, () => SV.build(PDFLib, views, async p => { const c = await pageCanvas(Object.assign(Object.create(p), { strokes: [] }), 2); return new Uint8Array(await (await blobOf(c, 'image/jpeg', .9)).arrayBuffer()); }, window.__refOf));
    await __saveBlob(new Blob([bytes], { type: 'application/pdf' }), 'copyr', docName + '-edited.pdf', primary);
    pages.forEach((p, i) => { p.cpn = i + 1; p.vC = p.strokes.length ? -1 : ver[i]; });
    AS2.cN = pages.length;
  }
  const marks = {}, sent = [];
  pages.forEach((p, i) => { if (pDirty(p, 'copy')) { marks[p.cpn] = wire(p.strokes); sent.push([p, ver[i]]); } });
  if (!sent.length) return { mode: 'copy' };
  const r = await window.__pdfJob({ op: 'marks', src: primary, marks, mode: 'copyr', name: docName + '-edited.pdf' });
  sent.forEach(([p, v]) => { p.vC = v; });
  return r;
}
async function autoSave() {
  clearTimeout(AS2.t); if (!AS2.pend || !pages.length) return;
  if (AS2.busy) { AS2.again = true; return; }
  AS2.busy = true; AS2.pend = false; let r = null;
  try {
    r = nativeDoc() ? await saveNative(saveMode()) : await saveOther();
    AS2.fails = 0; saveMarks();
  } catch (e) {
    AS2.pend = true; AS2.fails++;
    if (AS2.fails === 3) toast('Could not save the changes yet: ' + (e && e.message || e) + ' — trying again.', 6000);
    clearTimeout(AS2.t); AS2.t = setTimeout(autoSave, Math.min(30000, 3000 * AS2.fails));
  } finally { AS2.busy = false; }
  if (AS2.again) { AS2.again = false; scheduleSave(300); }
}
window.__flushSave = async () => { if (AS2.pend && !AS2.busy) await autoSave(); let n = 0; while (AS2.busy && n++ < 900) await new Promise(r => setTimeout(r, 200)); if (AS2.pend) await autoSave(); };
window.__resetSave = () => { clearTimeout(AS2.t); AS2.cN = 0; AS2.pend = false; AS2.fails = 0; };

/* ---------- 📄 this page: move, delete, copy, blank page, export, bookmarks, go to page ---------- */
const pmp = mk('div', { id: 'pmp', className: 'panel', hidden: true }, `
 <div class="row"><b id="pmt">Page</b><button id="pmx">✕</button></div>
 <div class="row"><button class="big" id="pmup">↑ Move up</button><button class="big" id="pmdn">↓ Move down</button></div>
 <div class="row"><button class="big" id="pmdup">⧉ Duplicate</button><button class="big" id="pmbl">＋ Blank page after</button></div>
 <div class="row"><button class="big" id="pmdel">🗑 Delete page</button><button class="big" id="pmexp">⬇ Export page</button></div>
 <div class="row"><button class="big" id="pmbm">🔖 Bookmark this page</button><button class="big" id="pmarr">▦ All pages</button></div>
 <div class="row"><span>Move this page to</span><input type="number" id="pmmv" min="1" inputmode="numeric" enterkeyhint="done" placeholder="page no." style="width:110px;font:inherit;padding:6px 8px;border:1px solid var(--bd);border-radius:8px;background:var(--bar);color:var(--fg)"></div>
 <div class="row"><span>Go to page</span><input type="number" id="pmgo" min="1" inputmode="numeric" enterkeyhint="go" style="width:110px;font:inherit;padding:6px 8px;border:1px solid var(--bd);border-radius:8px;background:var(--bar);color:var(--fg)"></div>
 <div><b style="font-size:13px">Bookmarks</b></div><div id="pmbl2"></div>`);
document.body.appendChild(pmp);
const bmKey = () => { const f = firstPdf() || pages[0]; return 'ms.bm.' + (f && f.nid ? A.entryKey(f.nid) : docName); };
const bmGet = () => { try { return JSON.parse(localStorage.getItem(bmKey()) || '[]'); } catch (e) { return []; } };
const bmSet = l => { try { localStorage.setItem(bmKey(), JSON.stringify(l)); } catch (e) {} };
function pmRefresh() {
  const p = pages[window.__curIndex()], i = pages.indexOf(p); $('#pmt').textContent = `Page ${i + 1} of ${pages.length}`;
  const l = bmGet(), has = l.some(b => b.n === i + 1); $('#pmbm').textContent = has ? '🔖 Remove bookmark' : '🔖 Bookmark this page';
  const box = $('#pmbl2'); box.innerHTML = l.length ? '' : '<small>No bookmarks yet.</small>';
  l.sort((a, b) => a.n - b.n).forEach(b => { const d = mk('div', { className: 'fi' }, `<div class="ic">🔖</div><div class="nm"><div>Page ${b.n}</div>${b.t ? `<div class="mt">${esc(b.t)}</div>` : ''}</div>`); d.onclick = () => { pmp.hidden = true; window.__gotoGlobal(b.n - 1, 0); }; box.appendChild(d); });
}
pm.onclick = () => { const open = pmp.hidden; document.querySelectorAll('.panel').forEach(x => { if (x !== pmp && x.id !== 'sp') x.hidden = true; }); pmp.hidden = !open; if (open) pmRefresh(); };
$('#pmx').onclick = () => pmp.hidden = true;
const curP = () => pages[window.__curIndex()];
$('#pmup').onclick = () => { const p = curP(); window.__pageOps.move(p, -1); window.__gotoGlobal(pages.indexOf(p), 0); pmRefresh(); };
$('#pmdn').onclick = () => { const p = curP(); window.__pageOps.move(p, 1); window.__gotoGlobal(pages.indexOf(p), 0); pmRefresh(); };
$('#pmdup').onclick = () => { window.__pageOps.dup(curP()); toast('Page copied'); pmRefresh(); };
$('#pmbl').onclick = () => { window.__pageOps.blank(curP()); toast('Blank page added after this one'); pmRefresh(); };
$('#pmdel').onclick = () => { const p = curP(), i = pages.indexOf(p); if (window.__pageOps.del(p)) { toast('Page ' + (i + 1) + ' deleted · ↶ undo brings it back'); window.__gotoGlobal(Math.min(i, pages.length - 1), 0); } pmRefresh(); };
$('#pmmv').addEventListener('keydown', e => { if (e.key === 'Enter') { const n = +e.target.value, p = curP(); e.target.value = ''; e.target.blur(); if (n > 0 && p) { window.__pageOps.moveTo(p, n - 1); window.__gotoGlobal(pages.indexOf(p), 0); toast('Page moved to ' + (pages.indexOf(p) + 1)); pmRefresh(); } } });
$('#pmexp').onclick = () => { pmp.hidden = true; $('#exbtn').click(); $('#escope').value = 'cur'; $('#escope').dispatchEvent(new Event('change')); };
$('#pmbm').onclick = async () => {
  const p = curP(), i = pages.indexOf(p); let l = bmGet();
  if (l.some(b => b.n === i + 1)) l = l.filter(b => b.n !== i + 1);
  else { let t = ''; try { const r = await pageReadable(p); t = r.words.slice(0, 9).map(w => w.w).join(' '); } catch (e) {} l.push({ n: i + 1, t }); }
  bmSet(l); pmRefresh();
};
$('#pmarr').onclick = () => { pmp.hidden = true; $('#pgs').click(); };
$('#pmgo').addEventListener('keydown', e => { if (e.key === 'Enter') { const n = +e.target.value; e.target.value = ''; e.target.blur(); if (n > 0) { pmp.hidden = true; window.__gotoGlobal(n - 1, 0); } } });

/* ---------- panels ---------- */
const mp = mk('div', { id: 'mp', className: 'panel', hidden: true }, `
 <div class="row"><b>Settings</b><button id="mpx">✕</button></div>
 <div><b style="font-size:13px">Saving</b></div>
 <label><input type="radio" name="sm" value="original"> Save every change into the original file</label>
 <label><input type="radio" name="sm" value="copy"> Keep the original unchanged — save into a copy (name + “-edited”)</label>
 <small>Every mark, text and page change is saved by itself at once, also when the app is closed. Saved marks and text can still be erased later. Pictures, Word and text files are saved as a PDF copy.</small>
 <hr>
 <div><b style="font-size:13px">Folders</b></div>
 <div class="row"><span>Edited copy goes to</span><select id="mcw"><option value="orig">Folder of the original</option><option value="dir">Folder I choose</option></select></div>
 <div class="row" id="mcdr"><small id="mcdv"></small><button id="mcd">Choose</button></div>
 <div class="row"><span>Exports go to</span><button id="med">Change</button></div><small id="medv"></small>
 <hr>
 <div><b style="font-size:13px">Big books</b></div>
 <small id="mmem"></small>
 <div class="row"><button class="big" id="mmerge">Join PDF files into one…</button></div>
 <hr>
 <div class="row"><span>Theme</span><select id="mth"><option value="light">White</option><option value="dark">Dark</option><option value="auto">Same as phone</option></select></div>
 <hr>
 <label><input type="checkbox" id="mfs"> Full screen (hide status and navigation bars)</label>
 <label><input type="checkbox" id="mres"> Reopen the last document on start</label>
 <hr>
 <div><b style="font-size:13px">Storage access</b></div>
 <small id="mstore"></small>
 <div class="row"><button class="big" id="mperm">Allow access to all files</button></div>
 <div class="row"><button class="big" id="mbrowse">Browse all files</button></div>
 <div class="row"><button class="big" id="mtree">Allow writing to SD card / USB</button></div>
 <small>Android 11 and newer block the Android/data and Android/obb system folders for every app.</small>
 <small>Markup Studio appears in “Open with” and “Share” menus of file managers.</small>`);
const rp = mk('div', { id: 'rp', className: 'panel', hidden: true }, `
 <div class="row"><b>Read aloud</b><button id="rpx">✕</button></div>
 <div class="row"><button class="big" id="rprev" title="Previous page">⏮</button><button class="big on" id="rplay">▶ Read</button><button class="big" id="rnext" title="Next page">⏭</button><button class="big" id="rstop" title="Stop">⏹</button></div>
 <div class="row"><span>Speed <b id="rrv">1.0×</b></span><input type="range" id="rrate" min="50" max="300" step="5"></div>
 <div class="row"><span>Language</span><select id="rlang"><option value="auto">Hindi + English mixed (both voices)</option><option value="en">English only</option><option value="hi">Hindi only</option></select></div>
 <div class="row"><span>Speech engine</span><select id="reng"><option value="">Phone default</option></select></div>
 <div class="row"><span>English voice</span><select id="rven"></select></div>
 <div class="row"><span>Hindi voice</span><select id="rvhi"></select></div>
 <div class="row"><span>Pitch <b id="rpv">1.0</b></span><input type="range" id="rpitch" min="50" max="200" step="5"></div>
 <label><input type="checkbox" id="rmed"> Say short forms in full (mg → milligram, b.d. → twice daily, i.v. → intravenous, e.g. → for example…)</label>
 <div><b style="font-size:13px">My pronunciations</b> <small>one per line: word = how to say it</small></div>
 <textarea id="rpron" rows="3" placeholder="HbA1c = H B A one C&#10;Dr = doctor&#10;CKD = chronic kidney disease" style="width:100%;font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--bd);border-radius:8px;background:var(--bar);color:var(--fg);resize:vertical"></textarea>
 <div class="row"><span>Voices shown</span><select id="rvf"><option value="all">Online + offline</option><option value="off">Offline only</option><option value="on">Online only</option></select></div>
 <div class="row"><button id="rtest">Test</button><button id="rinst">Voice data</button><button id="rtts">TTS settings</button></div>
 <label><input type="checkbox" id="rfollow"> Scroll along while reading</label>
 <label><input type="checkbox" id="rtap"> Tap a word or line to read from there</label>
 <label><input type="checkbox" id="rawake"> Keep screen on</label>
 <hr>
 <div><b style="font-size:13px">Page layout</b></div>
 <div class="row"><span>Columns</span><select id="rcols"><option value="auto">Find automatically</option><option value="1">1 column</option><option value="2">2 columns</option><option value="3">3 columns</option></select></div>
 <label><input type="checkbox" id="rmain"> Read only the main story — skip boxes, coloured backgrounds, different fonts and colours</label>
 <label><input type="checkbox" id="rheads"> Also read headings</label>
 <label><input type="checkbox" id="rhead"> Skip book name, headers and page numbers</label>
 <label><input type="checkbox" id="rtab"> Skip tables (also tables with only divider lines)</label>
 <label><input type="checkbox" id="rpic"> Skip picture labels and notes below pictures</label>
 <label><input type="checkbox" id="rside"> Skip side notes in the margins</label>
 <label><input type="checkbox" id="rshow"> Show reading order on the page</label>
 <small>Column 1 is read to its end, then column 2. With “Show reading order”: green boxes are read in the numbered order, red is skipped.</small>
 <hr>
 <div class="row"><b style="font-size:13px">Auto-scroll</b><button id="asbtn">▶ Start</button></div>
 <div class="row"><span>Speed <b id="asv">40</b> px/s</span><input type="range" id="asr" min="5" max="300" step="5"></div>
 <small id="rnote"></small>`);
document.body.append(mp, rp);
const pq = (r, s) => r.querySelector(s);
function showPanel(p) { const open = p.hidden; mp.hidden = rp.hidden = true; $('#pop').hidden = true; if (open) { p.hidden = false; if (p === mp) refreshMenu(); else refreshReader(); } }
mn.onclick = () => showPanel(mp); rd.onclick = () => showPanel(rp);
$('#mpx').onclick = () => mp.hidden = true; $('#rpx').onclick = () => rp.hidden = true;
document.addEventListener('pointerdown', e => { if (!mp.hidden && !mp.contains(e.target) && e.target !== mn) mp.hidden = true; if (!rp.hidden && !rp.contains(e.target) && e.target !== rd) rp.hidden = true; }, true);
window.__back = () => { if (!fb.hidden) { fbUp(true); return true; } if (!mp.hidden || !rp.hidden) { mp.hidden = rp.hidden = true; return true; } if (!$('#pop').hidden) { $('#pop').hidden = true; return true; } if (!$('#exp').hidden) { $('#exp').hidden = true; return true; } if (inGrid()) { closeGrid(); return true; } return false; };

function refreshMenu() {
  mp.querySelectorAll('input[name=sm]').forEach(r => r.checked = r.value === saveMode());
  $('#mfs').checked = pref('fullscreen', '1') !== '0'; $('#mres').checked = pref('resume', '1') !== '0';
  const s = JP(A.storageInfo(), {}), vol = (s.volumes || []).filter(v => !/emulated/.test(v));
  $('#mstore').textContent = (s.allFiles ? 'All-files access: allowed. ' : 'All-files access: not allowed yet. ') + (vol.length ? 'Removable storage found: ' + vol.join(', ') + '. ' : 'No SD card / USB drive detected. ') + ((s.trees || []).length ? 'Folder access granted for ' + s.trees.length + ' location(s).' : '');
  $('#mperm').style.display = s.allFiles ? 'none' : '';
  $('#mth').value = pref('theme', 'light');
  const mi = JP(A.memInfo ? A.memInfo() : '{}', {}), M = window.__MEM || {};
  $('#mmem').textContent = (mi.total ? 'This phone has ' + (mi.total / 1073741824).toFixed(1) + ' GB memory' + (M.low ? ' — low-memory mode is on.' : '.') + ' ' : '') + 'Big books scroll as one book; only the pages around where you read are kept in memory, the rest show small previews.';
  const cd = pref('copyDir', ''), ed = pref('exportDir', ''), cw = pref('copyWhere', cd ? 'dir' : 'orig');
  $('#mcw').value = cw; $('#mcdr').style.display = cw === 'dir' ? '' : 'none';
  $('#mcdv').textContent = cd || 'No folder chosen yet';
  $('#medv').textContent = ed || 'Download/MarkupStudio';
}
mp.addEventListener('change', e => {
  if (e.target.name === 'sm') { A.setPref('saveMode', e.target.value); window.__resetSave(); AS2.pend = true; scheduleSave(300); }
  if (e.target.id === 'mcw') { A.setPref('copyWhere', e.target.value); refreshMenu(); if (e.target.value === 'dir' && !pref('copyDir', '')) $('#mcd').click(); }
  if (e.target.id === 'mfs') A.setFullscreen(e.target.checked);
  if (e.target.id === 'mres') A.setPref('resume', e.target.checked ? '1' : '0');
  if (e.target.id === 'mth') { const t = e.target.value; A.setTheme(t); if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }
});
$('#mcd').onclick = () => { mp.hidden = true; fbOpen('folder', p => { A.setPref('copyDir', p); if (p) A.setPref('copyWhere', 'dir'); }, pref('copyDir', '')); };
$('#med').onclick = () => { mp.hidden = true; fbOpen('folder', p => { A.setPref('exportDir', p); toast(p ? 'Exports will be saved in ' + p : 'Exports will be saved in Download/MarkupStudio'); }, pref('exportDir', '')); };
$('#mbrowse').onclick = () => { mp.hidden = true; fbOpen('open'); };
$('#mmerge').onclick = () => { mp.hidden = true; fbOpen('merge'); };
$('#mperm').onclick = () => A.requestStorage(); $('#mtree').onclick = () => A.grantTree();
window.__nativeEvent = ev => { if (ev === 'storage') { if (!mp.hidden) refreshMenu(); if (!fb.hidden) fbGo(FB.path); } };

/* ---------- reader state ---------- */
const RS = Object.assign({ pitch: 1, med: true, pron: '', rate: 1, voiceEn: '', voiceHi: '', filter: 'all', lang: 'auto', follow: true, tap: true, awake: true, speed: 40, cols: 'auto', head: true, tab: true, pic: true, side: true, show: false, main: true, heads: false }, JP(pref('reader', '{}'), {}));
const saveRS = () => A.setPref('reader', JSON.stringify(RS));
const R = { on: false, gen: 0, page: null, rd: null, chunks: [], sent: 0, fin: 0, cur: -1, wi: 0, resolve: null, errs: 0, userUntil: 0, resumeAt: null, est: 0, sawRange: false };
const AS = { on: false, last: 0, acc: 0, raf: 0, touching: false, resumeAt: 0 };
let ttsReady = false, voices = [];
window.__ttsReady = ok => { ttsReady = !!ok; if (ok) { voices = JP(A.ttsVoices(), []); fillVoices(); fillEngines(); } else toast('No text-to-speech engine found. Install “Speech Services by Google”.', 5000); };
A.ttsInit();

/* other speech engines (Google, Samsung, …) bring their own voices */
function fillEngines() {
  const sel = pq(rp, '#reng'); if (!A.ttsEngines) { sel.parentNode.style.display = 'none'; return; }
  const l = JP(A.ttsEngines(), []), info = l.find(x => 'cur' in x) || {}, en = l.filter(x => x.n);
  sel.innerHTML = ''; sel.appendChild(new Option('Phone default' + (info.cur ? ' (' + ((en.find(x => x.n === info.cur) || {}).l || info.cur) + ')' : ''), ''));
  en.forEach(x => sel.appendChild(new Option(x.l || x.n, x.n))); sel.value = info.sel || '';
}
/* how words are said: short forms in full, and the user's own list; the highlight keeps following the words */
const MED = { 'mg': 'milligram', 'mcg': 'microgram', 'µg': 'microgram', 'μg': 'microgram', 'ml': 'millilitre', 'kg': 'kilogram', 'iu': 'international units', 'mmhg': 'millimetres of mercury',
  'mg/kg': 'milligram per kilogram', 'mg/dl': 'milligram per decilitre', 'mmol/l': 'millimoles per litre', 'mg/day': 'milligram per day', 'mcg/kg': 'microgram per kilogram',
  'b.d.': 'twice daily', 'bd': 'twice daily', 'bid': 'twice daily', 'b.i.d.': 'twice daily', 't.d.s.': 'three times a day', 'tds': 'three times a day', 'tid': 'three times a day', 't.i.d.': 'three times a day',
  'q.i.d.': 'four times a day', 'qid': 'four times a day', 'qds': 'four times a day', 'o.d.': 'once daily', 'h.s.': 'at bedtime', 'p.o.': 'by mouth', 'i.v.': 'intravenous', 'i.m.': 'intramuscular', 's.c.': 'subcutaneous',
  's.o.s.': 'if needed', 'sos': 'if needed', 'prn': 'as needed', 'p.r.n.': 'as needed', 'stat': 'immediately', 'e.g.': 'for example', 'i.e.': 'that is', 'etc.': 'et cetera', 'vs': 'versus', 'vs.': 'versus',
  'dr.': 'doctor', 'fig.': 'figure', 'approx.': 'approximately', '°c': 'degrees celsius', '%': 'percent', 'yrs': 'years', 'hrs': 'hours', 'wk': 'week', 'wks': 'weeks', 'no.': 'number' };
let PRON = new Map();
const parsePron = () => { PRON = new Map(); for (const l of String(RS.pron || '').split(/\n/)) { const m = l.split('='); if (m.length >= 2 && m[0].trim()) PRON.set(m[0].trim().toLowerCase(), m.slice(1).join('=').trim()); } };
parsePron();
function sayTok(tok) {
  const m = tok.match(/^([("'“‘\[]*)(.*?)([)"'”’\],;:!?।]*)$/) || ['', '', tok, ''], pre = m[1], post = m[3]; let core = m[2]; const key = core.toLowerCase();
  if (PRON.has(key)) return pre + PRON.get(key) + post;
  if (PRON.has(key.replace(/\.$/, ''))) return pre + PRON.get(key.replace(/\.$/, '')) + '.' + post;
  if (!RS.med) return tok;
  if (MED[key]) return pre + MED[key] + post;
  if (MED[key.replace(/\.$/, '')] && !/\.$/.test(key.replace(/\.$/, ''))) return pre + MED[key.replace(/\.$/, '')] + '.' + post;
  let n = core.match(/^(\d+(?:[.,]\d+)?)(mg|mcg|µg|ml|kg|iu|mmhg|g|mg\/kg|mg\/dl|%|°c)(\.?)$/i);
  if (n) return pre + n[1] + ' ' + (MED[n[2].toLowerCase()] || (n[2].toLowerCase() === 'g' ? 'gram' : n[2])) + n[3] + post;
  return tok;
}
function sayAs(c) {
  if (!RS.med && !PRON.size) return c;
  let out = '', pos = 0; const map = [];
  for (const m of c.map) { out += c.text.slice(pos, m.s); const say = sayTok(c.text.slice(m.s, m.e)), s0 = out.length; out += say; map.push(Object.assign({}, m, { s: s0, e: out.length })); pos = m.e; }
  out += c.text.slice(pos);
  return Object.assign({}, c, { text: out, map });
}
window.__sayAs = sayAs;
function fillVoices() {
  const net = A.isOnline();
  const fill = (sel, lang, cur) => {
    sel.innerHTML = ''; sel.appendChild(new Option('Default for this language', ''));
    let vs = voices.filter(v => (v.l || '').toLowerCase().startsWith(lang));
    if (RS.filter === 'off') vs = vs.filter(v => !v.net); else if (RS.filter === 'on') vs = vs.filter(v => v.net);
    vs.sort((a, b) => (a.l || '').localeCompare(b.l || '') || (b.q - a.q));
    vs.forEach(v => sel.appendChild(new Option(v.n.replace(/-(local|network)$/, '') + ' · ' + v.l + (v.net ? ' · online' + (net ? '' : ' (offline now)') : ' · offline') + (v.ni ? ' · not installed' : ''), v.n)));
    if (!vs.length) sel.appendChild(new Option(lang === 'hi' ? 'No Hindi voice here — tap “Voice data”' : 'No English voice found', '', false, false));
    sel.value = vs.some(v => v.n === cur) ? cur : '';
  };
  fill(pq(rp, '#rven'), 'en', RS.voiceEn); fill(pq(rp, '#rvhi'), 'hi', RS.voiceHi);
}
function refreshReader() {
  pq(rp, '#rrate').value = Math.round(RS.rate * 100); pq(rp, '#rrv').textContent = RS.rate.toFixed(2).replace(/0$/, '') + '×';
  pq(rp, '#rpitch').value = Math.round(RS.pitch * 100); pq(rp, '#rpv').textContent = RS.pitch.toFixed(2).replace(/0$/, ''); pq(rp, '#rmed').checked = RS.med; pq(rp, '#rpron').value = RS.pron || ''; if (ttsReady) fillEngines();
  pq(rp, '#rlang').value = RS.lang; pq(rp, '#rvf').value = RS.filter; pq(rp, '#rfollow').checked = RS.follow; pq(rp, '#rtap').checked = RS.tap; pq(rp, '#rawake').checked = RS.awake;
  pq(rp, '#asr').value = RS.speed; pq(rp, '#asv').textContent = RS.speed; if (ttsReady) fillVoices(); updUI();
  pq(rp, '#rcols').value = RS.cols; pq(rp, '#rhead').checked = RS.head; pq(rp, '#rtab').checked = RS.tab; pq(rp, '#rpic').checked = RS.pic; pq(rp, '#rside').checked = RS.side; pq(rp, '#rshow').checked = RS.show; pq(rp, '#rmain').checked = RS.main; pq(rp, '#rheads').checked = RS.heads;
  pq(rp, '#rnote').textContent = 'Scanned pages and photos of text are read with the phone\'s own text recognition (Hindi and English, any font, no internet). The next page is recognised while the current one is read.';
}
function updUI() { pq(rp, '#rplay').textContent = R.on ? '⏸ Pause' : '▶ Read'; pq(rp, '#asbtn').textContent = AS.on ? '⏸ Stop' : '▶ Start'; rd.classList.toggle('on', R.on || AS.on); }
let rst; const restartSoon = () => { clearTimeout(rst); if (R.on) rst = setTimeout(() => readFrom(R.page, R.wi), 450); };
rp.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'rrate') { RS.rate = e.target.value / 100; pq(rp, '#rrv').textContent = RS.rate.toFixed(2).replace(/0$/, '') + '×'; saveRS(); restartSoon(); }
  if (id === 'asr') { RS.speed = +e.target.value; pq(rp, '#asv').textContent = RS.speed; saveRS(); }
  if (id === 'rpitch') { RS.pitch = e.target.value / 100; pq(rp, '#rpv').textContent = RS.pitch.toFixed(2).replace(/0$/, ''); saveRS(); restartSoon(); }
});
rp.addEventListener('change', e => {
  const id = e.target.id, v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (id === 'rlang') RS.lang = v; else if (id === 'rven') RS.voiceEn = v; else if (id === 'rvhi') RS.voiceHi = v;
  else if (id === 'rvf') { RS.filter = v; fillVoices(); } else if (id === 'rfollow') RS.follow = v; else if (id === 'rtap') RS.tap = v;
  else if (id === 'rawake') { RS.awake = v; awake(R.on || AS.on); }
  else if (/^(rcols|rhead|rtab|rpic|rside|rmain|rheads)$/.test(id)) { RS[{ rcols: 'cols', rhead: 'head', rtab: 'tab', rpic: 'pic', rside: 'side', rmain: 'main', rheads: 'heads' }[id]] = v; pages.forEach(q => { q.read = null; }); layoutAll(); restartSoon(); }
  else if (id === 'rshow') { RS.show = v; layoutAll(); }
  else if (id === 'rmed') { RS.med = v; restartSoon(); }
  else if (id === 'rpron') { RS.pron = v; parsePron(); restartSoon(); }
  else if (id === 'reng') { A.ttsSetEngine(v); ttsReady = false; RS.voiceEn = RS.voiceHi = ''; stopAll(); toast('Speech engine changed — choose its voices below', 3000); }
  else return;
  saveRS(); if (/^(rlang|rven|rvhi)$/.test(id)) restartSoon();
});
pq(rp, '#rinst').onclick = () => A.ttsInstallData(); pq(rp, '#rtts').onclick = () => A.ttsSettings();
pq(rp, '#rtest').onclick = () => {
  if (!ttsReady) { toast('Speech engine is not ready'); return; }
  A.ttsStop(); A.ttsSpeak('t:0', 'Hello, this is the English voice.', voiceFor('en'), 'en-IN', RS.rate, RS.pitch, true);
  A.ttsSpeak('t:1', 'नमस्ते, यह हिंदी आवाज़ है।', voiceFor('hi'), 'hi-IN', RS.rate, RS.pitch, false);
};
const awake = on => A.keepAwake(!!on && RS.awake);

/* ---------- scanned pages (photos of text): the phone's own text recognition, Hindi + English, no internet ---------- */
const ocrWait = {}; let ocrSeq = 0, ocrTold = false;
window.__ocrDone = (id, r) => { const f = ocrWait[id]; if (f) { delete ocrWait[id]; f(r); } };
const ocrCall = url => new Promise(res => {
  const id = 'o' + (++ocrSeq); ocrWait[id] = res;
  try { A.ocr(id, url); } catch (e) { delete ocrWait[id]; res({ ok: false }); return; }
  setTimeout(() => { if (ocrWait[id]) { delete ocrWait[id]; res({ ok: false, err: 'timeout' }); } }, 90000);
});
/* the page drawn as a picture -> words with their places on the page, as if the PDF had text */
async function ocrItems(p) {
  if (!A.ocr) return null;
  if (!ocrTold) { ocrTold = true; toast('Scanned page: recognising the text…', 2500); }
  const k = Math.min(3.5, Math.max(1.2, 1800 / Math.max(1, p.w))), c = document.createElement('canvas');
  c.width = Math.round(p.w * k); c.height = Math.round(p.h * k);
  await paint(p, c.getContext('2d'), k, null);
  const url = c.toDataURL('image/jpeg', 0.92); c.width = c.height = 0;
  const r = await ocrCall(url); if (!r || !r.ok || !r.w) return null;
  const f = p.w / r.w, items = [];
  for (const L of r.lines || []) {
    const lh = (L.y1 - L.y0) * f, fs = Math.max(3, lh * 0.78), base = L.y1 * f - lh * 0.2;
    for (const w of (L.words && L.words.length ? L.words : [L])) if (w.t) items.push({ str: w.t, transform: [fs, 0, 0, fs, w.x0 * f, base], width: (w.x1 - w.x0) * f, height: fs, fontName: 'ocr' });
  }
  return items;
}
window.__ocrItems = ocrItems;
const fewWords = W => W.reduce((n, w) => n + w.w.length, 0) < 25;

/* ---------- text of a page in reading order ---------- */
const readP = new WeakMap();
function pageReadable(p) {
  if (p.read) return Promise.resolve(p.read);
  let pr = readP.get(p);
  if (!pr) { pr = pageReadable0(p); readP.set(p, pr); pr.then(() => readP.delete(p), () => readP.delete(p)); }
  return pr;
}
async function pageReadable0(p) {
  let words = [], scanned = false, extra = {};
  if (p.kind === 'pdf') {
    await ensure(p);
    const i = pages.indexOf(p), repeat = new Set();               // top / bottom lines of nearby pages: book name, chapter
    for (let j = i - 2; j <= i + 2; j++) {
      const q = pages[j]; if (!q || q === p || q.kind !== 'pdf' || q.doc !== p.doc) continue;
      try { if (!q.bands) { await ensure(q); q.bands = await RC.bandKeys(q.page); } q.bands.forEach(k => repeat.add(k)); } catch (e) {}
    }
    const r = await RC.analyzePage(p.page, pdfjsLib, { cols: RS.cols, head: RS.head, tables: RS.tab, pics: RS.pic, side: RS.side, main: RS.main, heads: RS.heads }, repeat);
    words = r.words; scanned = r.scanned; extra = { blocks: r.blocks, skipped: r.skipped, sgroups: r.sgroups || [] };
  } else if (p.kind === 'txt') words = RC.textWords(p.lines);
  if ((p.kind === 'pdf' || p.kind === 'cv') && fewWords(words)) {          // a scan or a photo: recognise the text
    let items = null; try { items = await ocrItems(p); } catch (e) { items = null; }
    if (items && items.length) {
      const r = RC.analyze({ items, vpT: [1, 0, 0, 1, 0, 0], W: p.w, H: p.h, opt: { cols: RS.cols, head: RS.head, tables: false, pics: false, side: RS.side, main: false, heads: true } });
      if (r.words.length) { words = r.words; scanned = false; extra = { blocks: r.blocks, skipped: r.skipped, sgroups: r.sgroups || [], ocr: true }; }
    }
  }
  const lines = {};
  for (const w of words) { const L = lines[w.si]; if (!L) lines[w.si] = { x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom }; else { L.x0 = Math.min(L.x0, w.x0); L.x1 = Math.max(L.x1, w.x1); L.top = Math.min(L.top, w.top); L.bottom = Math.max(L.bottom, w.bottom); } }
  return (p.read = Object.assign({ words, scanned, lines }, extra));
}
/* "show reading order": numbered green boxes = read in this order, red = skipped */
function drawLayout(p) {
  p.wrap.querySelectorAll('.lay').forEach(e => e.remove());
  if (!RS.show || !p.read || !p.w) return;
  const box = (cls, b, n) => { const d = mk('div', { className: 'lay ' + cls }); d.style.cssText = `left:${(b.x0 - 2) / p.w * 100}%;top:${(b.top - 2) / p.h * 100}%;width:${(b.x1 - b.x0 + 4) / p.w * 100}%;height:${(b.bottom - b.top + 4) / p.h * 100}%`; if (n) d.dataset.n = n; p.wrap.appendChild(d); };
  (p.read.blocks || []).forEach((b, i) => box('lr', b, String(i + 1)));
  (p.read.skipped || []).forEach(b => box('ls', b));
}
let layQ = 0;
async function layoutAll() {
  const id = ++layQ;
  document.querySelectorAll('.lay').forEach(e => e.remove());
  if (!RS.show || !pages.length) return;
  const vr = view.getBoundingClientRect();
  for (const p of pages) {
    const r = p.wrap.getBoundingClientRect(); if (r.bottom < vr.top - 1500 || r.top > vr.bottom + 1500) continue;
    try { await pageReadable(p); } catch (e) { continue; }
    if (id !== layQ) return; drawLayout(p);
  }
}
let lyt; view.addEventListener('scroll', () => { if (!RS.show) return; clearTimeout(lyt); lyt = setTimeout(() => { const vr = view.getBoundingClientRect(); for (const p of pages) { const r = p.wrap.getBoundingClientRect(); if (r.bottom > vr.top - 1500 && r.top < vr.bottom + 1500 && !p.wrap.querySelector('.lay')) { pageReadable(p).then(() => drawLayout(p)).catch(() => {}); } } }, 300); }, { passive: true });

window.__readable = pageReadable; window.__topPage = topPage;

/* ---------- highlight + follow ---------- */
const hlClear = () => document.querySelectorAll('.rh,.rl').forEach(e => e.remove());
function hlWord(p, rdp, wi) {
  hlClear(); const w = rdp.words[wi]; if (!w || !p) return;
  const box = (cls, x0, y0, x1, y1, pad) => { const d = mk('div', { className: cls }); d.style.cssText = `left:${x0 * scale - pad}px;top:${y0 * scale - pad}px;width:${(x1 - x0) * scale + 2 * pad}px;height:${(y1 - y0) * scale + 2 * pad}px`; p.wrap.appendChild(d); };
  const L = rdp.lines[w.si]; if (L) box('rl', L.x0, L.top, L.x1, L.bottom, 1);
  box('rh', w.x0, w.top, w.x1, w.bottom, 1);
  follow(p, w);
}
function follow(p, w) {
  if (!RS.follow || performance.now() < R.userUntil) return;
  const vr = view.getBoundingClientRect(), pr = p.wrap.getBoundingClientRect(), vh = view.clientHeight;
  const y = pr.top - vr.top + w.top * scale, h = (w.bottom - w.top) * scale, x = pr.left - vr.left + w.x0 * scale;
  const dy = (y < vh * .1 || y + h > vh * .72) ? y - vh * .3 : 0, dx = (x < 8 || x > view.clientWidth - 40) ? x - view.clientWidth * .15 : 0;
  if (dy || dx) view.scrollBy({ top: dy, left: dx, behavior: 'smooth' });
}
function scrollToPage(p) { const vr = view.getBoundingClientRect(), pr = p.wrap.getBoundingClientRect(); view.scrollBy({ top: pr.top - vr.top - 6, behavior: 'smooth' }); }

/* ---------- reading engine ---------- */
function voiceFor(lang) {
  const name = lang === 'hi' ? RS.voiceHi : RS.voiceEn; if (!name) return '';
  const v = voices.find(x => x.n === name);
  if (v && v.net && !A.isOnline()) { const off = voices.find(x => !x.net && !x.ni && (x.l || '').toLowerCase().startsWith(lang)); return off ? off.n : ''; }
  return name;
}
const langOf = c => RS.lang === 'auto' ? c.lang : RS.lang;
function pump(gen) {
  while (gen === R.gen && R.sent < R.chunks.length && R.sent - R.fin < 2) {
    const i = R.sent++, c = R.chunks[i], lang = langOf(c);
    const rc = A.ttsSpeak(gen + ':' + i, c.text, voiceFor(lang), lang === 'hi' ? 'hi-IN' : 'en-IN', RS.rate, RS.pitch, false);
    if (rc < 0) { toast(rc === -2 ? (lang === 'hi' ? 'Hindi voice data is not installed — tap “Voice data”.' : 'English voice data is missing.') : 'Speech engine error', 4500); stopAll(); return; }
  }
}
function speakChunks(gen) { return new Promise(res => { R.resolve = r => { R.resolve = null; res(r); }; R.sent = 0; R.fin = 0; R.cur = -1; pump(gen); }); }
const findMap = (c, ch) => { let m = c.map[0]; for (const x of c.map) { if (x.s <= ch) m = x; else break; } return m; };
window.__tts = function (ev, id, s) {
  const parts = String(id).split(':'), g = +parts[0], i = +parts[1];
  if (g !== R.gen || !R.on) return;
  if (ev === 'start') {
    R.cur = i; R.sawRange = false; clearInterval(R.est);
    const c = R.chunks[i]; if (!c) return; R.wi = c.map.length ? c.map[0].wi : c.a; hlWord(R.page, R.rd, R.wi);
    const t0 = performance.now(), len = c.text.length;       // engines without word callbacks: estimate progress
    R.est = setInterval(() => { if (R.sawRange || g !== R.gen) { clearInterval(R.est); return; } const t = performance.now() - t0 - 900; if (t < 0) return; const m = findMap(c, Math.min(len - 1, Math.floor(t / 1000 * 14 * RS.rate))); if (m && m.wi !== R.wi) { R.wi = m.wi; hlWord(R.page, R.rd, m.wi); } }, 250);
  } else if (ev === 'range') {
    if (i !== R.cur) return; R.sawRange = true; const c = R.chunks[i], m = c && findMap(c, +s); if (m) { R.wi = m.wi; hlWord(R.page, R.rd, m.wi); }
  } else if (ev === 'done' || ev === 'error') {
    clearInterval(R.est);
    if (ev === 'error' && ++R.errs > 3) { stopAll(); toast('Speech failed — check the voice in TTS settings.', 4500); return; }
    if (ev === 'done') R.errs = 0;
    R.fin++; if (R.fin >= R.chunks.length) { R.resolve && R.resolve('end'); } else pump(g);
  }
};
function stopSpeech() { clearInterval(R.est); try { A.ttsStop(); } catch (e) {} if (R.resolve) { const r = R.resolve; R.resolve = null; r('stop'); } }
function stopAll() { R.gen++; stopSpeech(); R.on = false; hlClear(); awake(AS.on); updUI(); }
const waitTts = () => new Promise(res => { let n = 0; const t = setInterval(() => { if (ttsReady || ++n > 30) { clearInterval(t); res(); } }, 100); });
async function readFrom(p, wi, ov) {
  const gen = ++R.gen; stopSpeech(); R.on = true; R.errs = 0; hlClear(); updUI(); awake(true);
  if (!ttsReady) { A.ttsInit(); await waitTts(); if (gen !== R.gen) return; if (!ttsReady) { R.on = false; updUI(); awake(AS.on); return; } }
  if (AS.on) stopAS();
  let page = p, start = wi || 0, first = true, spoke = false;
  while (gen === R.gen) {
    R.page = page; let rdp; try { rdp = first && ov ? ov : await pageReadable(page); } catch (e) { rdp = { words: [], lines: {}, scanned: false }; }
    if (gen !== R.gen) return;
    if (!first && RS.follow) scrollToPage(page);
    if (RS.show && !page.wrap.querySelector('.lay')) drawLayout(page);
    { const nx = pages[pages.indexOf(page) + 1]; if (nx && !nx.read) pageReadable(nx).catch(() => {}); }   // next page ready in time (scans take a moment)
    if (rdp.words.length > start) { R.rd = rdp; R.chunks = RC.chunks(rdp.words, start, 0, RS.lang === 'auto' ? 'mix' : 'single').map(sayAs); spoke = true; await speakChunks(gen); if (gen !== R.gen) return; }
    first = false; start = 0;
    let i = pages.indexOf(page);
    if (i >= 0 && i + 1 >= pages.length && window.__book() && gen === R.gen) {          // big book: carry on into the next part
      R.switching = true; let ok = false; try { ok = await window.__nextPart(); } finally { R.switching = false; }
      if (gen !== R.gen) return;
      if (ok && pages.length) { page = pages[0]; first = false; start = 0; continue; }
    }
    if (i < 0 || i + 1 >= pages.length) { R.on = false; R.resumeAt = null; hlClear(); awake(AS.on); updUI(); toast(spoke ? 'Finished reading' : 'No readable text here — the pages are pictures or scans', spoke ? 2600 : 4200); return; }
    page = pages[i + 1]; saveStateSoon();
  }
}
async function firstVisible() {
  const t = topPage(); if (!t) return null; const vr = view.getBoundingClientRect();
  for (let i = pages.indexOf(t.p); i < Math.min(pages.length, pages.indexOf(t.p) + 3); i++) {
    const p = pages[i], rdp = await pageReadable(p), pr = p.wrap.getBoundingClientRect();
    const wi = rdp.words.findIndex(w => pr.top - vr.top + w.top * scale >= -2 && pr.top - vr.top + w.top * scale < view.clientHeight);
    if (wi >= 0) return { p, wi };
  }
  return { p: t.p, wi: 0 };
}
async function toggleRead() {
  if (!pages.length) { toast('Open a document first'); return; }
  if (R.on) { R.resumeAt = { p: R.page, wi: R.wi }; stopAll(); return; }
  const at = R.resumeAt && pages.includes(R.resumeAt.p) ? R.resumeAt : await firstVisible(); R.resumeAt = null;
  if (at) readFrom(at.p, at.wi);
}
async function skipPage(d) {
  if (!pages.length) return; const cur = R.page && pages.includes(R.page) ? R.page : (topPage() || {}).p; let i = pages.indexOf(cur) + d;
  if (i < 0 || i >= pages.length) return; scrollToPage(pages[i]);
  if (R.on) readFrom(pages[i], 0); else R.resumeAt = { p: pages[i], wi: 0 };
}
pq(rp, '#rplay').onclick = toggleRead; pq(rp, '#rstop').onclick = () => { R.resumeAt = null; stopAll(); };
pq(rp, '#rprev').onclick = () => skipPage(-1); pq(rp, '#rnext').onclick = () => skipPage(1);

/* ---------- one tap = read from that word; double tap = stop reading ----------
   tapping text that the reading rules skip (a box, a table, a caption…) reads that block first, then the normal rules go on */
let tap = null, hinted = false, tapTimer = 0, lastUp = { t: 0, x: 0, y: 0 };
window.__isReading = () => R.on;
view.addEventListener('pointerdown', e => { tap = { x: e.clientX, y: e.clientY, t: performance.now(), ok: tool === 'scroll' && !inGrid() && e.isPrimary }; }, true);
view.addEventListener('pointermove', e => { if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap.ok = false; }, true);
view.addEventListener('pointercancel', () => { tap = null; }, true);
function linesOf(words) { const L = {}; for (const w of words) { const l = L[w.si]; if (!l) L[w.si] = { x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom }; else { l.x0 = Math.min(l.x0, w.x0); l.x1 = Math.max(l.x1, w.x1); l.top = Math.min(l.top, w.top); l.bottom = Math.max(l.bottom, w.bottom); } } return L; }
async function readAtPoint(p, x, y) {
  let rdp; try { rdp = await pageReadable(p); } catch (err) { return; }
  const dd = (W, i) => { const w = W[i]; const dx = Math.max(w.x0 - x, 0, x - w.x1), dy = Math.max(w.top - y, 0, y - w.bottom); return Math.sqrt(dx * dx + 4 * dy * dy); };
  const wi = RC.nearestWord(rdp.words, x, y, 28); let best = wi >= 0 ? { d: dd(rdp.words, wi) } : { d: Infinity }, bg = null, bj = -1;
  for (const g of rdp.sgroups || []) { const j = RC.nearestWord(g.words, x, y, 28); if (j >= 0) { const d = dd(g.words, j); if (d < best.d) { best = { d }; bg = g; bj = j; } } }
  if (!bg) { if (wi >= 0) readFrom(p, wi); return; }
  /* read the tapped block, then carry on with the main text below it (same column first) */
  let k = -1, kd = Infinity;
  rdp.words.forEach((w, i) => { if (w.top < bg.bottom - 2) return; const d = (w.top - bg.bottom) + (w.x1 > bg.x0 && w.x0 < bg.x1 ? 0 : 400) + Math.abs(w.x0 - bg.x0) * 0.2; if (d < kd) { kd = d; k = i; } });
  const words = bg.words.slice(bj).concat(k >= 0 ? rdp.words.slice(k) : []);
  toast('Reading this ' + (/table/.test(bg.why) ? 'table' : /box/.test(bg.why) ? 'box' : 'part') + ', then the main text', 2200);
  readFrom(p, 0, { words, lines: Object.assign(linesOf(words), rdp.lines), scanned: false });
}
view.addEventListener('pointerup', e => {
  const t = tap; tap = null; if (!t || !t.ok || performance.now() - t.t > 450) return;
  if (window.__pinchAt && performance.now() - window.__pinchAt < 600) return;
  const now = performance.now(), dbl = now - lastUp.t < 330 && Math.hypot(e.clientX - lastUp.x, e.clientY - lastUp.y) < 40;
  lastUp = { t: now, x: e.clientX, y: e.clientY };
  if (dbl) {
    clearTimeout(tapTimer); lastUp.t = 0;
    if (R.on) { R.resumeAt = null; stopAll(); window.__dblStop = performance.now(); toast('Reading stopped', 1500); }
    else if (window.__fromGrid && e.target.closest && e.target.closest('.pg')) $('#pgs').click();   // opened from the thumbnails: double tap goes back there
    return;
  }
  if (!RS.tap) return;
  const wrap = e.target.closest && e.target.closest('.pg'); if (!wrap || !wrap._p) return;
  const p = wrap._p, r = p.wrap.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
  clearTimeout(tapTimer); tapTimer = setTimeout(() => readAtPoint(p, x, y), 340);   // wait: it may be a double tap
}, true);
view.addEventListener('scroll', () => { if (!hinted && pages.length) { hinted = true; if (RS.tap && pref('hint', '') !== '1') { A.setPref('hint', '1'); toast('Tip: tap any word to hear it read from there · double tap stops', 3500); } } }, { passive: true, once: true });

/* ---------- auto-scroll (no voice) ---------- */
function asLoop(t) {
  if (!AS.on) return;
  const dt = Math.min(64, t - AS.last) / 1000; AS.last = t;
  if (!R.on && !AS.touching && t > AS.resumeAt) {
    AS.acc += RS.speed * dt; const px = Math.floor(AS.acc);
    if (px >= 1) { const before = view.scrollTop; view.scrollTop = before + px; AS.acc -= px; if (view.scrollTop === before && before + view.clientHeight >= view.scrollHeight - 2) { stopAS(); toast('End of document'); return; } }
  }
  AS.raf = requestAnimationFrame(asLoop);
}
function startAS() { if (!pages.length) { toast('Open a document first'); return; } if (R.on) stopAll(); AS.on = true; AS.last = performance.now(); AS.acc = 0; AS.resumeAt = 0; awake(true); updUI(); AS.raf = requestAnimationFrame(asLoop); }
function stopAS() { AS.on = false; cancelAnimationFrame(AS.raf); awake(R.on); updUI(); }
pq(rp, '#asbtn').onclick = () => AS.on ? stopAS() : startAS();

/* ---------- built-in file browser: all of internal storage, SD cards and USB drives ---------- */
const fb = mk('div', { id: 'fb', hidden: true }, `
 <div id="fbh"><button id="fbx" title="Close">✕</button><div id="fbt">Open a file</div><button id="fbu" title="Up one folder">⬆</button><button id="fbs" title="Sort">A–Z</button></div>
 <div id="fbr"></div><div id="fbp"></div><div id="fbl"></div>
 <div id="fbf"><button id="fball">Show all files</button><button id="fbsys">Other apps…</button><span style="flex:1"></span><button id="fbjoin" class="on" hidden>Join</button><button id="fbdef" hidden>Use default</button><button id="fbuse" class="on" hidden>✓ Use this folder</button></div>`);
document.body.appendChild(fb);
const FB = { mode: 'open', cb: null, path: '', all: false, sort: pref('fbSort', 'name'), roots: [] };
const DOCS = /\.(pdf|png|jpe?g|webp|gif|bmp|txt|md|csv|json|xml|html?|docx|xlsx|xls|xlsm|ods|log|rtf)$/i;
const ICON = n => /\.pdf$/i.test(n) ? '📕' : /\.(png|jpe?g|webp|gif|bmp)$/i.test(n) ? '🖼️' : /\.(docx?|rtf|odt)$/i.test(n) ? '📘' : /\.(xlsx?|xlsm|ods|csv)$/i.test(n) ? '📗' : '📄';
const fsz = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function fbRoots() {
  FB.roots = JP(A.roots(), []);
  const r = $('#fbr'); r.innerHTML = '';
  const add = (label, path) => { const b = mk('button', {}, esc(label)); b.onclick = () => fbGo(path); r.appendChild(b); };
  add('🏠 Storages', '');
  FB.roots.forEach(x => add((x.kind === 'usb' ? '🔌 ' : x.kind === 'sd' ? '💾 ' : '📱 ') + x.label, x.path));
  const int = FB.roots.find(x => x.kind === 'internal');
  if (int) { add('⬇ Download', int.path + '/Download'); add('📁 Documents', int.path + '/Documents'); }
}
function fbOpen(mode, cb, start) {
  FB.mode = mode; FB.cb = cb || null;
  $('#fbt').textContent = mode === 'folder' ? 'Choose a folder' : mode === 'add' ? 'Add a file to this document' : mode === 'merge' ? 'Tap PDFs in the order to join' : 'Open a file';
  $('#fbuse').hidden = $('#fbdef').hidden = mode !== 'folder'; $('#fball').hidden = $('#fbsys').hidden = mode === 'folder' || mode === 'merge';
  $('#fbjoin').hidden = mode !== 'merge'; FB.pick = []; updJoin();
  $('#fball').textContent = FB.all ? 'Documents only' : 'Show all files';
  mp.hidden = rp.hidden = true; fb.hidden = false; fbRoots();
  let p = start || (mode === 'folder' ? '' : pref('fbLast', ''));
  if (!p) { const int = FB.roots.find(x => x.kind === 'internal'); p = int ? int.path : ''; }
  fbGo(p);
}
function fbClose() { fb.hidden = true; }
const isRoot = p => FB.roots.some(x => x.path === p);
function fbUp(fromBack) {
  if (!FB.path) { if (fromBack) fbClose(); return; }
  if (isRoot(FB.path)) { fbGo(''); return; }
  fbGo(FB.path.replace(/\/[^/]+\/?$/, '') || '/');
}
function fbItem(icon, name, meta, onTap) {
  const d = mk('div', { className: 'fi' }, `<div class="ic">${icon}</div><div class="nm"><div>${esc(name)}</div>${meta ? `<div class="mt">${esc(meta)}</div>` : ''}</div>`);
  d.onclick = onTap; return d;
}
function fbGo(path) {
  const L = $('#fbl'); L.innerHTML = ''; FB.path = path; $('#fbu').disabled = !path;
  $('#fbsys').hidden = FB.mode === 'folder';
  if (!path) {                                   // list of storages
    $('#fbp').textContent = 'All storages'; $('#fbuse').disabled = true;
    FB.roots.forEach(x => L.appendChild(fbItem(x.kind === 'usb' ? '🔌' : x.kind === 'sd' ? '💾' : '📱', x.label, x.total ? fsz(x.free) + ' free of ' + fsz(x.total) : x.path, () => fbGo(x.path))));
    if (!FB.roots.length) L.appendChild(mk('div', { id: 'fbm' }, 'No storage found.'));
    return;
  }
  $('#fbp').textContent = '\u200e' + path; $('#fbuse').disabled = false;
  const r = JP(A.listDir(path), { ok: false });
  if (!r.ok) {
    const m = mk('div', { id: 'fbm' });
    if (r.blocked) m.textContent = 'Android does not let any app open this system folder.';
    else if (r.perm) { m.innerHTML = 'Markup Studio needs permission to see all your files.<br><button>Allow access to all files</button>'; m.querySelector('button').onclick = () => A.requestStorage(); }
    else m.textContent = 'This folder cannot be opened.';
    L.appendChild(m); return;
  }
  let items = r.items.filter(x => !x.n.startsWith('.'));
  const dirs = items.filter(x => x.d), files = items.filter(x => !x.d && (FB.mode === 'merge' ? /\.pdf$/i.test(x.n) : (FB.all || DOCS.test(x.n))));
  const cmp = FB.sort === 'date' ? (a, b) => b.m - a.m : (a, b) => a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: 'base' });
  dirs.sort(cmp); files.sort(cmp);
  const day = m => m ? new Date(m).toLocaleDateString() : '';
  dirs.forEach(x => L.appendChild(fbItem('📁', x.n, day(x.m), () => fbGo(path.replace(/\/$/, '') + '/' + x.n))));
  if (FB.mode === 'merge') files.forEach(x => {
    const full = path.replace(/\/$/, '') + '/' + x.n, it = fbItem(ICON(x.n), x.n, fsz(x.s) + ' · ' + day(x.m), () => {
      const i = FB.pick.indexOf(full); if (i >= 0) FB.pick.splice(i, 1); else FB.pick.push(full); fbGo(FB.path); updJoin();
    });
    const k = FB.pick.indexOf(full); if (k >= 0) { it.style.background = 'var(--ac2)'; it.querySelector('.ic').textContent = String(k + 1); }
    L.appendChild(it);
  });
  else if (FB.mode !== 'folder') files.forEach(x => L.appendChild(fbItem(ICON(x.n), x.n, fsz(x.s) + ' · ' + day(x.m), () => {
    A.setPref('fbLast', path); fbClose(); toast('Opening ' + x.n + '…');
    A.openPaths(JSON.stringify([path.replace(/\/$/, '') + '/' + x.n]), FB.mode === 'add' ? 'add' : 'replace');
  })));
  if (!L.children.length) L.appendChild(mk('div', { id: 'fbm' }, FB.mode === 'folder' ? 'No sub-folders here. Tap “Use this folder” to pick this one.' : 'No documents in this folder.' + (FB.all ? '' : ' Tap “Show all files” to see everything.')));
  L.scrollTop = 0;
}
function updJoin() { const b = $('#fbjoin'); if (b) { b.textContent = FB.pick && FB.pick.length > 1 ? `Join ${FB.pick.length} files` : 'Pick 2 or more PDFs'; b.disabled = !(FB.pick && FB.pick.length > 1); } }
$('#fbjoin').onclick = async () => {
  const files = FB.pick.slice(); if (files.length < 2) return;
  const name = (prompt('Name of the joined file', 'joined') || '').trim().replace(/[\\/:*?"<>|]/g, '_'); if (!name) return;
  fbClose();
  try { const r = await window.__pdfJob({ op: 'merge', files, name }, d => toast(d.msg || 'Joining…', 60000)); toast('Saved: ' + r.files[0], 6000); }
  catch (e) { toast('Joining failed: ' + e.message, 6000); }
};
$('#fbx').onclick = fbClose; $('#fbu').onclick = () => fbUp(false);
$('#fbs').onclick = () => { FB.sort = FB.sort === 'name' ? 'date' : 'name'; A.setPref('fbSort', FB.sort); $('#fbs').textContent = FB.sort === 'name' ? 'A–Z' : 'Newest'; fbGo(FB.path); };
$('#fbs').textContent = FB.sort === 'name' ? 'A–Z' : 'Newest';
$('#fball').onclick = () => { FB.all = !FB.all; $('#fball').textContent = FB.all ? 'Documents only' : 'Show all files'; fbGo(FB.path); };
$('#fbsys').onclick = () => { const m = FB.mode === 'add' ? 'add' : 'replace'; fbClose(); A.pickFiles(m); };
$('#fbdef').onclick = () => { fbClose(); if (FB.cb) FB.cb(''); };
$('#fbuse').onclick = () => {
  const p = FB.path; if (!p) return; fbClose();
  if (!A.canWriteDir(p)) toast('Android needs your OK to write there: Settings ⋮ → “Allow writing to SD card / USB”', 6000);
  if (FB.cb) FB.cb(p);
};

/* ---------- self-test of the phone's PDF tools (started only by the automatic tests) ---------- */
window.__selfTest = async () => {
  const log = (...a) => console.log('SELFTEST ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
  try {
    const all = window.__allPages(), nid = all[0].nid, st = { t: 'hl', c: '#facc15', a: 0.4, w: 14, segs: [[60, 90, 300, 104]] };
    log('book', all.length, 'pages, prepared in parts', !!window.__book());
    const r1 = await window.__pdfJob({ op: 'export', src: nid, pages: [...Array(60).keys()].map(i => i + 1), marks: { 1: [st] }, parts: 2, name: 'selftest' });
    log('export 2 parts', r1.ok, r1.files);
    const r2 = await window.__pdfJob({ op: 'export', src: nid, pages: [1, 2, 3, 4, 5], parts: 1, dest: 'temp', name: 't' });
    const r3 = await window.__pdfJob({ op: 'export', src: nid, pages: [6, 7, 8], parts: 1, dest: 'temp', name: 't' });
    const r4 = await window.__pdfJob({ op: 'merge', files: [r2.files[0], r3.files[0]], name: 'selftest-merged', deleteSources: true });
    log('merge', r4.ok, r4.files);
    const t0 = Date.now(); let last = '';
    await exportBig(all.slice(0, 30), 40, t => { last = t; }, { tries: 2, cap: 6e6, off: 0 }, 1);
    log('compress 40%', last, (Date.now() - t0) + 'ms');
    /* auto-save path: the whole book rebuilt into one copy, then a mark added to that copy as an incremental update */
    const r6 = await window.__pdfJob({ op: 'rebuild', src: nid, order: [...Array(12).keys()].map(i => ({ pn: i + 1 })).concat([{ blank: [595, 842] }]), marks: {}, mode: 'copyr', name: 'selftest-copy.pdf' });
    log('rebuild copy', r6.ok, r6.where);
    const tx = { t: 'tx', x: 60, y: 300, text: 'नमस्ते Hello', f: 'hind', sz: 18, b: true, u: true, c: '#dc2626', w: 0, h: 0 };
    const txi = Object.assign({}, tx, { img: window.__txImg(tx) });
    const r7 = await window.__pdfJob({ op: 'marks', src: nid, marks: { 2: [st], 3: [txi] }, mode: 'copyr', name: 'x' });
    log('marks into copy', r7.ok, 'incremental', r7.incremental, r7.where);
    const yellowOf = async (show) => {
      const ab = new Uint8Array(await (await fetch('/__file/' + A.registerFile(r7.where), { cache: 'no-store' })).arrayBuffer());
      const d = await pdfjsLib.getDocument({ data: ab }).promise, pg2 = await d.getPage(2), vp = pg2.getViewport({ scale: 0.5 }), c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      const o = { canvasContext: x, viewport: vp }; if (show) o.optionalContentConfigPromise = d.getOptionalContentConfig();
      await pg2.render(o).promise; const px = x.getImageData(0, 0, c.width, c.height).data; let yellow = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 225 && px[i + 1] > 195 && px[i + 2] < 205) yellow++;
      const n = d.numPages; await d.destroy(); return { yellow, n };
    };
    let y1 = await yellowOf(true), y0 = await yellowOf(false);
    log('copy check: pages', y1.n, 'marks seen by other apps', y1.yellow, y1.yellow > 200 ? 'PASS' : 'FAIL', '· hidden in this app', y0.yellow, y0.yellow < 80 ? 'PASS' : 'FAIL');
    const rm1 = await window.__pdfJob({ op: 'readmarks', src: A.registerFile(r7.where) });
    const m2 = (rm1.marks || {})['2'] || [], m3 = (rm1.marks || {})['3'] || [];
    log('marks read back', m2.length === 1 && m2[0].t === 'hl' ? 'PASS' : 'FAIL', 'text read back', m3.length === 1 && m3[0].text === tx.text && !m3[0].img ? 'PASS' : 'FAIL');
    await window.__pdfJob({ op: 'marks', src: nid, marks: { 2: [] }, mode: 'copyr', name: 'x' });
    y1 = await yellowOf(true); const rm2 = await window.__pdfJob({ op: 'readmarks', src: A.registerFile(r7.where) });
    log('erased after saving', y1.yellow < 80 && !(rm2.marks || {})['2'] && (rm2.marks || {})['3'] ? 'PASS' : 'FAIL', y1.yellow);
    try {
      const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 420; const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 1400, 420); g.fillStyle = '#111'; g.font = '56px sans-serif';
      g.fillText('भारत एक विशाल देश है', 60, 120); g.fillText('Health is wealth', 60, 240); g.fillText('डॉक्टर Doctor 25 mg', 60, 360);
      const or = await ocrCall(cv.toDataURL('image/jpeg', 0.92)); const all = (or.lines || []).map(l => l.t).join(' | ');
      log('text recognition', or.ok, all, /भारत/.test(all) && /Health/.test(all) ? 'PASS' : 'FAIL ' + (or.err || ''));
    } catch (e) { log('text recognition FAILED', e.message); }
    log('ALL DONE');
  } catch (e) { log('FAILED', e && e.message || String(e)); }
};

/* ---------- keyboard: the toolbars move up to sit just above it ---------- */
let kbPx = 0, hMax = window.innerHeight, wPrev = window.innerWidth;
function kbApply() {
  if (window.innerWidth !== wPrev) { wPrev = window.innerWidth; hMax = window.innerHeight; } else hMax = Math.max(hMax, window.innerHeight);
  const vv = window.visualViewport, vvKb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  const shrunk = Math.max(0, hMax - window.innerHeight), need = Math.max(kbPx - shrunk, vvKb > 80 ? vvKb : 0, 0);
  document.body.style.setProperty('--kb', need + 'px'); document.body.classList.toggle('kbon', need > 0);
}
window.__kb = h => { kbPx = Math.max(0, +h || 0); kbApply(); };
window.addEventListener('resize', kbApply); if (window.visualViewport) window.visualViewport.addEventListener('resize', kbApply);

/* ---------- lifecycle ---------- */
window.__saveNow = () => { saveStateNow(); saveMarks(); };
window.__partChanged = () => {                       // marks not saved yet come back on the pages of this part
  saveStateSoon(); if (RS.show) setTimeout(layoutAll, 600);
};
window.__partLeaving = () => { if (R.on && !R.switching) { R.resumeAt = null; stopAll(); } hlClear(); };
window.__paused = () => { saveMarks(); if (AS2.pend) autoSave(); if (R.on) { R.resumeAt = { p: R.page, wi: R.wi }; stopAll(); } if (AS.on) stopAS(); window.__saveNow(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) window.__paused(); else if (window.__setTool) window.__setTool('scroll'); });

/* ---------- startup: files from the intent, else the last document ---------- */
(async function () {
  A.jsReady();
  const pend = JP(A.takePending(), []);
  if (pend.length) { await window.__nativeOpen(pend, 'replace'); return; }
  if (pref('resume', '1') === '0') return;
  if (A.safeStart && A.safeStart()) { toast('The last book was not reopened because the viewer ran out of memory. Open it again from 📂.', 7000); return; }
  const last = JP(A.reopenLast(), null);
  if (last && last.entries && last.entries.length) await window.__nativeOpen(last.entries, 'replace', { page: last.page, frac: last.frac });
})();
})();
