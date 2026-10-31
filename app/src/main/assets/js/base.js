/* base.js — shared helpers, the link to the phone (window.Android) and the state every part uses */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
const A = window.Android, RC = window.ReaderCore;
const $ = s => document.querySelector(s);
const view = $('#view'), host = $('#pages');

/* ---------- small helpers ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const JP = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const el = (tag, props, html) => { const e = document.createElement(tag); Object.assign(e, props || {}); if (html != null) e.innerHTML = html; return e; };
const blobOf = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
const b2u = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const fmtB = b => b >= 1048576 ? (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fsz = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : fmtB(b);
const libs = {};
const lib = u => libs[u] || (libs[u] = new Promise((ok, no) => { const s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = no; document.head.appendChild(s); }));
const LIB = { pdflib: 'libs/pdf-lib.min.js', jszip: 'libs/jszip.min.js', pptx: 'libs/pptxgen.bundle.js', mammoth: 'libs/mammoth.browser.min.js', xlsx: 'libs/xlsx.full.min.js' };

/* settings kept by the phone (survive updates of the page) and small ones kept by the page */
const pref = (k, d) => { const v = A.getPref(k, ''); return v === '' ? d : v; };
const setPref = (k, v) => A.setPref(k, String(v));
const ls = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

/* reads that are cancelled when a book is closed are not errors */
window.addEventListener('unhandledrejection', e => {
  const m = String(e.reason && (e.reason.message || e.reason) || '');
  if (/Failed to fetch|postMessage|aborted|Worker was destroyed|Transport destroyed|Loading aborted/i.test(m)) e.preventDefault();
});

/* memory budget: phones with 4 GB or less keep fewer, smaller page pictures */
const MEM = (() => {
  let tot = JP(A.memInfo(), {}).total || 0;
  if (!tot && navigator.deviceMemory) tot = navigator.deviceMemory * 1073741824;
  const low = !tot || tot < 4.6e9;
  return { total: tot, low, px: low ? 3.2e6 : 5.5e6, keep: low ? 4 : 7 };
})();
let dpr = Math.min(window.devicePixelRatio || 1, 2);

/* ---------- messages and panels ---------- */
let toastT = 0;
function toast(m, ms) {
  let t = $('#toast'); if (!t) { t = el('div', { id: 'toast' }); document.body.appendChild(t); }
  t.textContent = m; t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = 0; }, ms || 2600);
}
const PANELS = ['#pmp', '#sp', '#rp', '#mp', '#exp'];
/* open one panel (and close the others); a second tap on its button closes it */
function togglePanel(sel, onOpen) {
  const p = $(sel), open = p.hidden;
  PANELS.forEach(q => { if (q !== sel) $(q).hidden = true; });
  p.hidden = !open; if (open && onOpen) onOpen();
}
const closePanels = () => PANELS.forEach(q => { $(q).hidden = true; });
document.addEventListener('pointerdown', e => {          // a tap outside the reader / settings panel closes it
  for (const q of ['#rp', '#mp']) { const p = $(q); if (!p.hidden && !p.contains(e.target) && !e.target.closest('#rd,#mn')) p.hidden = true; }
}, true);
/* no long-press menus (copy / select all…) on buttons, bars or pages */
document.addEventListener('contextmenu', e => { if (!(e.target.closest && e.target.closest('input,textarea,select,.txed'))) e.preventDefault(); });

/* ---------- the open document ---------- */
const DOC = { name: 'document', primary: 0, meta: {} };   // primary = phone id of the main file; meta: id -> {name, mime, size}
let pages = [];           // every page of the open document, in order
let scale = 1.3, base = 1.3, tool = 'scroll', undo = [];
const inGrid = () => document.body.classList.contains('grid');
const A4 = [595, 842];

/* ---------- the phone's PDF tools: jobs with progress (big books, saving, export) ---------- */
const jobs = {};
window.__job = (id, type, d) => {
  const j = jobs[id]; if (!j) return;
  if (type === 'progress') { if (j.prog) j.prog(d); }
  else if (type !== 'done') { if (j.on) j.on(type, d); }
  else { delete jobs[id]; A.keepAwake(false); if (d.ok) j.ok(d); else j.no(new Error(d.err || 'failed')); }
};
const pdfJob = (o, prog, on) => new Promise((ok, no) => { A.keepAwake(true); const id = A.job(JSON.stringify(o)); jobs[id] = { ok, no, prog, on }; });

/* hand a file made here to the phone: export folder, original, copy, or a temporary piece */
function b64(u8, s, e) { let bin = ''; for (let i = s; i < e; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 0x8000, e))); return btoa(bin); }
async function saveBlob(data, mode, name, primary) {
  const blob = data instanceof Blob ? data : new Blob([data]), buf = new Uint8Array(await blob.arrayBuffer());
  if (!A.saveBegin()) throw new Error('cannot start writing');
  const STEP = 3 * 262144;                       // a multiple of 3 bytes: every piece is valid base64 on its own
  for (let i = 0; i < buf.length; i += STEP) if (!A.saveChunk(b64(buf, i, Math.min(i + STEP, buf.length)))) throw new Error('write failed');
  const r = JP(A.saveEnd(mode, name, primary || 0), { ok: false });
  if (!r.ok) throw new Error(r.err || 'save failed');
  return r;
}
const saveExport = async (data, filename) => { const r = await saveBlob(data, 'export', filename, 0); return r.where; };
