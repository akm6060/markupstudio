/* convert.js — a scanned (photographed) book made into a text book, page by page, offline.
   "searchable": every original page kept exactly as it is, the recognised words laid invisibly on top in the same
                 places (search, select, copy, read aloud all work; the page looks 100% the same)
   "typed":      every page rebuilt on clean paper: the words typed at the same place and size, line by line,
                 column by column, and the pictures cut out of the scan and put back where they were */

const CONV = { on: false, stop: false };

/* the page drawn as a picture at a size the text recognition reads well */
async function scanCanvas(p) {
  const k = clamp(2000 / Math.max(1, p.w), 1.2, 3.5), c = el('canvas');
  c.width = Math.round(p.w * k); c.height = Math.round(p.h * k);
  await paint(p, c.getContext('2d'), k, null);
  return c;
}

/* the words of a page that already has real text (no recognition needed): [x0, baseline, x1, size, text] in page points */
async function pageTextWords(p) {
  if (p.kind !== 'pdf') return null;
  await ensure(p); const tc = await p.page.getTextContent(), items = RC.fixItems(tc.items);
  if (items.reduce((n, i) => n + (i.str || '').trim().length, 0) < 25) return null;
  const vp = p.page.getViewport({ scale: 1 }), out = [];
  for (const it of items) {
    const s = (it.str || '').trim(); if (!s) continue;
    const t = pdfjsLib.Util.transform(vp.transform, it.transform), fs = Math.hypot(t[2], t[3]) || 10;
    out.push([t[4], t[5], t[4] + (it.width || fs * s.length * .5), fs, s]);
  }
  return out;
}

/* text recognition of one page -> lines of words, in canvas pixels */
async function recognise(c) {
  const r = await ocrCall(c.toDataURL('image/jpeg', .92));
  if (!r || !r.ok || !r.w) throw new Error('text recognition failed' + (r && r.err ? ': ' + r.err : ''));
  const f = c.width / r.w;                         // the phone may have read a smaller copy
  return (r.lines || []).map(L => ({
    x0: L.x0 * f, y0: L.y0 * f, x1: L.x1 * f, y1: L.y1 * f, t: L.t,
    words: (L.words && L.words.length ? L.words : [L]).filter(w => w.t).map(w => ({ t: w.t, x0: w.x0 * f, x1: w.x1 * f }))
  }));
}
/* one line -> words with one baseline and one size for the whole line (so the line stays straight) */
const lineWords = (L, f) => {
  const lh = (L.y1 - L.y0) * f, fs = Math.max(3, lh * .78), base = L.y1 * f - lh * .2;
  return L.words.map(w => [w.x0 * f, base, w.x1 * f, fs, w.t]);
};

/* ---------- finding the pictures on a scanned page ---------- */
function findPictures(c, lines) {
  const W = c.width, H = c.height, x = c.getContext('2d'), d = x.getImageData(0, 0, W, H).data, n = W * H;
  const lum = new Uint8Array(n), hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000 | 0; lum[i] = v; hist[v]++; }
  let bg = 230, best = 0; for (let v = 110; v < 256; v++) if (hist[v] > best) { best = hist[v]; bg = v; }   // the paper
  const S = Math.max(8, Math.round(W / 150)), gw = Math.ceil(W / S), gh = Math.ceil(H / S), G = gw * gh;
  const ink = new Float32Array(G), sd = new Float32Array(G), mid = new Float32Array(G), text = new Uint8Array(G);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let cnt = 0, k = 0, s = 0, s2 = 0, m = 0;
    const ya = gy * S, yb = Math.min(H, ya + S), xa = gx * S, xb = Math.min(W, xa + S);
    for (let yy = ya; yy < yb; yy += 2) for (let xx = xa; xx < xb; xx += 2) {
      const i = yy * W + xx, v = lum[i], j = i * 4, sat = Math.max(d[j], d[j + 1], d[j + 2]) - Math.min(d[j], d[j + 1], d[j + 2]);
      k++; s += v; s2 += v * v; if (v < bg - 50 || (sat > 60 && v < bg - 15)) cnt++; if (v > 50 && v < bg - 35) m++;
    }
    const g = gy * gw + gx, mean = s / k; ink[g] = cnt / k; sd[g] = Math.sqrt(Math.max(0, s2 / k - mean * mean)); mid[g] = m / k;
  }
  for (const L of lines) {                          // where the words are is not a picture
    const lh = L.y1 - L.y0, a = Math.max(0, Math.floor((L.x0 - lh * .3) / S)), b = Math.min(gw - 1, Math.floor((L.x1 + lh * .3) / S));
    const t = Math.max(0, Math.floor((L.y0 - lh * .35) / S)), u = Math.min(gh - 1, Math.floor((L.y1 + lh * .35) / S));
    for (let gy = t; gy <= u; gy++) for (let gx = a; gx <= b; gx++) text[gy * gw + gx] = 1;
  }
  const cand = new Uint8Array(G); for (let g = 0; g < G; g++) cand[g] = !text[g] && (ink[g] > .06 || sd[g] > 22) ? 1 : 0;
  const dil = new Uint8Array(G);                     // close small gaps inside a picture
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (!cand[gy * gw + gx]) continue;
    for (let yy = Math.max(0, gy - 1); yy <= Math.min(gh - 1, gy + 1); yy++) for (let xx = Math.max(0, gx - 1); xx <= Math.min(gw - 1, gx + 1); xx++) dil[yy * gw + xx] = 1;
  }
  const seen = new Uint8Array(G), boxes = [], st = [];
  for (let g0 = 0; g0 < G; g0++) {
    if (!dil[g0] || seen[g0]) continue;
    let ax = gw, ay = gh, bx = 0, by = 0, cells = 0, midSum = 0; st.push(g0); seen[g0] = 1;
    while (st.length) {
      const g = st.pop(), gx = g % gw, gy = (g / gw) | 0; cells++; midSum += mid[g];
      if (gx < ax) ax = gx; if (gx > bx) bx = gx; if (gy < ay) ay = gy; if (gy > by) by = gy;
      for (const q of [g - 1, g + 1, g - gw, g + gw]) { if (q < 0 || q >= G || seen[q] || !dil[q]) continue; if ((q === g - 1 && gx === 0) || (q === g + 1 && gx === gw - 1)) continue; seen[q] = 1; st.push(q); }
    }
    const bw = (bx - ax + 1) / gw, bh = (by - ay + 1) / gh;
    if (bw < .06 || bh < .035 || bw * bh < .01) continue;                       // stray marks, missed words, thin rules
    const edge = ax === 0 || ay === 0 || bx === gw - 1 || by === gh - 1;
    if (edge && (bw < .1 || bh < .1)) continue;                                 // shadow at the edge of a photographed page
    boxes.push({ x: Math.max(0, (ax - 1) * S), y: Math.max(0, (ay - 1) * S), w: 0, h: 0, x2: Math.min(W, (bx + 2) * S), y2: Math.min(H, (by + 2) * S), photo: midSum / cells > .25 });
  }
  for (let again = true; again;) {                  // join pictures that touch
    again = false;
    for (let i = 0; i < boxes.length && !again; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x2 && b.x < a.x2 && a.y < b.y2 && b.y < a.y2) { a.x = Math.min(a.x, b.x); a.y = Math.min(a.y, b.y); a.x2 = Math.max(a.x2, b.x2); a.y2 = Math.max(a.y2, b.y2); a.photo = a.photo || b.photo; boxes.splice(j, 1); again = true; break; }
    }
  }
  boxes.forEach(b => { b.w = b.x2 - b.x; b.h = b.y2 - b.y; });
  return { boxes, bg, lum };
}
const inside = (L, b) => { const cx = (L.x0 + L.x1) / 2, cy = (L.y0 + L.y1) / 2; return cx > b.x && cx < b.x2 && cy > b.y && cy < b.y2; };

/* one scanned page -> what the phone needs to type it again */
function typedPage(p, c, lines) {
  const W = c.width, H = c.height, f = p.w / W, x = c.getContext('2d');
  const { boxes, bg, lum } = findPictures(c, lines);
  const keep = lines.filter(L => !boxes.some(b => b.photo && inside(L, b)));       // words printed on a photo stay part of the photo
  const id = x.getImageData(0, 0, W, H), d = id.data, n = W * H;
  const out = keep.map(L => {                                                       // the colour of each line's letters
    let r = 0, g = 0, b = 0, k = 0; const t = bg - 60;
    for (let yy = Math.max(0, L.y0 | 0); yy < Math.min(H, L.y1); yy += 2) for (let xx = Math.max(0, L.x0 | 0); xx < Math.min(W, L.x1); xx += 2) {
      const i = yy * W + xx; if (lum[i] < t) { const j = i * 4; r += d[j]; g += d[j + 1]; b += d[j + 2]; k++; }
    }
    let col = '#111111';
    if (k) { r /= k; g /= k; b /= k; if (Math.max(r, g, b) - Math.min(r, g, b) > 45) col = '#' + [r, g, b].map(v => Math.round(Math.min(255, v * 255 / bg)).toString(16).padStart(2, '0')).join(''); }
    return { c: col, w: lineWords(L, f) };
  });
  const imgs = [];
  if (boxes.length) {
    for (let i = 0, j = 0; i < n; i++, j += 4) {                                    // paper -> white, the rest kept
      const s = 255 / Math.max(60, bg); d[j] = Math.min(255, d[j] * s); d[j + 1] = Math.min(255, d[j + 1] * s); d[j + 2] = Math.min(255, d[j + 2] * s);
    }
    x.putImageData(id, 0, 0); x.fillStyle = '#fff';
    for (const L of keep) if (boxes.some(b => !b.photo && inside(L, b))) { const lh = L.y1 - L.y0; x.fillRect(L.x0 - lh * .1, L.y0 - lh * .1, L.x1 - L.x0 + lh * .2, lh * 1.2); }   // labels inside a drawing are typed again
    for (const b of boxes) {
      const q = el('canvas'); q.width = Math.round(b.w); q.height = Math.round(b.h);
      q.getContext('2d').drawImage(c, b.x, b.y, b.w, b.h, 0, 0, q.width, q.height);
      imgs.push({ x: b.x * f, y: b.y * f, w: b.w * f, h: b.h * f, d: q.toDataURL('image/jpeg', .85) }); q.width = q.height = 0;
    }
  }
  return { w: p.w, h: p.h, imgs, lines: out };
}

/* ---------- the whole conversion ---------- */
async function convertScanned(list, typed, say) {
  const t0 = performance.now(), secs = () => Math.round((performance.now() - t0) / 1000) + ' s';
  if (!typed && !list.every(p => p.kind === 'pdf' && p.nid && p.nid === list[0].nid)) { say('A searchable copy can be made from one PDF at a time. Choose the pages of one PDF, or use "typed text".'); return; }
  CONV.on = true; CONV.stop = false; $('#ego').textContent = 'Stop';
  const words = {}; let found = 0, scanned = 0, bad = 0;
  try {
    if (typed && !A.typedBegin()) throw new Error('could not start the new book');
    for (let i = 0; i < list.length; i++) {
      if (CONV.stop) { say('Stopped.'); if (typed) A.typedEnd(true); return; }
      const p = list[i]; say(`Page ${i + 1} of ${list.length}: recognising the text… (${secs()})`);
      try {
        const own = await pageTextWords(p);
        if (own) {                                                          // the page already has real text
          if (typed) { const c = await scanCanvas(p), sc = c.width / p.w, L = own.map(w => ({ x0: w[0] * sc, x1: w[2] * sc, y0: (w[1] - w[3]) * sc, y1: (w[1] + w[3] * .25) * sc, t: w[4], words: [] }));
            const pg = typedPage(p, c, L); pg.lines = own.map(w => ({ c: '#111111', w: [w] })); c.width = c.height = 0; const r = A.typedPage(JSON.stringify(pg)); if (r !== 'ok') throw new Error(r); }
          continue;
        }
        const c = await scanCanvas(p), lines = await recognise(c); scanned++;
        lines.forEach(L => { found += L.words.length; });
        if (typed) { const r = A.typedPage(JSON.stringify(typedPage(p, c, lines))); if (r !== 'ok') throw new Error(r); }
        else words[filePn(p)] = lines.flatMap(L => lineWords(L, p.w / c.width));
        c.width = c.height = 0;
      } catch (e) {
        bad++; if (typed) { const r = A.typedPage(JSON.stringify({ w: p.w, h: p.h, imgs: [], lines: [] })); if (r !== 'ok') throw new Error(r); }
      }
      if (i % 4 === 3) await sleep(20);
    }
    say('Writing the new book…');
    let r;
    if (typed) {
      const parts = JP(A.typedEnd(false), null); if (!parts || !parts.ok) throw new Error((parts && parts.err) || 'could not write the book');
      r = await pdfJob({ op: 'merge', files: parts.files, name: DOC.name + '-typed', deleteSources: true }, x => say('Writing the new book… ' + (x.msg || '')));
    } else {
      const tmp = await saveBlob(new Blob([JSON.stringify(words)], { type: 'application/json' }), 'temp', 'ocr.json', 0);
      try { r = await pdfJob({ op: 'ocrpdf', src: list[0].nid, pages: list.map(filePn), words: tmp.where, marks: marksOf(list), name: DOC.name + '-searchable' }, x => say('Writing the new book… ' + (x.msg || ''))); }
      finally { try { A.deleteTemp(tmp.where); } catch (e) {} }
    }
    say(`Saved ✓ ${r.files[0]} · ${scanned} scanned page${scanned === 1 ? '' : 's'} recognised, ${found} words · ${secs()}` + (bad ? ` · ${bad} page(s) could not be read` : '') + ' · open it from 📂');
  } finally { CONV.on = false; $('#ego').textContent = 'Export'; }
}
