/* open.js — opening documents (Open with / Share / the built-in file browser / last document), the file browser
   for internal storage, SD cards and USB drives, and remembering the place you read */

const BIGPDF = 12e6;                          // above this a PDF is read piece by piece instead of all at once
const isPdf = f => /pdf/i.test(f.mime || '') || /\.pdf$/i.test(f.name || '');

/* ---------- a file -> pages ---------- */
function textPages(txt, title) {
  const cols = 95, per = 63, L = []; if (title) L.push('▸ ' + title, '');
  for (const raw of txt.replace(/\t/g, '    ').split(/\r?\n/).slice(0, 60000)) {
    let l = raw; if (!l.length) { L.push(''); continue; }
    while (l.length > cols) { L.push(l.slice(0, cols)); l = l.slice(cols); }
    L.push(l);
  }
  const out = []; for (let i = 0; i < L.length; i += per) out.push({ kind: 'txt', w: A4[0], h: A4[1], lines: L.slice(i, i + per) });
  return out.length ? out : [{ kind: 'txt', w: A4[0], h: A4[1], lines: ['(empty)'] }];
}
const fetchOk = async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r; };
async function ingest(f) {
  const n = (f.name || '').toLowerCase();
  if (isPdf(f)) {
    let doc = null; const src = { url: f.url, size: f.size || 0 };
    if (f.size > BIGPDF) { try { doc = await pdfjsLib.getDocument({ url: f.url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144 }).promise; } catch (e) { doc = null; } }
    if (!doc) { const ab = new Uint8Array(await (await fetchOk(f.url)).arrayBuffer()); src.size = ab.length; doc = await pdfjsLib.getDocument({ data: ab }).promise; }
    const p1 = await doc.getPage(1); patchOC(p1); const v = p1.getViewport({ scale: 1 });
    return Array.from({ length: doc.numPages }, (_, i) => ({ kind: 'pdf', doc, src, pn: i + 1, page: i ? null : p1, w: v.width, h: v.height, osize: src.size / doc.numPages }));
  }
  if (/^image\//.test(f.mime || '') || /\.(png|jpe?g|webp|gif|bmp)$/.test(n)) {
    const blob = await (await fetchOk(f.url)).blob(), url = URL.createObjectURL(blob);
    try {
      const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
      const k = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight)), c = el('canvas');
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return [{ kind: 'cv', cv: c, w: 612, h: Math.round(612 * c.height / c.width) }];
    } finally { URL.revokeObjectURL(url); }
  }
  if (n.endsWith('.docx')) { await lib(LIB.mammoth); const r = await mammoth.extractRawText({ arrayBuffer: await (await fetchOk(f.url)).arrayBuffer() }); return textPages(r.value, f.name); }
  if (/\.(xlsx|xls|xlsm|ods)$/.test(n)) {
    await lib(LIB.xlsx); const wb = XLSX.read(new Uint8Array(await (await fetchOk(f.url)).arrayBuffer()), { type: 'array' });
    return wb.SheetNames.flatMap(s => textPages(XLSX.utils.sheet_to_csv(wb.Sheets[s]), f.name + ' · ' + s));
  }
  const txt = await (await fetchOk(f.url)).text();
  if (/[\x00-\x08\x0e-\x1f]/.test(txt.slice(0, 3000))) throw new Error('binary');
  return textPages(txt, n.endsWith('.txt') ? null : f.name);
}

/* ---------- opening: mode 'replace' (a new document) or 'add' (pages added to this one); pos = {page, frac} ---------- */
async function openDocs(entries, mode, pos) {
  const files = entries.map(e => { DOC.meta[e.id] = { name: e.name, mime: e.mime, size: e.size }; return { nid: e.id, name: e.name || 'document', mime: e.mime || '', size: e.size || 0, url: '/__file/' + e.id }; });
  if (!files.length) return;
  await flushSave(); stopReading();
  const replace = mode !== 'add' || !pages.length, want = pos ? pos.page : 0, f0 = files[0];
  const startFresh = () => { beforeReplace(); clearPages(); DOC.primary = f0.nid; DOC.name = f0.name.replace(/\.[^.]+$/, ''); fromGrid = false; setTool('scroll'); };
  if (files.length === 1 && replace && isPdf(f0) && f0.size > SPLITMIN) {          // a really big book: cut once into parts
    startFresh(); const recs = await openSplitBook(f0, want);
    if (recs) { begin(recs[0].w); addPages(recs, 0); await gotoPage(want, pos ? pos.frac : 0); docOpened(true, pages); thumbLoop(); return; }
  }
  const all = [], bad = [];
  for (const f of files) {
    try { const ps = await ingest(f); ps.forEach((p, i) => { p.nid = f.nid; p.sidx = i + 1; }); all.push(...ps); }
    catch (e) { bad.push(f.name); }
  }
  if (bad.length) toast('Could not read: ' + bad.join(', '), 4200);
  if (!all.length) return;
  if (replace) { startFresh(); begin(all[0].w); }
  const added = addPages(all, replace ? 0 : (inGrid() ? insIdx() : pages.length));
  if (inGrid()) buildGrid();
  if (!replace) changedPages();
  docOpened(replace, added); thumbLoop();
  if (pos) restorePos(pos.page, pos.frac);
}
function begin(w) { base = scale = fitW(w); scale = base * savedZoom(); view.scrollTop = 0; view.scrollLeft = 0; }
window.__nativeOpen = (list, mode, pos) => openDocs(list, mode, pos);

/* ---------- remembering the place you read ---------- */
let userTouched = false;
function restorePos(idx, frac) {
  if (!pages.length) return; idx = clamp(idx | 0, 0, pages.length - 1); userTouched = false;
  const go = () => { const t = pages[idx]; if (!t || userTouched) return; const vr = view.getBoundingClientRect(), r = t.wrap.getBoundingClientRect(); view.scrollTop += r.top - vr.top + (frac || 0) * r.height; };
  go(); [250, 800, 1800].forEach(ms => setTimeout(go, ms));
}
function saveStateNow() {
  const t = topPage(); if (!t) return;
  const ids = [...new Set(pages.map(q => q.nid).filter(Boolean))];
  if (ids.length) A.saveState(ids.join(','), pageNo(t.p) - 1, t.frac);
}
let sst = 0; const saveStateSoon = () => { clearTimeout(sst); sst = setTimeout(saveStateNow, 700); };
view.addEventListener('scroll', saveStateSoon, { passive: true });
view.addEventListener('touchstart', () => { userTouched = true; }, { passive: true });

/* ---------- 📂 file browser: internal storage, SD cards, USB drives ---------- */
const FB = { mode: 'open', cb: null, path: '', all: false, sort: pref('fbSort', 'name'), roots: [], pick: [] };
const DOCS = /\.(pdf|png|jpe?g|webp|gif|bmp|txt|md|csv|json|xml|html?|docx|xlsx|xls|xlsm|ods|log|rtf)$/i;
const ICON = n => /\.pdf$/i.test(n) ? '📕' : /\.(png|jpe?g|webp|gif|bmp)$/i.test(n) ? '🖼️' : /\.(docx?|rtf|odt)$/i.test(n) ? '📘' : /\.(xlsx?|xlsm|ods|csv)$/i.test(n) ? '📗' : '📄';
const fb = $('#fb'), fbl = $('#fbl');
const joinPath = (dir, name) => dir.replace(/\/$/, '') + '/' + name;
function fbRoots() {
  FB.roots = JP(A.roots(), []);
  const r = $('#fbr'); r.innerHTML = '';
  const add = (label, path) => { const b = el('button', {}, esc(label)); b.onclick = () => fbGo(path); r.appendChild(b); };
  add('🏠 Storages', '');
  FB.roots.forEach(x => add((x.kind === 'usb' ? '🔌 ' : x.kind === 'sd' ? '💾 ' : '📱 ') + x.label, x.path));
  const int = FB.roots.find(x => x.kind === 'internal');
  if (int) { add('⬇ Download', int.path + '/Download'); add('📁 Documents', int.path + '/Documents'); }
}
/* mode: 'open', 'add', 'folder' (cb gets the chosen folder), 'merge' (pick PDFs to join) */
function openBrowser(mode, cb, start) {
  FB.mode = mode; FB.cb = cb || null; FB.pick = [];
  $('#fbt').textContent = mode === 'folder' ? 'Choose a folder' : mode === 'add' ? 'Add a file to this document' : mode === 'merge' ? 'Tap PDFs in the order to join' : 'Open a file';
  $('#fbuse').hidden = $('#fbdef').hidden = mode !== 'folder';
  $('#fball').hidden = $('#fbsys').hidden = mode === 'folder' || mode === 'merge';
  $('#fbjoin').hidden = mode !== 'merge'; updJoin();
  $('#fball').textContent = FB.all ? 'Documents only' : 'Show all files';
  closePanels(); fb.hidden = false; fbRoots();
  let p = start || (mode === 'folder' ? '' : pref('fbLast', ''));
  if (!p) { const int = FB.roots.find(x => x.kind === 'internal'); p = int ? int.path : ''; }
  fbGo(p);
}
const fbClose = () => { fb.hidden = true; };
function fbUp(fromBack) {
  if (!FB.path) { if (fromBack) fbClose(); return; }
  if (FB.roots.some(x => x.path === FB.path)) { fbGo(''); return; }
  fbGo(FB.path.replace(/\/[^/]+\/?$/, '') || '/');
}
function fbItem(icon, name, meta, onTap) {
  const d = el('div', { className: 'fi' }, `<div class="ic">${icon}</div><div class="nm"><div>${esc(name)}</div>${meta ? `<div class="mt">${esc(meta)}</div>` : ''}</div>`);
  d.onclick = onTap; return d;
}
function fbGo(path) {
  fbl.innerHTML = ''; FB.path = path; $('#fbu').disabled = !path;
  if (!path) {                                 // the list of storages
    $('#fbp').textContent = 'All storages'; $('#fbuse').disabled = true;
    FB.roots.forEach(x => fbl.appendChild(fbItem(x.kind === 'usb' ? '🔌' : x.kind === 'sd' ? '💾' : '📱', x.label, x.total ? fsz(x.free) + ' free of ' + fsz(x.total) : x.path, () => fbGo(x.path))));
    if (!FB.roots.length) fbl.appendChild(el('div', { id: 'fbm' }, 'No storage found.'));
    return;
  }
  $('#fbp').textContent = '‎' + path; $('#fbuse').disabled = false;
  const r = JP(A.listDir(path), { ok: false });
  if (!r.ok) {
    const m = el('div', { id: 'fbm' });
    if (r.blocked) m.textContent = 'Android does not let any app open this system folder.';
    else if (r.perm) { m.innerHTML = 'Markup Studio needs permission to see all your files.<br><button>Allow access to all files</button>'; m.querySelector('button').onclick = () => A.requestStorage(); }
    else m.textContent = 'This folder cannot be opened.';
    fbl.appendChild(m); return;
  }
  const items = r.items.filter(x => !x.n.startsWith('.'));
  const dirs = items.filter(x => x.d), files = items.filter(x => !x.d && (FB.mode === 'merge' ? /\.pdf$/i.test(x.n) : (FB.all || DOCS.test(x.n))));
  const cmp = FB.sort === 'date' ? (a, b) => b.m - a.m : (a, b) => a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: 'base' });
  dirs.sort(cmp); files.sort(cmp);
  const day = m => m ? new Date(m).toLocaleDateString() : '';
  dirs.forEach(x => fbl.appendChild(fbItem('📁', x.n, day(x.m), () => fbGo(joinPath(path, x.n)))));
  if (FB.mode === 'merge') files.forEach(x => {
    const full = joinPath(path, x.n), it = fbItem(ICON(x.n), x.n, fsz(x.s) + ' · ' + day(x.m), () => {
      const i = FB.pick.indexOf(full); if (i >= 0) FB.pick.splice(i, 1); else FB.pick.push(full); fbGo(FB.path); updJoin();
    });
    const k = FB.pick.indexOf(full); if (k >= 0) { it.style.background = 'var(--ac2)'; it.querySelector('.ic').textContent = String(k + 1); }
    fbl.appendChild(it);
  });
  else if (FB.mode !== 'folder') files.forEach(x => fbl.appendChild(fbItem(ICON(x.n), x.n, fsz(x.s) + ' · ' + day(x.m), () => {
    setPref('fbLast', path); fbClose(); toast('Opening ' + x.n + '…');
    A.openPaths(JSON.stringify([joinPath(path, x.n)]), FB.mode === 'add' ? 'add' : 'replace');
  })));
  if (!fbl.children.length) fbl.appendChild(el('div', { id: 'fbm' }, FB.mode === 'folder' ? 'No sub-folders here. Tap “Use this folder” to pick this one.' : 'No documents in this folder.' + (FB.all ? '' : ' Tap “Show all files” to see everything.')));
  fbl.scrollTop = 0;
}
function updJoin() { const b = $('#fbjoin'); b.textContent = FB.pick.length > 1 ? `Join ${FB.pick.length} files` : 'Pick 2 or more PDFs'; b.disabled = FB.pick.length < 2; }
$('#fbjoin').onclick = async () => {
  const files = FB.pick.slice(); if (files.length < 2) return;
  const name = (prompt('Name of the joined file', 'joined') || '').trim().replace(/[\\/:*?"<>|]/g, '_'); if (!name) return;
  fbClose();
  try { const r = await pdfJob({ op: 'merge', files, name }, d => toast(d.msg || 'Joining…', 60000)); toast('Saved: ' + r.files[0], 6000); }
  catch (e) { toast('Joining failed: ' + e.message, 6000); }
};
$('#fbx').onclick = fbClose; $('#fbu').onclick = () => fbUp(false);
const sortLabel = () => { $('#fbs').textContent = FB.sort === 'name' ? 'A–Z' : 'Newest'; };
$('#fbs').onclick = () => { FB.sort = FB.sort === 'name' ? 'date' : 'name'; setPref('fbSort', FB.sort); sortLabel(); fbGo(FB.path); };
sortLabel();
$('#fball').onclick = () => { FB.all = !FB.all; $('#fball').textContent = FB.all ? 'Documents only' : 'Show all files'; fbGo(FB.path); };
$('#fbsys').onclick = () => { const m = FB.mode === 'add' ? 'add' : 'replace'; fbClose(); A.pickFiles(m); };
$('#fbdef').onclick = () => { fbClose(); if (FB.cb) FB.cb(''); };
$('#fbuse').onclick = () => {
  const p = FB.path; if (!p) return; fbClose();
  if (!A.canWriteDir(p)) toast('Android needs your OK to write there: Settings ⋮ → “Allow writing to SD card / USB”', 6000);
  if (FB.cb) FB.cb(p);
};
$('#ob').onclick = () => openBrowser('open');
$('#open2').onclick = () => openBrowser('open');
