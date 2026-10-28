/* saver.js — rebuilds a PDF from the viewer's pages: original pages are copied (text stays real text),
   pen / underline / highlight marks are written as vector graphics. */
(function (root) {
'use strict';
const S = {};
const rgb = h => { h = (h || '#000000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255]; };

function mapper(page) {                       // view coords (scale 1, y down, rotated) -> PDF user space
  const cb = page.getCropBox(), rot = ((page.getRotation().angle % 360) + 360) % 360, ox = cb.x, oy = cb.y, W0 = cb.width, H0 = cb.height;
  return (x, y) => {
    let u, v;
    if (rot === 0) { u = x; v = H0 - y; }
    else if (rot === 90) { u = y; v = x; }
    else if (rot === 180) { u = W0 - x; v = y; }
    else { u = W0 - y; v = H0 - x; }
    return [ox + u, oy + v];
  };
}

S.drawStrokes = function (L, doc, page, strokes) {
  if (!strokes || !strokes.length) return;
  const P = mapper(page), cache = {};
  const gsFor = a => {
    const k = String(a); if (cache[k]) return cache[k];
    const d = doc.context.obj({ Type: L.PDFName.of('ExtGState'), CA: a, ca: a, BM: L.PDFName.of('Multiply') });
    return (cache[k] = page.node.newExtGState('MK', d));
  };
  for (const s of strokes) {
    const a = s.a == null ? 1 : s.a, [r, g, b] = rgb(s.c), ops = [L.pushGraphicsState(), L.setGraphicsState(gsFor(a))];
    if (s.t === 'hl') {
      ops.push(L.setFillingRgbColor(r, g, b));
      for (const q of s.segs) { const A = P(q[0], q[1]), B = P(q[2], q[3]); ops.push(L.rectangle(Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1])), L.fill()); }
    } else {
      ops.push(L.setStrokingRgbColor(r, g, b), L.setLineWidth(s.w), L.setLineJoin(1));
      if (s.t === 'wu') {
        ops.push(L.setLineCap(1));
        for (const q of s.segs) { const A = P(q[0], q[2]), B = P(q[1], q[2]); ops.push(L.moveTo(A[0], A[1]), L.lineTo(B[0], B[1]), L.stroke()); }
      } else {
        ops.push(L.setLineCap(s.sq ? 0 : 1));
        const q = s.p;
        if (q.length === 1) { const A = P(q[0][0], q[0][1]); ops.push(L.moveTo(A[0], A[1]), L.lineTo(A[0] + 0.01, A[1]), L.stroke()); }
        else if (s.t === 'line' || q.length < 3) { const A = P(q[0][0], q[0][1]), B = P(q[q.length-1][0], q[q.length-1][1]); ops.push(L.moveTo(A[0], A[1]), L.lineTo(B[0], B[1]), L.stroke()); }
        else {
          let cur = P(q[0][0], q[0][1]); ops.push(L.moveTo(cur[0], cur[1]));
          for (let i = 1; i < q.length - 1; i++) {
            const C = P(q[i][0], q[i][1]), E = P((q[i][0] + q[i+1][0]) / 2, (q[i][1] + q[i+1][1]) / 2);
            ops.push(L.appendBezierCurve(cur[0] + 2/3*(C[0]-cur[0]), cur[1] + 2/3*(C[1]-cur[1]), E[0] + 2/3*(C[0]-E[0]), E[1] + 2/3*(C[1]-E[1]), E[0], E[1]));
            cur = E;
          }
          const Z = P(q[q.length-1][0], q[q.length-1][1]); ops.push(L.lineTo(Z[0], Z[1]), L.stroke());
        }
      }
    }
    ops.push(L.popGraphicsState());
    page.pushOperators(...ops);
  }
};

/* list: [{kind,bytes,pn,w,h,strokes}] ; raster(p) -> Promise<ArrayBuffer|Uint8Array> JPEG with the marks already baked in */
S.build = async function (L, list, raster) {
  const sources = new Map();
  const load = async b => { let d = sources.get(b); if (!d) { d = await L.PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false }); sources.set(b, d); } return d; };
  const first = list[0];
  // untouched page structure of a single PDF: keep the original file (bookmarks, forms, links) and just add the marks
  if (first && first.kind === 'pdf' && first.bytes && list.every((p, i) => p.kind === 'pdf' && p.bytes === first.bytes && p.pn === i + 1)) {
    try {
      const d = await load(first.bytes);
      if (d.getPageCount() === list.length) {
        list.forEach((p, i) => S.drawStrokes(L, d, d.getPage(i), p.strokes));
        return d.save();
      }
    } catch (e) { sources.clear(); }
  }
  const out = await L.PDFDocument.create();
  for (const p of list) {
    let done = false;
    if (p.kind === 'pdf' && p.bytes) {
      try {
        const sd = await load(p.bytes), [cp] = await out.copyPages(sd, [p.pn - 1]);
        const pg = out.addPage(cp); S.drawStrokes(L, out, pg, p.strokes); done = true;
      } catch (e) { done = false; }
    }
    if (!done && p.kind === 'blank') { const pg = out.addPage([p.w, p.h]); S.drawStrokes(L, out, pg, p.strokes); done = true; }
    if (!done) { const im = await out.embedJpg(await raster(p)); out.addPage([p.w, p.h]).drawImage(im, { x: 0, y: 0, width: p.w, height: p.h }); }
  }
  return out.save();
};
if (typeof module !== 'undefined' && module.exports) module.exports = S; else root.MarkupSaver = S;
})(typeof self !== 'undefined' ? self : this);
