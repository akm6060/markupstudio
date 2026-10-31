/* search.js — find a word or phrase in all pages, in this chapter / topic (from the book's bookmarks)
   or in a page range; list of pages with how many times it occurs; highlights on the pages; next / previous. */
(function () {
'use strict';
const view = $('#view'), RC = window.ReaderCore;
const toast = (m, ms) => (window.__toast ? window.__toast(m, ms) : null);
const el = (tag, props, html) => { const e = document.createElement(tag); Object.assign(e, props || {}); if (html != null) e.innerHTML = html; return e; };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const css = el('style'); css.textContent = `
.sh{position:absolute;pointer-events:none;background:rgba(250,204,21,.45);outline:1px solid rgba(202,138,4,.85);z-index:3;border-radius:2px}
.sh.cur{background:rgba(249,115,22,.55);outline:2px solid #ea580c}
#sp .row input[type=search],#sp .row input[type=number]{flex:1;min-width:0;font:inherit;font-size:15px;padding:7px 9px;border:1px solid var(--bd);border-radius:8px;background:var(--bar);color:var(--fg)}
#sp .row input[type=number]{max-width:110px;font-size:14px}
#sres{display:flex;flex-direction:column;max-height:38vh;overflow:auto;border-top:1px solid var(--bd)}
.sr{display:flex;flex-direction:column;gap:2px;padding:8px 4px;border-bottom:1px solid var(--bd);cursor:pointer}.sr:active,.sr.on{background:var(--ac2)}
.sr .h{display:flex;justify-content:space-between;font-size:14px}.sr .h b{color:var(--ac)}.sr small{color:var(--mut);font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr small mark{background:rgba(250,204,21,.6);color:inherit;border-radius:2px}
#sst{font-size:12px;color:var(--mut);min-height:16px}
#sp{top:calc(6px + env(safe-area-inset-top,0px));bottom:auto!important;max-height:62vh}#sp.mini>*:not(.nav){display:none!important}#sp.mini{padding:6px 10px}
#sp .nav{display:flex;gap:6px;align-items:center}#sp .nav span{flex:1;text-align:center;font-size:13px;color:var(--mut)}`;
document.head.appendChild(css);

const sb = el('button', { id: 'sb', title: 'Search' }, '🔍');
($('#rd') || $('#exbtn')).after(sb);
const sp = el('div', { id: 'sp', className: 'panel', hidden: true }, `
 <div class="row"><b>Search</b><button id="spx">✕</button></div>
 <div class="row"><span>Go to page</span><input type="number" id="sgp" min="1" inputmode="numeric" enterkeyhint="go" placeholder="number"></div>
 <div class="row"><input type="search" id="sq" placeholder="Word or phrase (Hindi or English)" enterkeyhint="search"><button id="sgo" class="on">Search</button></div>
 <div class="row"><span>Where</span><select id="ssc"><option value="all">All pages</option><option value="chapter">This chapter</option><option value="topic">This topic</option><option value="range">Pages from … to …</option></select></div>
 <div class="row" id="srng"><span>Pages</span><input type="number" id="sfrom" min="1"><span>to</span><input type="number" id="sto" min="1"></div>
 <label><input type="checkbox" id="sww"> Whole word only</label>
 <div id="sst"></div>
 <div id="sres"></div>
 <div class="nav"><button id="sprev" title="Previous match">◀</button><span id="scnt"></span><button id="snext" title="Next match">▶</button><button id="slist">☰ List</button></div>`);
document.body.appendChild(sp);
const S = { gen: 0, res: [], flat: [], cur: -1, re: null, running: false };

/* ---------- text of a page with the position of every character ---------- */
let sdoc = null, sdocUses = 0;
async function pdfPageFor(rec) {
  if (window.__bookPage) return window.__bookPage(rec);
  const B = window.__book && window.__book();
  if (B && B.src && B.src.url && B.src.size > BIGPDF) {          // big book: a search engine of its own, renewed every 120 pages
    if (!sdoc || sdocUses >= 120) { if (sdoc) try { await sdoc.destroy(); } catch (e) {} sdoc = await pdfjsLib.getDocument({ url: B.src.url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144 }).promise; sdocUses = 0; }
    sdocUses++; return { pg: await sdoc.getPage(rec.pn), own: true };
  }
  await ensure(rec); return { pg: rec.page, own: false };
}
async function endSearchDoc() { if (window.__bookPageDone) await window.__bookPageDone(); if (sdoc) { try { await sdoc.destroy(); } catch (e) {} sdoc = null; } }
async function pageText(p) {
  let str = '';
  const G = [], ci = [], co = [];                          // item geometry; for each character: item index, offset in item
  const push = (s, gi) => { for (let k = 0; k < s.length; k++) { ci.push(gi); co.push(k); } str += s; };
  if (p.kind === 'pdf') {
    const { pg, own } = await pdfPageFor(p);
    const tc = await pg.getTextContent(), vp = pg.getViewport({ scale: 1 });
    if (own) try { pg.cleanup(); } catch (e) {}
    let prevHal = false;
    for (const it of (RC && RC.fixItems ? RC.fixItems(tc.items) : tc.items)) {
      if (typeof it.str !== 'string') continue;
      if (prevHal && !it.str.trim()) { prevHal = false; continue; }       // Hindi: the "space" after a half letter is not a space
      prevHal = /\u094d$/.test(it.str);
      const t = pdfjsLib.Util.transform(vp.transform, it.transform), fs = Math.hypot(t[2], t[3]) || 10, s = (RC ? RC.fixDeva(it.str.replace(/[\u0000-\u001f\ufffd]/g, '').replace(/^(\s*)\u093f((?:[\u0915-\u0939\u0958-\u095f]\u093c?\u094d)*[\u0915-\u0939\u0958-\u095f]\u093c?)/, '$1$2\u093f')) : it.str).normalize('NFC');
      G.push({ x: t[4], y: t[5], fs, cw: (it.width || 0) / Math.max(1, s.length) });
      push(s, G.length - 1);
      if (it.hasEOL) push(' ', -1);
    }
  } else if (p.kind === 'txt') {
    p.lines.forEach((l, i) => { G.push({ x: 40, y: 40 + i * 12 + 8, fs: 9, cw: 5.4 }); push(l.normalize('NFC'), G.length - 1); push(' ', -1); });
  }
  return { str, G, ci, co, low: str.toLowerCase() };
}
function boxesOf(tx, a, b) {
  const out = []; let cur = null;
  for (let k = a; k < b; k++) {
    const gi = tx.ci[k]; if (gi < 0) { cur = null; continue; }
    const g = tx.G[gi], o = tx.co[k];
    if (cur && cur.gi === gi) { cur.o1 = o + 1; continue; }
    cur = { gi, o0: o, o1: o + 1 }; out.push(cur);
  }
  return out.map(c => { const g = tx.G[c.gi]; return { x0: g.x + c.o0 * g.cw, x1: g.x + c.o1 * g.cw, top: g.y - 0.85 * g.fs, bottom: g.y + 0.25 * g.fs }; });
}
function makeRe(q, whole) {
  const body = q.normalize('NFC').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  if (!body) return null;
  if (whole) { try { return new RegExp('(?<![\\p{L}\\p{M}\\p{N}])' + body + '(?![\\p{L}\\p{M}\\p{N}])', 'gu'); } catch (e) { return new RegExp('\\b' + body + '\\b', 'g'); } }
  return new RegExp(body, 'g');
}

/* ---------- where to look: all, chapter / topic from the book's bookmarks, or a page range ---------- */
let outline = null, outlineDoc = null;
async function loadOutline() {
  const BK = window.__book && window.__book();
  if (BK && BK.split) { if (outlineDoc !== BK) { outlineDoc = BK; outline = (BK.outline || []).map((e, i) => ({ title: e.title, lv: e.lv, pn: e.pi + 1, ord: i })).sort((a, b) => a.pn - b.pn || a.ord - b.ord); } return outline; }
  const d = pages[0] && pages[0].doc; if (!d) return [];
  if (outline && outlineDoc && window.__book && window.__book() && outlineDoc !== d && outline.length) { outlineDoc = d; return outline; }   // same book, engine renewed
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
    await walk(ol, 0);
    outline.sort((a, b) => a.pn - b.pn || a.ord - b.ord);
  } catch (e) {}
  return outline;
}
const allP = () => (window.__allPages ? window.__allPages() : pages);
const curIndex = () => { const t = window.__topPage && window.__topPage(); return t ? window.__pageNo(t.p) - 1 : 0; };
async function section(kind) {
  const ol = await loadOutline(), p = allP()[curIndex()]; if (!ol.length || !p) return null;
  const pn = p.pn, cand = ol.filter(e => e.pn <= pn && (kind === 'topic' || e.lv === 0));
  if (!cand.length) return null;
  const me = kind === 'topic' ? cand.reduce((a, e) => (e.pn > a.pn || (e.pn === a.pn && e.lv >= a.lv) ? e : a)) : cand[cand.length - 1];
  const nx = ol.find(e => e.pn > me.pn && e.lv <= me.lv);
  const L = allP(), toPn = nx ? Math.max(me.pn, nx.pn - 1) : (outlineDoc.numPages || L.length);
  const idx = n => L.findIndex(q => q.kind === 'pdf' && q.pn === n);
  let a = idx(me.pn), b = idx(toPn); if (a < 0) a = 0; if (b < 0) b = L.length - 1;
  return { title: me.title, a, b };
}
async function refreshScope() {
  const sel = $('#ssc'), ch = await section('chapter'), tp = await section('topic');
  sel.querySelector('[value=chapter]').disabled = !ch; sel.querySelector('[value=topic]').disabled = !tp;
  sel.querySelector('[value=chapter]').textContent = ch ? `This chapter: ${ch.title.slice(0, 40)} (p. ${ch.a + 1}–${ch.b + 1})` : 'This chapter (book has no bookmarks)';
  sel.querySelector('[value=topic]').textContent = tp ? `This topic: ${tp.title.slice(0, 40)} (p. ${tp.a + 1}–${tp.b + 1})` : 'This topic (book has no bookmarks)';
  if (sel.selectedOptions[0] && sel.selectedOptions[0].disabled) sel.value = 'all';
  if (!$('#sfrom').value) $('#sfrom').value = curIndex() + 1;
  if (!$('#sto').value) $('#sto').value = Math.min(allP().length, curIndex() + 20);
  $('#sfrom').max = $('#sto').max = allP().length;
  $('#srng').style.display = sel.value === 'range' ? '' : 'none';
}
async function scopeRange() {
  const v = $('#ssc').value;
  if (v === 'chapter' || v === 'topic') { const s = await section(v); if (s) return [s.a, s.b]; }
  const n = allP().length;
  if (v === 'range') { let a = (+$('#sfrom').value || 1) - 1, b = (+$('#sto').value || n) - 1; if (a > b) [a, b] = [b, a]; return [Math.max(0, a), Math.min(n - 1, b)]; }
  return [0, n - 1];
}

/* ---------- highlights ---------- */
function clearHits(p) { p.wrap.querySelectorAll('.sh').forEach(e => e.remove()); }
function drawHits(p) {
  clearHits(p); const r = p.smatch ? p : (p.rec || p); if (!r.smatch || !p.w) return;
  const cur = S.flat[S.cur];
  r.smatch.forEach((m, k) => {
    for (const b of m.boxes) {
      const d = el('div', { className: 'sh' + (cur && (cur.p === r || cur.p === p) && cur.k === k ? ' cur' : '') });
      d.style.cssText = `left:${(b.x0 - 1) / p.w * 100}%;top:${(b.top - 1) / p.h * 100}%;width:${(b.x1 - b.x0 + 2) / p.w * 100}%;height:${(b.bottom - b.top + 2) / p.h * 100}%`;
      p.wrap.appendChild(d);
    }
  });
}
function clearAll() { S.gen++; allP().forEach(p => { p.smatch = null; }); pages.forEach(p => { if (p.rec) p.rec.smatch = null; p.smatch = null; clearHits(p); }); S.res = []; S.flat = []; S.cur = -1; $('#sres').innerHTML = ''; $('#sst').textContent = ''; updNav(); }
function updNav() { $('#scnt').textContent = S.flat.length ? `${S.cur + 1} / ${S.flat.length}` + (S.running ? '…' : '') : (S.running ? 'searching…' : 'no matches'); }
const shown = r => pages.find(q => q === r || q.rec === r);
async function goTo(i) {
  if (!S.flat.length) return;
  i = (i + S.flat.length) % S.flat.length;
  const prev = S.flat[S.cur]; S.cur = i; const m = S.flat[i];
  let d = shown(m.p);
  if (!d && window.__book && window.__book()) { await window.__gotoGlobal(m.p.pn - 1, 0); d = shown(m.p); }   // the match is in another part of the book
  if (!d) return;
  const pd = prev && shown(prev.p); if (pd && pd !== d) drawHits(pd);
  drawHits(d);
  const box = (m.p.smatch[m.k].boxes || [])[0], vr = view.getBoundingClientRect(), pr = d.wrap.getBoundingClientRect();
  if (box) {
    const y = pr.top - vr.top + box.top * scale, x = pr.left - vr.left + box.x0 * scale;
    view.scrollBy({ top: y - view.clientHeight * 0.35, left: (x < 10 || x > view.clientWidth - 40) ? x - view.clientWidth * 0.2 : 0 });
  } else view.scrollBy({ top: pr.top - vr.top - 6 });
  document.querySelectorAll('#sres .sr').forEach(r => r.classList.toggle('on', r._p === m.p));
  const on = document.querySelector('#sres .sr.on'); if (on && !sp.classList.contains('mini')) on.scrollIntoView({ block: 'nearest' });
  updNav();
}

/* ---------- running a search ---------- */
async function run() {
  const q = $('#sq').value; if (!q.trim()) { $('#sq').focus(); return; }
  if (!pages.length) { toast('Open a document first'); return; }
  clearAll();
  const gen = S.gen, ww = $('#sww').checked, re = makeRe(q.toLowerCase(), ww), [a, b] = await scopeRange();
  if (!re) return;
  S.running = true; window.__searchRunning = true; $('#sgo').textContent = 'Stop'; let total = 0; const list = $('#sres');
  try { localStorage.setItem('ms.sq', q); } catch (e) {}
  const L = allP();
  for (let i = a; i <= b; i++) {
    if (gen !== S.gen) { endSearchDoc(); window.__searchRunning = false; return; }
    const p = L[i];
    $('#sst').textContent = `Searching page ${i + 1} (${i - a + 1} of ${b - a + 1}) · found ${total} so far`;
    let tx; try { tx = await pageText(p); } catch (e) { continue; }
    if (gen !== S.gen) return;
    const ms = []; re.lastIndex = 0; let m;
    while ((m = re.exec(tx.low))) { if (!m[0].length) { re.lastIndex++; continue; } ms.push({ a: m.index, b: m.index + m[0].length }); if (ms.length >= 999) break; }
    ms.forEach(x => { x.boxes = boxesOf(tx, x.a, x.b); });             // keep only where the matches are, not the page text
    if (ms.length) {
      p.smatch = ms; total += ms.length; S.res.push({ p, n: ms.length });
      ms.forEach((x, k) => S.flat.push({ p, k }));
      const s0 = Math.max(0, ms[0].a - 35), sn = tx.str.slice(s0, ms[0].a) , hit = tx.str.slice(ms[0].a, ms[0].b), after = tx.str.slice(ms[0].b, ms[0].b + 45);
      const r = el('div', { className: 'sr' }, `<div class="h"><span>Page <b>${i + 1}</b></span><span><b>${ms.length}</b> time${ms.length > 1 ? 's' : ''}</span></div><small>${s0 ? '…' : ''}${esc(sn)}<mark>${esc(hit)}</mark>${esc(after)}…</small>`);
      r._p = p; r.onclick = () => { const k = S.flat.findIndex(f => f.p === p); sp.classList.add('mini'); goTo(k); };
      list.appendChild(r);
      const d = shown(p);
      if (d) { const vr = view.getBoundingClientRect(), pr = d.wrap.getBoundingClientRect(); if (pr.bottom > vr.top - 400 && pr.top < vr.bottom + 400) drawHits(d); }
      if (S.cur < 0) { S.cur = 0; }
      updNav();
    }
    if ((i - a) % 6 === 5) await new Promise(r => setTimeout(r, 25));      // small batches: the phone stays responsive and memory is given back
  }
  await endSearchDoc();
  S.running = false; window.__searchRunning = false; $('#sgo').textContent = 'Search';
  $('#sst').textContent = total ? `“${q.trim()}” found ${total} time${total > 1 ? 's' : ''} on ${S.res.length} page${S.res.length > 1 ? 's' : ''} (pages ${a + 1}–${b + 1})` : `“${q.trim()}” was not found in pages ${a + 1}–${b + 1}`;
  updNav();
}
/* highlights for pages that come into view */
let st; view.addEventListener('scroll', () => {
  if (!S.flat.length) return; clearTimeout(st);
  st = setTimeout(() => { const vr = view.getBoundingClientRect(); for (const q of pages) { if (!(q.smatch || (q.rec && q.rec.smatch))) continue; const pr = q.wrap.getBoundingClientRect(); if (pr.bottom > vr.top - 600 && pr.top < vr.bottom + 600 && !q.wrap.querySelector('.sh')) drawHits(q); } }, 200);
}, { passive: true });

/* ---------- panel ---------- */
sb.onclick = async () => {
  if (!sp.hidden && !sp.classList.contains('mini')) { sp.hidden = true; return; }
  document.querySelectorAll('.panel').forEach(x => { if (x !== sp) x.hidden = true; });
  sp.classList.remove('mini'); sp.hidden = false;
  if (!$('#sq').value) { try { $('#sq').value = localStorage.getItem('ms.sq') || ''; } catch (e) {} }
  await refreshScope(); $('#sq').focus();
};
$('#spx').onclick = () => { sp.hidden = true; clearAll(); };
$('#sgo').onclick = () => { if (S.running) { S.gen++; endSearchDoc(); S.running = false; window.__searchRunning = false; $('#sgo').textContent = 'Search'; $('#sst').textContent += ' · stopped'; updNav(); } else run(); };
$('#sgp').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const n = +e.target.value; e.target.value = ''; e.target.blur(); if (n > 0 && window.__gotoGlobal) { sp.hidden = true; window.__gotoGlobal(Math.min(n, allP().length) - 1, 0); } } });
$('#sq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#sq').blur(); run(); } });
$('#ssc').onchange = () => { $('#srng').style.display = $('#ssc').value === 'range' ? '' : 'none'; };
$('#sprev').onclick = () => goTo(S.cur - 1); $('#snext').onclick = () => goTo(S.cur + 1);
$('#slist').onclick = () => sp.classList.toggle('mini');
const prevBack = window.__back;
window.__back = () => { if (!sp.hidden) { if (sp.classList.contains('mini')) sp.classList.remove('mini'); else { sp.hidden = true; clearAll(); } return true; } return prevBack ? prevBack() : false; };
/* a new document: old results no longer apply */
const prevDoc = window.__docChanged;
window.__docChanged = function (fresh, added) { if (fresh) { S.res = []; S.flat = []; S.cur = -1; outlineDoc = null; outline = null; $('#sres').innerHTML = ''; $('#sst').textContent = ''; updNav(); } if (prevDoc) prevDoc(fresh, added); };
/* another part of a big book is shown: put the highlights back on its pages */
const prevPart = window.__partChanged;
window.__partChanged = function () { if (S.flat.length) setTimeout(() => pages.forEach(q => { if (q.smatch || (q.rec && q.rec.smatch)) drawHits(q); }), 50); if (prevPart) prevPart(); };
/* every icon button gets a spoken name (TalkBack, and the automatic tests) */
setTimeout(() => document.querySelectorAll('button[title]').forEach(b => { if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title); }), 0);
$('#sq').setAttribute('aria-label', 'Search words');
})();
