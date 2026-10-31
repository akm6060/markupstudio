/* marks.js — pen, underline, highlighter, eraser and undo. A mark ("stroke") is kept in page units:
   pen / line: {t, c, w, a, p:[[x,y]…]}, underline snapped to words: {t:'wu', segs:[[x0,x1,y]…]},
   highlight snapped to words: {t:'hl', segs:[[x0,y0,x1,y1]…]}, text: {t:'tx', …} (see text.js) */

const PEN = { pen: { w: 3, a: 1 }, line: { w: 3, a: 1 }, hl: { w: 14, a: .4 } };
let penColor = '#e11d48';
{ const v = ls('ms.pens', null); if (v) for (const k in PEN) Object.assign(PEN[k], v[k] || {}); penColor = ls('ms.pcol', penColor); }
const savePens = () => { lset('ms.pens', PEN); lset('ms.pcol', penColor); };
const ER = Object.assign({ mode: 'stroke', w: 20 }, ls('ms.er', {}));   // eraser: whole stroke or area; size in screen pixels

/* ---------- drawing marks (k = canvas pixels per page unit) ---------- */
function drawStroke(ctx, s, k) {
  if (s.t === 'tx') { drawTx(ctx, s, k); return; }
  ctx.globalAlpha = s.a || (s.t === 'hl' ? .4 : 1);
  if (s.t === 'hl') { ctx.fillStyle = s.c; s.segs.forEach(g => ctx.fillRect(g[0] * k, g[1] * k, (g[2] - g[0]) * k, (g[3] - g[1]) * k)); }
  else if (s.t === 'wu') { ctx.strokeStyle = s.c; ctx.lineWidth = s.w * k; ctx.lineCap = 'round'; s.segs.forEach(g => { ctx.beginPath(); ctx.moveTo(g[0] * k, g[2] * k); ctx.lineTo(g[1] * k, g[2] * k); ctx.stroke(); }); }
  else {
    const q = s.p; ctx.strokeStyle = s.c; ctx.lineWidth = s.w * k; ctx.lineCap = s.sq ? 'butt' : 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    if (q.length === 1) { ctx.fillStyle = s.c; ctx.arc(q[0][0] * k, q[0][1] * k, s.w * k / 2, 0, 7); ctx.fill(); }
    else {
      ctx.moveTo(q[0][0] * k, q[0][1] * k);
      if (s.t === 'line' || q.length < 3) ctx.lineTo(q[q.length - 1][0] * k, q[q.length - 1][1] * k);
      else { for (let i = 1; i < q.length - 1; i++) ctx.quadraticCurveTo(q[i][0] * k, q[i][1] * k, (q[i][0] + q[i + 1][0]) / 2 * k, (q[i][1] + q[i + 1][1]) / 2 * k); ctx.lineTo(q[q.length - 1][0] * k, q[q.length - 1][1] * k); }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
const drawMarks = (ctx, strokes, k) => strokes.forEach(s => drawStroke(ctx, s, k));
/* the marks layer of a page: only exists while the page has marks or one is being drawn */
function redraw(p, extra) {
  if (!p.strokes.length && !extra) { freeCanvas(p.oc); p.oc = null; return; }
  if (!p.oc || p.oc.width !== Math.max(1, Math.round(p.w * scale * p.pr))) { freeCanvas(p.oc); p.oc = canvasFor(p, 'oc'); place(p, p.oc, 3); }
  const c = p.oc.getContext('2d'), k = scale * p.pr;
  c.clearRect(0, 0, p.oc.width, p.oc.height);
  p.strokes.forEach(s => { if (!ED || ED.s !== s) drawStroke(c, s, k); });
  if (extra) drawStroke(c, extra, k);
}
/* distance from a point to a mark */
function dist(pt, s) {
  let m = 1e9;
  if (s.t === 'tx') return Math.hypot(Math.max(s.x - pt[0], 0, pt[0] - s.x - s.w), Math.max(s.y - pt[1], 0, pt[1] - s.y - s.h));
  if (s.t === 'hl') { for (const g of s.segs) m = Math.min(m, Math.hypot(Math.max(g[0] - pt[0], 0, pt[0] - g[2]), Math.max(g[1] - pt[1], 0, pt[1] - g[3]))); return m; }
  if (s.t === 'wu') { for (const g of s.segs) m = Math.min(m, Math.hypot(Math.max(g[0] - pt[0], 0, pt[0] - g[1]), pt[1] - g[2])); return m; }
  const q = s.p; if (q.length === 1) return Math.hypot(pt[0] - q[0][0], pt[1] - q[0][1]);
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1], b = q[i], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1, t = clamp(((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l, 0, 1);
    m = Math.min(m, Math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dy));
  }
  return m;
}

/* ---------- underline and highlighter snap to the words of the page ---------- */
async function getWords(p) {
  if (p.words) return p.words; p.words = [];
  if (p.kind === 'txt') {
    const W = []; p.lines.forEach((l, i) => { const re = /\S+/g, y = 40 + i * 12 + 8; let m; while ((m = re.exec(l))) W.push({ x0: 40 + m.index * 5.4, x1: 40 + (m.index + m[0].length) * 5.4, y, t: y - 7.6, b: y + 2, s: 9 }); });
    return p.words = W;
  }
  if (p.kind !== 'pdf') return p.words;
  try {
    await ensure(p); const tc = await p.page.getTextContent(), vp = p.page.getViewport({ scale: 1 }), W = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = pdfjsLib.Util.transform(vp.transform, it.transform), fs = Math.hypot(t[2], t[3]) || it.height, cw = it.width / it.str.length, re = /\S+/g; let m;
      while ((m = re.exec(it.str))) W.push({ x0: t[4] + m.index * cw, x1: t[4] + (m.index + m[0].length) * cw, y: t[5], t: t[5] - fs * .85, b: t[5] + fs * .22, s: fs });
    }
    p.words = W;
  } catch (e) {}
  return p.words;
}
function nearestWord(W, pt) { let bi = -1, bd = 2500; W.forEach((w, i) => { const dx = Math.max(w.x0 - pt[0], 0, pt[0] - w.x1), dy = Math.max(w.t - pt[1], 0, pt[1] - w.b), d = dx * dx + dy * dy * 4; if (d < bd) { bd = d; bi = i; } }); return bi; }
/* the words from point a to point b, joined per line */
function wordSegs(W, a, b) {
  let i = nearestWord(W, a), j = nearestWord(W, b); if (i < 0 || j < 0) return null; if (i > j) [i, j] = [j, i];
  const segs = []; let g = null;
  for (let k = i; k <= j; k++) {
    const w = W[k];
    if (g && Math.abs(w.y - g.y) < g.s * .5) { g.x0 = Math.min(g.x0, w.x0); g.x1 = Math.max(g.x1, w.x1); g.t = Math.min(g.t, w.t); g.b = Math.max(g.b, w.b); }
    else { g = { x0: w.x0, x1: w.x1, y: w.y, t: w.t, b: w.b, s: w.s }; segs.push(g); }
  }
  return segs;
}
/* the mark being drawn -> the mark kept */
function finishStroke(c, p) {
  const pts = c.p, W = p.words || [];
  if (c.t === 'line') {
    const sg = wordSegs(W, pts[0], pts[1]);
    if (sg) return { t: 'wu', c: c.c, w: c.w, a: c.a, segs: sg.map(g => [g.x0, g.x1, g.y + 1.5 + c.w / 2]) };
    return { t: 'line', c: c.c, w: c.w, a: c.a, p: [pts[0], [pts[1][0], pts[0][1]]] };
  }
  if (c.t === 'hl') {
    const sg = wordSegs(W, pts[0], pts[pts.length - 1]);
    if (sg) return { t: 'hl', c: c.c, w: c.w, a: c.a, segs: sg.map(g => { const m = (g.t + g.b) / 2; return [g.x0 - 1, m - c.w / 2, g.x1 + 1, m + c.w / 2]; }) };
    return { t: 'line', sq: 1, c: c.c, w: c.w, a: c.a, p: [pts[0], [pts[pts.length - 1][0], pts[0][1]]] };
  }
  return c;
}

/* ---------- eraser: the part of a mark under the eraser circle (c, radius r) is taken out ---------- */
function cutStroke(s, c, r) {
  if (s.t === 'tx') return dist(c, s) <= 0 ? [] : s;
  if (s.t === 'wu' || s.t === 'hl') {
    const segs = [], rr = s.t === 'wu' ? r + s.w / 2 : r; let hit = false;
    for (const g of s.segs) {
      const wu = s.t === 'wu', y0 = wu ? g[2] : g[1], y1 = wu ? g[2] : g[3], x0 = g[0], x1 = wu ? g[1] : g[2];
      const dy = c[1] < y0 ? y0 - c[1] : c[1] > y1 ? c[1] - y1 : 0;
      if (dy >= rr || c[0] + rr < x0 || c[0] - rr > x1) { segs.push(g); continue; }
      const dx = Math.sqrt(rr * rr - dy * dy), a = c[0] - dx, b = c[0] + dx;
      if (b <= x0 || a >= x1) { segs.push(g); continue; }
      hit = true; const mk = (u, v) => wu ? [u, v, g[2]] : [u, g[1], v, g[3]];
      if (a - x0 > .8) segs.push(mk(x0, a)); if (x1 - b > .8) segs.push(mk(b, x1));
    }
    return hit ? (segs.length ? [Object.assign({}, s, { segs })] : []) : s;
  }
  const q = s.p; if (!q || !q.length) return s;
  const rr = r + (s.w || 2) / 2, inC = pt => Math.hypot(pt[0] - c[0], pt[1] - c[1]) < rr;
  if (q.length === 1) return inC(q[0]) ? [] : s;
  const P = [q[0]];                                // points close together, so the cut is exact
  for (let i = 1; i < q.length; i++) { const a = q[i - 1], b = q[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(.5, r / 3)); for (let k = 1; k <= n; k++) P.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  if (!P.some(inC)) return s;
  const out = []; let run = [];
  const flush = () => { if (run.length >= 2) out.push(Object.assign({}, s, { p: s.t === 'line' ? [run[0], run[run.length - 1]] : run })); run = []; };
  for (const pt of P) { if (inC(pt)) flush(); else run.push(pt); }
  flush(); return out;
}
let erDiv = null;
function erCursor(e) {
  if (!e) { if (erDiv) erDiv.style.display = 'none'; return; }
  if (!erDiv) { erDiv = el('div', { id: 'ercur' }); document.body.appendChild(erDiv); }
  const d = ER.w; erDiv.style.cssText = `display:block;width:${d}px;height:${d}px;left:${e.clientX - d / 2}px;top:${e.clientY - d / 2}px`;
}

/* ---------- touching a page: draw, erase, place text ---------- */
let erPrev = null;     // the tool used before the eraser: comes back after erasing
function bindPage(p) {
  const w = p.wrap; let cur = null, erSnap = null;
  p.cancel = () => { if (cur && cur !== 'erase') { cur = null; redraw(p); } else cur = null; };
  const pt = e => { const r = w.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; };
  const erase = e => {
    const x = pt(e), r = ER.w / 2 / scale; erCursor(e);
    if (ER.mode === 'stroke') {
      for (let i = p.strokes.length - 1; i >= 0; i--) {
        const s = p.strokes[i]; if (ED && ED.s === s) continue;
        if (dist(x, s) <= (s.t === 'tx' ? 0 : s.w / 2) + r) { p.strokes.splice(i, 1); undo.push({ k: 'del', p, s, i }); edited(p); redraw(p); break; }
      }
      return;
    }
    let ch = false; const out = [];
    for (const s of p.strokes) { if (ED && ED.s === s) { out.push(s); continue; } const res = cutStroke(s, x, r); if (res === s) out.push(s); else { ch = true; out.push(...res); } }
    if (ch) { if (!erSnap) erSnap = p.strokes.slice(); p.strokes.splice(0, p.strokes.length, ...out); edited(p); redraw(p); }
  };
  w.onpointerdown = e => {
    if (tool === 'text') { if (e.isPrimary && !(e.target.classList && e.target.classList.contains('txed'))) txDown = { p, x: e.clientX, y: e.clientY, pt: pt(e) }; return; }
    if (tool === 'scroll' || PZ.on || !e.isPrimary) return;
    e.preventDefault(); w.setPointerCapture(e.pointerId);
    if (tool === 'erase') { cur = 'erase'; erase(e); return; }
    if (!p.words) getWords(p);
    cur = { t: tool, c: penColor, w: PEN[tool].w, a: PEN[tool].a, p: [pt(e)] }; if (tool === 'line') cur.p.push(pt(e));
    redraw(p, finishStroke(cur, p));
  };
  w.onpointermove = e => {
    if (!cur) return; if (PZ.on) { p.cancel(); return; }
    if (cur === 'erase') { erase(e); return; }
    const x = pt(e); if (cur.t === 'line') cur.p[1] = x; else cur.p.push(x);
    redraw(p, finishStroke(cur, p));
  };
  const end = () => {
    if (cur === 'erase') {
      erCursor(null); if (erSnap) { undo.push({ k: 'rep', p, before: erSnap }); erSnap = null; } cur = null;
      if (erPrev && erPrev !== 'erase') { const t = erPrev; erPrev = null; setTool(t); }
      return;
    }
    if (cur) {
      const s = finishStroke(cur, p), ok = s.t !== 'line' || Math.hypot(s.p[1][0] - s.p[0][0], s.p[1][1] - s.p[0][1]) > 2;
      if (ok) { p.strokes.push(s); undo.push({ k: 'add', p, s }); edited(p); }
      redraw(p);
    }
    cur = null;
  };
  w.onpointerup = e => {
    if (tool === 'text') { const d = txDown; txDown = null; if (d && d.p === p && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) txTap(p, d.pt); return; }
    end();
  };
  w.onpointercancel = () => { txDown = null; end(); };
}

/* ---------- a page's marks changed: saved by itself a moment later ---------- */
function edited(p) { p.ver = (p.ver || 0) + 1; p.tstale = true; changedMarks(p); }

/* ---------- undo: marks and page changes ---------- */
const restoreObj = (s, b) => { for (const k of Object.keys(s)) if (!(k in b)) delete s[k]; Object.assign(s, b); };
function doUndo() {
  txClose(); const a = undo.pop(); if (!a) return;
  if (a.k === 'pages') {
    const keep = new Set(a.before), had = new Set(pages);
    for (const p of pages) if (!keep.has(p)) removePage(p);
    for (const p of a.before) if (!had.has(p)) io.observe(p.wrap);
    pages = a.before; reorderDOM(); syncEmpty(); changedPages(); if (inGrid()) buildGrid(); upd(); settle(0);
    return;
  }
  if (!pages.includes(a.p)) { doUndo(); return; }
  if (a.k === 'rep') a.p.strokes.splice(0, a.p.strokes.length, ...a.before);
  else if (a.k === 'add') { const i = a.p.strokes.indexOf(a.s); if (i > -1) a.p.strokes.splice(i, 1); }
  else if (a.k === 'tx') { restoreObj(a.s, a.before); if (a.p.strokes.indexOf(a.s) < 0) a.p.strokes.push(a.s); }
  else a.p.strokes.splice(a.i, 0, a.s);
  edited(a.p); redraw(a.p);
}
$('#undo').onclick = doUndo;
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo(); } });
$('#clr').onclick = () => {
  const p = curPage(); if (!p || !p.strokes.length || !confirm('Clear all marks on page ' + pageNo(p) + '?')) return;
  txClose(); p.strokes.slice().reverse().forEach(s => undo.push({ k: 'del', p, s, i: 0 }));
  p.strokes.splice(0); edited(p); redraw(p);
};
