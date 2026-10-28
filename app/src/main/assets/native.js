/* native.js — Android-only layer on top of the viewer:
   open-with / share / resume, save (original or copy), reader (TTS), auto-scroll, tap-to-read. */
(function () {
'use strict';
if (!window.Android) return;
const A = window.Android, RC = window.ReaderCore, SV = window.MarkupSaver, view = $('#view');
const JP = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const pref = (k, d) => { const v = A.getPref(k, ''); return v === '' ? d : v; };
const meta = {};                                   // native id -> {name,mime}

/* ---------- styles + small UI helpers ---------- */
const st = document.createElement('style');
st.textContent = `#toast{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);background:rgba(0,0,0,.82);color:#fff;padding:8px 14px;border-radius:18px;font-size:13px;z-index:30;max-width:90vw;opacity:0;transition:opacity .25s;pointer-events:none;text-align:center}
.panel{position:fixed;left:50%;transform:translateX(-50%);bottom:74px;width:min(390px,94vw);max-height:68vh;overflow:auto;background:var(--bar);border:1px solid var(--bd);border-radius:14px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.35);z-index:8;display:flex;flex-direction:column;gap:9px}
.panel[hidden]{display:none}.panel .row{display:flex;gap:8px;align-items:center;justify-content:space-between}.panel .row>span{color:var(--mut);font-size:13px}
.panel select{background:var(--bar);color:var(--fg);border:1px solid var(--bd);border-radius:8px;padding:6px;font:inherit;font-size:13px;max-width:64%;min-width:0}
.panel input[type=range]{flex:1;min-width:0}.panel label{font-size:13px;color:var(--fg)}.panel small{color:var(--mut);font-size:12px;line-height:1.35}.panel hr{border:0;border-top:1px solid var(--bd);margin:0;width:100%}
.panel .big{flex:1;padding:8px 6px}
.rh{position:absolute;pointer-events:none;background:rgba(255,196,0,.5);border-radius:3px;z-index:3}.rl{position:absolute;pointer-events:none;background:rgba(37,99,235,.13);z-index:2}
#sv.dirty::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#e11d48;margin-left:4px;vertical-align:middle}
body.grid .panel{display:none!important}`;
document.head.appendChild(st);
let tt;
function toast(m, ms) { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = m; el.style.opacity = 1; clearTimeout(tt); tt = setTimeout(() => el.style.opacity = 0, ms || 2600); }
window.__toast = toast;
const mk = (tag, props, html) => { const e = document.createElement(tag); Object.assign(e, props || {}); if (html != null) e.innerHTML = html; return e; };
const btn = (id, txt, title) => mk('button', { id, title }, txt);

/* ---------- bar buttons ---------- */
const sv = btn('sv', '💾', 'Save edits'), rd = btn('rd', '🔊', 'Read aloud / auto-scroll'), mn = btn('mn', '⋮', 'Settings');
$('#exbtn').after(sv, rd); $('#info').before(mn);

/* ---------- opening files from Android (open with / share / picker / resume) ---------- */
async function fetchEntry(e) {
  const r = await fetch('/__file/' + e.id, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const b = await r.blob(), f = new File([b], e.name || 'document', { type: e.mime || b.type || '' });
  f._nid = e.id; meta[e.id] = { name: e.name, mime: e.mime }; return f;
}
window.__nativeOpen = async function (list, mode, pos) {
  const files = [], bad = [];
  for (const e of list) { try { files.push(await fetchEntry(e)); } catch (x) { bad.push(e.name || 'file'); } }
  if (bad.length) toast('Could not read: ' + bad.join(', '), 4200);
  if (!files.length) return;
  stopAll();
  await openFiles(files, mode !== 'add');
  if (pos) restorePos(pos.page, pos.frac);
};
$('#open2').onclick = () => A.pickFiles('replace');
$('#gfile').onclick = () => A.pickFiles('add');

/* ---------- remembering the last document / position ---------- */
let userTouched = false;
function topPage() { const vr = view.getBoundingClientRect(); for (const p of pages) { const r = p.wrap.getBoundingClientRect(); if (r.bottom > vr.top + 4) return { p, frac: Math.max(0, Math.min(1, (vr.top - r.top) / (r.height || 1))) }; } return null; }
function restorePos(idx, frac) {
  if (!pages.length) return; idx = Math.max(0, Math.min(pages.length - 1, idx | 0)); userTouched = false;
  const go = () => { const t = pages[idx]; if (!t || userTouched) return; const vr = view.getBoundingClientRect(), r = t.wrap.getBoundingClientRect(); view.scrollTop += r.top - vr.top + (frac || 0) * r.height; };
  go(); [250, 800, 1800].forEach(ms => setTimeout(go, ms));
}
function saveStateNow() {
  if (!pages.length) return; const t = topPage(); if (!t) return;
  const ids = [...new Set(pages.map(q => q.nid).filter(Boolean))];
  if (ids.length) A.saveState(ids.join(','), pages.indexOf(t.p), t.frac);
}
let sst; const saveStateSoon = () => { clearTimeout(sst); sst = setTimeout(saveStateNow, 700); };
view.addEventListener('scroll', saveStateSoon, { passive: true });
view.addEventListener('touchstart', () => { userTouched = true; R.userUntil = performance.now() + 2500; AS.touching = true; }, { passive: true });
view.addEventListener('touchend', () => { AS.touching = false; AS.resumeAt = performance.now() + 600; }, { passive: true });
view.addEventListener('touchcancel', () => { AS.touching = false; }, { passive: true });
view.addEventListener('wheel', () => { R.userUntil = performance.now() + 2500; }, { passive: true });

/* ---------- marks survive closing the app (until saved) ---------- */
const MK = 'ms.marks';
const loadMarks = () => { try { return JSON.parse(localStorage.getItem(MK) || '{}'); } catch (e) { return {}; } };
const pageKey = p => p.nid ? A.entryKey(p.nid) + '|' + p.sidx : null;
function saveMarks() {
  try {
    const all = loadMarks(), has = {};
    for (const p of pages) { const k = pageKey(p); if (!k) continue; if (p.strokes.length) has[k] = p.strokes; else if (!(k in has)) has[k] = null; }
    for (const k in has) { if (has[k]) all[k] = has[k]; else delete all[k]; }
    const s = JSON.stringify(all); if (s.length < 4e6) localStorage.setItem(MK, s);
  } catch (e) {}
}
function clearMarksFor(nid) { try { const all = loadMarks(), pre = A.entryKey(nid) + '|'; for (const k in all) if (k.startsWith(pre)) delete all[k]; localStorage.setItem(MK, JSON.stringify(all)); } catch (e) {} }
let mst; const saveMarksSoon = () => { clearTimeout(mst); mst = setTimeout(saveMarks, 1000); };
window.__dirtyChanged = d => { sv.classList.toggle('dirty', d); if (d) saveMarksSoon(); };
let skipMarks = false;
window.__beforeReplace = () => { if (skipMarks) { skipMarks = false; } else saveMarks(); saveStateNow(); };
window.__docChanged = (fresh, added) => {
  const all = loadMarks(); let n = 0;
  for (const p of added) { const k = pageKey(p); if (k && all[k] && !p.strokes.length) { p.strokes = all[k]; n++; redraw(p); } }
  if (n && fresh) { setDirty(); toast('Restored your unsaved marks on ' + n + ' page' + (n > 1 ? 's' : '')); }
  saveStateSoon();
};

/* ---------- saving ---------- */
let saving = false;
const saveMode = () => pref('saveMode', 'copy');
async function doSave() {
  if (!pages.length) { toast('Nothing to save'); return; }
  if (saving) return; saving = true; sv.disabled = true; toast('Saving…', 60000);
  try {
    const mode = saveMode(), primary = docPrimary || 0;
    for (const p of pages) await ensure(p);
    await lib(PDFLIB);
    const bytes = await SV.build(PDFLib, pages, async p => { const c = await pageCanvas(p, 2); return new Uint8Array(await (await blobOf(c, 'image/jpeg', .9)).arrayBuffer()); });
    const r = await __saveBlob(new Blob([bytes], { type: 'application/pdf' }), mode, docName + '-edited.pdf', primary);
    setDirty(false);
    toast((r.note ? r.note + ' ' : '') + (r.mode === 'original' ? 'Saved in the original file.' : 'Saved: ' + r.where), 4500);
    if (r.mode === 'original' && primary) {            // reload so what you see is what is on disk
      const t = topPage(), idx = t ? pages.indexOf(t.p) : 0, fr = t ? t.frac : 0, m = meta[primary] || {};
      clearMarksFor(primary); skipMarks = true;
      await window.__nativeOpen([{ id: primary, name: m.name || (docName + '.pdf'), mime: m.mime }], 'replace', { page: idx, frac: fr });
    }
  } catch (e) { toast('Save failed: ' + (e && e.message || e), 5000); }
  saving = false; sv.disabled = false;
}
sv.onclick = doSave;

/* ---------- panels ---------- */
const mp = mk('div', { id: 'mp', className: 'panel', hidden: true }, `
 <div class="row"><b>Settings</b><button id="mpx">✕</button></div>
 <div><b style="font-size:13px">When I tap Save 💾</b></div>
 <label><input type="radio" name="sm" value="original"> Save into the original file (replaces it)</label>
 <label><input type="radio" name="sm" value="copy"> Save a new copy next to it (“-edited”)</label>
 <small>Chosen once here — Save never asks. Replacing the original works for PDF files; other file types always get a PDF copy.</small>
 <hr>
 <label><input type="checkbox" id="mfs"> Full screen (hide status and navigation bars)</label>
 <label><input type="checkbox" id="mres"> Reopen the last document on start</label>
 <hr>
 <div><b style="font-size:13px">Storage access</b></div>
 <small id="mstore"></small>
 <div class="row"><button class="big" id="mperm">Allow storage access</button></div>
 <div class="row"><button class="big" id="mtree">Grant SD card / USB folder</button></div>
 <small>Markup Studio appears in “Open with” and “Share” menus of file managers.</small>`);
const rp = mk('div', { id: 'rp', className: 'panel', hidden: true }, `
 <div class="row"><b>Read aloud</b><button id="rpx">✕</button></div>
 <div class="row"><button class="big" id="rprev" title="Previous page">⏮</button><button class="big on" id="rplay">▶ Read</button><button class="big" id="rnext" title="Next page">⏭</button><button class="big" id="rstop" title="Stop">⏹</button></div>
 <div class="row"><span>Speed <b id="rrv">1.0×</b></span><input type="range" id="rrate" min="50" max="300" step="5"></div>
 <div class="row"><span>Language</span><select id="rlang"><option value="auto">Auto (Hindi + English)</option><option value="en">English only</option><option value="hi">Hindi only</option></select></div>
 <div class="row"><span>English voice</span><select id="rven"></select></div>
 <div class="row"><span>Hindi voice</span><select id="rvhi"></select></div>
 <div class="row"><span>Voices shown</span><select id="rvf"><option value="all">Online + offline</option><option value="off">Offline only</option><option value="on">Online only</option></select></div>
 <div class="row"><button id="rtest">Test</button><button id="rinst">Voice data</button><button id="rtts">TTS settings</button></div>
 <label><input type="checkbox" id="rfollow"> Scroll along while reading</label>
 <label><input type="checkbox" id="rtap"> Tap a word or line to read from there</label>
 <label><input type="checkbox" id="rawake"> Keep screen on</label>
 <hr>
 <div class="row"><b style="font-size:13px">Auto-scroll</b><button id="asbtn">▶ Start</button></div>
 <div class="row"><span>Speed <b id="asv">40</b> px/s</span><input type="range" id="asr" min="5" max="300" step="5"></div>
 <small id="rnote"></small>`);
document.body.append(mp, rp);
const pq = (r, s) => r.querySelector(s);
function showPanel(p) { const open = p.hidden; mp.hidden = rp.hidden = true; $('#pop').hidden = true; if (open) { p.hidden = false; if (p === mp) refreshMenu(); else refreshReader(); } }
mn.onclick = () => showPanel(mp); rd.onclick = () => showPanel(rp);
$('#mpx').onclick = () => mp.hidden = true; $('#rpx').onclick = () => rp.hidden = true;
document.addEventListener('pointerdown', e => { if (!mp.hidden && !mp.contains(e.target) && e.target !== mn) mp.hidden = true; if (!rp.hidden && !rp.contains(e.target) && e.target !== rd) rp.hidden = true; }, true);
window.__back = () => { if (!mp.hidden || !rp.hidden) { mp.hidden = rp.hidden = true; return true; } if (!$('#pop').hidden) { $('#pop').hidden = true; return true; } if (!$('#exp').hidden) { $('#exp').hidden = true; return true; } if (inGrid()) { closeGrid(); return true; } return false; };

function refreshMenu() {
  mp.querySelectorAll('input[name=sm]').forEach(r => r.checked = r.value === saveMode());
  $('#mfs').checked = pref('fullscreen', '1') !== '0'; $('#mres').checked = pref('resume', '1') !== '0';
  const s = JP(A.storageInfo(), {}), vol = (s.volumes || []).filter(v => !/emulated/.test(v));
  $('#mstore').textContent = (s.allFiles ? 'All-files access: allowed. ' : 'All-files access: not allowed yet. ') + (vol.length ? 'Removable storage found: ' + vol.join(', ') + '. ' : 'No SD card / USB drive detected. ') + ((s.trees || []).length ? 'Folder access granted for ' + s.trees.length + ' location(s).' : '');
  $('#mperm').style.display = s.allFiles ? 'none' : '';
}
mp.addEventListener('change', e => {
  if (e.target.name === 'sm') { A.setPref('saveMode', e.target.value); toast(e.target.value === 'original' ? 'Save will replace the original file' : 'Save will create a new copy'); }
  if (e.target.id === 'mfs') A.setFullscreen(e.target.checked);
  if (e.target.id === 'mres') A.setPref('resume', e.target.checked ? '1' : '0');
});
$('#mperm').onclick = () => A.requestStorage(); $('#mtree').onclick = () => A.grantTree();
window.__nativeEvent = ev => { if (ev === 'storage' && !mp.hidden) refreshMenu(); };

/* ---------- reader state ---------- */
const RS = Object.assign({ rate: 1, voiceEn: '', voiceHi: '', filter: 'all', lang: 'auto', follow: true, tap: true, awake: true, speed: 40 }, JP(pref('reader', '{}'), {}));
const saveRS = () => A.setPref('reader', JSON.stringify(RS));
const R = { on: false, gen: 0, page: null, rd: null, chunks: [], sent: 0, fin: 0, cur: -1, wi: 0, resolve: null, errs: 0, userUntil: 0, resumeAt: null, est: 0, sawRange: false };
const AS = { on: false, last: 0, acc: 0, raf: 0, touching: false, resumeAt: 0 };
let ttsReady = false, voices = [];
window.__ttsReady = ok => { ttsReady = !!ok; if (ok) { voices = JP(A.ttsVoices(), []); fillVoices(); } else toast('No text-to-speech engine found. Install “Speech Services by Google”.', 5000); };
A.ttsInit();

function fillVoices() {
  const net = A.isOnline();
  const fill = (sel, lang, cur) => {
    sel.innerHTML = ''; sel.appendChild(new Option('Default for this language', ''));
    let vs = voices.filter(v => (v.l || '').toLowerCase().startsWith(lang));
    if (RS.filter === 'off') vs = vs.filter(v => !v.net); else if (RS.filter === 'on') vs = vs.filter(v => v.net);
    vs.sort((a, b) => (a.l || '').localeCompare(b.l || '') || (b.q - a.q));
    vs.forEach(v => sel.appendChild(new Option(v.n.replace(/-(local|network)$/, '') + ' · ' + v.l + (v.net ? ' · online' + (net ? '' : ' (offline now)') : ' · offline') + (v.ni ? ' · not installed' : ''), v.n)));
    if (!vs.length) sel.appendChild(new Option(lang === 'hi' ? 'No Hindi voice here — tap “Voice data”' : 'No English voice found', '', false, false));
    sel.value = vs.some(v => v.n === cur) ? cur : '';
  };
  fill(pq(rp, '#rven'), 'en', RS.voiceEn); fill(pq(rp, '#rvhi'), 'hi', RS.voiceHi);
}
function refreshReader() {
  pq(rp, '#rrate').value = Math.round(RS.rate * 100); pq(rp, '#rrv').textContent = RS.rate.toFixed(2).replace(/0$/, '') + '×';
  pq(rp, '#rlang').value = RS.lang; pq(rp, '#rvf').value = RS.filter; pq(rp, '#rfollow').checked = RS.follow; pq(rp, '#rtap').checked = RS.tap; pq(rp, '#rawake').checked = RS.awake;
  pq(rp, '#asr').value = RS.speed; pq(rp, '#asv').textContent = RS.speed; if (ttsReady) fillVoices(); updUI();
  pq(rp, '#rnote').textContent = 'Reads columns in order, skips pictures and their text. Scanned pages (pictures of text) cannot be read.';
}
function updUI() { pq(rp, '#rplay').textContent = R.on ? '⏸ Pause' : '▶ Read'; pq(rp, '#asbtn').textContent = AS.on ? '⏸ Stop' : '▶ Start'; rd.classList.toggle('on', R.on || AS.on); }
let rst; const restartSoon = () => { clearTimeout(rst); if (R.on) rst = setTimeout(() => readFrom(R.page, R.wi), 450); };
rp.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'rrate') { RS.rate = e.target.value / 100; pq(rp, '#rrv').textContent = RS.rate.toFixed(2).replace(/0$/, '') + '×'; saveRS(); restartSoon(); }
  if (id === 'asr') { RS.speed = +e.target.value; pq(rp, '#asv').textContent = RS.speed; saveRS(); }
});
rp.addEventListener('change', e => {
  const id = e.target.id, v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (id === 'rlang') RS.lang = v; else if (id === 'rven') RS.voiceEn = v; else if (id === 'rvhi') RS.voiceHi = v;
  else if (id === 'rvf') { RS.filter = v; fillVoices(); } else if (id === 'rfollow') RS.follow = v; else if (id === 'rtap') RS.tap = v;
  else if (id === 'rawake') { RS.awake = v; awake(R.on || AS.on); } else return;
  saveRS(); if (/^(rlang|rven|rvhi)$/.test(id)) restartSoon();
});
pq(rp, '#rinst').onclick = () => A.ttsInstallData(); pq(rp, '#rtts').onclick = () => A.ttsSettings();
pq(rp, '#rtest').onclick = () => {
  if (!ttsReady) { toast('Speech engine is not ready'); return; }
  A.ttsStop(); A.ttsSpeak('t:0', 'Hello, this is the English voice.', voiceFor('en'), 'en-IN', RS.rate, 1, true);
  A.ttsSpeak('t:1', 'नमस्ते, यह हिंदी आवाज़ है।', voiceFor('hi'), 'hi-IN', RS.rate, 1, false);
};
const awake = on => A.keepAwake(!!on && RS.awake);

/* ---------- text of a page in reading order ---------- */
async function pageReadable(p) {
  if (p.read) return p.read;
  let words = [], scanned = false;
  if (p.kind === 'pdf') {
    await ensure(p);
    const vp = p.page.getViewport({ scale: 1 }), tc = await p.page.getTextContent();
    let ol = null; try { ol = await p.page.getOperatorList(); } catch (e) {}
    const r = RC.analyze({ items: tc.items, fnArray: ol && ol.fnArray, argsArray: ol && ol.argsArray, OPS: pdfjsLib.OPS, vpT: vp.transform, W: vp.width, H: vp.height });
    words = r.words; scanned = r.scanned;
  } else if (p.kind === 'txt') words = RC.textWords(p.lines);
  const lines = {};
  for (const w of words) { const L = lines[w.si]; if (!L) lines[w.si] = { x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom }; else { L.x0 = Math.min(L.x0, w.x0); L.x1 = Math.max(L.x1, w.x1); L.top = Math.min(L.top, w.top); L.bottom = Math.max(L.bottom, w.bottom); } }
  return (p.read = { words, scanned, lines });
}

window.__readable = pageReadable; window.__topPage = topPage;

/* ---------- highlight + follow ---------- */
const hlClear = () => document.querySelectorAll('.rh,.rl').forEach(e => e.remove());
function hlWord(p, rdp, wi) {
  hlClear(); const w = rdp.words[wi]; if (!w || !p) return;
  const box = (cls, x0, y0, x1, y1, pad) => { const d = mk('div', { className: cls }); d.style.cssText = `left:${x0 * scale - pad}px;top:${y0 * scale - pad}px;width:${(x1 - x0) * scale + 2 * pad}px;height:${(y1 - y0) * scale + 2 * pad}px`; p.wrap.appendChild(d); };
  const L = rdp.lines[w.si]; if (L) box('rl', L.x0, L.top, L.x1, L.bottom, 1);
  box('rh', w.x0, w.top, w.x1, w.bottom, 1);
  follow(p, w);
}
function follow(p, w) {
  if (!RS.follow || performance.now() < R.userUntil) return;
  const vr = view.getBoundingClientRect(), pr = p.wrap.getBoundingClientRect(), vh = view.clientHeight;
  const y = pr.top - vr.top + w.top * scale, h = (w.bottom - w.top) * scale, x = pr.left - vr.left + w.x0 * scale;
  const dy = (y < vh * .1 || y + h > vh * .72) ? y - vh * .3 : 0, dx = (x < 8 || x > view.clientWidth - 40) ? x - view.clientWidth * .15 : 0;
  if (dy || dx) view.scrollBy({ top: dy, left: dx, behavior: 'smooth' });
}
function scrollToPage(p) { const vr = view.getBoundingClientRect(), pr = p.wrap.getBoundingClientRect(); view.scrollBy({ top: pr.top - vr.top - 6, behavior: 'smooth' }); }

/* ---------- reading engine ---------- */
function voiceFor(lang) {
  const name = lang === 'hi' ? RS.voiceHi : RS.voiceEn; if (!name) return '';
  const v = voices.find(x => x.n === name);
  if (v && v.net && !A.isOnline()) { const off = voices.find(x => !x.net && !x.ni && (x.l || '').toLowerCase().startsWith(lang)); return off ? off.n : ''; }
  return name;
}
const langOf = c => RS.lang === 'auto' ? c.lang : RS.lang;
function pump(gen) {
  while (gen === R.gen && R.sent < R.chunks.length && R.sent - R.fin < 2) {
    const i = R.sent++, c = R.chunks[i], lang = langOf(c);
    const rc = A.ttsSpeak(gen + ':' + i, c.text, voiceFor(lang), lang === 'hi' ? 'hi-IN' : 'en-IN', RS.rate, 1, false);
    if (rc < 0) { toast(rc === -2 ? (lang === 'hi' ? 'Hindi voice data is not installed — tap “Voice data”.' : 'English voice data is missing.') : 'Speech engine error', 4500); stopAll(); return; }
  }
}
function speakChunks(gen) { return new Promise(res => { R.resolve = r => { R.resolve = null; res(r); }; R.sent = 0; R.fin = 0; R.cur = -1; pump(gen); }); }
const findMap = (c, ch) => { let m = c.map[0]; for (const x of c.map) { if (x.s <= ch) m = x; else break; } return m; };
window.__tts = function (ev, id, s) {
  const parts = String(id).split(':'), g = +parts[0], i = +parts[1];
  if (g !== R.gen || !R.on) return;
  if (ev === 'start') {
    R.cur = i; R.sawRange = false; clearInterval(R.est);
    const c = R.chunks[i]; if (!c) return; R.wi = c.map.length ? c.map[0].wi : c.a; hlWord(R.page, R.rd, R.wi);
    const t0 = performance.now(), len = c.text.length;       // engines without word callbacks: estimate progress
    R.est = setInterval(() => { if (R.sawRange || g !== R.gen) { clearInterval(R.est); return; } const t = performance.now() - t0 - 900; if (t < 0) return; const m = findMap(c, Math.min(len - 1, Math.floor(t / 1000 * 14 * RS.rate))); if (m && m.wi !== R.wi) { R.wi = m.wi; hlWord(R.page, R.rd, m.wi); } }, 250);
  } else if (ev === 'range') {
    if (i !== R.cur) return; R.sawRange = true; const c = R.chunks[i], m = c && findMap(c, +s); if (m) { R.wi = m.wi; hlWord(R.page, R.rd, m.wi); }
  } else if (ev === 'done' || ev === 'error') {
    clearInterval(R.est);
    if (ev === 'error' && ++R.errs > 3) { stopAll(); toast('Speech failed — check the voice in TTS settings.', 4500); return; }
    if (ev === 'done') R.errs = 0;
    R.fin++; if (R.fin >= R.chunks.length) { R.resolve && R.resolve('end'); } else pump(g);
  }
};
function stopSpeech() { clearInterval(R.est); try { A.ttsStop(); } catch (e) {} if (R.resolve) { const r = R.resolve; R.resolve = null; r('stop'); } }
function stopAll() { R.gen++; stopSpeech(); R.on = false; hlClear(); awake(AS.on); updUI(); }
const waitTts = () => new Promise(res => { let n = 0; const t = setInterval(() => { if (ttsReady || ++n > 30) { clearInterval(t); res(); } }, 100); });
async function readFrom(p, wi) {
  const gen = ++R.gen; stopSpeech(); R.on = true; R.errs = 0; hlClear(); updUI(); awake(true);
  if (!ttsReady) { A.ttsInit(); await waitTts(); if (gen !== R.gen) return; if (!ttsReady) { R.on = false; updUI(); awake(AS.on); return; } }
  if (AS.on) stopAS();
  let page = p, start = wi || 0, first = true, spoke = false;
  while (gen === R.gen) {
    R.page = page; let rdp; try { rdp = await pageReadable(page); } catch (e) { rdp = { words: [], lines: {}, scanned: false }; }
    if (gen !== R.gen) return;
    if (!first && RS.follow) scrollToPage(page);
    if (rdp.words.length > start) { R.rd = rdp; R.chunks = RC.chunks(rdp.words, start); spoke = true; await speakChunks(gen); if (gen !== R.gen) return; }
    first = false; start = 0;
    const i = pages.indexOf(page); if (i < 0 || i + 1 >= pages.length) { R.on = false; R.resumeAt = null; hlClear(); awake(AS.on); updUI(); toast(spoke ? 'Finished reading' : 'No readable text here — the pages are pictures or scans', spoke ? 2600 : 4200); return; }
    page = pages[i + 1]; saveStateSoon();
  }
}
async function firstVisible() {
  const t = topPage(); if (!t) return null; const vr = view.getBoundingClientRect();
  for (let i = pages.indexOf(t.p); i < Math.min(pages.length, pages.indexOf(t.p) + 3); i++) {
    const p = pages[i], rdp = await pageReadable(p), pr = p.wrap.getBoundingClientRect();
    const wi = rdp.words.findIndex(w => pr.top - vr.top + w.top * scale >= -2 && pr.top - vr.top + w.top * scale < view.clientHeight);
    if (wi >= 0) return { p, wi };
  }
  return { p: t.p, wi: 0 };
}
async function toggleRead() {
  if (!pages.length) { toast('Open a document first'); return; }
  if (R.on) { R.resumeAt = { p: R.page, wi: R.wi }; stopAll(); return; }
  const at = R.resumeAt && pages.includes(R.resumeAt.p) ? R.resumeAt : await firstVisible(); R.resumeAt = null;
  if (at) readFrom(at.p, at.wi);
}
async function skipPage(d) {
  if (!pages.length) return; const cur = R.page && pages.includes(R.page) ? R.page : (topPage() || {}).p, i = pages.indexOf(cur) + d;
  if (i < 0 || i >= pages.length) return; scrollToPage(pages[i]);
  if (R.on) readFrom(pages[i], 0); else R.resumeAt = { p: pages[i], wi: 0 };
}
pq(rp, '#rplay').onclick = toggleRead; pq(rp, '#rstop').onclick = () => { R.resumeAt = null; stopAll(); };
pq(rp, '#rprev').onclick = () => skipPage(-1); pq(rp, '#rnext').onclick = () => skipPage(1);

/* ---------- tap / stylus a word or line to read from there ---------- */
let tap = null, hinted = false;
view.addEventListener('pointerdown', e => { tap = { x: e.clientX, y: e.clientY, t: performance.now(), ok: tool === 'scroll' && RS.tap && !inGrid() && e.isPrimary }; }, true);
view.addEventListener('pointermove', e => { if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap.ok = false; }, true);
view.addEventListener('pointercancel', () => { tap = null; }, true);
view.addEventListener('pointerup', async e => {
  const t = tap; tap = null; if (!t || !t.ok || performance.now() - t.t > 600) return;
  const wrap = e.target.closest && e.target.closest('.pg'); if (!wrap || !wrap._p) return;
  const p = wrap._p, r = p.oc.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
  let rdp; try { rdp = await pageReadable(p); } catch (err) { return; }
  const wi = RC.nearestWord(rdp.words, x, y, 28); if (wi < 0) return;
  readFrom(p, wi);
}, true);
view.addEventListener('scroll', () => { if (!hinted && pages.length) { hinted = true; if (RS.tap && pref('hint', '') !== '1') { A.setPref('hint', '1'); toast('Tip: tap any word to hear it read from there', 3500); } } }, { passive: true, once: true });

/* ---------- auto-scroll (no voice) ---------- */
function asLoop(t) {
  if (!AS.on) return;
  const dt = Math.min(64, t - AS.last) / 1000; AS.last = t;
  if (!R.on && !AS.touching && t > AS.resumeAt) {
    AS.acc += RS.speed * dt; const px = Math.floor(AS.acc);
    if (px >= 1) { const before = view.scrollTop; view.scrollTop = before + px; AS.acc -= px; if (view.scrollTop === before && before + view.clientHeight >= view.scrollHeight - 2) { stopAS(); toast('End of document'); return; } }
  }
  AS.raf = requestAnimationFrame(asLoop);
}
function startAS() { if (!pages.length) { toast('Open a document first'); return; } if (R.on) stopAll(); AS.on = true; AS.last = performance.now(); AS.acc = 0; AS.resumeAt = 0; awake(true); updUI(); AS.raf = requestAnimationFrame(asLoop); }
function stopAS() { AS.on = false; cancelAnimationFrame(AS.raf); awake(R.on); updUI(); }
pq(rp, '#asbtn').onclick = () => AS.on ? stopAS() : startAS();

/* ---------- lifecycle ---------- */
window.__saveNow = () => { saveStateNow(); saveMarks(); };
window.__paused = () => { if (R.on) { R.resumeAt = { p: R.page, wi: R.wi }; stopAll(); } if (AS.on) stopAS(); window.__saveNow(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) window.__paused(); });

/* ---------- startup: files from the intent, else the last document ---------- */
(async function () {
  A.jsReady();
  const pend = JP(A.takePending(), []);
  if (pend.length) { await window.__nativeOpen(pend, 'replace'); return; }
  if (pref('resume', '1') === '0') return;
  const last = JP(A.reopenLast(), null);
  if (last && last.entries && last.entries.length) await window.__nativeOpen(last.entries, 'replace', { page: last.page, frac: last.frac });
})();
})();
