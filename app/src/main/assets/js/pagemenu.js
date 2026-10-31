/* pagemenu.js — 📄 the page you are on: move, copy, blank page after, delete, export, bookmark, go to page */

const pmp = $('#pmp');
const bmKey = () => { const f = pages.find(p => p.nid); return 'ms.bm.' + (f ? A.entryKey(f.nid) : DOC.name); };
const bmGet = () => ls(bmKey(), []);
const bmSet = l => lset(bmKey(), l);
function pmRefresh() {
  const p = curPage(), i = pages.indexOf(p); $('#pmt').textContent = `Page ${i + 1} of ${pages.length}`;
  const l = bmGet(); $('#pmbm').textContent = l.some(b => b.n === i + 1) ? '🔖 Remove bookmark' : '🔖 Bookmark this page';
  const box = $('#pmbl2'); box.innerHTML = l.length ? '' : '<small>No bookmarks yet.</small>';
  l.sort((a, b) => a.n - b.n).forEach(b => {
    const d = el('div', { className: 'fi' }, `<div class="ic">🔖</div><div class="nm"><div>Page ${b.n}</div>${b.t ? `<div class="mt">${esc(b.t)}</div>` : ''}</div>`);
    d.onclick = () => { pmp.hidden = true; gotoPage(b.n - 1, 0); }; box.appendChild(d);
  });
}
$('#pm').onclick = () => { if (pages.length) togglePanel('#pmp', pmRefresh); };
$('#pmx').onclick = () => { pmp.hidden = true; };
const pmStay = p => { gotoPage(pages.indexOf(p), 0); pmRefresh(); };
$('#pmup').onclick = () => { const p = curPage(); PAGEOPS.move(p, -1); pmStay(p); };
$('#pmdn').onclick = () => { const p = curPage(); PAGEOPS.move(p, 1); pmStay(p); };
$('#pmdup').onclick = () => { PAGEOPS.dup(curPage()); toast('Page copied'); pmRefresh(); };
$('#pmbl').onclick = () => { PAGEOPS.blank(curPage()); toast('Blank page added after this one'); pmRefresh(); };
$('#pmdel').onclick = () => {
  const p = curPage(), i = pages.indexOf(p);
  if (PAGEOPS.del(p)) { toast('Page ' + (i + 1) + ' deleted · ↶ undo brings it back'); gotoPage(Math.min(i, pages.length - 1), 0); }
  pmRefresh();
};
$('#pmexp').onclick = () => { pmp.hidden = true; openExport('cur'); };
$('#pmarr').onclick = () => { pmp.hidden = true; openGrid(); };
$('#pmbm').onclick = async () => {
  const p = curPage(), i = pages.indexOf(p); let l = bmGet();
  if (l.some(b => b.n === i + 1)) l = l.filter(b => b.n !== i + 1);
  else { let t = ''; try { t = (await pageReadable(p)).words.slice(0, 9).map(w => w.w).join(' '); } catch (e) {} l.push({ n: i + 1, t }); }
  bmSet(l); pmRefresh();
};
const onEnter = (q, fn) => $(q).addEventListener('keydown', e => { if (e.key !== 'Enter') return; const n = +e.target.value; e.target.value = ''; e.target.blur(); if (n > 0) fn(n); });
onEnter('#pmmv', n => { const p = curPage(); PAGEOPS.moveTo(p, n - 1); gotoPage(pages.indexOf(p), 0); toast('Page moved to ' + (pages.indexOf(p) + 1)); pmRefresh(); });
onEnter('#pmgo', n => { pmp.hidden = true; gotoPage(n - 1, 0); });
