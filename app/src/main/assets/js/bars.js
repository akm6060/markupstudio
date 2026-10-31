/* bars.js — the toolbar and the slim bars above it:
   ⚙ pens and text: P|T, 4 colour dots (tap the chosen dot again or long-press a dot: colour mixer), size, opacity
   long-press ⌫ eraser: whole stroke / area only, size;   ☀ picture: brightness, contrast, colour */

const SHADES = [['#e11d48', '#dc2626', '#f97316', '#be123c', '#fb7185', '#831843'], ['#facc15', '#fde047', '#f59e0b', '#eab308', '#fb923c', '#a3e635'],
  ['#16a34a', '#22c55e', '#84cc16', '#15803d', '#14b8a6', '#065f46'], ['#111827', '#2563eb', '#7c3aed', '#0ea5e9', '#6b7280', '#92400e']];
let dots = ls('ms.dots', null); if (!Array.isArray(dots) || dots.length !== 4) dots = SHADES.map(o => o[0]);
let penTool = 'pen', target = 'p';               // the last pen-type tool; the ⚙ bar works on pens (p) or text (t)
const sbar = $('#sbar'), ebar = $('#ebar'), ibar = $('#ibar'), sdots = $('#sdots');
const cm = el('div', { id: 'cm', hidden: true }); document.body.appendChild(cm);
const penT = () => PEN[tool] ? tool : penTool;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
function showOnly(bar) { [sbar, ebar, ibar].forEach(b => { if (b !== bar) b.hidden = true; }); cm.hidden = true; updBars(); applyPic(); }

/* ---------- tools ---------- */
function setTool(t) {
  if (t === 'scroll') txClose();               // text stays open with pens, highlighter and eraser; ✋ finishes it
  if (t === 'erase' && tool !== 'erase') erPrev = tool; else if (t !== 'erase') erPrev = null;
  tool = t; if (PEN[t]) penTool = t;
  if (!sbar.hidden) target = t === 'text' ? 't' : PEN[t] ? 'p' : target;
  [...$('#tools').children].forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.body.className = document.body.className.replace(/\bt-\w+/g, '').trim() + ' t-' + t;
  pages.forEach(p => p.cancel && p.cancel());
  updBars(); markTextButton();
}
function markTextButton() { $('#ttx').classList.toggle('txon', !!ED && tool !== 'text'); }
/* a long press on a button: fn() runs, and the click that follows is ignored */
function longPress(b, fn) {
  let t = 0; b._lp = false;
  b.addEventListener('pointerdown', () => { b._lp = false; clearTimeout(t); t = setTimeout(() => { b._lp = true; fn(); }, 480); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => b.addEventListener(n, () => clearTimeout(t)));
}
$('#tools').onclick = e => {
  const b = e.target.closest('button'); if (!b || b.id === 'ttx') return;
  if (b._lp) { b._lp = false; return; }
  setTool(b.dataset.t);
};
/* T: once = a text box with the keyboard; again = done. Long-press T = ⚙ bar set to text */
const tb = $('#ttx');
longPress(tb, () => { if (tool !== 'text') setTool('text'); openSettings('t'); });
tb.addEventListener('click', e => {
  e.stopPropagation(); tb.blur(); if (tb._lp) { tb._lp = false; return; }
  if (tool === 'text') { setTool('scroll'); return; }
  setTool('text'); if (ED) ED.ta.focus(); else txStart();
});
/* tapping the bars never takes the cursor out of a text box (the keyboard stays) */
[$('#bar'), sbar, ebar, cm].forEach(b => b.addEventListener('pointerdown', e => { if (ED && !(e.target.closest && e.target.closest('input,select,textarea'))) e.preventDefault(); }));

/* ---------- ⚙ pens and text ---------- */
function updBars() {
  const isT = target === 't', pt = PEN[penT()], col = isT ? TX.c : penColor;
  $('#stp').classList.toggle('on', !isT); $('#stt').classList.toggle('on', isT);
  [...sdots.children].forEach((b, i) => { b.style.background = dots[i]; b.classList.toggle('on', same(dots[i], col)); });
  $('#ssl').textContent = isT ? 'Size' : 'Width'; $('#ssv').textContent = isT ? TX.sz : pt.w;
  $('#sov').textContent = Math.round((isT ? TX.a : pt.a) * 100) + '%';
  $('#cfg').classList.toggle('on', !sbar.hidden);
  $('#ems').classList.toggle('on', ER.mode === 'stroke'); $('#ema').classList.toggle('on', ER.mode === 'area'); $('#ewv').textContent = ER.w;
}
function openSettings(t) { showOnly(sbar); sbar.hidden = false; target = t || ((tool === 'text' || ED) ? 't' : 'p'); updBars(); }
$('#cfg').onclick = () => { if (sbar.hidden) openSettings(); else { sbar.hidden = true; cm.hidden = true; updBars(); } };
$('#stp').onclick = () => { target = 'p'; updBars(); };
$('#stt').onclick = () => { target = 't'; updBars(); };
function setColor(c) { if (target === 't') { TX.c = c; txApply('c'); } else { penColor = c; savePens(); } updBars(); }
function sizeStep(d) {
  if (target === 't') { TX.sz = clamp(TX.sz + d * (TX.sz + d >= 20 ? 2 : 1), 4, 50); txApply('sz'); }
  else { const pt = PEN[penT()]; pt.w = clamp(pt.w + d * (pt.w + d < 6 ? 1 : 2), 1, 40); savePens(); }
  updBars();
}
function opacityStep(d) {
  if (target === 't') { TX.a = clamp(Math.round((TX.a + d * .1) * 10) / 10, .1, 1); txApply('a'); }
  else { const pt = PEN[penT()]; pt.a = clamp(Math.round((pt.a + d * .1) * 10) / 10, .1, 1); savePens(); }
  updBars();
}
$('#ssm').onclick = () => sizeStep(-1); $('#ssp').onclick = () => sizeStep(1);
$('#som').onclick = () => opacityStep(-1); $('#sop').onclick = () => opacityStep(1);
dots.forEach((c, i) => {
  const b = el('button', { className: 'sw' }); b.setAttribute('aria-label', 'Colour ' + (i + 1));
  longPress(b, () => { setColor(dots[i]); mixer(i); });
  b.onclick = () => {
    if (b._lp) { b._lp = false; return; }
    if (same(dots[i], target === 't' ? TX.c : penColor)) { if (cm.hidden) mixer(i); else cm.hidden = true; }
    else { cm.hidden = true; setColor(dots[i]); }
  };
  sdots.appendChild(b);
});
document.addEventListener('pointerdown', e => { if (!cm.contains(e.target) && !sdots.contains(e.target)) cm.hidden = true; });

/* colour mixer for one dot: shades, then Hue / Strength / Light */
const hex2hsl = h => {
  const f = String(h).replace('#', ''); const r = parseInt(f.slice(0, 2), 16) / 255, g = parseInt(f.slice(2, 4), 16) / 255, b = parseInt(f.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let hh = 0, ss = 0;
  if (mx !== mn) { const d = mx - mn; ss = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); hh = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; }
  return [Math.round(hh), Math.round(ss * 100), Math.round(l * 100)];
};
const hsl2hex = (h, s, l) => { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map(x => ('0' + Math.round(x * 255).toString(16)).slice(-2)).join(''); };
function mixer(i) {
  cm.innerHTML = ''; let hsl = hex2hsl(/^#[0-9a-f]{6}$/i.test(dots[i]) ? dots[i] : '#000000');
  const top = el('div', { className: 'cmr' });
  SHADES[i].concat(['#000000', '#ffffff']).forEach(c => { const x = el('button', { className: 'sw' }); x.style.background = c; x.onclick = () => pick(c, true); top.appendChild(x); });
  cm.appendChild(top);
  const pv = el('div', { className: 'cmpv' });
  const slider = (name, max, bg, idx) => {
    const row = el('div', { className: 'cms' }, '<span>' + name + '</span><div class="trk"><i></i></div>'), trk = row.querySelector('.trk'), knob = row.querySelector('i');
    row.show = () => { knob.style.left = (hsl[idx] / max * 100) + '%'; trk.style.background = bg(); };
    const at = e => { const r = trk.getBoundingClientRect(); hsl[idx] = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * max); pick(hsl2hex(...hsl), false); };
    trk.addEventListener('pointerdown', e => { e.preventDefault(); trk.setPointerCapture(e.pointerId); at(e); });
    trk.addEventListener('pointermove', e => { if (trk.hasPointerCapture(e.pointerId)) at(e); });
    cm.appendChild(row); return row;
  };
  const rows = [
    slider('Hue', 360, () => 'linear-gradient(90deg,' + [0, 60, 120, 180, 240, 300, 360].map(h => hsl2hex(h, Math.max(hsl[1], 40), clamp(hsl[2], 30, 70))).join(',') + ')', 0),
    slider('Strength', 100, () => 'linear-gradient(90deg,' + hsl2hex(hsl[0], 0, hsl[2]) + ',' + hsl2hex(hsl[0], 100, hsl[2]) + ')', 1),
    slider('Light', 100, () => 'linear-gradient(90deg,#000,' + hsl2hex(hsl[0], hsl[1], 50) + ',#fff)', 2)];
  cm.appendChild(pv);
  function pick(c, fromShade) { dots[i] = c; lset('ms.dots', dots); setColor(c); if (fromShade) hsl = hex2hsl(c); pv.style.background = c; rows.forEach(r => r.show()); }
  pv.style.background = dots[i]; rows.forEach(r => r.show()); cm.hidden = false;
}

/* ---------- ⌫ eraser bar (long press) ---------- */
const eb = document.querySelector('[data-t=erase]');
longPress(eb, () => { const open = ebar.hidden; showOnly(ebar); ebar.hidden = !open; if (open) setTool('erase'); updBars(); });
const saveER = () => { lset('ms.er', ER); updBars(); };
$('#ems').onclick = () => { ER.mode = 'stroke'; saveER(); };
$('#ema').onclick = () => { ER.mode = 'area'; saveER(); };
$('#ewm').onclick = () => { ER.w = clamp(ER.w - (ER.w > 24 ? 8 : 4), 6, 96); saveER(); };
$('#ewp').onclick = () => { ER.w = clamp(ER.w + (ER.w >= 24 ? 8 : 4), 6, 96); saveER(); };

/* ---------- ☀ picture: brightness, contrast and colour of the pages (faint old books) ---------- */
const PIC = Object.assign({ b: 100, c: 100, s: 100 }, ls('ms.pic', {}));
function applyPic() {
  const none = PIC.b === 100 && PIC.c === 100 && PIC.s === 100;
  document.body.style.setProperty('--pf', none ? 'none' : `brightness(${PIC.b / 100}) contrast(${PIC.c / 100}) saturate(${PIC.s / 100})`);
  $('#ibv').textContent = PIC.b + '%'; $('#icv').textContent = PIC.c + '%'; $('#isv').textContent = PIC.s + '%';
  $('#pic').classList.toggle('on', !ibar.hidden || !none); lset('ms.pic', PIC);
}
const picStep = (k, d, lo, hi) => { PIC[k] = clamp(PIC[k] + d, lo, hi); applyPic(); };
$('#ibm').onclick = () => picStep('b', -10, 30, 200); $('#ibp').onclick = () => picStep('b', 10, 30, 200);
$('#icm').onclick = () => picStep('c', -10, 50, 300); $('#icp').onclick = () => picStep('c', 10, 50, 300);
$('#ism').onclick = () => picStep('s', -10, 0, 300); $('#isp').onclick = () => picStep('s', 10, 0, 300);
[['#ibr', 'b'], ['#icr', 'c'], ['#isr', 's']].forEach(([q, k]) => { $(q).onclick = () => { PIC[k] = 100; applyPic(); }; });   // tap a number: back to 100%
$('#pic').onclick = () => { const open = ibar.hidden; showOnly(ibar); ibar.hidden = !open; applyPic(); };

/* ---------- the keyboard: bars move up to sit just above it ---------- */
let kbPx = 0, hMax = window.innerHeight, wPrev = window.innerWidth;
function kbApply() {
  if (window.innerWidth !== wPrev) { wPrev = window.innerWidth; hMax = window.innerHeight; } else hMax = Math.max(hMax, window.innerHeight);
  const vv = window.visualViewport, vvKb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  const need = Math.max(kbPx - Math.max(0, hMax - window.innerHeight), vvKb > 80 ? vvKb : 0, 0);
  document.body.style.setProperty('--kb', need + 'px'); document.body.classList.toggle('kbon', need > 0);
}
window.__kb = h => { kbPx = Math.max(0, +h || 0); kbApply(); };     // the phone reports how much of the screen the keyboard covers
window.addEventListener('resize', kbApply);
if (window.visualViewport) window.visualViewport.addEventListener('resize', kbApply);
