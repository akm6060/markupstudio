/* reader-core.js — page layout analysis for read-aloud:
   columns (auto or forced 1/2/3), headers / page numbers, tables, pictures + labels + captions, side notes,
   and speech chunks that switch between Hindi and English voices word by word.
   Works in the WebView (global ReaderCore) and in Node (module.exports) for testing. */
(function (root) {
'use strict';
const RC = {};
const mul = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const app = (m, x, y) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];
const median = a => { if (!a.length) return 10; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const cy = e => (e.top + e.bottom) / 2;
RC.mul = mul;
RC.DEF = { cols: 'auto', head: true, tables: true, pics: true, side: true, main: true, heads: false };

/* ---- Devanagari: PDFs often store the i-matra (ि) before its consonant; put it back after the cluster ---- */
RC.fixDeva = s => s.replace(/(^|[^क-हक़-य़़्])ि((?:[क-हक़-य़]़?्)*[क-हक़-य़]़?)/g, '$1$2ि');
RC.wordLang = t => {
  let d = 0, l = 0;
  for (const ch of t) { const c = ch.charCodeAt(0); if (c >= 0x900 && c <= 0x97F) d++; else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) l++; }
  return d > l ? 'hi' : l ? 'en' : d ? 'hi' : '';
};

/* ---- images from the operator list (view coordinates, y down) ---- */
function walk(fn, args, OPS, cb) {
  let ctm = [1,0,0,1,0,0]; const st = [];
  for (let i = 0; i < fn.length; i++) {
    const f = fn[i];
    if (f === OPS.save) st.push(ctm.slice());
    else if (f === OPS.restore) { if (st.length) ctm = st.pop(); }
    else if (f === OPS.transform) ctm = mul(ctm, args[i]);
    else if (f === OPS.paintFormXObjectBegin) { st.push(ctm.slice()); if (args[i] && args[i][0]) ctm = mul(ctm, args[i][0]); }
    else if (f === OPS.paintFormXObjectEnd) { if (st.length) ctm = st.pop(); }
    else cb(f, args[i], ctm, i);
  }
}
RC.scanImages = function (fn, args, OPS, vpT, W, H) {
  const names = ['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintJpegXObject','paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintSolidColorImageMask','paintImageMaskXObjectGroup'];
  const imgOps = new Set(names.map(n => OPS[n]).filter(v => v !== undefined));
  const imgs = []; let scanned = false;
  walk(fn, args, OPS, (f, a, ctm) => {
    if (!imgOps.has(f)) return;
    const m = mul(vpT, ctm), P = [app(m,0,0), app(m,1,0), app(m,0,1), app(m,1,1)];
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    const r = { kind: 'i', x0: Math.min(...xs), x1: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    const w = r.x1 - r.x0, h = r.bottom - r.top;
    if (w < 12 || h < 12) return;
    if (w * h >= 0.75 * W * H) { scanned = true; return; }
    r.base = r.bottom; imgs.push(r);
  });
  return { imgs, scanned };
};

/* ---- vector paths: horizontal / vertical rules (tables) and curves / diagonals (drawings) ---- */
RC.scanPaths = function (fn, args, OPS, vpT, W, H) {
  const Hs = [], Vs = [], O = [], B = [], pageA = W * H;
  const stroke = new Set(['stroke','closeStroke','fillStroke','eoFillStroke','closeFillStroke','closeEOFillStroke'].map(n => OPS[n]).filter(v => v !== undefined));
  const fill = new Set(['fill','eoFill'].map(n => OPS[n]).filter(v => v !== undefined));
  let n = 0;
  const line = (a, b) => {
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    if (dy <= 1.5 && dx >= 4) Hs.push({ x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y: (a[1] + b[1]) / 2 });
    else if (dx <= 1.5 && dy >= 4) Vs.push({ y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]), x: (a[0] + b[0]) / 2 });
    else if (dx >= 2 || dy >= 2) O.push({ x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), top: Math.min(a[1], b[1]), bottom: Math.max(a[1], b[1]) });
  };
  walk(fn, args, OPS, (f, a, ctm, i) => {
    if (f !== OPS.constructPath || n > 20000) return;
    const nf = fn[i + 1], isS = stroke.has(nf), isF = fill.has(nf);
    if (!isS && !isF) return;                                  // clipping path or invisible
    const ops = a[0], co = a[1], m = mul(vpT, ctm), P = (x, y) => app(m, x, y);
    const axis = Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6;
    let k = 0, cx = 0, cyy = 0, sx = 0, sy = 0, sub = null;
    const subs = [];
    for (const op of ops) {
      n++;
      if (op === OPS.moveTo) { cx = co[k++]; cyy = co[k++]; sx = cx; sy = cyy; sub = { pts: [P(cx, cyy)], closed: false }; subs.push(sub); }
      else if (op === OPS.lineTo) { const x = co[k++], y = co[k++]; if (isS) line(P(cx, cyy), P(x, y)); cx = x; cyy = y; if (sub) sub.pts.push(P(x, y)); }
      else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
        const c = op === OPS.curveTo ? 6 : 4, pts = [P(cx, cyy)];
        for (let j = 0; j < c; j += 2) pts.push(P(co[k + j], co[k + j + 1]));
        cx = co[k + c - 2]; cyy = co[k + c - 1]; k += c;
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        O.push({ x0: Math.min(...xs), x1: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), c: 1 });
        if (sub) sub.pts.push(...pts.slice(1));
      }
      else if (op === OPS.closePath) { if (isS && (cx !== sx || cyy !== sy)) line(P(cx, cyy), P(sx, sy)); cx = sx; cyy = sy; if (sub) sub.closed = true; }
      else if (op === OPS.rectangle) {
        const x = co[k++], y = co[k++], w = co[k++], h = co[k++]; cx = sx = x; cyy = sy = y;
        const A = P(x, y), Bq = P(x + w, y + h);
        subs.push({ pts: [A, P(x + w, y), Bq, P(x, y + h)], closed: true });
        if (!axis) { if (isS) { line(A, P(x + w, y)); line(P(x + w, y), Bq); line(Bq, P(x, y + h)); line(P(x, y + h), A); } continue; }
        const l = Math.min(A[0], Bq[0]), r = Math.max(A[0], Bq[0]), t = Math.min(A[1], Bq[1]), b = Math.max(A[1], Bq[1]), rw = r - l, rh = b - t;
        if (rw * rh > 0.6 * pageA) continue;                     // page background / frame
        if (rh <= 3 && rw >= 4) Hs.push({ x0: l, x1: r, y: (t + b) / 2 });
        else if (rw <= 3 && rh >= 4) Vs.push({ y0: t, y1: b, x: (l + r) / 2 });
        else if (isS) { Hs.push({ x0: l, x1: r, y: t }, { x0: l, x1: r, y: b }); Vs.push({ y0: t, y1: b, x: l }, { y0: t, y1: b, x: r }); }
        // large filled rectangles (shading, highlights) are ignored here; coloured backgrounds are found from the picture
      }
    }
    if (isS) for (const q of subs) {                            // outlined closed shapes = boxes around text
      if (q.pts.length < 3) continue;
      const f = q.pts[0], l = q.pts[q.pts.length - 1];
      if (!q.closed && Math.hypot(f[0] - l[0], f[1] - l[1]) > 1.5) continue;
      const xs = q.pts.map(p => p[0]), ys = q.pts.map(p => p[1]), b = { x0: Math.min(...xs), x1: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
      if (b.x1 - b.x0 >= 20 && b.bottom - b.top >= 12 && (b.x1 - b.x0) * (b.bottom - b.top) < 0.7 * pageA) B.push(b);
    }
  });
  return { H: Hs, V: Vs, O, B };
};

/* ---- text items -> parts -> line segments ---- */
RC.buildParts = function (items, vpT) {
  const parts = [];
  for (const it of items) {
    if (!it || typeof it.str !== 'string' || it.str === '') continue;
    const t = mul(vpT, it.transform), fs = Math.hypot(t[2], t[3]) || it.height || 10, hx = Math.hypot(t[0], t[1]);
    if (Math.abs(t[1]) > 0.25 * hx || t[0] < 0) continue;      // not horizontal on screen
    if (fs < 2.5) continue;
    const w = it.width || 0, s = it.str;
    if (!s.trim()) { parts.push({ s: ' ', x0: t[4], x1: t[4] + w, base: t[5], fs, sp: true }); continue; }
    if (s.length > 6 && /\S\s{3,}\S/.test(s)) {                  // one item holding two columns: split at wide spaces
      const cw = w / s.length, re = /\S+(?:\s{1,2}\S+)*/g; let m;
      while ((m = re.exec(s))) parts.push({ s: m[0], x0: t[4] + m.index * cw, x1: t[4] + (m.index + m[0].length) * cw, base: t[5], fs, fn: it.fontName });
      continue;
    }
    parts.push({ s, x0: t[4], x1: t[4] + w, base: t[5], fs, fn: it.fontName });
  }
  return parts;
};
const asEl = p => ({ kind: 't', x0: p.x0, x1: p.x1, top: p.base - 0.9 * p.fs, bottom: p.base + 0.25 * p.fs, size: p.fs, base: p.base });
RC.mergeParts = function (parts, cuts) {
  cuts = cuts || [];
  const crosses = (a, b) => cuts.some(g => { const m = (g.x0 + g.x1) / 2; return a < m && b > m; });
  const segs = []; let cur = null;
  const fin = () => { if (cur) { while (cur.parts.length && cur.parts[cur.parts.length-1].sp) cur.parts.pop(); if (cur.parts.length) { cur.x1 = cur.parts[cur.parts.length-1].x1; segs.push(cur); } } cur = null; };
  for (const p of parts) {
    if (p.sp && p.x1 - p.x0 > 0.6 * p.fs) { fin(); continue; }       // a wide "space" is a gap between columns or cells
    if (cur) {
      let li = cur.parts.length - 1; while (li > 0 && cur.parts[li].sp) li--;
      const last = cur.parts[cur.parts.length-1], solid = cur.parts[li], gap = p.x0 - last.x1, mf = Math.max(cur.size, p.fs);
      if (Math.abs(p.base - cur.base) < 0.35 * mf && gap > -0.6 * mf && gap < 0.9 * mf && p.x0 - solid.x1 < 1.2 * mf && !crosses(solid.x1 - 0.5, p.x0 + 0.5)) { cur.parts.push(p); cur.size = Math.max(cur.size, p.fs); continue; }
      fin();
    }
    if (p.sp) continue;
    cur = { kind: 't', x0: p.x0, x1: p.x1, base: p.base, size: p.fs, parts: [p] };
  }
  fin();
  for (const s of segs) {
    s.top = s.base - 0.9 * s.size; s.bottom = s.base + 0.25 * s.size; s.text = s.parts.map(p => p.s).join(''); s.n = s.text.replace(/\s/g, '').length;
    const byF = new Map(), byS = new Map();                 // dominant font and size, counted by characters
    for (const p of s.parts) { if (p.sp) continue; const l = p.s.replace(/\s/g, '').length || 1; byF.set(p.fn, (byF.get(p.fn) || 0) + l); const k = Math.round(p.fs * 4) / 4; byS.set(k, (byS.get(k) || 0) + l); }
    s.fn = [...byF].sort((a, b) => b[1] - a[1])[0][0]; s.dsize = [...byS].sort((a, b) => b[1] - a[1])[0][0];
  }
  return segs;
};
RC.buildSegments = (items, vpT) => RC.mergeParts(RC.buildParts(items, vpT), []);

/* ---- columns ---- */
function hits(e, g) { const m = (g.x0 + g.x1) / 2, hw = Math.max(0.5, (g.x1 - g.x0) * 0.25); return e.x0 < m + hw && e.x1 > m - hw; }
function coverage(elems) {
  let minX = Infinity, maxX = -Infinity, totalH = 0;
  for (const e of elems) { minX = Math.min(minX, e.x0); maxX = Math.max(maxX, e.x1); totalH += e.bottom - e.top; }
  const width = maxX - minX, N = Math.max(1, Math.ceil(width) + 2), cov = new Float64Array(N);
  for (const e of elems) { const i0 = Math.max(0, Math.floor(e.x0 - minX)), i1 = Math.min(N, Math.ceil(e.x1 - minX)), h = e.bottom - e.top; for (let i = i0; i < i1; i++) cov[i] += h; }
  return { minX, maxX, width, N, cov, totalH };
}
function binOf(e, G) { const c = (e.x0 + e.x1) / 2; let k = 0; while (k < G.length && c > (G[k].x0 + G[k].x1) / 2) k++; return k; }
function findGutters(elems) {
  const texts = elems.filter(e => e.kind === 't');
  if (texts.length < 6) return [];
  const C = coverage(elems), { minX, maxX, width, N, cov } = C;
  if (width < 120) return [];
  const med = median(texts.map(t => t.size)), Tv = Math.max(4, 0.45 * med);
  const thr = 0.25 * C.totalH, runs = []; let s = -1;
  for (let i = 0; i <= N; i++) {
    const free = i < N && cov[i] <= thr;
    if (free && s < 0) s = i; else if (!free && s >= 0) { runs.push([s + minX, i + minX]); s = -1; }
  }
  const lo = minX + 0.1 * width, hi = maxX - 0.1 * width;
  /* keep only the emptiest part of each run, so ragged line ends next to the gap do not count as "crossing" it */
  const narrow = r => {
    const a = Math.round(r[0] - minX), b = Math.round(r[1] - minX) - 1; let best = Infinity;
    for (let i = a; i <= b; i++) best = Math.min(best, cov[i]);
    let bs = a, bl = 0, s = -1;
    for (let i = a; i <= b + 1; i++) { const ok = i <= b && cov[i] <= best + 1e-6; if (ok && s < 0) s = i; else if (!ok && s >= 0) { if (i - s > bl) { bl = i - s; bs = s; } s = -1; } }
    return { x0: minX + bs, x1: minX + bs + Math.max(1, bl) };
  };
  const G = runs.filter(r => r[1] - r[0] >= Tv && r[0] > lo && r[1] < hi).map(narrow);
  const colsOK = gs => {
    const bins = Array.from({ length: gs.length + 1 }, () => []);
    for (const t of texts) { if (gs.some(g => hits(t, g))) continue; bins[binOf(t, gs)].push(t); }
    return bins.map(b => ({ n: b.length, w: b.length ? Math.max(...b.map(t => t.x1)) - Math.min(...b.map(t => t.x0)) : 0 }));
  };
  while (G.length) {
    const info = colsOK(G), tot = info.reduce((a, c) => a + c.n, 0);
    let bad = info.findIndex(c => c.n < 3 || c.w < 0.12 * width);
    if (bad < 0 && tot < 0.5 * texts.length) bad = 0;
    if (bad < 0) break;
    const cand = [Math.min(bad, G.length - 1), Math.max(bad - 1, 0)];
    let drop = cand[0]; if (G[cand[1]].x1 - G[cand[1]].x0 < G[cand[0]].x1 - G[cand[0]].x0) drop = cand[1];
    G.splice(drop, 1);
  }
  return G;
}
RC.findGutters = findGutters;
/* user said "this page has n columns": put the n-1 gutters at the emptiest places near the expected positions */
RC.forcedGutters = function (elems, n) {
  const texts = elems.filter(e => e.kind === 't');
  if (n < 2 || texts.length < 2) return [];
  const { minX, width, N, cov } = coverage(texts), out = [];
  for (let k = 1; k < n; k++) {
    const c = k * width / n, a = Math.max(0, Math.floor(c - 0.15 * width)), b = Math.min(N - 1, Math.ceil(c + 0.15 * width));
    let best = Infinity; for (let i = a; i <= b; i++) best = Math.min(best, cov[i]);
    let bs = Math.round(c), bl = 0, s = -1;
    for (let i = a; i <= b + 1; i++) {
      const ok = i <= b && cov[i] <= best + 1e-6;
      if (ok && s < 0) s = i;
      else if (!ok && s >= 0) { const l = i - s; if (l > bl || (l === bl && Math.abs(s + l / 2 - c) < Math.abs(bs + bl / 2 - c))) { bl = l; bs = s; } s = -1; }
    }
    out.push({ x0: minX + bs, x1: minX + bs + Math.max(1, bl) });
  }
  return out;
};
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
/* reading order: split into columns at gutters; anything crossing a gutter (title, wide picture, table)
   splits the page into bands that are read top to bottom, each band column by column */
RC.order = function (elems, depth, forced) {
  depth = depth || 0;
  if (elems.length < 2 || depth > 6) return sortFlow(elems);
  const G = forced || findGutters(elems);
  if (!G.length) return sortFlow(elems);
  const crosses = e => G.some(g => hits(e, g));
  const blockers = [], rest = [];
  for (const e of elems) (crosses(e) ? blockers : rest).push(e);
  let out = [];
  if (!blockers.length) {
    const bins = Array.from({ length: G.length + 1 }, () => []);
    for (const e of rest) bins[binOf(e, G)].push(e);
    for (const b of bins) out = out.concat(forced ? sortFlow(b) : RC.order(b, depth + 1));
    return out;
  }
  blockers.sort((a, b) => cy(a) - cy(b));
  const regions = Array.from({ length: blockers.length + 1 }, () => []);
  for (const e of rest) { const c = cy(e); let k = 0; while (k < blockers.length && cy(blockers[k]) < c) k++; regions[k].push(e); }
  for (let i = 0; i <= blockers.length; i++) {
    if (regions[i].length) out = out.concat(RC.order(regions[i], depth + 1, forced));
    if (i < blockers.length) out.push(blockers[i]);
  }
  return out;
};

/* ---- things that are not running text ---- */
const inside = (s, b, pad) => { const x = (s.x0 + s.x1) / 2, y = cy(s); return x >= b.x0 - pad && x <= b.x1 + pad && y >= b.top - pad && y <= b.bottom + pad; };
function groupRows(segs) {
  const a = segs.slice().sort((p, q) => p.base - q.base), rows = []; let r = null;
  for (const s of a) { if (r && Math.abs(s.base - r.base) <= 0.4 * Math.max(r.size, s.size)) r.items.push(s); else { r = { base: s.base, size: s.size, items: [s] }; rows.push(r); } }
  rows.forEach(r => r.items.sort((p, q) => p.x0 - q.x0));
  return rows;
}
function uf(n) { const p = Array.from({ length: n }, (_, i) => i); const f = i => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; }; return { f, u: (a, b) => { a = f(a); b = f(b); if (a !== b) p[a] = b; } }; }
function cluster(boxes, tol) {
  const n = boxes.length, U = uf(n), idx = boxes.map((b, i) => i).sort((a, b) => boxes[a].x0 - boxes[b].x0);
  for (let ii = 0; ii < n; ii++) {
    const a = boxes[idx[ii]];
    for (let jj = ii + 1; jj < n; jj++) {
      const b = boxes[idx[jj]]; if (b.x0 > a.x1 + tol) break;
      if (b.top <= a.bottom + tol && b.bottom >= a.top - tol) U.u(idx[ii], idx[jj]);
    }
  }
  const g = new Map(); boxes.forEach((b, i) => { const r = U.f(i); if (!g.has(r)) g.set(r, []); g.get(r).push(b); });
  return [...g.values()];
}
const bbox = bs => ({ x0: Math.min(...bs.map(b => b.x0)), x1: Math.max(...bs.map(b => b.x1)), top: Math.min(...bs.map(b => b.top)), bottom: Math.max(...bs.map(b => b.bottom)) });
const PN = /^[\s\-–—|•·()[\]]*(?:(?:page|pg\.?|p\.|पृष्ठ|पेज|पृ\.?)\s*)?(?:[0-9०-९]{1,4}|[ivxlcdm]{1,7})(?:\s*(?:of|\/|का|में से)\s*[0-9०-९]{1,4})?[\s\-–—|•·()[\]]*$/i;
RC.norm = t => String(t).toLowerCase().replace(/[0-9०-९]+/g, '#').replace(/[\s.,:;|·•\-–—()[\]'"“”‘’]+/g, ' ').trim();
function headFoot(segs, H, drop, med, repeat) {
  const few = segs.filter(s => !s.skip).length < 5;     // a page with almost no text: keep what little there is
  for (const s of segs) {
    if (s.skip) continue;
    const t = s.text.trim();
    if ((s.base < 0.16 * H || s.top > 0.84 * H) && PN.test(t)) { drop(s, 'page number'); continue; }
    if (repeat && repeat.size && (s.base < 0.13 * H || s.top > 0.87 * H) && s.n <= 100) { const nt = RC.norm(t), yk = Math.round(s.base / 6); if ([yk - 1, yk, yk + 1].some(k => repeat.has(nt + '@' + k))) { drop(s, 'book name / running header'); continue; } }
    const inTop = s.base < 0.09 * H, inBot = s.top > 0.91 * H;
    if (few || !(inTop || inBot) || s.n > 90 || s.size > 1.15 * med) continue;
    let gap = Infinity;
    for (const q of segs) { if (q === s || q.skip) continue; const dy = inTop ? q.base - s.base : s.base - q.base; if (dy > 0.5 * s.size) gap = Math.min(gap, dy); }
    if (gap >= 1.9 * Math.max(s.size, med) || s.size < 0.87 * med) drop(s, inTop ? 'header' : 'footer');
  }
}
function findFigures(O, segs, W, H) {
  if (!O || O.length < 3) return [];
  const list = O.length > 3000 ? O.slice(0, 3000) : O, out = [];
  for (const g of cluster(list, 6)) {
    if (g.length < 3) continue;
    const b = bbox(g), w = b.x1 - b.x0, h = b.bottom - b.top;
    if (w < 25 || h < 25 || w * h > 0.7 * W * H) continue;
    const ins = segs.filter(s => !s.skip && inside(s, b, 4));
    const ns = ins.map(s => s.n);
    if (!ins.length || (median(ns) < 25 && Math.max(...ns) <= 60)) { b.fig = true; b.kind = 'f'; out.push(b); }
  }
  return out;
}
const CAP = /^(fig(ure)?\.?|photo(graph)?|image|picture|plate|source|map|chart|graph|diagram|illustration|table|चित्र|आकृति|तालिका|सारणी|स्रोत|मानचित्र|छाया\s*चित्र)(?=[\s.:\-–—0-9०-९]|$)/i;
function captions(segs, boxes, drop, med) {
  const near = s => boxes.some(b => s.x0 < b.x1 + 4 && s.x1 > b.x0 - 4 && ((s.top - b.bottom >= -2 && s.top - b.bottom <= 2.2 * s.size) || (b.top - s.bottom >= -2 && b.top - s.bottom <= 2.2 * s.size)));
  const sorted = segs.slice().sort((p, q) => p.base - q.base);
  for (const s of sorted) {
    if (s.skip) continue;
    const t = s.text.trim(), isCap = CAP.test(t), nb = near(s);
    if (!((isCap && (nb || s.size < 0.95 * med)) || (nb && s.n <= 60 && s.size < 0.95 * med))) continue;
    drop(s, 'caption');
    let last = s;                                              // the caption may continue on the next lines
    for (let k = 0; k < 4; k++) {
      const nx = sorted.find(q => !q.skip && q.base > last.base + 0.5 * last.size && q.base - last.base <= 1.6 * last.size && q.x0 < last.x1 && q.x1 > last.x0 && Math.abs(q.size - last.size) <= 0.1 * last.size);
      if (!nx) break; drop(nx, 'caption'); last = nx;
    }
  }
}
function tabular(segs) { const rows = groupRows(segs), good = rows.filter(r => r.items.length >= 3).length; return rows.length >= 2 && good >= 2 && good >= 0.5 * rows.length; }
function findTables(paths, segs, G, W, H) {
  const T = [], total = segs.length || 1;
  const ok = b => segs.filter(s => inside(s, b, 1.5)).length <= 0.6 * total || total < 8;
  if (paths) {
    const L = paths.H.filter(h => h.x1 - h.x0 >= 8).map(h => ({ h: 1, x0: h.x0, x1: h.x1, top: h.y, bottom: h.y, pos: h.y }))
      .concat(paths.V.filter(v => v.y1 - v.y0 >= 8).map(v => ({ h: 0, x0: v.x, x1: v.x, top: v.y0, bottom: v.y1, pos: v.x })));
    if (L.length <= 3000) for (const g of cluster(L, 2.5)) {
      const hp = new Set(g.filter(l => l.h).map(l => Math.round(l.pos / 2))), vp = new Set(g.filter(l => !l.h).map(l => Math.round(l.pos / 2)));
      if (hp.size >= 3 && vp.size >= 3) { const b = bbox(g); if ((b.x1 - b.x0) * (b.bottom - b.top) < 0.85 * W * H && ok(b)) { b.why = 'grid'; T.push(b); } }
    }
    /* a divider sits between rows of text, not hugging the text above it like an underline */
    const divider = h => !segs.some(s => s.x0 < h.x1 && s.x1 > h.x0 && h.y >= s.base - 0.2 * s.size && h.y - s.base < 0.35 * s.size);
    const hs = paths.H.filter(h => h.x1 - h.x0 >= 60 && !T.some(t => h.y >= t.top - 2 && h.y <= t.bottom + 2) && divider(h)).sort((a, b) => a.y - b.y), used = new Set();
    const med = median(segs.map(s => s.size));
    for (let i = 0; i < hs.length; i++) {
      if (used.has(i)) continue; const grp = [hs[i]];
      for (let j = i + 1; j < hs.length; j++) if (!used.has(j) && Math.abs(hs[j].x0 - hs[i].x0) <= 4 && Math.abs(hs[j].x1 - hs[i].x1) <= 4) { grp.push(hs[j]); used.add(j); }
      if (grp.length < 2) continue;
      /* 3+ dividers close together (rows of a table), or 2 with cells between them */
      let run = [grp[0]];
      const close = () => {
        if (run.length < 2) return;
        const b = { x0: hs[i].x0, x1: hs[i].x1, top: run[0].y, bottom: run[run.length - 1].y };
        if (b.bottom - b.top < 15 || b.bottom - b.top > 0.6 * H) return;
        if ((run.length >= 3 || tabular(segs.filter(s => inside(s, b, 1)))) && ok(b)) { b.why = 'ruled'; T.push(b); }
      };
      for (let k = 1; k < grp.length; k++) { if (grp[k].y - run[run.length - 1].y <= 4.5 * med) run.push(grp[k]); else { close(); run = [grp[k]]; } }
      close();
    }
  }
  /* tables without lines: rows of 3+ separate cells inside one column */
  const bands = Array.from({ length: (G || []).length + 1 }, () => []);
  for (const s of segs) if (!T.some(t => inside(s, t, 1.5))) bands[binOf(s, G || [])].push(s);
  for (const band of bands) {
    const rows = groupRows(band);
    rows.forEach(r => { r.t = r.items.length >= 3; });
    rows.forEach((r, i) => { if (!r.t && r.items.length >= 2 && [rows[i - 1], rows[i + 1]].some(q => q && q.items.length >= 3 && Math.abs(q.base - r.base) <= 2.6 * r.size)) r.t2 = true; });
    let run = [];
    const flush = () => { if (run.length >= 2 && run.some(r => r.t)) { const b = bbox([].concat(...run.map(r => r.items))); if (ok(b)) { b.why = 'cells'; T.push(b); } } run = []; };
    rows.forEach(r => { if (r.t || r.t2) { if (run.length && r.base - run[run.length - 1].base > 2.6 * r.size) flush(); run.push(r); } else flush(); });
    flush();
  }
  return T;
}
/* ---- main story only: body font, size and colour; boxes and coloured backgrounds are not part of it ---- */
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function pxMode(px, x0, y0, x1, y1, max) {
  const k = px.k, W = px.w, H = px.h, d = px.data;
  x0 = Math.max(0, Math.floor(x0 * k)); x1 = Math.min(W - 1, Math.ceil(x1 * k)); y0 = Math.max(0, Math.floor(y0 * k)); y1 = Math.min(H - 1, Math.ceil(y1 * k));
  if (x1 < x0 || y1 < y0) return null;
  const step = Math.max(1, Math.floor(Math.sqrt((x1 - x0 + 1) * (y1 - y0 + 1) / (max || 1500)))), hist = new Map(), all = [];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    const i = (y * W + x) * 4, key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
    let h = hist.get(key); if (!h) { h = [0, 0, 0, 0]; hist.set(key, h); } h[0]++; h[1] += d[i]; h[2] += d[i + 1]; h[3] += d[i + 2]; all.push(i);
  }
  let best = null; for (const h of hist.values()) if (!best || h[0] > best[0]) best = h;
  return { bg: [best[1] / best[0], best[2] / best[0], best[3] / best[0]], all, d };
}
RC.pageBg = px => { const m = pxMode(px, 0, 0, px.w / px.k, px.h / px.k, 40000); return m ? m.bg : [255, 255, 255]; };
function segColours(px, s) {
  const m = pxMode(px, s.x0, s.top, s.x1, s.bottom); if (!m) return;
  s.bg = m.bg; let n = 0, r = 0, g = 0, b = 0;
  for (const i of m.all) { const c = [m.d[i], m.d[i + 1], m.d[i + 2]]; if (cdist(c, s.bg) > 100) { n++; r += c[0]; g += c[1]; b += c[2]; } }
  s.fg = n >= 3 ? [r / n, g / n, b / n] : null;
  const h = 0.25 * (s.bottom - s.top), mid = (s.top + s.bottom) / 2;           // does the colour go on past the text (a panel) or hug it (a highlight)?
  const L = pxMode(px, s.x0 - 4, mid - h, s.x0 - 1.5, mid + h, 200), R = pxMode(px, s.x1 + 1.5, mid - h, s.x1 + 4, mid + h, 200);
  s.bgWide = !!((L && cdist(L.bg, s.bg) < 30) || (R && cdist(R.bg, s.bg) < 30));
}
function mainFlow(segs, o, opt, drop, boxes, H) {
  const live = segs.filter(s => !s.skip); if (!live.length) return;
  const fk = fn => (o.fontKey && o.fontKey(fn)) || fn || '?';
  const px = o.px, pageBg = px ? (px.pageBg || (px.pageBg = RC.pageBg(px))) : null;
  if (px) live.forEach(s => segColours(px, s));
  const coloured = s => pageBg && s.bg && s.bgWide && cdist(s.bg, pageBg) > 40;
  const cnt = new Map();
  for (const s of live) { if (coloured(s) || boxes.some(b => inside(s, b, 0))) continue; const k = fk(s.fn) + '|' + s.dsize; cnt.set(k, (cnt.get(k) || 0) + s.n); }
  if (!cnt.size) return;
  const top = [...cnt].sort((a, b) => b[1] - a[1])[0][0], cut = top.lastIndexOf('|'), bodyF = top.slice(0, cut), bodyS = +top.slice(cut + 1);
  const sameSize = s => Math.abs(s.dsize - bodyS) <= 0.12 * bodyS;
  /* fonts used inside the same lines as the body font also belong to the story (Hindi + English, bold or italic words) */
  const fam = new Set([bodyF]);
  for (const s of live) {
    if (!sameSize(s)) continue; let inB = 0, tot = 0;
    for (const p of s.parts) { if (p.sp) continue; const l = p.s.length; tot += l; if (fk(p.fn) === bodyF) inB += l; }
    if (tot && inB / tot >= 0.3 && inB / tot < 1) s.parts.forEach(p => { if (!p.sp) fam.add(fk(p.fn)); });
  }
  let fg = null;
  if (px) { let n = 0, a = [0, 0, 0]; for (const s of live) if (s.fg && fk(s.fn) === bodyF && sameSize(s)) { n += s.n; for (let i = 0; i < 3; i++) a[i] += s.fg[i] * s.n; } if (n) fg = a.map(v => v / n); }
  const bodyChars = live.reduce((a, s) => a + s.n, 0);
  const realBoxes = boxes.filter(b => live.filter(s => inside(s, b, 0)).reduce((a, s) => a + s.n, 0) < 0.45 * bodyChars);
  for (const s of live) {
    if (coloured(s)) { drop(s, 'coloured background'); continue; }
    if (realBoxes.some(b => inside(s, b, 0))) { drop(s, 'inside a box'); continue; }
    if (!sameSize(s)) { if (!(opt.heads && s.dsize > bodyS)) { drop(s, s.dsize > bodyS ? 'heading / bigger text' : 'smaller text'); continue; } }
    else if (!fam.has(fk(s.fn))) { drop(s, 'different font'); continue; }
    if (fg && s.fg && cdist(s.fg, fg) > 110) { drop(s, 'coloured text'); continue; }
  }
}
function sideNotes(segs, drop, W, H) {
  const body = segs.filter(s => !s.skip && s.n >= 25); if (body.length < 4) return;
  const x0s = body.map(s => s.x0).sort((a, b) => a - b), x1s = body.map(s => s.x1).sort((a, b) => a - b);
  const L = x0s[Math.floor(0.05 * x0s.length)], R = x1s[Math.ceil(0.95 * x1s.length) - 1];
  for (const s of segs) {
    if (s.skip || s.x1 - s.x0 > 0.22 * W || s.base < 0.09 * H || s.top > 0.91 * H) continue;
    if ((s.x1 < L - 3 && s.x1 < 0.22 * W) || (s.x0 > R + 3 && s.x0 > 0.78 * W)) drop(s, 'side note');
  }
}
function readBlocks(ordered) {
  const out = []; let b = null;
  for (const s of ordered) {
    if (b && s.top >= b.lastTop - 1 && s.x0 <= b.x1 + 0.6 * s.size && s.x1 >= b.x0 - 0.6 * s.size && s.top - b.bottom <= 3 * s.size) {
      b.x0 = Math.min(b.x0, s.x0); b.x1 = Math.max(b.x1, s.x1); b.bottom = Math.max(b.bottom, s.bottom); b.lastTop = s.top; continue;
    }
    b = { x0: s.x0, x1: s.x1, top: s.top, bottom: s.bottom, lastTop: s.top }; out.push(b);
  }
  return out.map(b => ({ x0: b.x0, x1: b.x1, top: b.top, bottom: b.bottom }));
}

/* ---- words in reading order ---- */
function segWords(seg) {
  const W = []; let tok = '', tx0 = 0, tx1 = 0;
  const end = () => { if (tok) W.push({ w: RC.fixDeva(tok), x0: tx0, x1: tx1, top: seg.top, bottom: seg.bottom, base: seg.base, size: seg.size }); tok = ''; };
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
  const opt = Object.assign({}, RC.DEF, o.opt || {}), W = o.W || 600, H = o.H || 800;
  let imgs = [], scanned = false, paths = null;
  if (o.fnArray) {
    const r = RC.scanImages(o.fnArray, o.argsArray, o.OPS, o.vpT, W, H); imgs = r.imgs; scanned = r.scanned;
    try { paths = RC.scanPaths(o.fnArray, o.argsArray, o.OPS, o.vpT, W, H); } catch (e) { paths = null; }
  }
  const parts = RC.buildParts(o.items || [], o.vpT), nCols = opt.cols === 'auto' ? 0 : (+opt.cols || 0);
  const pe = parts.filter(p => !p.sp).map(asEl);
  const pageG = nCols ? RC.forcedGutters(pe, nCols) : findGutters(pe);
  const segs = RC.mergeParts(parts, pageG), skipped = [];
  const drop = (s, why) => { if (!s.skip) { s.skip = why; skipped.push(s); } };
  const med = median(segs.map(s => s.size));
  if (imgs.length) segs.forEach(s => { if (imgs.some(b => inside(s, b, 1))) drop(s, 'picture'); });
  if (opt.head) headFoot(segs, H, drop, med, o.repeat);
  let figs = [], tables = [];
  if (paths && opt.pics) {
    figs = findFigures(paths.O, segs, W, H);
    segs.forEach(s => { if (figs.some(f => inside(s, f, 4))) drop(s, 'picture label'); });
  }
  if (opt.tables) {
    tables = findTables(paths, segs.filter(s => !s.skip), pageG, W, H);
    segs.forEach(s => { if (tables.some(t => inside(s, t, 1.5))) drop(s, 'table'); });
  }
  if (opt.pics) captions(segs, imgs.concat(figs, opt.tables ? tables : []), drop, med);
  if (opt.side) sideNotes(segs, drop, W, H);
  if (opt.main) mainFlow(segs, o, opt, drop, paths ? paths.B.filter(b => !tables.some(t => b.x0 >= t.x0 - 3 && b.x1 <= t.x1 + 3 && b.top >= t.top - 3 && b.bottom <= t.bottom + 3)) : [], H);
  const live = segs.filter(s => !s.skip);
  const boxes = imgs.concat(figs, tables).map(b => ({ kind: 'i', x0: b.x0, x1: b.x1, top: b.top, bottom: b.bottom, base: b.bottom }));
  const forced = nCols ? (nCols === 1 ? [] : RC.forcedGutters(live, nCols)) : null;
  const ordered = RC.order(live.concat(boxes), 0, forced).filter(e => e.kind === 't');
  /* skipped text in blocks (a box, a table, a caption…): read only when the user taps on it */
  const ss = skipped.slice().sort((a, b) => a.top - b.top || a.x0 - b.x0), groups = [];
  for (const s of ss) {
    let g = null;
    for (let k = groups.length - 1; k >= 0; k--) { const q = groups[k]; if (q.why === s.skip && s.top - q.bottom < 2.2 * s.size && s.x0 < q.x1 + 2 * s.size && s.x1 > q.x0 - 2 * s.size) { g = q; break; } }
    if (!g) { g = { why: s.skip, x0: s.x0, x1: s.x1, top: s.top, bottom: s.bottom, segs: [] }; groups.push(g); }
    g.segs.push(s); g.x0 = Math.min(g.x0, s.x0); g.x1 = Math.max(g.x1, s.x1); g.top = Math.min(g.top, s.top); g.bottom = Math.max(g.bottom, s.bottom);
  }
  const sgroups = groups.map((g, gi) => {
    const ws = []; g.segs.sort((a, b) => (a.base - b.base) || (a.x0 - b.x0));
    g.segs.forEach((seg, k) => { const w = segWords(seg); w.forEach(x => { x.si = 100000 + gi * 1000 + k; }); if (w.length) w[w.length - 1].brk = k === g.segs.length - 1 ? 'para' : 'line'; ws.push(...w); });
    return { why: g.why, x0: g.x0, x1: g.x1, top: g.top, bottom: g.bottom, words: ws };
  }).filter(g => g.words.length);
  return {
    words: RC.toWords(ordered), imgs, scanned, gutters: forced || pageG, tables, figs, sgroups,
    blocks: readBlocks(ordered),
    skipped: skipped.map(s => ({ x0: s.x0, x1: s.x1, top: s.top, bottom: s.bottom, why: s.skip, text: s.text }))
  };
};
RC.analyzePage = async function (page, pdfjs, opt, repeat) {
  const vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
  let ol = null; try { ol = await page.getOperatorList(); } catch (e) {}
  let px = null;
  if (opt && opt.main !== false && typeof document !== 'undefined') {
    try {
      const k = Math.min(1.2, 1400 / Math.max(vp.width, vp.height)), v2 = page.getViewport({ scale: k }), c = document.createElement('canvas');
      c.width = Math.ceil(v2.width); c.height = Math.ceil(v2.height);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: v2 }).promise;
      px = { data: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, k }; c.width = c.height = 1;
    } catch (e) { px = null; }
  }
  const names = {};
  const fontKey = fn => {
    if (fn in names) return names[fn];
    let n = fn; try { const f = page.commonObjs.get(fn); n = (f && (f.name || f.loadedName)) || fn; } catch (e) {}
    return (names[fn] = String(n).replace(/^[A-Z]{6}\+/, '').toLowerCase());
  };
  return RC.analyze({ items: tc.items, fnArray: ol && ol.fnArray, argsArray: ol && ol.argsArray, OPS: pdfjs.OPS, vpT: vp.transform, W: vp.width, H: vp.height, opt, px, fontKey, repeat });
};
/* short lines at the very top / bottom of a page, for spotting the book name or chapter repeated on every page */
RC.bandKeys = async function (page) {
  const vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent(), H = vp.height, out = new Set(), rows = new Map();
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const t = mul(vp.transform, it.transform), y = t[5];
    if (y > 0.13 * H && y < 0.87 * H) continue;
    const yk = Math.round(y / 6); out.add(RC.norm(it.str) + '@' + yk); const k = Math.round(y / 3); rows.set(k, { y: yk, t: ((rows.get(k) || {}).t || '') + ' ' + it.str });
  }
  for (const r of rows.values()) out.add(RC.norm(r.t) + '@' + r.y);
  return out;
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

/* ---- speech chunks: a new chunk starts at every switch between Hindi and English script,
   so each part is spoken by its own voice and no word is dropped ---- */
const END = /[.!?।॥…]["'”’)\]]*$/;
RC.langOf = function (t) { const d = (t.match(/[ऀ-ॿ]/g) || []).length, l = (t.match(/[A-Za-z]/g) || []).length; return d && d / (d + l) >= 0.35 ? 'hi' : 'en'; };
RC.chunks = function (words, start, maxLen, mode) {
  maxLen = maxLen || 260; const split = mode !== 'single', out = []; let i = start || 0;
  while (i < words.length) {
    let text = '', map = [], j = i, prevGlue = false, lang = '';
    while (j < words.length) {
      const w = words[j], wl = RC.wordLang(w.w);
      if (split && wl && lang && wl !== lang && text.length) break;   // script changes: hand over to the other voice
      if (wl && !lang) lang = wl;
      let tok = w.w, glue = false;
      if (/[-‐‑]$/.test(tok) && tok.length > 1 && w.brk === 'line' && j + 1 < words.length && /^[a-z]/.test(words[j + 1].w)) { tok = tok.slice(0, -1); glue = true; }
      const sp = text.length && !prevGlue ? 1 : 0, cs = text.length + sp;
      text += (sp ? ' ' : '') + tok; map.push({ wi: j, s: cs, e: cs + tok.length }); prevGlue = glue; j++;
      if (glue) continue;
      if (w.brk === 'para') break;
      if (text.length >= 30 && END.test(tok)) break;
      if (text.length >= maxLen) break;
    }
    out.push({ text, map, lang: split ? (lang || 'en') : RC.langOf(text), a: i, b: j - 1 }); i = j;
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
