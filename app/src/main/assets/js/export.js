/* export.js — current / selected / all / a range of pages as PDF, pictures, Word, PowerPoint, HTML or text.
   File size 100% … 10% (pictures inside the PDF are compressed, text stays sharp); speed modes; several parts.
   Big books go through the phone's own PDF tools (they use storage instead of memory). */

let epct = 100, eparts = 10;
const SPD = { instant: { tries: 1, cap: 4e6, off: 0 }, quickest: { tries: 2, cap: 6e6, off: 0 }, quick: { tries: 3, cap: 1e7, off: -1 }, normal: { tries: 12, cap: 16e6, off: -2 } };
$('#espd').value = SPD[ls('ms.espd', 'quick')] ? ls('ms.espd', 'quick') : 'quick';
$('#espd').onchange = () => lset('ms.espd', $('#espd').value);
const speed = () => SPD[$('#espd').value] || SPD.quick;
const JSBIG = MEM.low ? 60e6 : 120e6;
const origOf = l => l.reduce((a, p) => a + (p.osize || 0), 0);
const nativeBig = l => !!(l.length && l.every(p => p.kind === 'pdf' && p.nid && p.nid === l[0].nid) && (BOOK || origOf(l) > JSBIG || l.length > 400));
const filePn = p => p.opn || p.pn;
const marksOf = l => { const m = {}; for (const p of l) if (p.strokes.length) m[filePn(p)] = wire(p.strokes); return m; };
const partsOn = () => $('#emode').value === 'n' && $('#efmt').value === 'pdf';

function exportList() {
  const sc = $('#escope').value;
  if (sc === 'range') { let a = (+$('#efrom').value || 1) - 1, b = (+$('#eto').value || pages.length) - 1; if (a > b) [a, b] = [b, a]; return pages.slice(Math.max(0, a), Math.min(pages.length, b + 1)); }
  if (sc === 'all') return pages.slice();
  if (sc === 'sel') return pages.filter(p => p.sel);
  return [inGrid() ? (pages.find(p => p.sel) || pages[0]) : curPage()].filter(Boolean);
}
function updExport() {
  const fmt = $('#efmt').value, o = origOf(exportList()); $('#esz').textContent = epct + '%';
  if (/^ocr/.test(fmt)) {
    $('#erng').style.display = $('#escope').value === 'range' ? '' : 'none';
    ['#espr', '#eparts', '#eszrow'].forEach(q => { $(q).style.display = 'none'; });
    $('#eszi').textContent = fmt === 'ocrs' ? 'Every page stays exactly as it is; the words are added invisibly on top, so you can search, select, copy and read aloud. Hindi + English, offline.'
      : 'Every page is typed again on clean paper: same places, lines, columns and sizes; the pictures are cut from the scan and put back. Hindi + English, offline. Check it — recognition can make mistakes.';
    return;
  }
  $('#espr').style.display = fmt === 'txt' || epct >= 100 ? 'none' : '';
  $('#erng').style.display = $('#escope').value === 'range' ? '' : 'none';
  $('#eparts').style.display = fmt === 'pdf' ? '' : 'none'; $('#epn').textContent = eparts;
  ['#epm', '#epp', '#epn'].forEach(q => { $(q).style.display = partsOn() ? '' : 'none'; });
  $('#eszrow').style.display = fmt === 'txt' ? 'none' : '';
  $('#eszi').textContent = fmt === 'txt' ? '' : epct >= 100
    ? (fmt === 'pdf' ? 'Original quality' + (o ? ' · about ' + fmtB(o) : '') + ' · text stays selectable' : 'Full quality')
    : (o ? 'Original ' + fmtB(o) + ' → about ' + fmtB(o * epct / 100) : 'Smaller file, lower picture quality');
}
function openExport(scope) {
  if (!pages.length) return;
  if (!$('#efrom').value) $('#efrom').value = 1; if (!$('#eto').value) $('#eto').value = pages.length;
  $('#efrom').max = $('#eto').max = pages.length;
  const sel = pages.some(p => p.sel); $('#escope').querySelector('[value=sel]').disabled = !sel;
  $('#escope').value = scope || (inGrid() && sel ? 'sel' : 'all');
  $('#est').textContent = ''; $('#ego').disabled = false;
  togglePanel('#exp'); $('#exp').hidden = false; updExport();
}
$('#exbtn').onclick = () => openExport();
$('#ex').onclick = () => { $('#exp').hidden = true; };
['#efmt', '#escope', '#emode', '#efrom', '#eto'].forEach(q => { $(q).onchange = updExport; });
$('#esm').onclick = () => { epct = Math.max(10, epct - 10); updExport(); };
$('#esp').onclick = () => { epct = Math.min(100, epct + 10); updExport(); };
$('#epm').onclick = () => { eparts = Math.max(2, eparts - 1); updExport(); };
$('#epp').onclick = () => { eparts = Math.min(50, eparts + 1); updExport(); };

/* ---------- Word and PowerPoint: one picture per page ---------- */
async function mkDocx(J) {
  await lib(LIB.jszip); const z = new JSZip(), W = J[0].w, H = J[0].h, E = 12700, R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  let body = '', rels = '';
  J.forEach((j, i) => {
    const n = i + 1, f = Math.min(W / j.w, H / j.h) * .97, cx = Math.round(j.w * f * E), cy = Math.round(j.h * f * E);
    z.file(`word/media/p${n}.jpg`, j.b);
    rels += `<Relationship Id="rI${n}" Type="${R}/image" Target="media/p${n}.jpg"/>`;
    body += `<w:p><w:pPr>${i ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Page ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="p${n}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rI${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  });
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  z.file('[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/_rels/document.xml.rels', X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
  z.file('word/document.xml', X + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="${Math.round(W * 20)}" w:h="${Math.round(H * 20)}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'blob' });
}
async function mkPptx(J) {
  await lib(LIB.pptx); const P = new PptxGenJS(), W = J[0].w / 72, H = J[0].h / 72; P.defineLayout({ name: 'PG', width: W, height: H }); P.layout = 'PG';
  for (const j of J) { const s = P.addSlide(), f = Math.min(W / (j.w / 72), H / (j.h / 72)), w = j.w / 72 * f, h = j.h / 72 * f; s.addImage({ data: (await b2u(j.b)).slice(5), x: (W - w) / 2, y: (H - h) / 2, w, h }); }
  return P.write({ outputType: 'blob' });
}
async function textOf(p) {
  if (p.kind === 'txt') return p.lines.join('\n');
  if (p.kind === 'pdf') { try { await ensure(p); } catch (e) { return '(this page could not be read)'; } const tc = await p.page.getTextContent(); return RC.fixItems(tc.items).map(i => i.str + (i.hasEOL ? '\n' : '')).join(''); }
  return '(no text on this page)';
}

/* ---------- making files smaller ---------- */
/* render a page and encode it at the best quality that fits the byte budget */
async function encodeFit(p, budget, mime, S, E) {
  E = E || SPD.normal;
  if (!S.k) { S.k = clamp(Math.sqrt(budget / .22 / (p.w * p.h)), .45, 2.5); S.q = .8; }
  let k = S.k, q = S.q, c = null, ck = 0, b = null;
  for (let t = 0; t < Math.max(1, E.tries); t++) {
    if (!c || ck !== k) { c = await pageCanvas(p, k); ck = k; }
    b = await blobOf(c, mime, q);
    if (b.size <= budget || (k <= .45 && q <= .35)) break;
    const r = budget / b.size;
    if (mime !== 'image/png' && q > .5 && r > .5) q = Math.max(.35, q - .12); else k = Math.max(.45, k * Math.max(.5, Math.sqrt(r) * .95));
  }
  if (b.size < budget * .6) { S.k = Math.min(2.5, k * 1.2); S.q = Math.min(.9, q + .05); }
  else if (b.size > budget) { S.k = Math.max(.45, k * Math.sqrt(budget / b.size)); S.q = q; }
  else { S.k = k; S.q = q; }
  return b;
}
const img2u8 = async b => new Uint8Array(await b.arrayBuffer());
function loadImg(blob) { return new Promise((ok, no) => { const u = URL.createObjectURL(blob), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => { URL.revokeObjectURL(u); no(new Error('img')); }; i.src = u; }); }
/* shrink the pictures inside the PDF; text and drawings stay sharp and selectable */
async function shrinkImages(doc, estSize, target, st, E) {
  E = E || SPD.normal;
  const L = PDFLib, N = n => L.PDFName.of(n), ctx = doc.context, imgs = []; let tot = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof L.PDFRawStream)) continue; const d = obj.dict;
    if (d.get(N('Subtype')) !== N('Image') || d.get(N('ImageMask')) || d.get(N('Decode'))) continue;
    const f = d.lookup(N('Filter')); let jpg = null, raw = null;
    if (f === N('DCTDecode')) jpg = obj.contents;
    else if (f instanceof L.PDFArray && f.size() >= 1 && f.lookup(f.size() - 1) === N('DCTDecode')) {
      const pre = []; for (let i = 0; i < f.size() - 1; i++) pre.push(f.lookup(i));
      if (pre.every(x => ['ASCII85Decode', 'ASCIIHexDecode', 'FlateDecode', 'LZWDecode', 'RunLengthDecode'].some(n => x === N(n)))) {
        try { const dd = d.clone(ctx); if (pre.length) dd.set(N('Filter'), ctx.obj(pre)); else dd.delete(N('Filter')); dd.delete(N('DecodeParms')); jpg = pre.length ? L.decodePDFRawStream(L.PDFRawStream.of(dd, obj.contents)).decode() : obj.contents; } catch (e) { jpg = null; }
      }
    }
    if (!jpg) {                                // zip-compressed pictures: unpack the pixels (only simple 8-bit RGB or grey ones)
      const flate = !f || f === N('FlateDecode') || (f instanceof L.PDFArray && f.size() === 1 && f.lookup(0) === N('FlateDecode'));
      const dp = d.lookup(N('DecodeParms')), pred = dp && dp.lookup && dp.lookup(N('Predictor'));
      if (flate && !(pred && pred.asNumber && pred.asNumber() > 1)) { const w = d.lookup(N('Width')), h = d.lookup(N('Height')); raw = { w: w && w.asNumber(), h: h && h.asNumber() }; if (!raw.w || !raw.h || raw.w * raw.h > 2.5e7) raw = null; }
    }
    if (!raw && (!jpg || jpg[0] !== 0xFF || jpg[1] !== 0xD8)) continue;
    const bpc = d.lookup(N('BitsPerComponent')); if (bpc && bpc.asNumber && bpc.asNumber() !== 8) continue;
    const cs = d.lookup(N('ColorSpace')); let okc = cs === N('DeviceRGB') || cs === N('DeviceGray'), iccN = 0;
    if (!okc && cs instanceof L.PDFArray && cs.lookup(0) === N('ICCBased')) { try { iccN = cs.lookup(1).dict.lookup(N('N')).asNumber(); okc = iccN === 1 || iccN === 3; } catch (e) {} }
    if (!okc || obj.contents.length < 12000) continue;
    if (raw) raw.comps = cs === N('DeviceGray') || iccN === 1 ? 1 : 3;
    imgs.push({ ref, obj, jpg, raw }); tot += obj.contents.length;
  }
  if (!imgs.length) return false;
  let budget = target - Math.max(0, estSize - tot); if (budget < tot * .03) return false;
  const LAD = [[1, .92], [1, .85], [1, .75], [1, .65], [.85, .6], [.72, .55], [.6, .5], [.5, .45], [.4, .42], [.32, .4], [.25, .38], [.2, .36]];
  let left = tot, changed = false;
  for (let i = 0; i < imgs.length; i++) {
    const { ref, obj, jpg, raw } = imgs[i], n = obj.contents.length, r = Math.min(1, budget / left), want = n * r; left -= n;
    st(`Compressing pictures ${i + 1} of ${imgs.length}…`);
    if (r >= .97) { budget -= n; continue; }
    let im;
    if (raw) {
      try {
        const px = obj.dict.get(N('Filter')) ? L.decodePDFRawStream(obj).decode() : obj.contents; if (px.length < raw.w * raw.h * raw.comps) throw 0;
        const c = el('canvas'); c.width = raw.w; c.height = raw.h; const x = c.getContext('2d'), id = x.createImageData(raw.w, raw.h), o = id.data;
        for (let q = 0, j = 0, e = raw.w * raw.h; q < e; q++, j += 4) { if (raw.comps === 1) o[j] = o[j + 1] = o[j + 2] = px[q]; else { o[j] = px[q * 3]; o[j + 1] = px[q * 3 + 1]; o[j + 2] = px[q * 3 + 2]; } o[j + 3] = 255; }
        x.putImageData(id, 0, 0); im = { naturalWidth: raw.w, naturalHeight: raw.h, _c: c };
      } catch (e) { budget -= n; continue; }
    } else { try { im = await loadImg(new Blob([jpg], { type: 'image/jpeg' })); } catch (e) { budget -= n; continue; } }
    const w0 = im.naturalWidth, h0 = im.naturalHeight, cap = Math.min(1, Math.sqrt(E.cap / (w0 * h0)));
    let li = Math.max(0, (r >= .7 ? 1 : r >= .5 ? 2 : r >= .35 ? 3 : r >= .25 ? 4 : r >= .18 ? 5 : r >= .12 ? 6 : r >= .08 ? 7 : 8) + E.off), best = null, bw = 0, bh = 0, tries = 0;
    for (; li < LAD.length; li++) {
      const [sc, q] = LAD[li], w = Math.max(8, Math.round(w0 * sc * cap)), h = Math.max(8, Math.round(h0 * sc * cap)), c = el('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im._c || im, 0, 0, w, h);
      const b = await blobOf(c, 'image/jpeg', q); c.width = c.height = 1; tries++;
      if (!best || b.size < best.size) { best = b; bw = w; bh = h; }
      if (b.size <= want || tries >= E.tries) break;
    }
    if (!best || best.size >= n) { budget -= n; continue; }
    const dict = { Type: 'XObject', Subtype: 'Image', Width: bw, Height: bh, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' }, sm = obj.dict.get(N('SMask')); if (sm) dict.SMask = sm;
    ctx.assign(ref, ctx.stream(await img2u8(best), dict)); budget -= best.size; changed = true; if (im._c) im._c.width = im._c.height = 0;
  }
  return changed;
}
/* every page as a picture: only when the size cannot be reached otherwise */
async function rasterPdf(list, target, st, E) {
  const d = await PDFLib.PDFDocument.create(), S = {}; let used = 0, bad = 0;
  for (let i = 0; i < list.length; i++) {
    st(`Compressing page ${i + 1} of ${list.length}…`);
    const rem = list.length - i, bud = Math.max(5000, (target - used - 1200 * rem) / rem), p = list[i]; let b = null;
    try { b = await encodeFit(p, bud, 'image/jpeg', S, E); } catch (e) { b = null; }
    if (!b) { d.addPage([p.w || 595, p.h || 842]); bad++; continue; }
    used += b.size + 1200; const im = await d.embedJpg(await img2u8(b)); d.addPage([p.w, p.h]).drawImage(im, { x: 0, y: 0, width: p.w, height: p.h });
  }
  const out = await d.save({ useObjectStreams: true }); out.__bad = bad; return out;
}
async function exportPdf(list, pct, st, E) {
  await lib(LIB.pdflib); st('Reading the document…');
  const raster = async p => img2u8(await blobOf(await pageCanvas(p, 2), 'image/jpeg', .9)), orig = origOf(list);
  return withBytes(list, async () => {
    st('Building PDF…'); const doc = await MarkupSaver.buildDoc(PDFLib, list, raster, refOf); let bad = doc.__bad || 0;
    if (pct >= 100 || !orig) return { data: await doc.save({ useObjectStreams: true }), how: '', bad };
    const target = orig * pct / 100; let how = '';
    if (await shrinkImages(doc, orig, target, st, E)) how = 'pictures compressed, text kept';
    st('Saving…'); let best = await doc.save({ useObjectStreams: true });
    if (best.length > target * 1.1) { try { const r = await rasterPdf(list, target, st, E); if (r.length < best.length) { best = r; bad = r.__bad || 0; how = 'pages turned into pictures to reach this size'; } } catch (e) {} }
    return { data: best, how, bad };
  });
}
/* several parts from a normal-size document */
async function exportPartsJs(list, pct, say, E, n) {
  n = Math.min(n, list.length); const t0 = performance.now(), out = []; let bad = 0;
  for (let k = 0; k < n; k++) {
    const ch = list.slice(Math.floor(list.length * k / n), Math.floor(list.length * (k + 1) / n));
    const r = await exportPdf(ch, pct, t => say(`Part ${k + 1} of ${n}: ${t}`), E); bad += r.bad || 0;
    const name = `${DOC.name}-part${String(k + 1).padStart(2, '0')}-of-${String(n).padStart(2, '0')}.pdf`; await saveExport(r.data, name); out.push(name);
  }
  say(`Saved ✓ ${n} parts (${out[0]} …) · ${((performance.now() - t0) / 1000).toFixed(0)} s` + (bad ? ` · ${bad} damaged page(s) left blank` : ''));
}
/* a big book: the phone cuts it into pieces; each piece is compressed here if asked; pieces are joined again for one file */
async function exportBig(list, pct, say, E, n) {
  const t0 = performance.now(), nid = list[0].nid, pn = list.map(filePn), marks = marksOf(list), name = DOC.name + (pct < 100 ? '-' + pct + 'pc' : '-marked');
  const prog = pre => x => say(pre + (x.msg || '')), secs = () => ((performance.now() - t0) / 1000).toFixed(0) + ' s';
  if (pct >= 100) {
    const r = await pdfJob({ op: 'export', src: nid, pages: pn, marks, parts: n, name }, prog(''));
    say(`Saved ✓ ${r.files.length > 1 ? r.files.length + ' parts in ' + r.files[0].replace(/[^/]*$/, '') : r.files[0]} · ${secs()}` + (r.bad ? ` · ${r.bad} damaged page(s) left blank` : ''));
    return;
  }
  await lib(LIB.pdflib);
  const avg = Math.max(1, origOf(list) / list.length), per = n > 1 ? Math.ceil(list.length / n) : Math.max(10, Math.floor((MEM.low ? 25e6 : 45e6) / avg));
  const chunks = []; for (let a = 0; a < list.length; a += per) chunks.push(pn.slice(a, a + per));
  const temps = []; let before = 0, after = 0;
  try {
    for (let k = 0; k < chunks.length; k++) {
      const tag = `Piece ${k + 1} of ${chunks.length}: `, ch = chunks[k], mk = {}; for (const x of ch) if (marks[x]) mk[x] = marks[x];
      const r = await pdfJob({ op: 'export', src: nid, pages: ch, marks: mk, parts: 1, dest: 'temp', name: 'piece' }, prog(tag));
      const path = r.files[0], id = A.registerFile(path); let bytes = new Uint8Array(await (await fetchOk('/__file/' + id)).arrayBuffer()); A.deleteTemp(path);
      before += bytes.length; say(tag + 'compressing…');
      const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }), size0 = bytes.length; bytes = null;
      await shrinkImages(doc, size0, size0 * pct / 100, t => say(tag + t), E);
      const outb = await doc.save({ useObjectStreams: true }); after += outb.length;
      if (n > 1) await saveExport(outb, `${name}-part${String(k + 1).padStart(2, '0')}-of-${String(chunks.length).padStart(2, '0')}.pdf`);
      else temps.push((await saveBlob(new Blob([outb], { type: 'application/pdf' }), 'temp', 'piece.pdf', 0)).where);
      await sleep(30);
    }
    if (n <= 1) { say('Joining the pieces into one file…'); const r = await pdfJob({ op: 'merge', files: temps, name, deleteSources: true }, prog('Joining: ')); temps.length = 0; say(`Saved ✓ ${r.files[0]} · ${fmtB(after)} (from ${fmtB(before)}) · ${secs()}`); }
    else say(`Saved ✓ ${chunks.length} parts · ${fmtB(after)} (from ${fmtB(before)}) · ${secs()}`);
  } finally { for (const t of temps) try { A.deleteTemp(t); } catch (e) {} }
}

/* ---------- Export ---------- */
$('#ego').onclick = async () => {
  const st = $('#est'), fmt = $('#efmt').value, pct = epct, say = t => { st.textContent = t; }, list = exportList();
  if (CONV.on) { CONV.stop = true; return; }
  if (/^ocr/.test(fmt)) { if (!list.length) return; try { await convertScanned(list, fmt === 'ocrt', say); } catch (e) { say('Could not make the book: ' + ((e && e.message) || 'unknown error')); } return; }
  if (!list.length) return; $('#ego').disabled = true;
  const done = () => { $('#ego').disabled = false; }, fail = e => say('Export failed: ' + ((e && (e.message || e.code)) || 'unknown error'));
  if (fmt === 'pdf' && nativeBig(list)) { try { await exportBig(list, pct, say, speed(), partsOn() ? eparts : 1); } catch (e) { fail(e); } done(); return; }
  if (fmt !== 'pdf' && list.length > 300) { say('For more than 300 pages please choose PDF, or export a smaller page range.'); done(); return; }
  if (fmt === 'pdf' && partsOn()) { try { await exportPartsJs(list, pct, say, speed(), eparts); } catch (e) { fail(e); } done(); return; }
  const nm = i => `${DOC.name}-p${pageNo(list[i])}`, prog = i => say(`Preparing page ${i + 1} of ${list.length}…`), orig = origOf(list), target = orig * pct / 100, small = pct < 100 && orig > 0;
  const IM = { png: ['image/png', 'png'], jpg: ['image/jpeg', 'jpg'], webp: ['image/webp', 'webp'] }, S = {}, E = speed(), t0 = performance.now();
  const pageBlob = async (i, mime, q) => small ? encodeFit(list[i], Math.max(4000, target / list.length), mime, S, E) : blobOf(await pageCanvas(list[i], 2), mime, q);
  try {
    let out, name, how = '', bad = 0;
    if (IM[fmt]) {
      const [m, ex] = IM[fmt]; let zip = null; if (list.length > 1) { await lib(LIB.jszip); zip = new JSZip(); }
      for (let i = 0; i < list.length; i++) { prog(i); let b; try { b = await pageBlob(i, m, .92); } catch (e) { bad++; continue; } if (zip) zip.file(nm(i) + '.' + ex, b); else { out = b; name = nm(0) + '.' + ex; } }
      if (!zip && !out) throw new Error('this page could not be read');
      if (zip) { out = await zip.generateAsync({ type: 'blob' }); name = DOC.name + '-pages.zip'; }
    } else if (fmt === 'txt') {
      const T = []; for (let i = 0; i < list.length; i++) { prog(i); T.push('--- Page ' + pageNo(list[i]) + ' ---\n' + await textOf(list[i])); }
      out = T.join('\n\n'); name = DOC.name + '.txt';
    } else if (fmt === 'pdf') {
      const r = await exportPdf(list, pct, say, E); out = r.data; how = r.how; bad = r.bad || 0; name = DOC.name + (pct < 100 ? '-' + pct + 'pc' : '-marked') + '.pdf';
    } else {
      const J = []; for (let i = 0; i < list.length; i++) { prog(i); const p = list[i]; let b; try { b = await pageBlob(i, 'image/jpeg', .9); } catch (e) { bad++; continue; } J.push({ w: p.w, h: p.h, b }); }
      if (!J.length) throw new Error('the pages could not be read');
      say('Building file…');
      if (fmt === 'docx') { out = await mkDocx(J); name = DOC.name + '.docx'; }
      else if (fmt === 'pptx') { out = await mkPptx(J); name = DOC.name + '.pptx'; }
      else { const U = []; for (const j of J) U.push(await b2u(j.b)); out = '<!DOCTYPE html><meta charset="utf-8"><title>' + esc(DOC.name) + '</title><body style="margin:0;background:#888;display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px">' + U.map(u => `<img src="${u}" style="max-width:100%;background:#fff">`).join(''); name = DOC.name + '.html'; }
    }
    const size = out.size != null ? out.size : (out.byteLength || out.length || 0);
    const where = await saveExport(out, name);
    say('Saved ✓ ' + where + (size ? ' · ' + fmtB(size) + (orig ? ' (original ' + fmtB(orig) + ')' : '') : '') + (how ? ' · ' + how : '') + ' · ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s'
      + (bad ? ' · ' + bad + ' damaged page' + (bad > 1 ? 's' : '') + ' could not be read and ' + (bad > 1 ? 'were' : 'was') + ' ' + (fmt === 'pdf' ? 'left blank' : 'left out') : ''));
  } catch (e) { fail(e); }
  done();
};
