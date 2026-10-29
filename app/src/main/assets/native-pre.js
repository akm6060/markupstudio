/* native-pre.js — runs before the viewer script. Bridges "Save/Export" to the Android layer. */
(function () {
  if (!window.Android) return;
  window.NATIVE = true;
  const A = window.Android;
  try {                                            // theme before first paint: white (default), dark, or same as phone
    const t = A.getPref('theme', 'light');
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
  function b64(u8, s, e) {
    let bin = '';
    for (let i = s; i < e; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 0x8000, e)));
    return btoa(bin);
  }
  async function saveBlob(data, mode, name, primary) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (!A.saveBegin()) throw new Error('cannot start writing');
    const STEP = 3 * 262144;                       // multiple of 3 bytes: every chunk is valid base64 on its own
    for (let i = 0; i < buf.length; i += STEP) {
      if (!A.saveChunk(b64(buf, i, Math.min(i + STEP, buf.length)))) throw new Error('write failed');
    }
    const r = JSON.parse(A.saveEnd(mode, name, primary || 0));
    if (!r.ok) throw new Error(r.err || 'save failed');
    return r;
  }
  window.__saveBlob = saveBlob;
  // the viewer's export code asks for the "downloads" capability; here it lands in Download/MarkupStudio
  window.claude = {
    use: async function (n) {
      if (n !== 'downloads') return null;
      return { save: async function (o) {
        const r = await saveBlob(o.data, 'export', o.filename, 0);
        if (window.__toast) window.__toast('Saved: ' + r.where);
        return { status: 'saved' };
      } };
    }
  };
})();
