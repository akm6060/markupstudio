/* settings.js — ⋮ saving (original / copy), folders, big books, theme, full screen, storage access */

const mp = $('#mp');
function refreshSettings() {
  mp.querySelectorAll('input[name=sm]').forEach(r => { r.checked = r.value === pref('saveMode', 'copy'); });
  $('#mfs').checked = pref('fullscreen', '1') !== '0'; $('#mres').checked = pref('resume', '1') !== '0';
  const s = JP(A.storageInfo(), {}), vol = (s.volumes || []).filter(v => !/emulated/.test(v));
  $('#mstore').textContent = (s.allFiles ? 'All-files access: allowed. ' : 'All-files access: not allowed yet. ') + (vol.length ? 'Removable storage found: ' + vol.join(', ') + '. ' : 'No SD card / USB drive detected. ') + ((s.trees || []).length ? 'Folder access granted for ' + s.trees.length + ' location(s).' : '');
  $('#mperm').style.display = s.allFiles ? 'none' : '';
  $('#mth').value = pref('theme', 'light');
  $('#mmem').textContent = (MEM.total ? 'This phone has ' + (MEM.total / 1073741824).toFixed(1) + ' GB memory' + (MEM.low ? ' — low-memory mode is on.' : '.') + ' ' : '') + 'Big books scroll as one book; only the pages around where you read are kept sharp, the rest show small previews.';
  const cd = pref('copyDir', ''), cw = pref('copyWhere', cd ? 'dir' : 'orig');
  $('#mcw').value = cw; $('#mcdr').style.display = cw === 'dir' ? '' : 'none'; $('#mcdv').textContent = cd || 'No folder chosen yet';
  $('#medv').textContent = pref('exportDir', '') || 'Download/MarkupStudio';
}
$('#mn').onclick = () => togglePanel('#mp', refreshSettings);
$('#mpx').onclick = () => { mp.hidden = true; };
mp.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'sm') { setPref('saveMode', t.value); resetSave(); SAVE.pend = true; scheduleSave(300); }
  if (t.id === 'mcw') { setPref('copyWhere', t.value); refreshSettings(); if (t.value === 'dir' && !pref('copyDir', '')) $('#mcd').click(); }
  if (t.id === 'mfs') A.setFullscreen(t.checked);
  if (t.id === 'mres') setPref('resume', t.checked ? '1' : '0');
  if (t.id === 'mth') { A.setTheme(t.value); if (t.value === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t.value); }
});
$('#mcd').onclick = () => { mp.hidden = true; openBrowser('folder', p => { setPref('copyDir', p); if (p) setPref('copyWhere', 'dir'); }, pref('copyDir', '')); };
$('#med').onclick = () => { mp.hidden = true; openBrowser('folder', p => { setPref('exportDir', p); toast(p ? 'Exports will be saved in ' + p : 'Exports will be saved in Download/MarkupStudio'); }, pref('exportDir', '')); };
$('#mbrowse').onclick = () => { mp.hidden = true; openBrowser('open'); };
$('#mmerge').onclick = () => { mp.hidden = true; openBrowser('merge'); };
$('#mperm').onclick = () => A.requestStorage();
$('#mtree').onclick = () => A.grantTree();
window.__nativeEvent = ev => { if (ev === 'storage') { if (!mp.hidden) refreshSettings(); if (!fb.hidden) fbGo(FB.path); } };
