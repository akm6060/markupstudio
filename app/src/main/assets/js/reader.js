/* reader.js — reading aloud: Hindi + English with their own voices, column by column, skipping what the rules say;
   scanned pages are read with the phone's text recognition. One tap on a word reads from there, double tap stops.
   Also: pronunciation (short forms in full, own list), speech engines and voices, auto-scroll. */

const RS = Object.assign({ rate: 1, pitch: 1, med: true, pron: '', voiceEn: '', voiceHi: '', filter: 'all', lang: 'auto', follow: true, tap: true, awake: true, speed: 40,
  cols: 'auto', head: true, tab: true, pic: true, side: true, show: false, main: true, heads: false }, JP(pref('reader', '{}'), {}));
const saveRS = () => setPref('reader', JSON.stringify(RS));
const R = { on: false, gen: 0, page: null, rd: null, chunks: [], sent: 0, fin: 0, cur: -1, wi: 0, resolve: null, errs: 0, userUntil: 0, resumeAt: null, est: 0, sawRange: false };
const AS = { on: false, last: 0, acc: 0, raf: 0, touching: false, resumeAt: 0 };
const rp = $('#rp'), rq = s => rp.querySelector(s);
let ttsReady = false, voices = [];
const awake = on => A.keepAwake(!!on && RS.awake);

/* ---------- speech engine and voices ---------- */
window.__ttsReady = ok => {
  ttsReady = !!ok;
  if (ok) { voices = JP(A.ttsVoices(), []); fillVoices(); fillEngines(); }
  else toast('No text-to-speech engine found. Install “Speech Services by Google”.', 5000);
};
function fillEngines() {
  const sel = rq('#reng'), l = JP(A.ttsEngines(), []), info = l.find(x => 'cur' in x) || {}, en = l.filter(x => x.n);
  sel.innerHTML = ''; sel.appendChild(new Option('Phone default' + (info.cur ? ' (' + ((en.find(x => x.n === info.cur) || {}).l || info.cur) + ')' : ''), ''));
  en.forEach(x => sel.appendChild(new Option(x.l || x.n, x.n))); sel.value = info.sel || '';
}
function fillVoices() {
  const net = A.isOnline();
  const fill = (sel, lang, cur) => {
    sel.innerHTML = ''; sel.appendChild(new Option('Default for this language', ''));
    let vs = voices.filter(v => (v.l || '').toLowerCase().startsWith(lang));
    if (RS.filter === 'off') vs = vs.filter(v => !v.net); else if (RS.filter === 'on') vs = vs.filter(v => v.net);
    vs.sort((a, b) => (a.l || '').localeCompare(b.l || '') || (b.q - a.q));
    vs.forEach(v => sel.appendChild(new Option(v.n.replace(/-(local|network)$/, '') + ' · ' + v.l + (v.net ? ' · online' + (net ? '' : ' (offline now)') : ' · offline') + (v.ni ? ' · not installed' : ''), v.n)));
    if (!vs.length) sel.appendChild(new Option(lang === 'hi' ? 'No Hindi voice here — tap “Voice data”' : 'No English voice found', ''));
    sel.value = vs.some(v => v.n === cur) ? cur : '';
  };
  fill(rq('#rven'), 'en', RS.voiceEn); fill(rq('#rvhi'), 'hi', RS.voiceHi);
}
function voiceFor(lang) {
  const name = lang === 'hi' ? RS.voiceHi : RS.voiceEn; if (!name) return '';
  const v = voices.find(x => x.n === name);
  if (v && v.net && !A.isOnline()) { const off = voices.find(x => !x.net && !x.ni && (x.l || '').toLowerCase().startsWith(lang)); return off ? off.n : ''; }
  return name;
}

/* ---------- how words are said: short forms in full and the user's own list (the highlight keeps following) ---------- */
const MED = { 'mg': 'milligram', 'mcg': 'microgram', 'µg': 'microgram', 'μg': 'microgram', 'ml': 'millilitre', 'kg': 'kilogram', 'iu': 'international units', 'mmhg': 'millimetres of mercury',
  'mg/kg': 'milligram per kilogram', 'mg/dl': 'milligram per decilitre', 'mmol/l': 'millimoles per litre', 'mg/day': 'milligram per day', 'mcg/kg': 'microgram per kilogram',
  'b.d.': 'twice daily', 'bd': 'twice daily', 'bid': 'twice daily', 'b.i.d.': 'twice daily', 't.d.s.': 'three times a day', 'tds': 'three times a day', 'tid': 'three times a day', 't.i.d.': 'three times a day',
  'q.i.d.': 'four times a day', 'qid': 'four times a day', 'qds': 'four times a day', 'o.d.': 'once daily', 'h.s.': 'at bedtime', 'p.o.': 'by mouth', 'i.v.': 'intravenous', 'i.m.': 'intramuscular', 's.c.': 'subcutaneous',
  's.o.s.': 'if needed', 'sos': 'if needed', 'prn': 'as needed', 'p.r.n.': 'as needed', 'stat': 'immediately', 'e.g.': 'for example', 'i.e.': 'that is', 'etc.': 'et cetera', 'vs': 'versus', 'vs.': 'versus',
  'dr.': 'doctor', 'fig.': 'figure', 'approx.': 'approximately', '°c': 'degrees celsius', '%': 'percent', 'yrs': 'years', 'hrs': 'hours', 'wk': 'week', 'wks': 'weeks', 'no.': 'number' };
let PRON = new Map();
function parsePron() { PRON = new Map(); for (const l of String(RS.pron || '').split('\n')) { const m = l.split('='); if (m.length >= 2 && m[0].trim()) PRON.set(m[0].trim().toLowerCase(), m.slice(1).join('=').trim()); } }
parsePron();
function sayTok(tok) {
  const m = tok.match(/^([("'“‘[]*)(.*?)([)"'”’\],;:!?।]*)$/) || ['', '', tok, ''], pre = m[1], post = m[3], key = m[2].toLowerCase(), k2 = key.replace(/\.$/, '');
  if (PRON.has(key)) return pre + PRON.get(key) + post;
  if (PRON.has(k2)) return pre + PRON.get(k2) + '.' + post;
  if (!RS.med) return tok;
  if (MED[key]) return pre + MED[key] + post;
  if (MED[k2] && !/\.$/.test(k2)) return pre + MED[k2] + '.' + post;
  const n = m[2].match(/^(\d+(?:[.,]\d+)?)(mg|mcg|µg|ml|kg|iu|mmhg|g|mg\/kg|mg\/dl|%|°c)(\.?)$/i);
  if (n) return pre + n[1] + ' ' + (MED[n[2].toLowerCase()] || (n[2].toLowerCase() === 'g' ? 'gram' : n[2])) + n[3] + post;
  return tok;
}
function sayAs(c) {
  if (!RS.med && !PRON.size) return c;
  let out = '', pos = 0; const map = [];
  for (const m of c.map) { out += c.text.slice(pos, m.s); const say = sayTok(c.text.slice(m.s, m.e)), s0 = out.length; out += say; map.push(Object.assign({}, m, { s: s0, e: out.length })); pos = m.e; }
  return Object.assign({}, c, { text: out + c.text.slice(pos), map });
}

/* ---------- scanned pages (photos of text): the phone's own text recognition, Hindi + English, no internet ---------- */
const ocrWait = {}; let ocrSeq = 0, ocrTold = false;
window.__ocrDone = (id, r) => { const f = ocrWait[id]; if (f) { delete ocrWait[id]; f(r); } };
const ocrCall = url => new Promise(res => {
  const id = 'o' + (++ocrSeq); ocrWait[id] = res;
  try { A.ocr(id, url); } catch (e) { delete ocrWait[id]; res({ ok: false }); return; }
  setTimeout(() => { if (ocrWait[id]) { delete ocrWait[id]; res({ ok: false, err: 'timeout' }); } }, 90000);
});
/* the page drawn as a picture -> words with their places, as if the PDF had text */
async function ocrItems(p) {
  if (!ocrTold) { ocrTold = true; toast('Scanned page: recognising the text…', 2500); }
  const k = clamp(1800 / Math.max(1, p.w), 1.2, 3.5), c = el('canvas'); c.width = Math.round(p.w * k); c.height = Math.round(p.h * k);
  await paint(p, c.getContext('2d'), k, null);
  const url = c.toDataURL('image/jpeg', .92); c.width = c.height = 0;
  const r = await ocrCall(url); if (!r || !r.ok || !r.w) return null;
  const f = p.w / r.w, items = [];
  for (const L of r.lines || []) {
    const lh = (L.y1 - L.y0) * f, fs = Math.max(3, lh * .78), base = L.y1 * f - lh * .2;
    for (const w of (L.words && L.words.length ? L.words : [L])) if (w.t) items.push({ str: w.t, transform: [fs, 0, 0, fs, w.x0 * f, base], width: (w.x1 - w.x0) * f, height: fs, fontName: 'ocr' });
  }
  return items;
}

/* ---------- the words of a page in reading order ---------- */
const readP = new WeakMap();
function pageReadable(p) {
  if (p.read) return Promise.resolve(p.read);
  let pr = readP.get(p);
  if (!pr) { pr = readPage(p); readP.set(p, pr); pr.then(() => readP.delete(p), () => readP.delete(p)); }
  return pr;
}
const layoutOpt = () => ({ cols: RS.cols, head: RS.head, tables: RS.tab, pics: RS.pic, side: RS.side, main: RS.main, heads: RS.heads });
async function readPage(p) {
  let words = [], extra = {};
  if (p.kind === 'pdf') {
    await ensure(p);
    const i = pages.indexOf(p), repeat = new Set();              // top / bottom lines of nearby pages: book name, chapter
    for (let j = i - 2; j <= i + 2; j++) {
      const q = pages[j]; if (!q || q === p || q.kind !== 'pdf' || q.doc !== p.doc) continue;
      try { if (!q.bands) { await ensure(q); q.bands = await RC.bandKeys(q.page); } q.bands.forEach(k => repeat.add(k)); } catch (e) {}
    }
    const r = await RC.analyzePage(p.page, pdfjsLib, layoutOpt(), repeat);
    words = r.words; extra = { blocks: r.blocks, skipped: r.skipped, sgroups: r.sgroups || [] };
  } else if (p.kind === 'txt') words = RC.textWords(p.lines);
  if ((p.kind === 'pdf' || p.kind === 'cv') && words.reduce((n, w) => n + w.w.length, 0) < 25) {      // a scan or a photo
    let items = null; try { items = await ocrItems(p); } catch (e) { items = null; }
    if (items && items.length) {
      const r = RC.analyze({ items, vpT: [1, 0, 0, 1, 0, 0], W: p.w, H: p.h, opt: Object.assign(layoutOpt(), { tables: false, pics: false, main: false, heads: true }) });
      if (r.words.length) { words = r.words; extra = { blocks: r.blocks, skipped: r.skipped, sgroups: r.sgroups || [], ocr: true }; }
    }
  }
  return (p.read = Object.assign({ words, lines: linesOf(words) }, extra));
}
function linesOf(words) {
  const L = {};
  for (const w of words) { const l = L[w.si]; if (!l) L[w.si] = { x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom }; else { l.x0 = Math.min(l.x0, w.x0); l.x1 = Math.max(l.x1, w.x1); l.top = Math.min(l.top, w.top); l.bottom = Math.max(l.bottom, w.bottom); } }
  return L;
}

/* ---------- "show reading order": numbered green boxes are read in this order, red ones are skipped ---------- */
function drawLayout(p) {
  p.wrap.querySelectorAll('.lay').forEach(e => e.remove());
  if (!RS.show || !p.read || !p.w) return;
  const box = (cls, b, n) => { const d = el('div', { className: 'lay ' + cls }); d.style.cssText = `left:${(b.x0 - 2) / p.w * 100}%;top:${(b.top - 2) / p.h * 100}%;width:${(b.x1 - b.x0 + 4) / p.w * 100}%;height:${(b.bottom - b.top + 4) / p.h * 100}%`; if (n) d.dataset.n = n; p.wrap.appendChild(d); };
  (p.read.blocks || []).forEach((b, i) => box('lr', b, String(i + 1)));
  (p.read.skipped || []).forEach(b => box('ls', b));
}
let layQ = 0;
async function layoutAll() {
  const id = ++layQ; document.querySelectorAll('.lay').forEach(e => e.remove());
  if (!RS.show || !pages.length) return;
  const vr = view.getBoundingClientRect();
  for (const p of pages) {
    const r = p.wrap.getBoundingClientRect(); if (r.bottom < vr.top - 1500 || r.top > vr.bottom + 1500) continue;
    try { await pageReadable(p); } catch (e) { continue; }
    if (id !== layQ) return; drawLayout(p);
  }
}
let layT = 0;
view.addEventListener('scroll', () => { if (!RS.show) return; clearTimeout(layT); layT = setTimeout(layoutAll, 300); }, { passive: true });
function readerDocChanged() { if (RS.show) setTimeout(layoutAll, 600); }

/* ---------- highlight and follow ---------- */
const hlClear = () => document.querySelectorAll('.rh,.rl').forEach(e => e.remove());
function hlWord(p, rd, wi) {
  hlClear(); const w = rd.words[wi]; if (!w || !p) return;
  const box = (cls, x0, y0, x1, y1) => { const d = el('div', { className: cls }); d.style.cssText = `left:${x0 * scale - 1}px;top:${y0 * scale - 1}px;width:${(x1 - x0) * scale + 2}px;height:${(y1 - y0) * scale + 2}px`; p.wrap.appendChild(d); };
  const L = rd.lines[w.si]; if (L) box('rl', L.x0, L.top, L.x1, L.bottom);
  box('rh', w.x0, w.top, w.x1, w.bottom);
  if (!RS.follow || performance.now() < R.userUntil) return;
  const vr = view.getBoundingClientRect(), pr = p.wrap.getBoundingClientRect(), vh = view.clientHeight;
  const y = pr.top - vr.top + w.top * scale, h = (w.bottom - w.top) * scale, x = pr.left - vr.left + w.x0 * scale;
  const dy = (y < vh * .1 || y + h > vh * .72) ? y - vh * .3 : 0, dx = (x < 8 || x > view.clientWidth - 40) ? x - view.clientWidth * .15 : 0;
  if (dy || dx) view.scrollBy({ top: dy, left: dx, behavior: 'smooth' });
}

/* ---------- speaking ---------- */
const langOf = c => RS.lang === 'auto' ? c.lang : RS.lang;
function pump(gen) {
  while (gen === R.gen && R.sent < R.chunks.length && R.sent - R.fin < 2) {
    const i = R.sent++, c = R.chunks[i], lang = langOf(c);
    const rc = A.ttsSpeak(gen + ':' + i, c.text, voiceFor(lang), lang === 'hi' ? 'hi-IN' : 'en-IN', RS.rate, RS.pitch, false);
    if (rc < 0) { toast(rc === -2 ? (lang === 'hi' ? 'Hindi voice data is not installed — tap “Voice data”.' : 'English voice data is missing.') : 'Speech engine error', 4500); stopReading(); return; }
  }
}
const speakChunks = gen => new Promise(res => { R.resolve = r => { R.resolve = null; res(r); }; R.sent = 0; R.fin = 0; R.cur = -1; pump(gen); });
const findMap = (c, ch) => { let m = c.map[0]; for (const x of c.map) { if (x.s <= ch) m = x; else break; } return m; };
window.__tts = (ev, id, s) => {
  const parts = String(id).split(':'), g = +parts[0], i = +parts[1];
  if (g !== R.gen || !R.on) return;
  if (ev === 'start') {
    R.cur = i; R.sawRange = false; clearInterval(R.est);
    const c = R.chunks[i]; if (!c) return; R.wi = c.map.length ? c.map[0].wi : c.a; hlWord(R.page, R.rd, R.wi);
    const t0 = performance.now(), len = c.text.length;       // engines without word callbacks: estimate where we are
    R.est = setInterval(() => {
      if (R.sawRange || g !== R.gen) { clearInterval(R.est); return; }
      const t = performance.now() - t0 - 900; if (t < 0) return;
      const m = findMap(c, Math.min(len - 1, Math.floor(t / 1000 * 14 * RS.rate))); if (m && m.wi !== R.wi) { R.wi = m.wi; hlWord(R.page, R.rd, m.wi); }
    }, 250);
  } else if (ev === 'range') {
    if (i !== R.cur) return; R.sawRange = true; const c = R.chunks[i], m = c && findMap(c, +s); if (m) { R.wi = m.wi; hlWord(R.page, R.rd, m.wi); }
  } else if (ev === 'done' || ev === 'error') {
    clearInterval(R.est);
    if (ev === 'error' && ++R.errs > 3) { stopReading(); toast('Speech failed — check the voice in TTS settings.', 4500); return; }
    if (ev === 'done') R.errs = 0;
    R.fin++; if (R.fin >= R.chunks.length) { if (R.resolve) R.resolve('end'); } else pump(g);
  }
};
function stopSpeech() { clearInterval(R.est); try { A.ttsStop(); } catch (e) {} if (R.resolve) { const r = R.resolve; R.resolve = null; r('stop'); } }
function stopReading() { R.gen++; stopSpeech(); R.on = false; hlClear(); awake(AS.on); updReadUI(); }
const waitTts = () => new Promise(res => { let n = 0; const t = setInterval(() => { if (ttsReady || ++n > 30) { clearInterval(t); res(); } }, 100); });
/* read from word wi of page p, then on, page after page; ov = words to read first on this page (a tapped box) */
async function readFrom(p, wi, ov) {
  const gen = ++R.gen; stopSpeech(); R.on = true; R.errs = 0; hlClear(); updReadUI(); awake(true);
  if (!ttsReady) { A.ttsInit(); await waitTts(); if (gen !== R.gen) return; if (!ttsReady) { R.on = false; updReadUI(); awake(AS.on); return; } }
  if (AS.on) stopAutoScroll();
  let page = p, start = wi || 0, first = true, spoke = false;
  while (gen === R.gen) {
    R.page = page; let rd;
    try { rd = first && ov ? ov : await pageReadable(page); } catch (e) { rd = { words: [], lines: {} }; }
    if (gen !== R.gen) return;
    if (!first && RS.follow) scrollToPage(page);
    if (RS.show && !page.wrap.querySelector('.lay')) drawLayout(page);
    { const nx = pages[pages.indexOf(page) + 1]; if (nx && !nx.read) pageReadable(nx).catch(() => {}); }    // next page ready in time
    if (rd.words.length > start) {
      R.rd = rd; R.chunks = RC.chunks(rd.words, start, 0, RS.lang === 'auto' ? 'mix' : 'single').map(sayAs); spoke = true;
      await speakChunks(gen); if (gen !== R.gen) return;
    }
    first = false; start = 0;
    const i = pages.indexOf(page);
    if (i < 0 || i + 1 >= pages.length) {
      R.on = false; R.resumeAt = null; hlClear(); awake(AS.on); updReadUI();
      toast(spoke ? 'Finished reading' : 'No readable text here', spoke ? 2600 : 4200); return;
    }
    page = pages[i + 1]; saveStateSoon();
  }
}
async function firstVisible() {
  const t = topPage(); if (!t) return null; const vr = view.getBoundingClientRect();
  for (let i = pages.indexOf(t.p); i < Math.min(pages.length, pages.indexOf(t.p) + 3); i++) {
    const p = pages[i], rd = await pageReadable(p), pr = p.wrap.getBoundingClientRect();
    const wi = rd.words.findIndex(w => { const y = pr.top - vr.top + w.top * scale; return y >= -2 && y < view.clientHeight; });
    if (wi >= 0) return { p, wi };
  }
  return { p: t.p, wi: 0 };
}
async function toggleRead() {
  if (!pages.length) { toast('Open a document first'); return; }
  if (R.on) { R.resumeAt = { p: R.page, wi: R.wi }; stopReading(); return; }
  const at = R.resumeAt && pages.includes(R.resumeAt.p) ? R.resumeAt : await firstVisible(); R.resumeAt = null;
  if (at) readFrom(at.p, at.wi);
}
function skipPage(d) {
  if (!pages.length) return;
  const cur = R.page && pages.includes(R.page) ? R.page : (topPage() || {}).p, i = pages.indexOf(cur) + d;
  if (i < 0 || i >= pages.length) return; scrollToPage(pages[i]);
  if (R.on) readFrom(pages[i], 0); else R.resumeAt = { p: pages[i], wi: 0 };
}

/* ---------- one tap = read from that word; double tap = stop (or back to the thumbnails when opened from there) ----------
   tapping text the reading rules skip (a box, a table, a caption…) reads that block first, then the main text goes on */
async function readAtPoint(p, x, y) {
  let rd; try { rd = await pageReadable(p); } catch (e) { return; }
  const dd = (W, i) => { const w = W[i], dx = Math.max(w.x0 - x, 0, x - w.x1), dy = Math.max(w.top - y, 0, y - w.bottom); return Math.sqrt(dx * dx + 4 * dy * dy); };
  const wi = RC.nearestWord(rd.words, x, y, 28); let best = wi >= 0 ? dd(rd.words, wi) : Infinity, bg = null, bj = -1;
  for (const g of rd.sgroups || []) { const j = RC.nearestWord(g.words, x, y, 28); if (j >= 0) { const d = dd(g.words, j); if (d < best) { best = d; bg = g; bj = j; } } }
  if (!bg) { if (wi >= 0) readFrom(p, wi); return; }
  let k = -1, kd = Infinity;                     // after the block: the main text below it, same column first
  rd.words.forEach((w, i) => { if (w.top < bg.bottom - 2) return; const d = (w.top - bg.bottom) + (w.x1 > bg.x0 && w.x0 < bg.x1 ? 0 : 400) + Math.abs(w.x0 - bg.x0) * .2; if (d < kd) { kd = d; k = i; } });
  const words = bg.words.slice(bj).concat(k >= 0 ? rd.words.slice(k) : []);
  toast('Reading this ' + (/table/.test(bg.why) ? 'table' : /box/.test(bg.why) ? 'box' : 'part') + ', then the main text', 2200);
  readFrom(p, 0, { words, lines: Object.assign(linesOf(words), rd.lines) });
}
let tap = null, tapTimer = 0, lastUp = { t: 0, x: 0, y: 0 }, dblStopAt = 0;
view.addEventListener('pointerdown', e => { tap = { x: e.clientX, y: e.clientY, t: performance.now(), ok: tool === 'scroll' && !inGrid() && e.isPrimary }; R.userUntil = performance.now() + 2500; AS.touching = true; }, true);
view.addEventListener('pointermove', e => { if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap.ok = false; }, true);
view.addEventListener('pointercancel', () => { tap = null; AS.touching = false; }, true);
view.addEventListener('pointerup', e => {
  AS.touching = false; AS.resumeAt = performance.now() + 600;
  const t = tap; tap = null; if (!t || !t.ok || performance.now() - t.t > 450 || performance.now() - PZ.at < 600) return;
  const now = performance.now(), dbl = now - lastUp.t < 330 && Math.hypot(e.clientX - lastUp.x, e.clientY - lastUp.y) < 40;
  lastUp = { t: now, x: e.clientX, y: e.clientY };
  if (dbl) {
    clearTimeout(tapTimer); lastUp.t = 0;
    if (R.on) { R.resumeAt = null; stopReading(); dblStopAt = now; toast('Reading stopped', 1500); }
    else if (fromGrid && e.target.closest('.pg')) openGrid();
    return;
  }
  if (!RS.tap) return;
  const wrap = e.target.closest && e.target.closest('.pg'); if (!wrap || !wrap._p) return;
  const p = wrap._p, r = p.wrap.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
  clearTimeout(tapTimer); tapTimer = setTimeout(() => readAtPoint(p, x, y), 340);     // wait: it may be a double tap
}, true);
view.addEventListener('wheel', () => { R.userUntil = performance.now() + 2500; }, { passive: true });
let hinted = false;
view.addEventListener('scroll', () => { if (!hinted && pages.length && RS.tap && pref('hint', '') !== '1') { hinted = true; setPref('hint', '1'); toast('Tip: tap any word to hear it read from there · double tap stops', 3500); } }, { passive: true });

/* ---------- auto-scroll (no voice) ---------- */
function asLoop(t) {
  if (!AS.on) return;
  const dt = Math.min(64, t - AS.last) / 1000; AS.last = t;
  if (!R.on && !AS.touching && t > AS.resumeAt) {
    AS.acc += RS.speed * dt; const px = Math.floor(AS.acc);
    if (px >= 1) { const before = view.scrollTop; view.scrollTop = before + px; AS.acc -= px; if (view.scrollTop === before && before + view.clientHeight >= view.scrollHeight - 2) { stopAutoScroll(); toast('End of document'); return; } }
  }
  AS.raf = requestAnimationFrame(asLoop);
}
function startAutoScroll() { if (!pages.length) { toast('Open a document first'); return; } if (R.on) stopReading(); AS.on = true; AS.last = performance.now(); AS.acc = 0; AS.resumeAt = 0; awake(true); updReadUI(); AS.raf = requestAnimationFrame(asLoop); }
function stopAutoScroll() { AS.on = false; cancelAnimationFrame(AS.raf); awake(R.on); updReadUI(); }

/* ---------- the 🔊 panel ---------- */
function updReadUI() { rq('#rplay').textContent = R.on ? '⏸ Pause' : '▶ Read'; rq('#asbtn').textContent = AS.on ? '⏸ Stop' : '▶ Start'; $('#rd').classList.toggle('on', R.on || AS.on); }
const num1 = v => v.toFixed(2).replace(/0$/, '');
function refreshReader() {
  rq('#rrate').value = Math.round(RS.rate * 100); rq('#rrv').textContent = num1(RS.rate) + '×';
  rq('#rpitch').value = Math.round(RS.pitch * 100); rq('#rpv').textContent = num1(RS.pitch);
  rq('#rlang').value = RS.lang; rq('#rvf').value = RS.filter; rq('#rmed').checked = RS.med; rq('#rpron').value = RS.pron || '';
  ['follow', 'tap', 'awake', 'head', 'tab', 'pic', 'side', 'show', 'main', 'heads'].forEach(k => { rq('#r' + k).checked = RS[k]; });
  rq('#rcols').value = RS.cols; rq('#asr').value = RS.speed; rq('#asv').textContent = RS.speed;
  if (ttsReady) { fillVoices(); fillEngines(); }
  updReadUI();
}
$('#rd').onclick = () => togglePanel('#rp', refreshReader);
rq('#rpx').onclick = () => { rp.hidden = true; };
let rst = 0; const restartSoon = () => { clearTimeout(rst); if (R.on) rst = setTimeout(() => readFrom(R.page, R.wi), 450); };
rp.addEventListener('input', e => {
  const id = e.target.id, v = +e.target.value;
  if (id === 'rrate') { RS.rate = v / 100; rq('#rrv').textContent = num1(RS.rate) + '×'; saveRS(); restartSoon(); }
  if (id === 'rpitch') { RS.pitch = v / 100; rq('#rpv').textContent = num1(RS.pitch); saveRS(); restartSoon(); }
  if (id === 'asr') { RS.speed = v; rq('#asv').textContent = v; saveRS(); }
});
const LAYOUT = { rcols: 'cols', rhead: 'head', rtab: 'tab', rpic: 'pic', rside: 'side', rmain: 'main', rheads: 'heads' };
rp.addEventListener('change', e => {
  const id = e.target.id, v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (id === 'rlang') { RS.lang = v; restartSoon(); }
  else if (id === 'rven') { RS.voiceEn = v; restartSoon(); }
  else if (id === 'rvhi') { RS.voiceHi = v; restartSoon(); }
  else if (id === 'rvf') { RS.filter = v; fillVoices(); }
  else if (id === 'reng') { A.ttsSetEngine(v); ttsReady = false; RS.voiceEn = RS.voiceHi = ''; stopReading(); toast('Speech engine changed — choose its voices below', 3000); }
  else if (id === 'rmed') { RS.med = v; restartSoon(); }
  else if (id === 'rpron') { RS.pron = v; parsePron(); restartSoon(); }
  else if (id === 'rfollow') RS.follow = v;
  else if (id === 'rtap') RS.tap = v;
  else if (id === 'rawake') { RS.awake = v; awake(R.on || AS.on); }
  else if (LAYOUT[id]) { RS[LAYOUT[id]] = v; pages.forEach(q => { q.read = null; }); layoutAll(); restartSoon(); }
  else if (id === 'rshow') { RS.show = v; layoutAll(); }
  else return;
  saveRS();
});
rq('#rplay').onclick = toggleRead;
rq('#rstop').onclick = () => { R.resumeAt = null; stopReading(); };
rq('#rprev').onclick = () => skipPage(-1); rq('#rnext').onclick = () => skipPage(1);
rq('#asbtn').onclick = () => AS.on ? stopAutoScroll() : startAutoScroll();
rq('#rinst').onclick = () => A.ttsInstallData(); rq('#rtts').onclick = () => A.ttsSettings();
rq('#rtest').onclick = () => {
  if (!ttsReady) { toast('Speech engine is not ready'); return; }
  A.ttsStop(); A.ttsSpeak('t:0', 'Hello, this is the English voice.', voiceFor('en'), 'en-IN', RS.rate, RS.pitch, true);
  A.ttsSpeak('t:1', 'नमस्ते, यह हिंदी आवाज़ है।', voiceFor('hi'), 'hi-IN', RS.rate, RS.pitch, false);
};
