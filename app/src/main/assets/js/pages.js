/* pages.js — the viewer: every page has a frame; while you scroll only small previews show, when scrolling stops the
   pages on screen are drawn sharp at once, then 3 pages above and below; pages further away go back to previews.
   Big books are cut once (by the phone) into part files; only 2-3 parts are open at a time. */

/* ---------- PDFs saved by this app keep the marks as an optional layer: hidden here, the app draws the marks itself ---------- */
let ocPatched = false;
function patchOC(pg) {
  if (ocPatched || !pg) return;
  const P = Object.getPrototypeOf(pg), R = P && P.render; if (!R) return;
  ocPatched = true;
  P.render = function (o) {
    const t = this._transport;
    if (o && !o.optionalContentConfigPromise && t && t.getOptionalContentConfig) {
      if (!t.__msOC) t.__msOC = t.getOptionalContentConfig().then(cfg => {
        try { const g = cfg.getGroups() || {}; for (const id in g) if (g[id] && g[id].name === 'Markup Studio marks') cfg.setVisibility(id, false); } catch (e) {}
        return cfg;
      });
      o = Object.assign({}, o, { optionalContentConfigPromise: t.__msOC });
    }
    return R.call(this, o);
  };
}

/* ---------- page objects and frames ---------- */
const io = new IntersectionObserver(es => es.forEach(en => {
  const p = en.target._p; if (!p) return;
  p.vis = en.isIntersecting;
  if (p.vis) { showPreview(p); showHi(p); } else { hidePreview(p); hideHi(p); }
}), { root: view, rootMargin: '700px 0px' });

/* layers inside a frame, bottom to top: preview 0, sharp picture 1, live canvas 2, marks 3, the rest above */
function place(p, node, rank) {
  node._rk = rank; let before = null;
  for (const c of p.wrap.children) { if (c !== node && (c._rk == null ? 9 : c._rk) > rank) { before = c; break; } }
  p.wrap.insertBefore(node, before);
}
function mkPage(d) {
  const wrap = el('div', { className: 'pg' });
  const p = Object.assign({}, d, { rec: d.rec || d, wrap, pc: null, oc: null, him: null, hurl: null, hscale: 0, pimg: null, rendering: null,
    strokes: d.strokes || [], done: false, task: null, sel: false, words: null, read: null });
  wrap._p = p; bindPage(p); size(p); return p;
}
const reorderDOM = () => pages.forEach(p => host.appendChild(p.wrap));
const syncEmpty = () => { $('#empty').style.display = pages.length ? 'none' : ''; };
function addPages(list, idx) {
  const ps = list.map(mkPage); pages.splice(idx, 0, ...ps);
  reorderDOM(); ps.forEach(p => io.observe(p.wrap)); syncEmpty(); upd(); settle(60);
  return ps;
}
function removePage(p) { dropHi(p); hidePreview(p); io.unobserve(p.wrap); p.wrap.remove(); }
function clearPages() { pages.forEach(removePage); pages = []; undo = []; closeBook(); }
/* frame size only; the pictures keep their pixels (stretched) until the page is drawn again */
function size(p) {
  const W = p.w * scale, H = p.h * scale;
  p.pr = Math.min(dpr, Math.sqrt(MEM.px / Math.max(1, W * H)));
  p.wrap.style.width = W + 'px'; p.wrap.style.height = H + 'px';
  for (const c of [p.pc, p.oc]) if (c) { c.style.width = W + 'px'; c.style.height = H + 'px'; }
}
function canvasFor(p, cls) {
  const c = el('canvas'); if (cls) c.className = cls;
  c.style.width = p.w * scale + 'px'; c.style.height = p.h * scale + 'px';
  c.width = Math.max(1, Math.round(p.w * scale * p.pr)); c.height = Math.max(1, Math.round(p.h * scale * p.pr));
  return c;
}
const freeCanvas = c => { if (c) { c.width = c.height = 0; c.remove(); } };

/* ---------- drawing a page ---------- */
async function ensure(p) {
  if (p.kind !== 'pdf' || p.page) return;
  if (!p.doc) { if (BOOK && p.part != null) p.doc = await partDocFor(p.part); else throw new Error('page not loaded'); }
  p.page = await p.doc.getPage(p.lpn || p.pn); patchOC(p.page);
  const v = p.page.getViewport({ scale: 1 }); p.w = v.width; p.h = v.height;
}
/* the page itself (no marks) onto a canvas at k pixels per point */
async function paint(p, ctx, k, holder) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, p.w * k, p.h * k);
  if (p.kind === 'pdf') { await ensure(p); const t = p.page.render({ canvasContext: ctx, viewport: p.page.getViewport({ scale: k }) }); if (holder) holder.task = t; await t.promise; }
  else if (p.kind === 'cv') ctx.drawImage(p.cv, 0, 0, p.w * k, p.h * k);
  else if (p.kind === 'txt') { ctx.fillStyle = '#111'; ctx.font = `${9 * k}px "Courier New",Courier,monospace`; ctx.textBaseline = 'top'; p.lines.forEach((l, i) => ctx.fillText(l, 40 * k, (40 + i * 12) * k)); }
}
/* the page with its marks, for export */
async function pageCanvas(p, k) {
  await ensure(p); k = Math.min(k, 4800 / Math.max(p.w, p.h));
  const c = el('canvas'); c.width = Math.round(p.w * k); c.height = Math.round(p.h * k);
  const x = c.getContext('2d'); await paint(p, x, k, null);
  const m = el('canvas'); m.width = c.width; m.height = c.height; drawMarks(m.getContext('2d'), p.strokes, k);
  x.globalCompositeOperation = 'multiply'; x.drawImage(m, 0, 0); x.globalCompositeOperation = 'source-over'; m.width = m.height = 0;
  return c;
}

const drawn = new Set();      // pages with a live canvas
/* sharp picture kept as a compact JPEG while the page is near the place you read */
function showHi(p) {
  if (!p.hurl || !p.vis || p.pc) return;
  if (!p.him) { p.him = el('img', { className: 'pim' }); p.him.src = p.hurl; place(p, p.him, 1); }
  else if (p.him.src !== p.hurl) p.him.src = p.hurl;
  if (p.strokes.length && !p.oc) redraw(p);
}
function hideHi(p) {
  if (p.him) { p.him.removeAttribute('src'); p.him.remove(); p.him = null; }
  if (p.oc && !p.pc) { freeCanvas(p.oc); p.oc = null; }
}
function dropHi(p) { unrender(p); hideHi(p); if (p.hurl) { URL.revokeObjectURL(p.hurl); p.hurl = null; } p.hscale = 0; }
const isFresh = p => (p.pc && p.pcs === scale) || (p.hurl && p.hscale === scale);
function unrender(p) {
  if (p.task) try { p.task.cancel(); } catch (e) {}
  p.task = null; p.done = false; drawn.delete(p);
  freeCanvas(p.pc); p.pc = null; freeCanvas(p.oc); p.oc = null;
  if (p.page) try { p.page.cleanup(); } catch (e) {}
  showHi(p);
}
/* keep only a few live canvases: drop the ones furthest from the screen */
function trimDrawn() {
  if (drawn.size <= MEM.keep) return;
  const vr = view.getBoundingClientRect(), mid = (vr.top + vr.bottom) / 2;
  const list = [...drawn].map(p => { const r = p.wrap.getBoundingClientRect(); return { p, d: Math.abs((r.top + r.bottom) / 2 - mid) }; }).sort((a, b) => b.d - a.d);
  while (list.length > MEM.keep) unrender(list.shift().p);
}
function render(p) {
  if (p.rendering && p.rsc === scale) return p.rendering;
  const r = p.rendering = renderNow(p); p.rsc = scale;
  r.finally(() => { if (p.rendering === r) p.rendering = null; });
  return r;
}
async function renderNow(p) {
  p.done = true; if (p.task) try { p.task.cancel(); } catch (e) {}
  try { await ensure(p); } catch (e) { p.done = false; return; }
  if (!pages.includes(p)) return;
  const sc = scale; size(p); const c = canvasFor(p); drawn.add(p);
  try { await paint(p, c.getContext('2d'), sc * p.pr, p); } catch (e) { c.width = c.height = 0; drawn.delete(p); p.done = false; return; }
  if (!p.done || !pages.includes(p) || sc !== scale) { c.width = c.height = 0; drawn.delete(p); return; }
  freeCanvas(p.pc); p.pc = c; p.pcs = sc; place(p, c, 2);
  if (p.him) { p.him.removeAttribute('src'); p.him.remove(); p.him = null; }
  freeCanvas(p.oc); p.oc = null; redraw(p);
  try {                                            // compact copy: the page stays sharp after its canvas is freed
    const b = await blobOf(c, 'image/jpeg', .9);
    if (b && p.pc === c && sc === scale) { if (p.hurl) URL.revokeObjectURL(p.hurl); p.hurl = URL.createObjectURL(b); p.hscale = sc; }
  } catch (e) {}
  trimDrawn();
}
window.__lowMemory = () => {
  const vr = view.getBoundingClientRect();
  pages.forEach(p => {
    const r = p.wrap.getBoundingClientRect(), far = r.bottom < vr.top - 50 || r.top > vr.bottom + 50;
    if (far) { unrender(p); p.read = null; if (r.bottom < vr.top - 3000 || r.top > vr.bottom + 3000) dropHi(p); }
  });
};

/* ---------- which pages are sharp: the ones on screen, then 3 above and below ---------- */
const RANGE = 3; let SG = 0, settleT = 0;
function settle(ms) { clearTimeout(settleT); settleT = setTimeout(runSettle, ms == null ? 150 : ms); }
async function runSettle() {
  if (!pages.length || inGrid() || PZ.on) return;
  const g = ++SG, i = curIndex(), vr = view.getBoundingClientRect(), n = pages.length;
  for (const p of [...drawn]) { const r = p.wrap.getBoundingClientRect(); if (!pages.includes(p) || r.bottom < vr.top - 200 || r.top > vr.bottom + 200) unrender(p); }
  pages.forEach((p, k) => { if ((p.hurl || p.pc) && Math.abs(k - i) > RANGE + 2) dropHi(p); });
  const order = []; let a = i;
  while (a > 0 && pages[a - 1].wrap.getBoundingClientRect().bottom > vr.top) a--;
  for (let k = a; k < n; k++) { if (pages[k].wrap.getBoundingClientRect().top >= vr.bottom) break; order.push(pages[k]); }
  for (let d = 0; d <= RANGE; d++) for (const k of [i + d, i - d]) { const p = pages[k]; if (p && !order.includes(p)) order.push(p); }
  for (const p of order) {
    if (g !== SG) return;
    if (isFresh(p)) { showHi(p); continue; }
    TH.pause = performance.now() + 2000; await render(p);
    if (g !== SG) return; await sleep(MEM.low ? 25 : 8);
  }
  TH.pause = 0;
}

/* ---------- where we are ---------- */
let lastCi = 0;
function curIndex() {                         // fast: binary search on the frame positions
  if (!view.clientHeight) return Math.min(lastCi, Math.max(0, pages.length - 1));   // arranger open: the page last seen
  const y = view.scrollTop + view.clientHeight * 0.3; let lo = 0, hi = pages.length - 1; if (hi < 0) return 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pages[m].wrap.offsetTop <= y) lo = m; else hi = m - 1; }
  return lastCi = lo;
}
const curPage = () => pages[curIndex()] || null;
const pageNo = p => pages.indexOf(p) + 1;
function topPage() {                          // page at the top edge and how far into it
  if (!pages.length) return null; let lo = 0, hi = pages.length - 1; const y = view.scrollTop + 4;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pages[m].wrap.offsetTop <= y) lo = m; else hi = m - 1; }
  const p = pages[lo], h = p.wrap.offsetHeight || 1; return { p, frac: clamp((y - p.wrap.offsetTop) / h, 0, 1) };
}
async function gotoPage(i, frac) {
  const t = pages[clamp(i, 0, pages.length - 1)]; if (!t) return;
  const go = () => { view.scrollTop = t.wrap.offsetTop - 6 + (frac || 0) * t.wrap.offsetHeight; };
  go(); await sleep(30); go(); upd(); settle(0);
}
function scrollToPage(p) { const vr = view.getBoundingClientRect(), pr = p.wrap.getBoundingClientRect(); view.scrollBy({ top: pr.top - vr.top - 6, behavior: 'smooth' }); }
function upd() {
  const p = inGrid() ? null : curPage();
  $('#info').textContent = pages.length ? `Page ${p ? pageNo(p) : 1} / ${pages.length} · ${Math.round(scale / base * 100)}%` : '';
}

/* ---------- zoom: pinch with two fingers; the same zoom for every page ---------- */
const fitW = w => clamp((view.clientWidth - 16) / w, .3, 4);
const savedZoom = () => { const z = +ls('ms.zoom', 1); return z > .2 && z < 20 ? z : 1; };
const saveZoom = () => lset('ms.zoom', scale / base);
function setScale(ns) {
  if (!pages.length) return;
  const ratio = view.scrollTop / (view.scrollHeight || 1);
  scale = ns; pages.forEach(p => { p.done = false; size(p); });
  view.scrollTop = ratio * view.scrollHeight; settle(0); upd();
}
function zoomAt(ns, cx, cy) {
  if (!pages.length) return; ns = clamp(ns, .25, 6); if (Math.abs(ns - scale) < 1e-4) return;
  let tp = null, fx = 0, fy = 0;
  for (const p of pages) { const r = p.wrap.getBoundingClientRect(); if (cy >= r.top - 7 && cy <= r.bottom + 7) { tp = p; fx = (cx - r.left) / r.width; fy = clamp((cy - r.top) / r.height, 0, 1); break; } }
  if (!tp) { setScale(ns); saveZoom(); return; }
  scale = ns; pages.forEach(p => { p.done = false; size(p); });
  const r = tp.wrap.getBoundingClientRect(); view.scrollLeft += r.left + fx * r.width - cx; view.scrollTop += r.top + fy * r.height - cy;
  settle(0); saveZoom(); upd();
}
const PZ = { on: false, f: 1, at: 0 };
view.addEventListener('touchstart', e => {
  if (e.touches.length !== 2 || !pages.length || inGrid()) return;
  const [a, b] = e.touches; PZ.on = true; PZ.f = 1; PZ.d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
  PZ.cx = (a.clientX + b.clientX) / 2; PZ.cy = (a.clientY + b.clientY) / 2; PZ.at = performance.now();
  const r = host.getBoundingClientRect(); host.style.transformOrigin = (PZ.cx - r.left) + 'px ' + (PZ.cy - r.top) + 'px';
  pages.forEach(p => p.cancel && p.cancel());
}, { passive: true });
view.addEventListener('touchmove', e => {
  if (!PZ.on || e.touches.length < 2) return; e.preventDefault();
  const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  PZ.f = clamp(d / PZ.d0, .25 / scale, 6 / scale); host.style.transform = 'scale(' + PZ.f + ')'; PZ.at = performance.now();
}, { passive: false });
const pinchEnd = e => { if (!PZ.on || e.touches.length >= 2) return; PZ.on = false; host.style.transform = ''; PZ.at = performance.now(); if (Math.abs(PZ.f - 1) > .02) zoomAt(scale * PZ.f, PZ.cx, PZ.cy); };
view.addEventListener('touchend', pinchEnd); view.addEventListener('touchcancel', pinchEnd);
window.addEventListener('resize', () => { if (pages.length && !inGrid()) { const z = scale / base; base = fitW(pages[0].w); setScale(base * z); } });
view.addEventListener('scroll', () => { upd(); TH.pause = performance.now() + 800; SG++; settle(); }, { passive: true });

/* ---------- small previews of every page, made in the background, nearest first ---------- */
const TH = { w: MEM.low ? 96 : 130, busy: false, pause: 0, ci: -1, d: 0, prio: [] };
function showPreview(p) { if (!p.timg || p.pimg || !p.vis) return; p.pimg = el('img', { className: 'pim' }); p.pimg.src = p.timg; place(p, p.pimg, 0); }
function hidePreview(p) { if (p.pimg) { p.pimg.remove(); p.pimg = null; } }
function nextThumb() {
  while (TH.prio.length) { const p = TH.prio.shift(); if (pages.includes(p) && (!p.timg || p.tstale) && (p.tfail || 0) < 2) return p; }
  const n = pages.length, ci = curIndex(); if (ci !== TH.ci) { TH.ci = ci; TH.d = 0; }
  while (TH.d < n) {
    const d = TH.d;
    for (const p of [pages[ci + d], d ? pages[ci - d] : null]) if (p && (!p.timg || p.tstale) && (p.tfail || 0) < 2 && p.kind !== 'blank') return p;
    TH.d++;
  }
  return null;
}
async function makeThumb(p) {
  const tw = TH.w, th = Math.max(1, Math.round(tw * p.h / p.w)), c = el('canvas'); c.width = tw; c.height = th;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, tw, th);
  if (p.kind === 'pdf') { const { pg, own } = await bookPage(p); await pg.render({ canvasContext: x, viewport: pg.getViewport({ scale: tw / p.w }) }).promise; if (own && !p.pc) try { pg.cleanup(); } catch (e) {} }
  else await paint(p, x, tw / p.w, null);
  drawMarks(x, p.strokes, tw / p.w);
  const b = await blobOf(c, 'image/jpeg', .6); c.width = c.height = 0;
  if (p.timg) URL.revokeObjectURL(p.timg);
  p.timg = URL.createObjectURL(b); p.tstale = false;
  if (p.pimg) p.pimg.src = p.timg; else showPreview(p);
  if (p.thEl && p.thEl.isConnected) tileImg(p);
}
async function thumbLoop() {
  if (TH.busy) return; TH.busy = true;
  try {
    while (pages.length) {
      if (performance.now() < TH.pause || PZ.on || SEARCH.running || document.hidden) { await sleep(500); continue; }
      const p = nextThumb(); if (!p) { await sleep(2000); if (!nextThumb()) break; continue; }
      try { await makeThumb(p); } catch (e) { p.tfail = (p.tfail || 0) + 1; }
      await sleep(inGrid() ? 10 : (MEM.low ? 35 : 15));
    }
  } finally { TH.busy = false; }
}

/* ---------- big books: cut once into hidden part files, shown as one continuous book ---------- */
let BOOK = null;
const SPLITMIN = MEM.low ? 40e6 : 80e6, PART = MEM.low ? 150 : 250, MAXDOCS = MEM.low ? 2 : 3;
function message(html) { host.innerHTML = ''; host.appendChild(el('div', { id: 'pmsg' }, html)); $('#empty').style.display = 'none'; }
async function openSplitBook(f, want) {
  const first = Math.floor(want / PART), ready = {}, waits = {}; let failed = null, recs = null;
  message('<b>Opening the book…</b><br><small>The first time, a big book is prepared once (kept for next time). The page you were reading opens first.</small><div id="pmsgp"></div>');
  const say = t => { const m = $('#pmsgp'); if (m) m.textContent = t; };
  const setup = j => {
    if (BOOK) return; const n = j.n, sz = j.sizes || [];
    recs = Array.from({ length: n }, (_, i) => { const s = sz[i] || sz[0] || A4; return { kind: 'pdf', pn: i + 1, part: Math.floor(i / j.partSize), lpn: i % j.partSize + 1, w: s[0], h: s[1], nid: f.nid, sidx: i + 1, src: { url: f.url, size: f.size }, osize: f.size / n, doc: null }; });
    BOOK = { size: j.partSize, parts: j.parts, files: [], ready, waits, key: j.key, outline: j.outline || [], docs: new Map(), n };
  };
  const gotPart = (k, path) => { BOOK.files[k] = { path, id: 0 }; ready[k] = true; (waits[k] || []).forEach(r => r()); delete waits[k]; };
  pdfJob({ op: 'prepare', src: f.nid, partSize: PART, first }, d => say(d.msg || ''), (type, d) => {
    if (type === 'info') setup(d);
    if (type === 'part' && BOOK) { gotPart(d.k, d.path); say(`Prepared ${d.done} of ${d.parts}`); }
  }).then(j => { if (!BOOK) setup(j); (j.files || []).forEach((p, k) => { if (!ready[k]) gotPart(k, p); }); })
    .catch(e => { failed = e; if (BOOK) { BOOK.prepFailed = e; Object.keys(waits).forEach(k => { waits[k].forEach(r => r()); delete waits[k]; }); toast('Preparing the book stopped: ' + e.message, 7000); } });
  while (!failed && !(BOOK && ready[Math.min(first, BOOK.parts - 1)])) await sleep(150);
  host.innerHTML = '';
  if (!BOOK || (failed && !ready[first])) { toast((failed ? failed.message + '. ' : '') + 'Opening the book directly instead (may be slow).', 6000); BOOK = null; return null; }
  return recs;
}
function partReady(k) { return new Promise(r => { if (BOOK.ready[k] || BOOK.prepFailed) return r(); (BOOK.waits[k] = BOOK.waits[k] || []).push(r); }); }
async function openPartDoc(k) {                 // a part file is small enough to be read in one go
  const f = BOOK.files[k]; if (!f.id) f.id = A.registerFile(f.path);
  const r = await fetch('/__file/' + f.id, { cache: 'no-store' }); if (!r.ok) throw new Error('part ' + (k + 1) + ' could not be read');
  return pdfjsLib.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;
}
function nearParts() { const i = curIndex(), s = new Set(); for (let k = Math.max(0, i - 10); k <= Math.min(pages.length - 1, i + 10); k++) if (pages[k].part != null) s.add(pages[k].part); return s; }
/* the PDF engine for one part; parts not used for the longest time are closed (and their pages forgotten) */
function partDocFor(k) {
  const D = BOOK.docs; let e = D.get(k); if (e) { e.t = performance.now(); return e.p; }
  const B = BOOK;
  e = { t: performance.now(), p: (async () => { await partReady(k); if (!B.ready[k]) throw new Error('This part of the book could not be prepared'); return openPartDoc(k); })() };
  e.p.catch(() => { if (B.docs.get(k) === e) B.docs.delete(k); }); D.set(k, e);
  if (D.size > MAXDOCS) {
    const keep = nearParts(); keep.add(k);
    const old = [...D.entries()].filter(([x]) => !keep.has(x)).sort((a, b) => a[1].t - b[1].t);
    while (D.size > MAXDOCS && old.length) {
      const [x, o] = old.shift(); D.delete(x);
      for (const p of pages) if (p.part === x && p.doc) { unrender(p); p.doc = null; p.page = null; p.read = null; p.bands = null; p.words = null; }
      o.p.then(d => d.destroy()).catch(() => {});
    }
  }
  return e.p;
}
/* a page for searching / previews (nothing is kept) */
async function bookPage(rec) {
  if (BOOK && rec.part != null) { if (rec.page) return { pg: rec.page, own: false }; const d = await partDocFor(rec.part), pg = await d.getPage(rec.lpn); patchOC(pg); return { pg, own: true }; }
  await ensure(rec); return { pg: rec.page, own: false };
}
function closeBook() { if (!BOOK) return; for (const e of BOOK.docs.values()) e.p.then(d => d.destroy()).catch(() => {}); BOOK = null; }
