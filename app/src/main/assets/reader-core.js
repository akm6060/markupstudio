/* reader-core.js — page layout analysis for reading order (columns, images, blockers).
   Works in the WebView (global ReaderCore) and in Node (module.exports) for testing. */
(function (root) {
'use strict';
const RC = {};
const mul = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const app = (m, x, y) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];
const median = a => { if (!a.length) return 10; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const cy = e => (e.top + e.bottom) / 2;
RC.mul = mul;

/* ---- images from the operator list (view coordinates, y down) ---- */
RC.scanImages = function (fn, args, OPS, vpT, W, H) {
  const names = ['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintJpegXObject','paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintSolidColorImageMask','paintImageMaskXObjectGroup'];
  const imgOps = new Set(names.map(n => OPS[n]).filter(v => v !== undefined));
  let ctm = [1,0,0,1,0,0]; const st = [], imgs = []; let scanned = false;
  for (let i = 0; i < fn.length; i++) {
    const f = fn[i];
    if (f === OPS.save) st.push(ctm.slice());
    else if (f === OPS.restore) { if (st.length) ctm = st.pop(); }
    else if (f === OPS.transform) ctm = mul(ctm, args[i]);
    else if (f === OPS.paintFormXObjectBegin) { st.push(ctm.slice()); if (args[i] && args[i][0]) ctm = mul(ctm, args[i][0]); }
    else if (f === OPS.paintFormXObjectEnd) { if (st.length) ctm = st.pop(); }
    else if (imgOps.has(f)) {
      const m = mul(vpT, ctm), P = [app(m,0,0), app(m,1,0), app(m,0,1), app(m,1,1)];
      const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
      const r = { kind: 'i', x0: Math.min(...xs), x1: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
      const w = r.x1 - r.x0, h = r.bottom - r.top;
      if (w < 12 || h < 12) continue;
      if (w * h >= 0.75 * W * H) { scanned = true; continue; }
      r.base = r.bottom; imgs.push(r);
    }
  }
  return { imgs, scanned };
};

/* ---- text items -> line segments ---- */
RC.buildSegments = function (items, vpT) {
  const parts = [];
  for (const it of items) {
    if (!it || typeof it.str !== 'string' || it.str === '') continue;
    const t = mul(vpT, it.transform), fs = Math.hypot(t[2], t[3]) || it.height || 10, hx = Math.hypot(t[0], t[1]);
    if (Math.abs(t[1]) > 0.25 * hx) continue;           // not horizontal on screen
    if (fs < 2.5) continue;
    const w = it.width || 0;
    if (!it.str.trim()) { parts.push({ s: ' ', x0: t[4], x1: t[4] + w, base: t[5], fs, sp: true }); continue; }
    parts.push({ s: it.str, x0: t[4], x1: t[4] + w, base: t[5], fs });
  }
  const segs = []; let cur = null;
  const fin = () => { if (cur) { while (cur.parts.length && cur.parts[cur.parts.length-1].sp) cur.parts.pop(); if (cur.parts.length) { cur.x1 = cur.parts[cur.parts.length-1].x1; segs.push(cur); } } cur = null; };
  for (const p of parts) {
    if (cur) {
      const last = cur.parts[cur.parts.length-1], gap = p.x0 - last.x1, mf = Math.max(cur.size, p.fs);
      if (Math.abs(p.base - cur.base) < 0.35 * mf && gap > -0.6 * mf && gap < 1.0 * mf) { cur.parts.push(p); cur.size = Math.max(cur.size, p.fs); continue; }
      fin();
    }
    if (p.sp) continue;
    cur = { kind: 't', x0: p.x0, x1: p.x1, base: p.base, size: p.fs, parts: [p] };
  }
  fin();
  for (const s of segs) { s.top = s.base - 0.9 * s.size; s.bottom = s.base + 0.25 * s.size; }
  return segs;
};

/* ---- reading order: gutters, blockers, recursive split ---- */
/* an element blocks a gutter only if it reaches the middle half of it (images slightly overhanging a column do not) */
function hits(e, g) { const m = (g.x0 + g.x1) / 2, hw = (g.x1 - g.x0) * 0.25; return e.x0 < m + hw && e.x1 > m - hw; }
function findGutters(elems) {
  const texts = elems.filter(e => e.kind === 't');
  if (texts.length < 6) return [];
  let minX = Infinity, maxX = -Infinity, totalH = 0;
  for (const e of elems) { minX = Math.min(minX, e.x0); maxX = Math.max(maxX, e.x1); totalH += e.bottom - e.top; }
  const width = maxX - minX; if (width < 120) return [];
  const med = median(texts.map(t => t.size)), Tv = Math.max(8, 0.9 * med);
  const N = Math.ceil(width) + 2, cov = new Float64Array(N);
  for (const e of elems) { const i0 = Math.max(0, Math.floor(e.x0 - minX)), i1 = Math.min(N, Math.ceil(e.x1 - minX)), h = e.bottom - e.top; for (let i = i0; i < i1; i++) cov[i] += h; }
  const thr = 0.25 * totalH, runs = []; let s = -1;
  for (let i = 0; i <= N; i++) {
    const free = i < N && cov[i] <= thr;
    if (free && s < 0) s = i; else if (!free && s >= 0) { runs.push([s + minX, i + minX]); s = -1; }
  }
  const lo = minX + 0.1 * width, hi = maxX - 0.1 * width;
  let G = runs.filter(r => r[1] - r[0] >= Tv && r[0] > lo && r[1] < hi).map(r => ({ x0: r[0], x1: r[1] }));
  const colsOK = (gs) => {
    const bins = Array.from({ length: gs.length + 1 }, () => []);
    for (const t of texts) {
      if (gs.some(g => hits(t, g))) continue;
      const c = (t.x0 + t.x1) / 2; let k = 0; while (k < gs.length && c > (gs[k].x0 + gs[k].x1) / 2) k++; bins[k].push(t);
    }
    return bins.map(b => ({ n: b.length, w: b.length ? Math.max(...b.map(t => t.x1)) - Math.min(...b.map(t => t.x0)) : 0 }));
  };
  while (G.length) {
    const info = colsOK(G), tot = info.reduce((a, c) => a + c.n, 0);
    let bad = info.findIndex(c => c.n < 3 || c.w < 0.12 * width);
    if (bad < 0 && tot < 0.5 * texts.length) bad = 0;
    if (bad < 0) break;
    const cand = [Math.min(bad, G.length - 1), Math.max(bad - 1, 0)];       // gutters adjacent to the bad column
    let drop = cand[0]; if (G[cand[1]].x1 - G[cand[1]].x0 < G[cand[0]].x1 - G[cand[0]].x0) drop = cand[1];
    G.splice(drop, 1);
  }
  return G;
}
function sortFlow(elems) {
  const a = elems.slice().sort((p, q) => (p.base - q.base) || (p.x0 - q.x0)), out = [];
  let row = [], rb = null, rs = 0;
  const flush = () => { row.sort((p, q) => p.x0 - q.x0); for (const r of row) out.push(r); row = []; };
  for (const e of a) {
    if (rb !== null && Math.abs(e.base - rb) <= 0.5 * Math.max(rs, e.size || 10)) { row.push(e); continue; }
    flush(); row = [e]; rb = e.base; rs = e.size || 10;
  }
  flush(); return out;
}
RC.order = function (elems, depth) {
  depth = depth || 0;
  if (elems.length < 2 || depth > 6) return sortFlow(elems);
  const G = findGutters(elems);
  if (!G.length) return sortFlow(elems);
  const crosses = e => G.some(g => hits(e, g));
  const blockers = [], rest = [];
  for (const e of elems) (crosses(e) ? blockers : rest).push(e);
  let out = [];
  if (!blockers.length) {
    const bins = Array.from({ length: G.length + 1 }, () => []);
    for (const e of rest) { const c = (e.x0 + e.x1) / 2; let k = 0; while (k < G.length && c > (G[k].x0 + G[k].x1) / 2) k++; bins[k].push(e); }
    for (const b of bins) out = out.concat(RC.order(b, depth + 1));
    return out;
  }
  blockers.sort((a, b) => cy(a) - cy(b));
  const regions = Array.from({ length: blockers.length + 1 }, () => []);
  for (const e of rest) { const c = cy(e); let k = 0; while (k < blockers.length && cy(blockers[k]) < c) k++; regions[k].push(e); }
  for (let i = 0; i <= blockers.length; i++) {
    if (regions[i].length) out = out.concat(RC.order(regions[i], depth + 1));
    if (i < blockers.length) out.push(blockers[i]);
  }
  return out;
};

/* ---- words in reading order ---- */
function segWords(seg) {
  const W = []; let tok = '', tx0 = 0, tx1 = 0;
  const end = () => { if (tok) W.push({ w: tok, x0: tx0, x1: tx1, top: seg.top, bottom: seg.bottom, base: seg.base, size: seg.size }); tok = ''; };
  seg.parts.forEach((p, pi) => {
    const len = p.s.length || 1, cw = (p.x1 - p.x0) / len;
    for (let i = 0; i < p.s.length; i++) {
      const ch = p.s[i];
      if (/\s/.test(ch)) { end(); continue; }
      const x = p.x0 + i * cw;
      if (!tok) tx0 = x; tok += ch; tx1 = x + cw;
    }
    const nx = seg.parts[pi + 1];
    if (nx && nx.x0 - p.x1 > 0.15 * seg.size) end();
  });
  end(); return W;
}
RC.toWords = function (ordered) {
  const words = [];
  ordered.forEach((seg, si) => {
    const ws = segWords(seg); if (!ws.length) return;
    ws.forEach(w => { w.si = si; });
    const n = ordered[si + 1], last = ws[ws.length - 1];
    let brk = 'line';
    if (!n) brk = 'para';
    else { const dy = n.base - seg.base; if (dy > 1.9 * seg.size || dy < -0.3 * seg.size) brk = 'para'; }
    last.brk = brk;
    for (const w of ws) words.push(w);
  });
  return words;
};
RC.analyze = function (o) {
  let segs = RC.buildSegments(o.items || [], o.vpT), imgs = [], scanned = false;
  if (o.fnArray) { const r = RC.scanImages(o.fnArray, o.argsArray, o.OPS, o.vpT, o.W, o.H); imgs = r.imgs; scanned = r.scanned; }
  if (o.skipMargins !== false && o.H) {         // running headers / page numbers in the outer margins are not read
    const hi = 0.955 * o.H, lo = 0.045 * o.H;
    segs = segs.filter(s => !((s.base > hi || s.base < lo) && s.parts.reduce((n, p) => n + p.s.length, 0) <= 60));
  }
  if (imgs.length) segs = segs.filter(s => { const cx = (s.x0 + s.x1) / 2, c = (s.top + s.bottom) / 2; return !imgs.some(im => cx >= im.x0 - 1 && cx <= im.x1 + 1 && c >= im.top - 1 && c <= im.bottom + 1); });
  const ordered = RC.order(segs.concat(imgs), 0).filter(e => e.kind === 't');
  return { words: RC.toWords(ordered), imgs, scanned };
};
RC.textWords = function (lines) {            // plain-text pages (monospace layout used by the viewer)
  const words = [];
  lines.forEach((l, i) => {
    const re = /\S+/g, y = 40 + i * 12 + 8; let m, last = null;
    while ((m = re.exec(l))) { last = { w: m[0], x0: 40 + m.index * 5.4, x1: 40 + (m.index + m[0].length) * 5.4, top: y - 7.6, bottom: y + 2, base: y, size: 9, si: i }; words.push(last); }
    if (last) last.brk = l.trim() === '' || !lines[i + 1] || !lines[i + 1].trim() ? 'para' : 'line';
  });
  return words;
};

/* ---- speech chunks ---- */
const DEV = /[ऀ-ॿ]/g, LAT = /[A-Za-z]/g, END = /[.!?।॥…]["'”’)\]]*$/;
RC.langOf = function (t) { const d = (t.match(DEV) || []).length, l = (t.match(LAT) || []).length; return d && d / (d + l) >= 0.35 ? 'hi' : 'en'; };
RC.chunks = function (words, start, maxLen) {
  maxLen = maxLen || 260; const out = []; let i = start || 0;
  while (i < words.length) {
    let text = '', map = [], j = i, prevGlue = false;
    while (j < words.length) {
      const w = words[j]; let tok = w.w, glue = false;
      if (/[-‐‑]$/.test(tok) && tok.length > 1 && w.brk === 'line' && j + 1 < words.length && /^[a-z]/.test(words[j + 1].w)) { tok = tok.slice(0, -1); glue = true; }
      const sp = text.length && !prevGlue ? 1 : 0, cs = text.length + sp;
      text += (sp ? ' ' : '') + tok; map.push({ wi: j, s: cs, e: cs + tok.length }); prevGlue = glue; j++;
      if (glue) continue;
      if (w.brk === 'para') break;
      if (text.length >= 30 && END.test(tok)) break;
      if (text.length >= maxLen) break;
    }
    out.push({ text, map, lang: RC.langOf(text), a: i, b: j - 1 }); i = j;
  }
  return out;
};
RC.nearestWord = function (words, x, y, tol) {
  let bi = -1, bd = Infinity;
  for (let i = 0; i < words.length; i++) {
    const w = words[i], dx = Math.max(w.x0 - x, 0, x - w.x1), dy = Math.max(w.top - y, 0, y - w.bottom), d = dx * dx + 4 * dy * dy;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi >= 0 && Math.sqrt(bd) <= (tol || 26) ? bi : -1;
};
if (typeof module !== 'undefined' && module.exports) module.exports = RC; else root.ReaderCore = RC;
})(typeof self !== 'undefined' ? self : this);
