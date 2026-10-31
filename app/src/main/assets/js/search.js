/* search.js — a word or phrase (Hindi or English) in all pages, this chapter / topic (from the book's bookmarks) or a
   page range; list of pages with how many times; highlights; previous / next; a page-number box to jump to a page */

const SEARCH = { gen: 0, res: [], flat: [], cur: -1, running: false };
const sp = $('#sp');

/* ---------- the text of a page with the place of every character ---------- */
const HAL = /्$/, IMATRA = /^(\s*)ि((?:[क-हक़-य़]़?्)*[क-हक़-य़]़?)/;
async function pageText(p) {
  let str = ''; const G = [], ci = [], co = [];         // item geometry; per character: item index, offset in the item
  const push = (s, gi) => { for (let k = 0; k < s.length; k++) { ci.push(gi); co.push(k); } str += s; };
  if (p.kind === 'pdf') {
    const { pg, own } = await bookPage(p), tc = await pg.getTextContent(), vp = pg.getViewport({ scale: 1 });
    if (own) try { pg.cleanup(); } catch (e) {}
    let prevHal = false;
    for (const it of RC.fixItems(tc.items)) {             // old Hindi fonts (Kruti Dev…) become real Hindi
      if (typeof it.str !== 'string') continue;
      if (prevHal && !it.str.trim()) { prevHal = false; continue; }      // the "space" after a Hindi half letter is not a space
      prevHal = HAL.test(it.str);
      const t = pdfjsLib.Util.transform(vp.transform, it.transform), fs = Math.hypot(t[2], t[3]) || 10;
      const s = RC.fixDeva(it.str.replace(/[\u0000-\u001f�]/g, '').replace(IMATRA, '$1$2ि')).normalize('NFC');
      G.push({ x: t[4], y: t[5], fs, cw: (it.width || 0) / Math.max(1, s.length) }); push(s, G.length - 1);
      if (it.hasEOL) push(' ', -1);
    }
  } else if (p.kind === 'txt') p.lines.forEach((l, i) => { G.push({ x: 40, y: 48 + i * 12, fs: 9, cw: 5.4 }); push(l.normalize('NFC'), G.length - 1); push(' ', -1); });
  return { str, G, ci, co, low: str.toLowerCase() };
}
function boxesOf(tx, a, b) {
  const out = []; let cur = null;
  for (let k = a; k < b; k++) {
    const gi = tx.ci[k]; if (gi < 0) { cur = null; continue; }
    if (cur && cur.gi === gi) { cur.o1 = tx.co[k] + 1; continue; }
    cur = { gi, o0: tx.co[k], o1: tx.co[k] + 1 }; out.push(cur);
  }
  return out.map(c => { const g = tx.G[c.gi]; return { x0: g.x + c.o0 * g.cw, x1: g.x + c.o1 * g.cw, top: g.y - .85 * g.fs, bottom: g.y + .25 * g.fs }; });
}
function makeRe(q, whole) {
  const body = q.normalize('NFC').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'); if (!body) return null;
  if (whole) { try { return new RegExp('(?<![\\p{L}\\p{M}\\p{N}])' + body + '(?![\\p{L}\\p{M}\\p{N}])', 'gu'); } catch (e) { return new RegExp('\\b' + body + '\\b', 'g'); } }
  return new RegExp(body, 'g');
}

/* ---------- where to look: all pages, chapter / topic (the book's bookmarks), or a page range ---------- */
let outline = null, outlineDoc = null;
async function loadOutline() {
  if (BOOK) { if (outlineDoc !== BOOK) { outlineDoc = BOOK; outline = BOOK.outline.map((e, i) => ({ title: e.title, lv: e.lv, pn: e.pi + 1, ord: i })).sort((a, b) => a.pn - b.pn || a.ord - b.ord); } return outline; }
  const d = pages[0] && pages[0].doc; if (!d) return [];
  if (outlineDoc === d) return outline; outlineDoc = d; outline = [];
  try {
    const ol = await d.getOutline(); if (!ol) return outline;
    const walk = async (items, lv) => {
      for (const it of items) {
        try {
          let dest = it.dest; if (typeof dest === 'string') dest = await d.getDestination(dest);
          if (Array.isArray(dest) && dest[0] != null) {
            const idx = typeof dest[0] === 'object' ? await d.getPageIndex(dest[0]) : Number.isInteger(dest[0]) ? dest[0] : -1;
            if (idx >= 0) outline.push({ title: (it.title || '').trim(), lv, pn: idx + 1, ord: outline.length });
          }
        } catch (e) {}
        if (it.items && it.items.length) await walk(it.items, lv + 1);
      }
    };
    await walk(ol, 0); outline.sort((a, b) => a.pn - b.pn || a.ord - b.ord);
  } catch (e) {}
  return outline;
}
async function section(kind) {
  const ol = await loadOutline(), p = curPage(); if (!ol.length || !p) return null;
  const cand = ol.filter(e => e.pn <= p.pn && (kind === 'topic' || e.lv === 0)); if (!cand.length) return null;
  const me = kind === 'topic' ? cand.reduce((a, e) => (e.pn > a.pn || (e.pn === a.pn && e.lv >= a.lv) ? e : a)) : cand[cand.length - 1];
  const nx = ol.find(e => e.pn > me.pn && e.lv <= me.lv), toPn = nx ? Math.max(me.pn, nx.pn - 1) : pages.length;
  const idx = n => pages.findIndex(q => q.kind === 'pdf' && q.pn === n);
  let a = idx(me.pn), b = idx(toPn); if (a < 0) a = 0; if (b < 0) b = pages.length - 1;
  return { title: me.title, a, b };
}
async function refreshScope() {
  const sel = $('#ssc'), ch = await section('chapter'), tp = await section('topic');
  const opt = v => sel.querySelector(`[value=${v}]`);
  opt('chapter').disabled = !ch; opt('topic').disabled = !tp;
  opt('chapter').textContent = ch ? `This chapter: ${ch.title.slice(0, 40)} (p. ${ch.a + 1}–${ch.b + 1})` : 'This chapter (book has no bookmarks)';
  opt('topic').textContent = tp ? `This topic: ${tp.title.slice(0, 40)} (p. ${tp.a + 1}–${tp.b + 1})` : 'This topic (book has no bookmarks)';
  if (sel.selectedOptions[0] && sel.selectedOptions[0].disabled) sel.value = 'all';
  if (!$('#sfrom').value) $('#sfrom').value = curIndex() + 1;
  if (!$('#sto').value) $('#sto').value = Math.min(pages.length, curIndex() + 20);
  $('#sfrom').max = $('#sto').max = pages.length;
  $('#srng').style.display = sel.value === 'range' ? '' : 'none';
}
async function scopeRange() {
  const v = $('#ssc').value, n = pages.length;
  if (v === 'chapter' || v === 'topic') { const s = await section(v); if (s) return [s.a, s.b]; }
  if (v === 'range') { let a = (+$('#sfrom').value || 1) - 1, b = (+$('#sto').value || n) - 1; if (a > b) [a, b] = [b, a]; return [Math.max(0, a), Math.min(n - 1, b)]; }
  return [0, n - 1];
}

/* ---------- highlights and going from hit to hit ---------- */
function clearHits(p) { p.wrap.querySelectorAll('.sh').forEach(e => e.remove()); }
function drawHits(p) {
  clearHits(p); if (!p.smatch || !p.w) return;
  const cur = SEARCH.flat[SEARCH.cur];
  p.smatch.forEach((m, k) => {
    for (const b of m.boxes) {
      const d = el('div', { className: 'sh' + (cur && cur.p === p && cur.k === k ? ' cur' : '') });
      d.style.cssText = `left:${(b.x0 - 1) / p.w * 100}%;top:${(b.top - 1) / p.h * 100}%;width:${(b.x1 - b.x0 + 2) / p.w * 100}%;height:${(b.bottom - b.top + 2) / p.h * 100}%`;
      p.wrap.appendChild(d);
    }
  });
}
function clearSearch() {
  SEARCH.gen++; pages.forEach(p => { p.smatch = null; clearHits(p); });
  SEARCH.res = []; SEARCH.flat = []; SEARCH.cur = -1; $('#sres').innerHTML = ''; $('#sst').textContent = ''; updNav();
}
function updNav() { $('#scnt').textContent = SEARCH.flat.length ? `${SEARCH.cur + 1} / ${SEARCH.flat.length}` + (SEARCH.running ? '…' : '') : (SEARCH.running ? 'searching…' : 'no matches'); }
function goToHit(i) {
  if (!SEARCH.flat.length) return;
  i = (i + SEARCH.flat.length) % SEARCH.flat.length;
  const prev = SEARCH.flat[SEARCH.cur]; SEARCH.cur = i; const m = SEARCH.flat[i], p = m.p;
  if (!pages.includes(p)) return;
  if (prev && prev.p !== p && pages.includes(prev.p)) drawHits(prev.p);
  drawHits(p);
  const box = (p.smatch[m.k].boxes || [])[0], vr = view.getBoundingClientRect(), pr = p.wrap.getBoundingClientRect();
  if (box) {
    const y = pr.top - vr.top + box.top * scale, x = pr.left - vr.left + box.x0 * scale;
    view.scrollBy({ top: y - view.clientHeight * .35, left: (x < 10 || x > view.clientWidth - 40) ? x - view.clientWidth * .2 : 0 });
  } else view.scrollBy({ top: pr.top - vr.top - 6 });
  document.querySelectorAll('#sres .sr').forEach(r => r.classList.toggle('on', r._p === p));
  const on = document.querySelector('#sres .sr.on'); if (on && !sp.classList.contains('mini2')) on.scrollIntoView({ block: 'nearest' });
  updNav();
}

/* ---------- a search, a few pages at a time (the phone stays responsive) ---------- */
async function runSearch() {
  const q = $('#sq').value; if (!q.trim()) { $('#sq').focus(); return; }
  if (!pages.length) { toast('Open a document first'); return; }
  clearSearch();
  const gen = SEARCH.gen, re = makeRe(q.toLowerCase(), $('#sww').checked), [a, b] = await scopeRange(); if (!re) return;
  SEARCH.running = true; $('#sgo').textContent = 'Stop'; lset('ms.sq', q); let total = 0;
  const list = pages.slice();
  for (let i = a; i <= b; i++) {
    if (gen !== SEARCH.gen) return;
    const p = list[i]; $('#sst').textContent = `Searching page ${i + 1} (${i - a + 1} of ${b - a + 1}) · found ${total} so far`;
    let tx; try { tx = await pageText(p); } catch (e) { continue; }
    if (gen !== SEARCH.gen) return;
    const ms = []; re.lastIndex = 0; let m;
    while ((m = re.exec(tx.low))) { if (!m[0].length) { re.lastIndex++; continue; } ms.push({ a: m.index, b: m.index + m[0].length }); if (ms.length >= 999) break; }
    ms.forEach(x => { x.boxes = boxesOf(tx, x.a, x.b); });   // only where the matches are is kept, not the page text
    if (ms.length) {
      p.smatch = ms; total += ms.length; SEARCH.res.push({ p, n: ms.length }); ms.forEach((x, k) => SEARCH.flat.push({ p, k }));
      const s0 = Math.max(0, ms[0].a - 35);
      const r = el('div', { className: 'sr' }, `<div class="h"><span>Page <b>${i + 1}</b></span><span><b>${ms.length}</b> time${ms.length > 1 ? 's' : ''}</span></div><small>${s0 ? '…' : ''}${esc(tx.str.slice(s0, ms[0].a))}<mark>${esc(tx.str.slice(ms[0].a, ms[0].b))}</mark>${esc(tx.str.slice(ms[0].b, ms[0].b + 45))}…</small>`);
      r._p = p; r.onclick = () => { sp.classList.add('mini2'); goToHit(SEARCH.flat.findIndex(f => f.p === p)); };    // open that page, word highlighted
      $('#sres').appendChild(r);
      const vr = view.getBoundingClientRect(), pr = p.wrap.getBoundingClientRect(); if (pr.bottom > vr.top - 400 && pr.top < vr.bottom + 400) drawHits(p);
      if (SEARCH.cur < 0) SEARCH.cur = 0; updNav();
    }
    if ((i - a) % 6 === 5) await sleep(25);
  }
  SEARCH.running = false; $('#sgo').textContent = 'Search';
  $('#sst').textContent = total ? `“${q.trim()}” found ${total} time${total > 1 ? 's' : ''} on ${SEARCH.res.length} page${SEARCH.res.length > 1 ? 's' : ''} (pages ${a + 1}–${b + 1})` : `“${q.trim()}” was not found in pages ${a + 1}–${b + 1}`;
  updNav();
}
function stopSearch() { SEARCH.gen++; SEARCH.running = false; $('#sgo').textContent = 'Search'; $('#sst').textContent += ' · stopped'; updNav(); }
let hitT = 0;                                  // highlights for pages that come into view
view.addEventListener('scroll', () => {
  if (!SEARCH.flat.length) return; clearTimeout(hitT);
  hitT = setTimeout(() => { const vr = view.getBoundingClientRect(); for (const q of pages) { if (!q.smatch) continue; const pr = q.wrap.getBoundingClientRect(); if (pr.bottom > vr.top - 600 && pr.top < vr.bottom + 600 && !q.wrap.querySelector('.sh')) drawHits(q); } }, 200);
}, { passive: true });
function searchDocChanged(fresh) { if (fresh) { SEARCH.gen++; SEARCH.res = []; SEARCH.flat = []; SEARCH.cur = -1; SEARCH.running = false; outline = outlineDoc = null; $('#sres').innerHTML = ''; $('#sst').textContent = ''; updNav(); } }

/* ---------- the panel ---------- */
$('#sb').onclick = async () => {
  if (!sp.hidden && !sp.classList.contains('mini2')) { sp.hidden = true; return; }
  togglePanel('#sp'); sp.hidden = false; sp.classList.remove('mini2');
  if (!$('#sq').value) $('#sq').value = ls('ms.sq', '');
  await refreshScope(); $('#sq').focus();
};
$('#spx').onclick = () => { sp.hidden = true; clearSearch(); };
$('#sgo').onclick = () => { if (SEARCH.running) stopSearch(); else runSearch(); };
$('#sq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#sq').blur(); runSearch(); } });
$('#sgp').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; e.preventDefault(); const n = +e.target.value; e.target.value = ''; e.target.blur();
  if (n > 0) { sp.hidden = true; gotoPage(Math.min(n, pages.length) - 1, 0); }
});
$('#ssc').onchange = () => { $('#srng').style.display = $('#ssc').value === 'range' ? '' : 'none'; };
$('#sprev').onclick = () => goToHit(SEARCH.cur - 1); $('#snext').onclick = () => goToHit(SEARCH.cur + 1);
$('#slist').onclick = () => sp.classList.toggle('mini2');
