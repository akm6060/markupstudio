/* select.js — long press on text in the viewer: the word is selected, two handles stretch the selection,
   and a small menu offers Copy · Select all · Paste. Works on text PDFs, typed books and (through text recognition)
   scanned pages. Paste puts the copied text into a new text box where you pressed. */

let SEL = null, lpT = 0, lpAt = null;
const selm = el('div', { id: 'selm', hidden: true }, '<button data-a="copy">Copy</button><button data-a="all">Select all</button><button data-a="paste">Paste</button><button data-a="x" aria-label="Close">✕</button>');
document.body.appendChild(selm);

/* the word lists of a page: the main text in reading order, then boxes / tables read on their own */
async function selLists(p) { const rd = await pageReadable(p); return [rd.words || []].concat((rd.sgroups || []).map(g => g.words || [])).filter(l => l.length); }

function selClear() {
  if (SEL) SEL.p.wrap.querySelectorAll('.selhl,.selh').forEach(e => e.remove());
  SEL = null; selm.hidden = true;
}
function selText() {
  if (!SEL || !SEL.W) return '';
  const { W, a, b } = SEL; let out = '', si = null;
  for (let k = a; k <= b; k++) { const w = W[k]; if (si !== null) out += w.si !== si ? '\n' : ' '; out += w.w; si = w.si; }
  return out;
}
function selDraw() {
  const { p, W, a, b } = SEL; p.wrap.querySelectorAll('.selhl,.selh').forEach(e => e.remove());
  if (!W) return selMenu();
  const pc = (v, t) => (v / t * 100) + '%', lines = [];
  for (let k = a; k <= b; k++) {
    const w = W[k], L = lines[lines.length - 1];
    if (L && L.si === w.si) { L.x0 = Math.min(L.x0, w.x0); L.x1 = Math.max(L.x1, w.x1); L.t = Math.min(L.t, w.top); L.b = Math.max(L.b, w.bottom); }
    else lines.push({ si: w.si, x0: w.x0, x1: w.x1, t: w.top, b: w.bottom });
  }
  for (const L of lines) p.wrap.appendChild(el('div', { className: 'selhl', style: `left:${pc(L.x0, p.w)};top:${pc(L.t, p.h)};width:${pc(L.x1 - L.x0, p.w)};height:${pc(L.b - L.t, p.h)}` }));
  const wa = W[a], wb = W[b];
  [['s', wa.x0, wa.bottom], ['e', wb.x1, wb.bottom]].forEach(([k, x, y]) => {
    const h = el('div', { className: 'selh ' + k, style: `left:${pc(x, p.w)};top:${pc(y, p.h)}` }); h._k = k; p.wrap.appendChild(h); selDrag(h);
  });
  selMenu();
}
function selMenu() {
  if (!SEL) return; selm.hidden = false;
  const r = SEL.p.wrap.getBoundingClientRect(), W = SEL.W, vr = view.getBoundingClientRect();
  const top = W ? r.top + W[SEL.a].top * scale : SEL.y, bot = W ? r.top + W[SEL.b].bottom * scale : SEL.y, mid = W ? r.left + (W[SEL.a].x0 + W[SEL.b].x1) / 2 * scale : SEL.x;
  const mh = selm.offsetHeight || 44, mw = selm.offsetWidth || 260;
  let y = top - mh - 14; if (y < vr.top + 4) y = bot + 30; if (y > vr.bottom - mh - 4) y = Math.max(vr.top + 4, Math.min(top, vr.bottom) - mh - 14);
  selm.style.top = y + 'px'; selm.style.left = clamp(mid - mw / 2, 6, innerWidth - mw - 6) + 'px';
  selm.querySelector('[data-a=copy]').style.display = W ? '' : 'none';
}
/* the handles: drag to make the selection longer or shorter */
function selDrag(h) {
  h.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault(); h.setPointerCapture(e.pointerId); selm.hidden = true;
    const move = ev => {
      if (!SEL || !SEL.W) return; const r = SEL.p.wrap.getBoundingClientRect(), x = (ev.clientX - r.left) / scale, y = (ev.clientY - r.top - 22) / scale;
      const i = RC.nearestWord(SEL.W, x, y, 80); if (i < 0) return;
      if (h._k === 's') { SEL.a = i; } else { SEL.b = i; }
      if (SEL.a > SEL.b) { [SEL.a, SEL.b] = [SEL.b, SEL.a]; h._k = h._k === 's' ? 'e' : 's'; }
      SEL.p.wrap.querySelectorAll('.selhl').forEach(e => e.remove());
      const keep = h; selDrawLines(); keep.style.left = (h._k === 's' ? SEL.W[SEL.a].x0 : SEL.W[SEL.b].x1) / SEL.p.w * 100 + '%'; keep.style.top = (h._k === 's' ? SEL.W[SEL.a].bottom : SEL.W[SEL.b].bottom) / SEL.p.h * 100 + '%';
    };
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); if (SEL) selDraw(); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
}
function selDrawLines() {           // only the coloured lines (the handle being dragged stays)
  const { p, W, a, b } = SEL, pc = (v, t) => (v / t * 100) + '%', lines = [];
  for (let k = a; k <= b; k++) { const w = W[k], L = lines[lines.length - 1]; if (L && L.si === w.si) { L.x0 = Math.min(L.x0, w.x0); L.x1 = Math.max(L.x1, w.x1); L.t = Math.min(L.t, w.top); L.b = Math.max(L.b, w.bottom); } else lines.push({ si: w.si, x0: w.x0, x1: w.x1, t: w.top, b: w.bottom }); }
  for (const L of lines) p.wrap.appendChild(el('div', { className: 'selhl', style: `left:${pc(L.x0, p.w)};top:${pc(L.t, p.h)};width:${pc(L.x1 - L.x0, p.w)};height:${pc(L.b - L.t, p.h)}` }));
}

/* ---------- long press ---------- */
async function selStart(p, x, y, cx, cy) {
  selClear(); try { navigator.vibrate && navigator.vibrate(25); } catch (e) {}
  let lists = []; try { lists = await selLists(p); } catch (e) {}
  let best = null, bd = Infinity;
  for (const W of lists) { const i = RC.nearestWord(W, x, y, 40); if (i < 0) continue; const w = W[i], d = Math.hypot(Math.max(w.x0 - x, 0, x - w.x1), Math.max(w.top - y, 0, y - w.bottom) * 2); if (d < bd) { bd = d; best = { W, i }; } }
  SEL = best ? { p, W: best.W, a: best.i, b: best.i, px: x, py: y, x: cx, y: cy, lists } : { p, W: null, px: x, py: y, x: cx, y: cy, lists };
  selDraw();
}
view.addEventListener('pointerdown', e => {
  clearTimeout(lpT); lpAt = null;
  if (SEL && !e.target.closest('.selh')) selClear();
  if (tool !== 'scroll' || inGrid() || !e.isPrimary || ED) return;
  const wrap = e.target.closest && e.target.closest('.pg'); if (!wrap || !wrap._p) return;
  lpAt = { x: e.clientX, y: e.clientY, p: wrap._p };
  lpT = setTimeout(() => {
    const a = lpAt; lpAt = null; if (!a || performance.now() - PZ.at < 800) return;
    tap = null; clearTimeout(tapTimer);                   // not a tap: nothing is read aloud
    const r = a.p.wrap.getBoundingClientRect();
    selStart(a.p, (a.x - r.left) / scale, (a.y - r.top) / scale, a.x, a.y);
  }, 520);
}, true);
view.addEventListener('pointermove', e => { if (lpAt && Math.hypot(e.clientX - lpAt.x, e.clientY - lpAt.y) > 10) { clearTimeout(lpT); lpAt = null; } }, true);
['pointerup', 'pointercancel'].forEach(t => view.addEventListener(t, () => { clearTimeout(lpT); lpAt = null; }, true));
view.addEventListener('scroll', () => { clearTimeout(lpT); lpAt = null; if (SEL && !selm.hidden) selMenu(); }, { passive: true });

/* ---------- the menu ---------- */
const clipSet = t => { try { if (A.copyText(t)) return true; } catch (e) {} try { navigator.clipboard.writeText(t); return true; } catch (e) { return false; } };
const clipGet = async () => { try { const t = A.pasteText(); if (t) return t; } catch (e) {} try { return await navigator.clipboard.readText(); } catch (e) { return ''; } };
selm.addEventListener('pointerdown', e => e.stopPropagation());
selm.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !SEL) return;
  const a = b.dataset.a;
  if (a === 'x') { selClear(); return; }
  if (a === 'copy') { const t = selText(); if (t && clipSet(t)) toast('Copied · ' + (t.length > 40 ? t.slice(0, 40) + '…' : t), 1800); selClear(); return; }
  if (a === 'all') {
    if (!SEL.lists.length) { toast('No text found on this page'); return; }
    const W = SEL.lists[0].concat(...SEL.lists.slice(1)); SEL.W = W; SEL.a = 0; SEL.b = W.length - 1; selDraw(); return;
  }
  if (a === 'paste') {
    const t = await clipGet(), { p, px, py } = SEL; selClear();
    if (!t) { toast('Nothing copied yet'); return; }
    setTool('text'); txOpen(p, txNew(px, py - TX.sz * .75), true);
    document.execCommand('insertText', false, t); txSync(); txSaveSoon();
  }
});
