/* arranger.js — all pages as thumbnails (2 to 12 per row): tap = select, sideways swipe = select many,
   up/down swipe starting on a selected page = move the selection, double tap = open that page.
   Every change shows at once; the file follows by itself (save.js). */

const tg = $('#tgrid');
let gcols = +ls('ms.gcols', 4) || 4, fromGrid = false, gpick = false;
const gio = new IntersectionObserver(es => es.forEach(en => {
  const p = en.target._p; if (en.isIntersecting && p && (!p.timg || p.tstale)) { TH.prio.push(p); thumbLoop(); }
}), { root: tg, rootMargin: '300px 0px' });
function setCols(n) {
  gcols = clamp(n, 2, 12); tg.style.setProperty('--cols', gcols); tg.style.setProperty('--gap', gcols > 8 ? '2px' : gcols > 5 ? '5px' : '10px');
  tg.classList.toggle('tiny', gcols > 8); $('#gsize').value = 14 - gcols; lset('ms.gcols', gcols);
}
function firstTile() { let lo = 0, hi = pages.length - 1; while (lo < hi) { const m = (lo + hi) >> 1, t = pages[m].thEl; if (t && t.offsetTop + t.offsetHeight < tg.scrollTop) lo = m + 1; else hi = m; } return pages[lo]; }
$('#gsize').oninput = e => { const a = firstTile(); setCols(14 - (+e.target.value)); if (a && a.thEl) tg.scrollTop = a.thEl.offsetTop - 8; };
function openGrid() { if (!pages.length) return; fromGrid = false; closePanels(); txClose(); document.body.classList.add('grid'); setCols(gcols); buildGrid(true); }
function closeGrid(go) {
  setPick(false); document.body.classList.remove('grid'); gio.disconnect();
  const t = go || pages.find(p => p.sel);
  requestAnimationFrame(() => { if (t && pages.includes(t)) gotoPage(pages.indexOf(t), 0); upd(); settle(0); });
}
$('#pgs').onclick = openGrid;
$('#gdone').onclick = () => closeGrid();
function tileImg(p) { const im = p.thEl && p.thEl.firstChild; if (im && p.timg && im.getAttribute('src') !== p.timg) im.src = p.timg; }
function buildGrid(jump) {
  gio.disconnect(); const st = tg.scrollTop, fr = document.createDocumentFragment(); tg.innerHTML = '';
  pages.forEach((p, i) => {
    const d = el('div', { className: 'th' + (p.sel ? ' sel' : '') }); d._p = p; d._i = i; p.thEl = d;
    const im = el('img', { className: 'tp', alt: '' }); im.style.aspectRatio = p.w + '/' + p.h; if (p.timg) im.src = p.timg; d.appendChild(im);
    d.appendChild(el('span', { textContent: i + 1 })); fr.appendChild(d); gio.observe(d);
  });
  tg.appendChild(fr); count();
  if (jump) { const c = pages[curIndex()], go = () => { if (c && c.thEl) tg.scrollTop = c.thEl.offsetTop - tg.clientHeight / 3; }; go(); requestAnimationFrame(go); setTimeout(go, 120); }
  else tg.scrollTop = st;
}
const count = () => { const n = pages.filter(p => p.sel).length; $('#gcnt').textContent = n ? n + ' selected' : pages.length + ' pages'; };
function setSel(i, v) { const p = pages[i]; if (!p || p.sel === v) return; p.sel = v; if (p.thEl) p.thEl.classList.toggle('sel', v); }

/* ---------- gestures ---------- */
let gs = null, lastTap = { i: -1, t: 0 }, drop = null;
const clearDrop = () => { if (drop) { drop.el.classList.remove('dropb', 'dropa'); drop = null; } };
function dropAt(x, y) {
  const n = document.elementFromPoint(x, y), t = n && n.closest && n.closest('.th'); clearDrop(); if (!t) return;
  const r = t.getBoundingClientRect(), after = x > r.left + r.width / 2; t.classList.add(after ? 'dropa' : 'dropb'); drop = { el: t, i: t._i, after };
}
const edgeScroll = (y, k) => { const r = tg.getBoundingClientRect(); if (y > r.bottom - 55) tg.scrollTop += k; else if (y < r.top + 55) tg.scrollTop -= k; };
tg.addEventListener('pointerdown', e => {
  const t = e.target.closest && e.target.closest('.th'); if (!t) return;
  gs = { x: e.clientX, y: e.clientY, i: t._i, mode: null, cur: t._i, snap: null, val: false, id: e.pointerId, onSel: !!pages[t._i].sel };
});
tg.addEventListener('pointermove', e => {
  if (!gs) return; const dx = e.clientX - gs.x, dy = e.clientY - gs.y;
  if (!gs.mode) {
    if (gs.onSel && Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)) {          // move the selected pages
      gs.mode = 'move'; try { tg.setPointerCapture(gs.id); } catch (x) {} pages.forEach(p => p.sel && p.thEl && p.thEl.classList.add('mv'));
    } else if (Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy) * .8) {          // select by swiping
      gs.mode = 'drag'; gs.snap = pages.map(p => p.sel); gs.val = !pages[gs.i].sel; try { tg.setPointerCapture(gs.id); } catch (x) {} setSel(gs.i, gs.val);
    } else if (Math.abs(dy) > 9) { gs.mode = 'scroll'; return; } else return;
  }
  if (gs.mode === 'move') { e.preventDefault(); dropAt(e.clientX, e.clientY); edgeScroll(e.clientY, 16); return; }
  if (gs.mode !== 'drag') return;
  e.preventDefault();
  const n = document.elementFromPoint(e.clientX, e.clientY), t = n && n.closest && n.closest('.th');
  if (t && t._i !== gs.cur) {
    const a0 = Math.min(gs.i, gs.cur), b0 = Math.max(gs.i, gs.cur), a1 = Math.min(gs.i, t._i), b1 = Math.max(gs.i, t._i);
    for (let k = a0; k <= b0; k++) if (k < a1 || k > b1) setSel(k, gs.snap[k]);
    for (let k = a1; k <= b1; k++) setSel(k, gs.val);
    gs.cur = t._i; count();
  }
  edgeScroll(e.clientY, 14);
}, { passive: false });
function gestureEnd(e) {
  if (!gs) return; const g = gs; gs = null;
  if (g.mode === 'move') {
    const d = drop; clearDrop(); pages.forEach(p => p.thEl && p.thEl.classList.remove('mv'));
    if (d && e.type === 'pointerup') { let t = d.i + (d.after ? 1 : 0); while (t < pages.length && pages[t].sel) t++; const st = tg.scrollTop; if (moveTo(t < pages.length ? t : null)) { buildGrid(); tg.scrollTop = st; } }
    return;
  }
  if (g.mode || e.type !== 'pointerup') return;
  const now = performance.now();
  if (gpick) { setPick(false); if (moveTo(g.i)) { buildGrid(); const f = pages.find(p => p.sel); if (f && f.thEl) tg.scrollTop = f.thEl.offsetTop - tg.clientHeight / 3; } return; }
  if (lastTap.i === g.i && now - lastTap.t < 420) { setSel(g.i, !pages[g.i].sel); lastTap.i = -1; closeGrid(pages[g.i]); fromGrid = true; return; }   // double tap: open
  lastTap = { i: g.i, t: now }; setSel(g.i, !pages[g.i].sel); count();
}
tg.addEventListener('pointerup', gestureEnd); tg.addEventListener('pointercancel', gestureEnd);

/* ---------- page changes (also used by the 📄 page menu) ---------- */
const snapPages = () => undo.push({ k: 'pages', before: pages.slice() });
const selected = () => pages.filter(p => p.sel);
function moveStep(dir) {
  const n = pages.length; if (!pages.some(p => p.sel)) return; snapPages();
  if (dir < 0) { for (let i = 1; i < n; i++) if (pages[i].sel && !pages[i - 1].sel) [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; }
  else { for (let i = n - 2; i >= 0; i--) if (pages[i].sel && !pages[i + 1].sel) [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; }
  reorderDOM(); changedPages();
}
/* the selected pages go just before page t (null: to the end) */
function moveTo(t) {
  const sel = selected(); if (!sel.length) return false;
  const target = t == null ? null : pages[t]; if (target && target.sel) return false;
  snapPages(); const rest = pages.filter(p => !p.sel), i = target ? rest.indexOf(target) : rest.length;
  pages = rest.slice(0, i).concat(sel, rest.slice(i)); reorderDOM(); changedPages(); settle(0); return true;
}
function deletePages(del) {
  if (!del.length) return false;
  if (del.length >= pages.length) { toast('At least one page must stay'); return false; }
  snapPages(); txClose(); del.forEach(p => { p.sel = false; removePage(p); });
  pages = pages.filter(p => !del.includes(p)); changedPages(); syncEmpty(); upd(); settle(0); return true;
}
function blankAfter(i) {
  snapPages(); const ref = pages[i] || pages[pages.length - 1] || { w: A4[0], h: A4[1] };
  const b = addPages([{ kind: 'blank', w: ref.w, h: ref.h }], i + 1)[0]; changedPages(); return b;
}
function copyOf(p) {
  return { kind: p.kind, doc: p.doc, src: p.src, osize: p.osize, pn: p.pn, part: p.part, lpn: p.lpn, cv: p.cv, lines: p.lines, w: p.w, h: p.h,
    nid: p.nid, sidx: p.sidx, opn: p.opn, og: p.og, fo: 0, ver: 1, vO: 0, vC: 0, strokes: JSON.parse(JSON.stringify(p.strokes)) };
}
function duplicate(list) { snapPages(); for (let i = pages.length - 1; i >= 0; i--) if (list.includes(pages[i])) addPages([copyOf(pages[i])], i + 1); changedPages(); }
const insIdx = () => { let k = -1; pages.forEach((p, i) => { if (p.sel) k = i; }); return k < 0 ? pages.length : k + 1; };
function setPick(v) {
  gpick = v; document.body.classList.toggle('gpick', v); $('#gmv').textContent = v ? '✕ Cancel' : '⇢ Move to…';
  if (v) $('#gcnt').textContent = 'Tap the page to put them before'; else count();
}
$('#gall').onclick = () => { pages.forEach((p, i) => setSel(i, true)); count(); };
$('#gnone').onclick = () => { pages.forEach((p, i) => setSel(i, false)); count(); };
$('#gup').onclick = () => { moveStep(-1); buildGrid(); };
$('#gdn').onclick = () => { moveStep(1); buildGrid(); };
$('#gmv').onclick = () => { if (gpick) { setPick(false); return; } if (!pages.some(p => p.sel)) { toast('Select pages first'); return; } setPick(true); };
$('#gend').onclick = () => { setPick(false); if (moveTo(null)) buildGrid(); };
$('#gdel').onclick = () => { const del = selected(); if (deletePages(del)) { buildGrid(); toast(del.length + ' page' + (del.length > 1 ? 's' : '') + ' deleted · ↶ undo brings them back'); } };
$('#gadd').onclick = () => { blankAfter(insIdx() - 1); buildGrid(); };
$('#gdup').onclick = () => { const l = selected(); if (l.length) { duplicate(l); buildGrid(); } };
$('#gfile').onclick = () => openBrowser('add');
$('#gexp').onclick = () => openExport();
/* one page (📄 menu) */
const PAGEOPS = {
  move: (p, d) => { pages.forEach(q => { q.sel = q === p; }); moveStep(d); pages.forEach(q => { q.sel = false; }); },
  moveTo: (p, n) => { pages.forEach(q => { q.sel = q === p; }); const rest = pages.filter(q => q !== p), t = rest[clamp(n, 0, rest.length)]; moveTo(t ? pages.indexOf(t) : null); pages.forEach(q => { q.sel = false; }); },
  del: p => deletePages([p]), dup: p => duplicate([p]), blank: p => blankAfter(pages.indexOf(p))
};
