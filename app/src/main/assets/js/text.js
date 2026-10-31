/* text.js — text anywhere on a page. Tap T: a text box opens with the keyboard; touch the page to start the text
   there instead. Each letter keeps its own size, colour and opacity: a change in the ⚙ bar applies to what is
   typed next (or to the letters selected), never to the whole box.
   A text mark: {t:'tx', x, y, w, h, runs:[[{t, sz, c, a}…] per line], text} (page units; text = plain copy) */

const TX = Object.assign({ sz: 16, c: '#111827', a: 1 }, ls('ms.tx', {}));       // style for what is typed next
const saveTX = () => lset('ms.tx', TX);
let ED = null, txDown = null;                 // the open text box; a touch waiting to become a tap
const ZW = '​';                          // invisible place-holder that carries a new style before typing
const txFont = (sz, k, bold) => (bold ? '700 ' : '400 ') + (sz * k).toFixed(2) + 'px sans-serif';
const mctx = el('canvas').getContext('2d');
const rgbaOf = (c, a) => { const h = String(c || '#000').replace('#', ''), f = h.length === 3 ? h.split('').map(x => x + x).join('') : h; return `rgba(${parseInt(f.slice(0, 2), 16)},${parseInt(f.slice(2, 4), 16)},${parseInt(f.slice(4, 6), 16)},${a == null ? 1 : a})`; };
const hexOf = css => { const m = String(css).match(/[\d.]+/g) || [0, 0, 0], h = n => ('0' + Math.round(+n).toString(16)).slice(-2); return { c: '#' + h(m[0]) + h(m[1]) + h(m[2]), a: m.length > 3 ? Math.round(+m[3] * 100) / 100 : 1 }; };

/* ---------- layout and drawing ---------- */
function runsOf(s) {                          // older text marks had one style for the whole box
  if (s.runs) return s.runs;
  return String(s.text || '').split('\n').map(l => l ? [{ t: l, sz: s.sz || 16, c: s.c || '#111827', a: s.a == null ? 1 : s.a }] : []);
}
const lineSz = (L, s) => L.length ? Math.max(...L.map(r => r.sz)) : (s.sz || 16);
function txLayout(s) {
  const R = runsOf(s); let w = 0, h = 0;
  for (const L of R) { let lw = 0; for (const r of L) { mctx.font = txFont(r.sz, 4, s.b); lw += mctx.measureText(r.t).width / 4; } w = Math.max(w, lw); h += lineSz(L, s) * 1.3; }
  const m = R.length ? lineSz(R[0], s) : s.sz || 16;
  s.w = Math.max(w, m * .4) + m * .15; s.h = Math.max(h, m * 1.3) + m * .15;
  s.text = R.map(L => L.map(r => r.t).join('')).join('\n');
}
function drawTx(ctx, s, k) {
  const R = runsOf(s); if (!R.some(L => L.length)) return;
  ctx.save(); ctx.textBaseline = 'alphabetic'; let y = s.y;
  for (const L of R) {
    const m = lineSz(L, s), yb = (y + m * 1.02) * k; let x = s.x * k;
    for (const r of L) {
      ctx.font = txFont(r.sz, k, s.b); ctx.fillStyle = r.c; ctx.globalAlpha = r.a == null ? 1 : r.a; ctx.fillText(r.t, x, yb);
      const w = ctx.measureText(r.t).width; if (s.u) ctx.fillRect(x, yb + r.sz * .14 * k, w, Math.max(1, r.sz * .07 * k)); x += w;
    }
    y += m * 1.3;
  }
  ctx.restore();
}
/* the text as a picture for the saved file (Hindi joins letters correctly, exactly as on screen) */
function txImg(s) {
  txLayout(s); if (!s.text) return null;
  const k = 4, c = el('canvas'); c.width = Math.max(1, Math.ceil(s.w * k)); c.height = Math.max(1, Math.ceil(s.h * k));
  const x = c.getContext('2d'); x.translate(-s.x * k, -s.y * k); drawTx(x, s, k);
  const u = c.toDataURL('image/png'); c.width = c.height = 0; return u;
}
window.__txImg = txImg;      // used by saver.js for exports

/* ---------- the editing box: spans with their own size and colour ---------- */
const spanCss = (sz, c, a) => 'font-size:' + (sz * scale).toFixed(2) + 'px;color:' + rgbaOf(c, a);
function txBuild(s) {
  const d = ED.ta; d.innerHTML = '';
  runsOf(s).forEach((L, i) => {
    const line = i ? el('div') : d; if (i) d.appendChild(line);
    if (!L.length && i) { line.appendChild(el('br')); return; }
    for (const r of L) { const sp = el('span'); sp.style.cssText = spanCss(r.sz, r.c, r.a); sp.textContent = r.t; line.appendChild(sp); }
  });
}
/* the box as pieces of text with their style, and line breaks */
function txToks() {
  const toks = [];
  (function walk(n) {
    for (const ch of n.childNodes) {
      if (ch.nodeType === 3) {
        const t = ch.nodeValue.split(ZW).join('');
        if (t) { const cs = getComputedStyle(ch.parentElement), o = hexOf(cs.color); toks.push({ t, sz: Math.round(parseFloat(cs.fontSize) / scale * 10) / 10, c: o.c, a: o.a, n: ch }); }
      } else if (ch.nodeName === 'BR') toks.push('BR');
      else if (ch.nodeType === 1) { const bl = /^(DIV|P)$/.test(ch.nodeName); if (bl) toks.push('BS'); walk(ch); if (bl) toks.push('BE'); }
    }
  })(ED.ta);
  return toks;
}
function txRead() {
  const lines = [[]], cur = () => lines[lines.length - 1];
  for (const k of txToks()) {
    if (k === 'BR') lines.push([]);
    else if (k === 'BS' || k === 'BE') { if (cur().length) lines.push([]); }
    else { const L = cur(), l = L[L.length - 1]; if (l && l.sz === k.sz && l.c === k.c && l.a === k.a) l.t += k.t; else L.push({ t: k.t, sz: k.sz, c: k.c, a: k.a }); }
  }
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  return lines;
}
/* (line, column) of a point inside the box, and back */
function txPos(node, off) {
  let line = 0, col = 0; const pt = document.createRange(); pt.setStart(node, off);
  for (const k of txToks()) {
    if (k === 'BR') { line++; col = 0; continue; }
    if (k === 'BS' || k === 'BE') { if (col) { line++; col = 0; } continue; }
    const before = k.n === node ? k.n.nodeValue.slice(0, off).split(ZW).join('').length : (pt.comparePoint(k.n, 0) < 0 ? k.t.length : 0);
    if (before < k.t.length) return { l: line, c: col + before };
    col += k.t.length;
  }
  return { l: line, c: col };
}
function txPoint(pos) {
  const d = ED.ta, lines = [[...d.childNodes].filter(n => n.nodeName === 'SPAN')].concat([...d.children].filter(n => n.nodeName === 'DIV').map(x => [...x.querySelectorAll('span')]));
  const L = lines[Math.min(pos.l, lines.length - 1)] || []; let c = pos.c;
  for (const sp of L) { const t = sp.firstChild; if (!t) continue; if (c <= t.nodeValue.length) return [t, c]; c -= t.nodeValue.length; }
  const last = L[L.length - 1]; return last && last.firstChild ? [last.firstChild, last.firstChild.nodeValue.length] : [d, 0];
}
/* change one property (size, colour or opacity) of the letters from a to b, nothing else */
function txRestyle(R, a, b, prop, val) {
  for (let l = a.l; l <= b.l && l < R.length; l++) {
    const c0 = l === a.l ? a.c : 0, c1 = l === b.l ? b.c : 1e9, out = []; let c = 0;
    for (const r of R[l]) {
      const s0 = c, s1 = c + r.t.length; c = s1; const x0 = Math.max(s0, c0), x1 = Math.min(s1, c1);
      if (x1 <= x0) { out.push(r); continue; }
      if (x0 > s0) out.push(Object.assign({}, r, { t: r.t.slice(0, x0 - s0) }));
      out.push(Object.assign({}, r, { t: r.t.slice(x0 - s0, x1 - s0), [prop]: val }));
      if (s1 > x1) out.push(Object.assign({}, r, { t: r.t.slice(x1 - s0) }));
    }
    const m = []; for (const r of out) { const q = m[m.length - 1]; if (q && q.sz === r.sz && q.c === r.c && q.a === r.a) q.t += r.t; else m.push(r); }
    R[l] = m;
  }
}
function txSync() { if (ED) { ED.s.runs = txRead(); txLayout(ED.s); } }
let txT = 0;
const txSaveSoon = () => { clearTimeout(txT); txT = setTimeout(() => { if (ED && ED.s.text) edited(ED.p); }, 500); };
function txStyle() {
  if (!ED) return; const s = ED.s, d = ED.ta;
  d.style.left = s.x * scale + 'px'; d.style.top = s.y * scale + 'px';
  d.style.cssText += ';' + spanCss(TX.sz, TX.c, TX.a) + ';min-width:' + (TX.sz * 2 * scale) + 'px';
}
const plainOf = d => (d.innerText || '').split(ZW).join('');

/* ---------- opening and closing a text box ---------- */
function txOpen(p, s, isNew) {
  txClose();
  const d = el('div', { className: 'txed' }); d.contentEditable = 'true'; d.setAttribute('autocapitalize', 'sentences'); d.setAttribute('spellcheck', 'false'); d._rk = 8;
  p.wrap.appendChild(d);
  ED = { p, s, ta: d, isNew, before: isNew ? null : JSON.parse(JSON.stringify(s)), range: null, pend: null };
  markTextButton(); if (isNew) p.strokes.push(s);
  txStyle(); txBuild(s); redraw(p);
  d.addEventListener('input', () => { txSync(); txSaveSoon(); });
  d.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text')); });
  d.addEventListener('pointerdown', e => e.stopPropagation());
  d.focus();
  try { const r = document.createRange(); r.selectNodeContents(d); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); ED.range = r.cloneRange(); } catch (e) {}
}
document.addEventListener('selectionchange', () => {
  if (!ED) return; const sel = getSelection();
  if (sel.rangeCount && ED.ta.contains(sel.getRangeAt(0).commonAncestorContainer)) ED.range = sel.getRangeAt(0).cloneRange();
});
function txClose() {
  if (!ED) return; txSync();
  const { p, s, ta, isNew, before } = ED; ED = null; markTextButton(); clearTimeout(txT); ta.blur(); ta.remove();
  if (s.runs) {                               // no spaces or empty lines left at the end
    const L = s.runs[s.runs.length - 1];
    if (L && L.length) { L[L.length - 1].t = L[L.length - 1].t.replace(/\s+$/, ''); if (!L[L.length - 1].t) L.pop(); }
    while (s.runs.length && !s.runs[s.runs.length - 1].length) s.runs.pop();
    txLayout(s);
  }
  const i = p.strokes.indexOf(s);
  if (!s.text.trim()) {
    if (i > -1) p.strokes.splice(i, 1);
    if (!isNew) { restoreObj(s, before); undo.push({ k: 'del', p, s, i: Math.max(0, i) }); }
    if (!isNew || before) edited(p);
  } else {
    if (isNew) undo.push({ k: 'add', p, s }); else if (JSON.stringify(before) !== JSON.stringify(s)) undo.push({ k: 'tx', p, s, before });
    edited(p);
  }
  redraw(p);
}
/* a size / colour / opacity change while typing: only for the letters selected, or for what is typed next */
function txApply(kind) {
  saveTX(); if (!ED) return;
  const d = ED.ta, sel = getSelection();
  let r = sel.rangeCount && d.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.getRangeAt(0) : ED.range;
  if (!r || !d.contains(r.commonAncestorContainer)) { r = document.createRange(); r.selectNodeContents(d); r.collapse(false); }
  if (!r.collapsed) {
    const a = txPos(r.startContainer, r.startOffset), b = txPos(r.endContainer, r.endOffset), R = txRead();
    txRestyle(R, a, b, kind, kind === 'sz' ? TX.sz : kind === 'c' ? TX.c : TX.a);
    ED.s.runs = R; txBuild(ED.s);
    const p0 = txPoint(a), p1 = txPoint(b), nr = document.createRange();
    try { nr.setStart(p0[0], p0[1]); nr.setEnd(p1[0], p1[1]); } catch (e) { nr.selectNodeContents(d); nr.collapse(false); }
    sel.removeAllRanges(); sel.addRange(nr); ED.range = nr.cloneRange(); ED.pend = null;
  } else {
    let sp = ED.pend;
    if (!(sp && sp.isConnected && sp.textContent === ZW)) { sp = el('span'); sp.textContent = ZW; r.insertNode(sp); ED.pend = sp; }
    sp.style.cssText = spanCss(TX.sz, TX.c, TX.a);
    const nr = document.createRange(); nr.setStart(sp.firstChild, 1); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr); ED.range = nr.cloneRange();
  }
  txSync(); txSaveSoon();
}
function txHit(p, pt) { for (let i = p.strokes.length - 1; i >= 0; i--) { const s = p.strokes[i]; if (s.t === 'tx' && pt[0] >= s.x - 4 && pt[0] <= s.x + s.w + 4 && pt[1] >= s.y - 4 && pt[1] <= s.y + s.h + 4) return s; } return null; }
const txNew = (x, y) => ({ t: 'tx', x, y, runs: [[]], text: '', sz: TX.sz, c: TX.c, a: TX.a, w: 0, h: 0 });
/* a tap on a page in text mode: edit the text there, move an empty box, or start a new text */
function txTap(p, pt) {
  const hit = txHit(p, pt);
  if (hit) { if (ED && ED.s === hit) ED.ta.focus(); else txOpen(p, hit, false); return; }
  if (ED && ED.p === p && !plainOf(ED.ta).trim()) { ED.s.x = pt[0]; ED.s.y = pt[1] - TX.sz * .75; txStyle(); ED.ta.focus(); return; }
  txOpen(p, txNew(pt[0], pt[1] - TX.sz * .75), true);
}
/* T pressed: a text box opens on the page you are looking at */
function txStart() {
  const p = curPage(); if (!p) return;
  const vr = view.getBoundingClientRect(), r = p.wrap.getBoundingClientRect();
  const y = clamp((vr.top + vr.height * .3 - r.top) / scale, 10, p.h - 30), x = clamp(p.w * .08, 10, p.w - 60);
  txOpen(p, txNew(x, y), true);
}
