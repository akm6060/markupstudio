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
.panel input[type=range]{flex:1;min-width:0}.panel label{font-size:13px;color:var(--fg);white-space:normal;align-items:flex-start;line-height:1.35}.panel label input{margin-top:2px;flex:none}.panel small{color:var(--mut);font-size:12px;line-height:1.35}.panel hr{border:0;border-top:1px solid var(--bd);margin:0;width:100%}
.panel .big{flex:1;padding:8px 6px}
.rh{position:absolute;pointer-events:none;background:rgba(255,196,0,.5);border-radius:3px;z-index:3}.rl{position:absolute;pointer-events:none;background:rgba(37,99,235,.13);z-index:2}
#sv.dirty::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#e11d48;margin-left:4px;vertical-align:middle}
body.grid .panel{display:none!important}
.lay{position:absolute;pointer-events:none;z-index:2;border-radius:3px}
.lr{border:2px solid rgba(22,163,74,.8);background:rgba(22,163,74,.05)}
.lr::before{content:attr(data-n);position:absolute;left:0;top:0;transform:translate(-45%,-45%);background:#16a34a;color:#fff;font:700 11px system-ui,sans-serif;border-radius:9px;min-width:18px;height:18px;line-height:18px;text-align:center;padding:0 4px}
.ls{background:rgba(220,38,38,.2);outline:1px dashed rgba(220,38,38,.75)}
#fb{position:fixed;left:0;top:0;right:0;bottom:0;background:var(--bg);z-index:20;display:flex;flex-direction:column}#fb[hidden]{display:none}
#fbh,#fbf{display:flex;gap:6px;align-items:center;padding:8px;background:var(--bar);border-bottom:1px solid var(--bd)}#fbf{border-top:1px solid var(--bd);border-bottom:0;flex-wrap:wrap}
#fbt{flex:1;font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fbr{display:flex;gap:6px;overflow-x:auto;padding:6px 8px;border-bottom:1px solid var(--bd);scrollbar-width:none}#fbr button{flex:none}
#fbp{font-size:12px;color:var(--mut);padding:5px 10px;white-space:nowrap;overflow-x:auto;direction:rtl;text-align:left}
#fbl{flex:1;overflow:auto;-webkit-overflow-scrolling:touch}
.fi{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--bd);cursor:pointer;user-select:none}.fi:active{background:var(--ac2)}
.fi .ic{font-size:22px;width:28px;text-align:center;flex:none}.fi .nm{flex:1;min-width:0}.fi .nm div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fi .mt{font-size:11px;color:var(--mut)}
#fbm{padding:22px 16px;color:var(--mut);text-align:center;line-height:1.5}#fbm button{margin-top:10px;background:var(--ac);color:#fff;border:none;padding:9px 16px}`;
document.head.appendChild(st);
let tt;
function toast(m, ms) { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = m; el.style.opacity = 1; clearTimeout(tt); tt = setTimeout(() => el.style.opacity = 0, ms || 2600); }
window.__toast = toast;
const mk = (tag, props, html) => { const e = document.createElement(tag); Object.assign(e, props || {}); if (html != null) e.innerHTML = html; return e; };
const btn = (id, txt, title) => mk('button', { id, title }, txt);

/* ---------- bar buttons ---------- */
const sv = btn('sv', '💾', 'Save edits'), rd = btn('rd', '🔊', 'Read aloud / auto-scroll'), mn = btn('mn', '⋮', 'Settings'), ob = btn('ob', '📂', 'Open a file');
$('#exbtn').after(sv, rd); $('#info').before(mn); $('#pgs').before(ob);

/* ---------- opening files from Android (open with / share / picker / resume) ---------- */
async function fetchEntry(e) {
  const url = '/__file/' + e.id; meta[e.id] = { name: e.name, mime: e.mime };
  if ((/pdf/i.test(e.mime || '') || /\.pdf$/i.test(e.name || '')) && e.size > BIGPDF) {   // big book: do not load it all into memory
    const get = () => fetch(url, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r; });
    return { name: e.name || 'document.pdf', type: 'application/pdf', size: e.size, _nid: e.id, _url: url, arrayBuffer: () => get().then(r => r.arrayBuffer()), text: () => get().then(r => r.text()) };
  }
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const b = await r.blob(), f = new File([b], e.name || 'document', { type: e.mime || b.type || '' });
  f._nid = e.id; f._url = url; return f;
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
$('#open2').onclick = () => fbOpen('open');
$('#gfile').onclick = () => fbOpen('add');
ob.onclick = () => fbOpen('open');

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
  saveStateSoon(); if (RS.show) setTimeout(layoutAll, 600);
};

/* ---------- saving ---------- */
let saving = false;
const saveMode = () => pref('saveMode', 'copy');
async function doSave() {
  if (!pages.length) { toast('Nothing to save'); return; }
  if (saving) return; saving = true; sv.disabled = true; toast('Saving…', 60000);
  try {
    let mode = saveMode(); const primary = docPrimary || 0;
    for (const p of pages) { try { await ensure(p); } catch (e) {} }   // a damaged page must not stop the save
    await lib(PDFLIB);
    const bytes = await window.__withBytes(pages, () => SV.build(PDFLib, pages, async p => { const c = await pageCanvas(p, 2); return new Uint8Array(await (await blobOf(c, 'image/jpeg', .9)).arrayBuffer()); }, window.__refOf));
    const bad = bytes.__bad || 0;
    if (bad && mode === 'original') mode = 'copy';                   // never overwrite the original with blank pages
    const r = await __saveBlob(new Blob([bytes], { type: 'application/pdf' }), mode, docName + '-edited.pdf', primary);
    setDirty(false);
    toast((r.note ? r.note + ' ' : '') + (r.mode === 'original' ? 'Saved in the original file.' : 'Saved: ' + r.where) + (bad ? ' · ' + bad + ' damaged page' + (bad > 1 ? 's' : '') + ' could not be read, so the original was not replaced.' : ''), bad ? 8000 : 4500);
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
 <label><input type="radio" name="sm" value="copy"> Save a new copy (“-edited”)</label>
 <small>Chosen once here — Save never asks. Replacing the original works for PDF files; other file types always get a PDF copy.</small>
 <hr>
 <div><b style="font-size:13px">Folders</b></div>
 <div class="row"><span>Edited copies go to</span><button id="mcd">Change</button></div><small id="mcdv"></small>
 <div class="row"><span>Exports go to</span><button id="med">Change</button></div><small id="medv"></small>
 <hr>
 <div class="row"><span>Theme</span><select id="mth"><option value="light">White</option><option value="dark">Dark</option><option value="auto">Same as phone</option></select></div>
 <hr>
 <label><input type="checkbox" id="mfs"> Full screen (hide status and navigation bars)</label>
 <label><input type="checkbox" id="mres"> Reopen the last document on start</label>
 <hr>
 <div><b style="font-size:13px">Storage access</b></div>
 <small id="mstore"></small>
 <div class="row"><button class="big" id="mperm">Allow access to all files</button></div>
 <div class="row"><button class="big" id="mbrowse">Browse all files</button></div>
 <div class="row"><button class="big" id="mtree">Allow writing to SD card / USB</button></div>
 <small>Android 11 and newer block the Android/data and Android/obb system folders for every app.</small>
 <small>Markup Studio appears in “Open with” and “Share” menus of file managers.</small>`);
const rp = mk('div', { id: 'rp', className: 'panel', hidden: true }, `
 <div class="row"><b>Read aloud</b><button id="rpx">✕</button></div>
 <div class="row"><button class="big" id="rprev" title="Previous page">⏮</button><button class="big on" id="rplay">▶ Read</button><button class="big" id="rnext" title="Next page">⏭</button><button class="big" id="rstop" title="Stop">⏹</button></div>
 <div class="row"><span>Speed <b id="rrv">1.0×</b></span><input type="range" id="rrate" min="50" max="300" step="5"></div>
 <div class="row"><span>Language</span><select id="rlang"><option value="auto">Hindi + English mixed (both voices)</option><option value="en">English only</option><option value="hi">Hindi only</option></select></div>
 <div class="row"><span>English voice</span><select id="rven"></select></div>
 <div class="row"><span>Hindi voice</span><select id="rvhi"></select></div>
 <div class="row"><span>Voices shown</span><select id="rvf"><option value="all">Online + offline</option><option value="off">Offline only</option><option value="on">Online only</option></select></div>
 <div class="row"><button id="rtest">Test</button><button id="rinst">Voice data</button><button id="rtts">TTS settings</button></div>
 <label><input type="checkbox" id="rfollow"> Scroll along while reading</label>
 <label><input type="checkbox" id="rtap"> Tap a word or line to read from there</label>
 <label><input type="checkbox" id="rawake"> Keep screen on</label>
 <hr>
 <div><b style="font-size:13px">Page layout</b></div>
 <div class="row"><span>Columns</span><select id="rcols"><option value="auto">Find automatically</option><option value="1">1 column</option><option value="2">2 columns</option><option value="3">3 columns</option></select></div>
 <label><input type="checkbox" id="rmain"> Read only the main story — skip boxes, coloured backgrounds, different fonts and colours</label>
 <label><input type="checkbox" id="rheads"> Also read headings</label>
 <label><input type="checkbox" id="rhead"> Skip book name, headers and page numbers</label>
 <label><input type="checkbox" id="rtab"> Skip tables (also tables with only divider lines)</label>
 <label><input type="checkbox" id="rpic"> Skip picture labels and notes below pictures</label>
 <label><input type="checkbox" id="rside"> Skip side notes in the margins</label>
 <label><input type="checkbox" id="rshow"> Show reading order on the page</label>
 <small>Column 1 is read to its end, then column 2. With “Show reading order”: green boxes are read in the numbered order, red is skipped.</small>
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
window.__back = () => { if (!fb.hidden) { fbUp(true); return true; } if (!mp.hidden || !rp.hidden) { mp.hidden = rp.hidden = true; return true; } if (!$('#pop').hidden) { $('#pop').hidden = true; return true; } if (!$('#exp').hidden) { $('#exp').hidden = true; return true; } if (inGrid()) { closeGrid(); return true; } return false; };

function refreshMenu() {
  mp.querySelectorAll('input[name=sm]').forEach(r => r.checked = r.value === saveMode());
  $('#mfs').checked = pref('fullscreen', '1') !== '0'; $('#mres').checked = pref('resume', '1') !== '0';
  const s = JP(A.storageInfo(), {}), vol = (s.volumes || []).filter(v => !/emulated/.test(v));
  $('#mstore').textContent = (s.allFiles ? 'All-files access: allowed. ' : 'All-files access: not allowed yet. ') + (vol.length ? 'Removable storage found: ' + vol.join(', ') + '. ' : 'No SD card / USB drive detected. ') + ((s.trees || []).length ? 'Folder access granted for ' + s.trees.length + ' location(s).' : '');
  $('#mperm').style.display = s.allFiles ? 'none' : '';
  $('#mth').value = pref('theme', 'light');
  const cd = pref('copyDir', ''), ed = pref('exportDir', '');
  $('#mcdv').textContent = cd || 'Same folder as the original file';
  $('#medv').textContent = ed || 'Download/MarkupStudio';
}
mp.addEventListener('change', e => {
  if (e.target.name === 'sm') { A.setPref('saveMode', e.target.value); toast(e.target.value === 'original' ? 'Save will replace the original file' : 'Save will create a new copy'); }
  if (e.target.id === 'mfs') A.setFullscreen(e.target.checked);
  if (e.target.id === 'mres') A.setPref('resume', e.target.checked ? '1' : '0');
  if (e.target.id === 'mth') { const t = e.target.value; A.setTheme(t); if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }
});
$('#mcd').onclick = () => { mp.hidden = true; fbOpen('folder', p => { A.setPref('copyDir', p); toast(p ? 'Edited copies will be saved in ' + p : 'Edited copies will be saved next to the original'); }, pref('copyDir', '')); };
$('#med').onclick = () => { mp.hidden = true; fbOpen('folder', p => { A.setPref('exportDir', p); toast(p ? 'Exports will be saved in ' + p : 'Exports will be saved in Download/MarkupStudio'); }, pref('exportDir', '')); };
$('#mbrowse').onclick = () => { mp.hidden = true; fbOpen('open'); };
$('#mperm').onclick = () => A.requestStorage(); $('#mtree').onclick = () => A.grantTree();
window.__nativeEvent = ev => { if (ev === 'storage') { if (!mp.hidden) refreshMenu(); if (!fb.hidden) fbGo(FB.path); } };

/* ---------- reader state ---------- */
const RS = Object.assign({ rate: 1, voiceEn: '', voiceHi: '', filter: 'all', lang: 'auto', follow: true, tap: true, awake: true, speed: 40, cols: 'auto', head: true, tab: true, pic: true, side: true, show: false, main: true, heads: false }, JP(pref('reader', '{}'), {}));
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
  pq(rp, '#rcols').value = RS.cols; pq(rp, '#rhead').checked = RS.head; pq(rp, '#rtab').checked = RS.tab; pq(rp, '#rpic').checked = RS.pic; pq(rp, '#rside').checked = RS.side; pq(rp, '#rshow').checked = RS.show; pq(rp, '#rmain').checked = RS.main; pq(rp, '#rheads').checked = RS.heads;
  pq(rp, '#rnote').textContent = 'Scanned pages (photos of text) have no text inside and cannot be read aloud.';
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
  else if (id === 'rawake') { RS.awake = v; awake(R.on || AS.on); }
  else if (/^(rcols|rhead|rtab|rpic|rside|rmain|rheads)$/.test(id)) { RS[{ rcols: 'cols', rhead: 'head', rtab: 'tab', rpic: 'pic', rside: 'side', rmain: 'main', rheads: 'heads' }[id]] = v; pages.forEach(q => { q.read = null; }); layoutAll(); restartSoon(); }
  else if (id === 'rshow') { RS.show = v; layoutAll(); }
  else return;
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
  let words = [], scanned = false, extra = {};
  if (p.kind === 'pdf') {
    await ensure(p);
    const i = pages.indexOf(p), repeat = new Set();               // top / bottom lines of nearby pages: book name, chapter
    for (let j = i - 2; j <= i + 2; j++) {
      const q = pages[j]; if (!q || q === p || q.kind !== 'pdf' || q.doc !== p.doc) continue;
      try { if (!q.bands) { await ensure(q); q.bands = await RC.bandKeys(q.page); } q.bands.forEach(k => repeat.add(k)); } catch (e) {}
    }
    const r = await RC.analyzePage(p.page, pdfjsLib, { cols: RS.cols, head: RS.head, tables: RS.tab, pics: RS.pic, side: RS.side, main: RS.main, heads: RS.heads }, repeat);
    words = r.words; scanned = r.scanned; extra = { blocks: r.blocks, skipped: r.skipped };
  } else if (p.kind === 'txt') words = RC.textWords(p.lines);
  const lines = {};
  for (const w of words) { const L = lines[w.si]; if (!L) lines[w.si] = { x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom }; else { L.x0 = Math.min(L.x0, w.x0); L.x1 = Math.max(L.x1, w.x1); L.top = Math.min(L.top, w.top); L.bottom = Math.max(L.bottom, w.bottom); } }
  return (p.read = Object.assign({ words, scanned, lines }, extra));
}
/* "show reading order": numbered green boxes = read in this order, red = skipped */
function drawLayout(p) {
  p.wrap.querySelectorAll('.lay').forEach(e => e.remove());
  if (!RS.show || !p.read || !p.w) return;
  const box = (cls, b, n) => { const d = mk('div', { className: 'lay ' + cls }); d.style.cssText = `left:${(b.x0 - 2) / p.w * 100}%;top:${(b.top - 2) / p.h * 100}%;width:${(b.x1 - b.x0 + 4) / p.w * 100}%;height:${(b.bottom - b.top + 4) / p.h * 100}%`; if (n) d.dataset.n = n; p.wrap.appendChild(d); };
  (p.read.blocks || []).forEach((b, i) => box('lr', b, String(i + 1)));
  (p.read.skipped || []).forEach(b => box('ls', b));
}
let layQ = 0;
async function layoutAll() {
  const id = ++layQ;
  document.querySelectorAll('.lay').forEach(e => e.remove());
  if (!RS.show || !pages.length) return;
  const vr = view.getBoundingClientRect();
  for (const p of pages) {
    const r = p.wrap.getBoundingClientRect(); if (r.bottom < vr.top - 1500 || r.top > vr.bottom + 1500) continue;
    try { await pageReadable(p); } catch (e) { continue; }
    if (id !== layQ) return; drawLayout(p);
  }
}
let lyt; view.addEventListener('scroll', () => { if (!RS.show) return; clearTimeout(lyt); lyt = setTimeout(() => { const vr = view.getBoundingClientRect(); for (const p of pages) { const r = p.wrap.getBoundingClientRect(); if (r.bottom > vr.top - 1500 && r.top < vr.bottom + 1500 && !p.wrap.querySelector('.lay')) { pageReadable(p).then(() => drawLayout(p)).catch(() => {}); } } }, 300); }, { passive: true });

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
    if (RS.show && !page.wrap.querySelector('.lay')) drawLayout(page);
    if (rdp.words.length > start) { R.rd = rdp; R.chunks = RC.chunks(rdp.words, start, 0, RS.lang === 'auto' ? 'mix' : 'single'); spoke = true; await speakChunks(gen); if (gen !== R.gen) return; }
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
  if (window.__pinchAt && performance.now() - window.__pinchAt < 600) return;
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

/* ---------- built-in file browser: all of internal storage, SD cards and USB drives ---------- */
const fb = mk('div', { id: 'fb', hidden: true }, `
 <div id="fbh"><button id="fbx" title="Close">✕</button><div id="fbt">Open a file</div><button id="fbu" title="Up one folder">⬆</button><button id="fbs" title="Sort">A–Z</button></div>
 <div id="fbr"></div><div id="fbp"></div><div id="fbl"></div>
 <div id="fbf"><button id="fball">Show all files</button><button id="fbsys">Other apps…</button><span style="flex:1"></span><button id="fbdef" hidden>Use default</button><button id="fbuse" class="on" hidden>✓ Use this folder</button></div>`);
document.body.appendChild(fb);
const FB = { mode: 'open', cb: null, path: '', all: false, sort: pref('fbSort', 'name'), roots: [] };
const DOCS = /\.(pdf|png|jpe?g|webp|gif|bmp|txt|md|csv|json|xml|html?|docx|xlsx|xls|xlsm|ods|log|rtf)$/i;
const ICON = n => /\.pdf$/i.test(n) ? '📕' : /\.(png|jpe?g|webp|gif|bmp)$/i.test(n) ? '🖼️' : /\.(docx?|rtf|odt)$/i.test(n) ? '📘' : /\.(xlsx?|xlsm|ods|csv)$/i.test(n) ? '📗' : '📄';
const fsz = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function fbRoots() {
  FB.roots = JP(A.roots(), []);
  const r = $('#fbr'); r.innerHTML = '';
  const add = (label, path) => { const b = mk('button', {}, esc(label)); b.onclick = () => fbGo(path); r.appendChild(b); };
  add('🏠 Storages', '');
  FB.roots.forEach(x => add((x.kind === 'usb' ? '🔌 ' : x.kind === 'sd' ? '💾 ' : '📱 ') + x.label, x.path));
  const int = FB.roots.find(x => x.kind === 'internal');
  if (int) { add('⬇ Download', int.path + '/Download'); add('📁 Documents', int.path + '/Documents'); }
}
function fbOpen(mode, cb, start) {
  FB.mode = mode; FB.cb = cb || null;
  $('#fbt').textContent = mode === 'folder' ? 'Choose a folder' : mode === 'add' ? 'Add a file to this document' : 'Open a file';
  $('#fbuse').hidden = $('#fbdef').hidden = mode !== 'folder'; $('#fball').hidden = $('#fbsys').hidden = mode === 'folder';
  $('#fball').textContent = FB.all ? 'Documents only' : 'Show all files';
  mp.hidden = rp.hidden = true; fb.hidden = false; fbRoots();
  let p = start || (mode === 'folder' ? '' : pref('fbLast', ''));
  if (!p) { const int = FB.roots.find(x => x.kind === 'internal'); p = int ? int.path : ''; }
  fbGo(p);
}
function fbClose() { fb.hidden = true; }
const isRoot = p => FB.roots.some(x => x.path === p);
function fbUp(fromBack) {
  if (!FB.path) { if (fromBack) fbClose(); return; }
  if (isRoot(FB.path)) { fbGo(''); return; }
  fbGo(FB.path.replace(/\/[^/]+\/?$/, '') || '/');
}
function fbItem(icon, name, meta, onTap) {
  const d = mk('div', { className: 'fi' }, `<div class="ic">${icon}</div><div class="nm"><div>${esc(name)}</div>${meta ? `<div class="mt">${esc(meta)}</div>` : ''}</div>`);
  d.onclick = onTap; return d;
}
function fbGo(path) {
  const L = $('#fbl'); L.innerHTML = ''; FB.path = path; $('#fbu').disabled = !path;
  $('#fbsys').hidden = FB.mode === 'folder';
  if (!path) {                                   // list of storages
    $('#fbp').textContent = 'All storages'; $('#fbuse').disabled = true;
    FB.roots.forEach(x => L.appendChild(fbItem(x.kind === 'usb' ? '🔌' : x.kind === 'sd' ? '💾' : '📱', x.label, x.total ? fsz(x.free) + ' free of ' + fsz(x.total) : x.path, () => fbGo(x.path))));
    if (!FB.roots.length) L.appendChild(mk('div', { id: 'fbm' }, 'No storage found.'));
    return;
  }
  $('#fbp').textContent = '\u200e' + path; $('#fbuse').disabled = false;
  const r = JP(A.listDir(path), { ok: false });
  if (!r.ok) {
    const m = mk('div', { id: 'fbm' });
    if (r.blocked) m.textContent = 'Android does not let any app open this system folder.';
    else if (r.perm) { m.innerHTML = 'Markup Studio needs permission to see all your files.<br><button>Allow access to all files</button>'; m.querySelector('button').onclick = () => A.requestStorage(); }
    else m.textContent = 'This folder cannot be opened.';
    L.appendChild(m); return;
  }
  let items = r.items.filter(x => !x.n.startsWith('.'));
  const dirs = items.filter(x => x.d), files = items.filter(x => !x.d && (FB.all || DOCS.test(x.n)));
  const cmp = FB.sort === 'date' ? (a, b) => b.m - a.m : (a, b) => a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: 'base' });
  dirs.sort(cmp); files.sort(cmp);
  const day = m => m ? new Date(m).toLocaleDateString() : '';
  dirs.forEach(x => L.appendChild(fbItem('📁', x.n, day(x.m), () => fbGo(path.replace(/\/$/, '') + '/' + x.n))));
  if (FB.mode !== 'folder') files.forEach(x => L.appendChild(fbItem(ICON(x.n), x.n, fsz(x.s) + ' · ' + day(x.m), () => {
    A.setPref('fbLast', path); fbClose(); toast('Opening ' + x.n + '…');
    A.openPaths(JSON.stringify([path.replace(/\/$/, '') + '/' + x.n]), FB.mode === 'add' ? 'add' : 'replace');
  })));
  if (!L.children.length) L.appendChild(mk('div', { id: 'fbm' }, FB.mode === 'folder' ? 'No sub-folders here. Tap “Use this folder” to pick this one.' : 'No documents in this folder.' + (FB.all ? '' : ' Tap “Show all files” to see everything.')));
  L.scrollTop = 0;
}
$('#fbx').onclick = fbClose; $('#fbu').onclick = () => fbUp(false);
$('#fbs').onclick = () => { FB.sort = FB.sort === 'name' ? 'date' : 'name'; A.setPref('fbSort', FB.sort); $('#fbs').textContent = FB.sort === 'name' ? 'A–Z' : 'Newest'; fbGo(FB.path); };
$('#fbs').textContent = FB.sort === 'name' ? 'A–Z' : 'Newest';
$('#fball').onclick = () => { FB.all = !FB.all; $('#fball').textContent = FB.all ? 'Documents only' : 'Show all files'; fbGo(FB.path); };
$('#fbsys').onclick = () => { const m = FB.mode === 'add' ? 'add' : 'replace'; fbClose(); A.pickFiles(m); };
$('#fbdef').onclick = () => { fbClose(); if (FB.cb) FB.cb(''); };
$('#fbuse').onclick = () => {
  const p = FB.path; if (!p) return; fbClose();
  if (!A.canWriteDir(p)) toast('Android needs your OK to write there: Settings ⋮ → “Allow writing to SD card / USB”', 6000);
  if (FB.cb) FB.cb(p);
};

/* ---------- lifecycle ---------- */
window.__saveNow = () => { saveStateNow(); saveMarks(); };
window.__paused = () => { if (R.on) { R.resumeAt = { p: R.page, wi: R.wi }; stopAll(); } if (AS.on) stopAS(); window.__saveNow(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) window.__paused(); else if (window.__setTool) window.__setTool('scroll'); });

/* ---------- startup: files from the intent, else the last document ---------- */
(async function () {
  A.jsReady();
  const pend = JP(A.takePending(), []);
  if (pend.length) { await window.__nativeOpen(pend, 'replace'); return; }
  if (pref('resume', '1') === '0') return;
  if (A.safeStart && A.safeStart()) { toast('The last book was not reopened because the viewer ran out of memory. Open it again from 📂.', 7000); return; }
  const last = JP(A.reopenLast(), null);
  if (last && last.entries && last.entries.length) await window.__nativeOpen(last.entries, 'replace', { page: last.page, frac: last.frac });
})();
})();
