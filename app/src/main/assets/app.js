/* app.js — the viewer: pages, pen / underline / highlighter, zoom, page manager, export */
pdfjsLib.GlobalWorkerOptions.workerSrc='libs/pdf.worker.min.js';
const $=s=>document.querySelector(s);let dpr=Math.min(window.devicePixelRatio||1,2);
/* memory budget: phones with 4 GB or less keep fewer, smaller page pictures */
/* reads that are cancelled when a book is closed are not errors */
window.addEventListener('unhandledrejection',e=>{const m=String(e.reason&&(e.reason.message||e.reason)||'');if(/Failed to fetch|postMessage|aborted|Worker was destroyed|Transport destroyed|Loading aborted/i.test(m))e.preventDefault()});
const MEM=(()=>{let tot=0;try{if(window.Android&&Android.memInfo)tot=JSON.parse(Android.memInfo()).total||0}catch(e){}if(!tot&&navigator.deviceMemory)tot=navigator.deviceMemory*1073741824;const low=!tot||tot<4.6e9;return{low,px:low?3.2e6:5.5e6,keep:low?4:7}})();
window.__MEM=MEM;
let dirty=false;function setDirty(v){dirty=v!==false;window.__dirtyChanged&&window.__dirtyChanged(dirty)}
let pages=[],scale=1.3,base=1.3,zoomed=false,tool='scroll',color='#e11d48',undo=[],lastSel=-1;
const host=$('#pages'),inGrid=()=>document.body.classList.contains('grid');
const SL=[['#e11d48','#dc2626','#f97316','#be123c','#fb7185','#831843'],['#facc15','#fde047','#f59e0b','#eab308','#fb923c','#a3e635'],['#16a34a','#22c55e','#84cc16','#15803d','#14b8a6','#065f46'],['#111827','#2563eb','#7c3aed','#0ea5e9','#6b7280','#92400e']],sws=$('#sws'),chosen=SL.map(o=>o[0]);let act=0;
const cm=document.createElement('div');cm.id='cm';cm.hidden=true;document.body.appendChild(cm);
function selSlot(){color=chosen[act];[...sws.children].forEach((b,i)=>{b.style.background=chosen[i];b.classList.toggle('on',i===act)});updPv()}
SL.forEach((o,i)=>{const b=document.createElement('button');b.className='sw';b.title='Tap again for more shades';b.onclick=()=>{if(act===i){if(cm.hidden){cm.innerHTML='';SL[i].forEach(c=>{const x=document.createElement('button');x.className='sw'+(c===chosen[i]?' on':'');x.style.background=c;x.onclick=()=>{chosen[i]=c;selSlot();cm.hidden=true};cm.appendChild(x)});cm.hidden=false}else cm.hidden=true}else{act=i;cm.hidden=true;selSlot()}};sws.appendChild(b)});
document.addEventListener('pointerdown',e=>{if(!cm.contains(e.target)&&!sws.contains(e.target))cm.hidden=true});
const S={pen:{w:3,a:1},line:{w:3,a:1},hl:{w:14,a:.4}};
function syncS(){const t=S[tool];if(!t)return;$('#w').value=t.w;$('#wv').textContent=t.w;$('#o').value=Math.round(t.a*100);$('#ov').textContent=Math.round(t.a*100)+'%';$('#pn').textContent={pen:'Pen',line:'Underline',hl:'Highlighter'}[tool];$('#sn').style.display=tool==='pen'?'none':'flex';updPv()}
function updPv(){const t=S[tool];if(!t)return;const i=$('#pv i');i.style.height=t.w+'px';i.style.background=color;i.style.opacity=t.a}
$('#w').oninput=e=>{const v=+e.target.value;$('#wv').textContent=v;if(S[tool])S[tool].w=v;updPv()};
$('#o').oninput=e=>{const v=+e.target.value;$('#ov').textContent=v+'%';if(S[tool])S[tool].a=v/100;updPv()};
function setTool(t){tool=t;[...$('#tools').children].forEach(x=>x.classList.toggle('on',x.dataset.t===t));document.body.classList.forEach(c=>{if(c.startsWith('t-'))document.body.classList.remove(c)});document.body.classList.add('t-'+t);syncS();if(!S[t])$('#pop').hidden=true;pages.forEach(p=>p.cancel&&p.cancel())}
window.__setTool=setTool;
$('#tools').onclick=e=>{const b=e.target.closest('button');if(!b)return;const same=tool===b.dataset.t;setTool(b.dataset.t);if(S[tool]&&same)$('#pop').hidden=!$('#pop').hidden};
$('#cfg').onclick=()=>{const had=!!S[tool];if(!had)document.querySelector('[data-t=pen]').click();$('#pop').hidden=had?!$('#pop').hidden:false};
$('#px').onclick=()=>$('#pop').hidden=true;
selSlot();

/* ---------- file ingestion ---------- */
const libs={};const lib=u=>libs[u]||(libs[u]=new Promise((ok,no)=>{const s=document.createElement('script');s.src=u;s.onload=ok;s.onerror=no;document.head.appendChild(s)}));
const A4=[595,842],BIGPDF=12e6;
/* fetch the original file bytes just for saving / exporting, then let them go */
async function withBytes(list,fn){const srcs=new Set();for(const p of list)if(p.src&&!p.bytes)srcs.add(p.src);
 for(const s of srcs)if(!s.bytes){const r=await fetch(s.url,{cache:'no-store'});if(!r.ok)throw new Error('cannot read the file again');s.bytes=new Uint8Array(await r.arrayBuffer())}
 for(const p of list)if(p.src&&!p.bytes)p.bytes=p.src.bytes;
 try{return await fn()}finally{for(const p of pages)if(p.src)p.bytes=null;for(const s of srcs)s.bytes=null}}
window.__withBytes=withBytes;
function textPages(txt,title){const cols=95,per=63,L=[];if(title)L.push('▸ '+title,'');
 for(const raw of txt.replace(/\t/g,'    ').split(/\r?\n/).slice(0,60000)){let l=raw;if(!l.length){L.push('');continue}while(l.length>cols){L.push(l.slice(0,cols));l=l.slice(cols)}L.push(l)}
 const out=[];for(let i=0;i<L.length;i+=per)out.push({kind:'txt',w:A4[0],h:A4[1],lines:L.slice(i,i+per)});
 return out.length?out:[{kind:'txt',w:A4[0],h:A4[1],lines:['(empty)']}]}
async function ingest(f){
 const n=f.name.toLowerCase(),t=f.type||'';
 if(t==='application/pdf'||n.endsWith('.pdf')){
  /* files from the phone: the PDF engine reads big books piece by piece; the whole file is fetched again only to save or export */
  let doc=null,ab=null,src=f._url?{url:f._url,size:f.size||0,bytes:null}:null;
  if(src&&f.size>BIGPDF){try{doc=await pdfjsLib.getDocument({url:f._url,disableAutoFetch:true,disableStream:true,rangeChunkSize:262144}).promise}catch(e){doc=null}}
  if(!doc){ab=new Uint8Array(await f.arrayBuffer());if(src)src.size=ab.length;doc=await pdfjsLib.getDocument({data:src?ab:ab.slice()}).promise;if(src)ab=null}
  const p1=await doc.getPage(1),v=p1.getViewport({scale:1}),sz=ab?ab.length:src.size;
  return Array.from({length:doc.numPages},(_,i)=>({kind:'pdf',doc,bytes:ab,src,pn:i+1,page:i?null:p1,w:v.width,h:v.height,osize:sz/doc.numPages}))}
 if(t.startsWith('image/'))return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const k=Math.min(1,2400/Math.max(im.naturalWidth,im.naturalHeight)),c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*k);c.height=Math.round(im.naturalHeight*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);ok([{kind:'cv',cv:c,w:612,h:Math.round(612*c.height/c.width)}])};im.onerror=no;im.src=r.result};r.onerror=no;r.readAsDataURL(f)});
 if(n.endsWith('.docx')){await lib('libs/mammoth.browser.min.js');const r=await mammoth.extractRawText({arrayBuffer:await f.arrayBuffer()});return textPages(r.value,f.name)}
 if(/\.(xlsx|xls|xlsm|ods)$/.test(n)){await lib('libs/xlsx.full.min.js');const wb=XLSX.read(new Uint8Array(await f.arrayBuffer()),{type:'array'});return wb.SheetNames.flatMap(s=>textPages(XLSX.utils.sheet_to_csv(wb.Sheets[s]),f.name+' · '+s))}
 const txt=await f.text();if(/[\x00-\x08\x0e-\x1f]/.test(txt.slice(0,3000)))throw new Error('binary');
 return textPages(txt,n.endsWith('.txt')?null:f.name)}
async function openFiles(files,replace){
 /* a really big book from the phone: cut once into part files, then only one part is ever in memory */
 const f0=files[0];
 if(files.length===1&&(replace||!pages.length)&&f0._url&&f0._nid&&window.__pdfJob&&/\.pdf$/i.test(f0.name||'')&&f0.size>SPLITMIN&&partSize()>0){
  if(await openSplitBook(f0,window.__wantPage||0)){window.__wantPage=0;return}}
 let all=[],bad=[];for(const f of files){try{const ps=await ingest(f);ps.forEach((p,i)=>{p.nid=f._nid;p.sidx=i+1;p.fname=f.name;if(!p.osize)p.osize=(f.size||0)/ps.length});all.push(...ps)}catch(e){bad.push(f.name)}}
 if(bad.length)alert('Unsupported or unreadable: '+bad.join(', '));
 if(!all.length)return;
 if(replace||BOOK){window.__beforeReplace&&window.__beforeReplace();pages.forEach(rm);pages=[];undo=[];setDirty(false);closeBook()}
 const fresh=!pages.length;if(fresh){docPrimary=all[0].nid||0;docName=(files[0].name||'document').replace(/\.[^.]+$/,'');base=scale=fitW(all[0].w);const zr=savedZoom();zoomed=zr!==1;scale=base*zr;$('#view').scrollTop=0;$('#view').scrollLeft=0;setTool('scroll')}
 const ps=partSize();
 if(fresh&&files.length===1&&all[0].kind==='pdf'&&ps>0&&all.length>ps*1.25){       // big book: show it part by part
  openBook(all,ps,window.__wantPage||0);window.__wantPage=0;window.__docChanged&&window.__docChanged(true,pages);return}
 const added=addPages(all,inGrid()?insIdx():pages.length);
 if(!fresh)setDirty();
 if(inGrid())buildGrid();
 window.__docChanged&&window.__docChanged(fresh,added)}
function insIdx(){let k=-1;pages.forEach((p,i)=>{if(p.sel)k=i});return k<0?pages.length:k+1}
const fitW=w=>Math.max(.3,Math.min(4,($('#view').clientWidth-16)/w));
$('#open2').onclick=()=>$('#file').click();$('#gfile').onclick=()=>$('#file2').click();
$('#file').onchange=e=>{const fs=[...e.target.files];e.target.value='';if(fs.length)openFiles(fs,pages.length?confirm('Replace the current document?\nOK = replace · Cancel = add to the end'):true)};
$('#file2').onchange=e=>{const fs=[...e.target.files];e.target.value='';if(fs.length)openFiles(fs,false)};
['dragover','drop'].forEach(n=>document.addEventListener(n,e=>{e.preventDefault();if(n==='drop'&&e.dataTransfer.files.length)openFiles([...e.dataTransfer.files],false)}));

/* ---------- pages ---------- */
const io=new IntersectionObserver(es=>es.forEach(en=>{const p=en.target._p;if(!p)return;p.vis=en.isIntersecting;if(en.isIntersecting){if(!p.done)render(p)}else if(p.pc&&Math.abs(en.boundingClientRect.top)>1500)unrender(p)}),{root:$('#view'),rootMargin:'400px 0px'});
const drawn=new Set();
/* free a page's pictures and the PDF engine's cached data for it */
function unrender(p){if(p.task)try{p.task.cancel()}catch(e){}p.task=null;p.done=false;drawn.delete(p);
 if(p.pc){p.pc.width=p.pc.height=0;p.pc.remove();p.pc=null}
 if(p.oc&&!p.strokes.length){p.oc.width=p.oc.height=0;p.oc.remove();p.oc=null}else if(p.oc){p.oc.width=p.oc.height=0;p.oc.remove();p.oc=null}
 p.words=null;if(p.page)try{p.page.cleanup()}catch(e){}}
/* keep only a few pages drawn: drop the ones furthest from the screen */
function trimDrawn(){if(drawn.size<=MEM.keep)return;const vr=$('#view').getBoundingClientRect(),mid=(vr.top+vr.bottom)/2;
 const list=[...drawn].map(p=>{const r=p.wrap.getBoundingClientRect();return{p,d:Math.abs((r.top+r.bottom)/2-mid)}}).sort((a,b)=>b.d-a.d);
 while(list.length>MEM.keep){const x=list.shift();unrender(x.p)}}
window.__lowMemory=()=>{const vr=$('#view').getBoundingClientRect();pages.forEach(p=>{const r=p.wrap.getBoundingClientRect();if(r.bottom<vr.top-50||r.top>vr.bottom+50)unrender(p);p.thumb=null;if(!r||r.bottom<vr.top-50||r.top>vr.bottom+50){p.read=null}})};
function mkPage(d){const wrap=document.createElement('div');wrap.className='pg';
 const p={...d,rec:d.rec||d,wrap,pc:null,oc:null,strokes:d.strokes||(d.strokes=[]),done:false,task:null,sel:false,words:null,thumb:null};wrap._p=p;bind(p);size(p);return p}
function addPages(ds,idx){const ps=ds.map(mkPage);pages.splice(idx,0,...ps);reorderDOM();ps.forEach(p=>io.observe(p.wrap));syncEmpty();upd();return ps}
const reorderDOM=()=>pages.forEach(p=>host.appendChild(p.wrap));
function rm(p){unrender(p);io.unobserve(p.wrap);p.wrap.remove()}
const syncEmpty=()=>{$('#empty').style.display=pages.length?'none':''};
/* frame size only; the pictures keep their pixels (stretched) until the page is drawn again */
function size(p){const W=p.w*scale,H=p.h*scale;p.pr=Math.min(dpr,Math.sqrt(MEM.px/Math.max(1,W*H)));p.wrap.style.width=W+'px';p.wrap.style.height=H+'px';for(const c of [p.pc,p.oc])if(c){c.style.width=W+'px';c.style.height=H+'px'}}
function canvasFor(p,cls){const c=document.createElement('canvas');if(cls)c.className=cls;c.style.position='absolute';c.style.left=c.style.top='0';c.style.width=p.w*scale+'px';c.style.height=p.h*scale+'px';c.width=Math.max(1,Math.round(p.w*scale*p.pr));c.height=Math.max(1,Math.round(p.h*scale*p.pr));return c}
async function ensure(p){if(p.kind==='pdf'&&!p.page){if(!p.doc)throw new Error('part not loaded');p.page=await p.doc.getPage(p.lpn||p.pn);const v=p.page.getViewport({scale:1});p.w=v.width;p.h=v.height}}
/* pdf.js object number of a page, so the saver can find it even in a damaged page tree */
const refOf=async p=>{try{await ensure(p);return p.page&&p.page.ref||null}catch(e){return null}};
window.__refOf=refOf;
async function paint(p,ctx,k,reg){
 ctx.fillStyle='#fff';ctx.fillRect(0,0,p.w*k,p.h*k);
 if(p.kind==='pdf'){await ensure(p);const t=p.page.render({canvasContext:ctx,viewport:p.page.getViewport({scale:k})});if(reg)reg.task=t;await t.promise}
 else if(p.kind==='cv')ctx.drawImage(p.cv,0,0,p.w*k,p.h*k);
 else if(p.kind==='txt'){ctx.fillStyle='#111';ctx.font=`${9*k}px "Courier New",Courier,monospace`;ctx.textBaseline='top';p.lines.forEach((l,i)=>ctx.fillText(l,40*k,(40+i*12)*k))}}
async function render(p){
 p.done=true;if(p.task)try{p.task.cancel()}catch(e){}
 try{await ensure(p)}catch(e){p.done=false;return}
 if(!pages.includes(p))return;
 size(p);const c=canvasFor(p);drawn.add(p);
 try{await paint(p,c.getContext('2d'),scale*p.pr,p)}catch(e){c.width=c.height=0;return}
 if(!p.done||!pages.includes(p)){c.width=c.height=0;return}
 if(p.pc){p.pc.width=p.pc.height=0;p.pc.remove()}p.pc=c;p.wrap.prepend(c);
 if(p.oc){p.oc.width=p.oc.height=0;p.oc.remove();p.oc=null}
 redraw(p);trimDrawn()}
function drawS(ctx,s){
 const k=scale*dpr;
 if(s.t==='hl'){ctx.fillStyle=s.c;ctx.globalAlpha=s.a||.4;s.segs.forEach(g=>ctx.fillRect(g[0]*k,g[1]*k,(g[2]-g[0])*k,(g[3]-g[1])*k));ctx.globalAlpha=1;return}
 if(s.t==='wu'){ctx.globalAlpha=s.a||1;ctx.strokeStyle=s.c;ctx.lineWidth=s.w*k;ctx.lineCap='round';s.segs.forEach(g=>{ctx.beginPath();ctx.moveTo(g[0]*k,g[2]*k);ctx.lineTo(g[1]*k,g[2]*k);ctx.stroke()});ctx.globalAlpha=1;return}
 ctx.globalAlpha=s.a||1;drawP(ctx,s);ctx.globalAlpha=1}
function drawP(ctx,s){
 const k=scale*dpr,q=s.p;ctx.strokeStyle=s.c;ctx.lineWidth=s.w*k;ctx.lineCap=s.sq?'butt':'round';ctx.lineJoin='round';ctx.beginPath();
 if(q.length===1){ctx.fillStyle=s.c;ctx.arc(q[0][0]*k,q[0][1]*k,s.w*k/2,0,7);ctx.fill();return}
 ctx.moveTo(q[0][0]*k,q[0][1]*k);
 if(s.t==='line'||q.length<3)ctx.lineTo(q[q.length-1][0]*k,q[q.length-1][1]*k);
 else{for(let i=1;i<q.length-1;i++){ctx.quadraticCurveTo(q[i][0]*k,q[i][1]*k,(q[i][0]+q[i+1][0])/2*k,(q[i][1]+q[i+1][1])/2*k)}ctx.lineTo(q[q.length-1][0]*k,q[q.length-1][1]*k)}
 ctx.stroke()}
/* marks layer: only exists while the page has marks or is being drawn on */
function redraw(p,extra){if(!extra)p.thumb=null;
 if(!p.strokes.length&&!extra){if(p.oc){p.oc.width=p.oc.height=0;p.oc.remove();p.oc=null}return}
 if(!p.oc||p.oc.width!==Math.max(1,Math.round(p.w*scale*p.pr))){if(p.oc){p.oc.width=p.oc.height=0;p.oc.remove()}p.oc=canvasFor(p,'oc');p.wrap.appendChild(p.oc)}
 const c=p.oc.getContext('2d'),od=dpr;dpr=p.pr||dpr;try{c.clearRect(0,0,p.oc.width,p.oc.height);p.strokes.forEach(s=>drawS(c,s));if(extra)drawS(c,extra)}finally{dpr=od}}
function dist(pt,s){
 let m=1e9;
 if(s.t==='hl'){for(const g of s.segs){m=Math.min(m,Math.hypot(Math.max(g[0]-pt[0],0,pt[0]-g[2]),Math.max(g[1]-pt[1],0,pt[1]-g[3])))}return m}
 if(s.t==='wu'){for(const g of s.segs){m=Math.min(m,Math.hypot(Math.max(g[0]-pt[0],0,pt[0]-g[1]),pt[1]-g[2]))}return m}
 const q=s.p;if(q.length===1)return Math.hypot(pt[0]-q[0][0],pt[1]-q[0][1]);
 for(let i=1;i<q.length;i++){const[a,b]=[q[i-1],q[i]],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy||1,t=Math.max(0,Math.min(1,((pt[0]-a[0])*dx+(pt[1]-a[1])*dy)/l));m=Math.min(m,Math.hypot(pt[0]-a[0]-t*dx,pt[1]-a[1]-t*dy))}return m}

/* ---------- word recognition ---------- */
async function getWords(p){
 if(p.words)return p.words;p.words=[];
 if(p.kind==='txt'){const W=[];p.lines.forEach((l,i)=>{const re=/\S+/g,y=40+i*12+8;let m;while((m=re.exec(l)))W.push({x0:40+m.index*5.4,x1:40+(m.index+m[0].length)*5.4,y,t:y-7.6,b:y+2,s:9})});p.words=W;return W}
 if(p.kind!=='pdf')return p.words;
 try{await ensure(p);const tc=await p.page.getTextContent(),vp=p.page.getViewport({scale:1}),W=[];
 for(const it of tc.items){if(!it.str||!it.str.trim())continue;
  const t=pdfjsLib.Util.transform(vp.transform,it.transform),fs=Math.hypot(t[2],t[3])||it.height,cw=it.width/it.str.length,re=/\S+/g;let m;
  while((m=re.exec(it.str)))W.push({x0:t[4]+m.index*cw,x1:t[4]+(m.index+m[0].length)*cw,y:t[5],t:t[5]-fs*.85,b:t[5]+fs*.22,s:fs})}
 p.words=W}catch(e){}
 return p.words}
function nearest(W,pt){let bi=-1,bd=2500;W.forEach((w,i)=>{const dx=Math.max(w.x0-pt[0],0,pt[0]-w.x1),dy=Math.max(w.t-pt[1],0,pt[1]-w.b),d=dx*dx+dy*dy*4;if(d<bd){bd=d;bi=i}});return bi}
function selSegs(W,a,b){let i=nearest(W,a),j=nearest(W,b);if(i<0||j<0)return null;if(i>j)[i,j]=[j,i];
 const segs=[];let g=null;
 for(let k=i;k<=j;k++){const w=W[k];if(g&&Math.abs(w.y-g.y)<g.s*.5){g.x0=Math.min(g.x0,w.x0);g.x1=Math.max(g.x1,w.x1);g.t=Math.min(g.t,w.t);g.b=Math.max(g.b,w.b)}else{g={x0:w.x0,x1:w.x1,y:w.y,t:w.t,b:w.b,s:w.s};segs.push(g)}}
 return segs}
function build(c,p){
 const snap=$('#snap').checked,pts=c.p;
 if(c.t==='line'){
  if(snap){const sg=selSegs(p.words||[],pts[0],pts[1]);if(sg)return{t:'wu',c:c.c,w:c.w,a:c.a,segs:sg.map(g=>[g.x0,g.x1,g.y+1.5+c.w/2])}}
  return{t:'line',c:c.c,w:c.w,a:c.a,p:[pts[0],[pts[1][0],pts[0][1]]]}}
 if(c.t==='hl'){
  if(snap){const sg=selSegs(p.words||[],pts[0],pts[pts.length-1]);if(sg)return{t:'hl',c:c.c,w:c.w,a:c.a,segs:sg.map(g=>{const m=(g.t+g.b)/2;return[g.x0-1,m-c.w/2,g.x1+1,m+c.w/2]})}}
  return{t:'line',sq:1,c:c.c,w:c.w,a:c.a,p:[pts[0],[pts[pts.length-1][0],pts[0][1]]]}}
 return c}
function bind(p){
 const oc=p.wrap;let cur=null;p.cancel=()=>{if(cur&&cur!=='erase'){cur=null;redraw(p)}else cur=null};
 const pt=e=>{const r=oc.getBoundingClientRect();return[(e.clientX-r.left)/scale,(e.clientY-r.top)/scale]};
 const erase=e=>{const x=pt(e);for(let i=p.strokes.length-1;i>=0;i--){const s=p.strokes[i];if(dist(x,s)<=s.w/2+6/scale){p.strokes.splice(i,1);undo.push({k:'del',p,s,i});setDirty();redraw(p);break}}};
 oc.onpointerdown=e=>{
  if(tool==='scroll'||PZ.on||!e.isPrimary)return;e.preventDefault();oc.setPointerCapture(e.pointerId);
  if(tool==='erase'){cur='erase';erase(e);return}
  if(!p.words)getWords(p);
  cur={t:tool,c:color,w:S[tool].w,a:S[tool].a,p:[pt(e)]};if(tool==='line')cur.p.push(pt(e));redraw(p,build(cur,p));
 };
 oc.onpointermove=e=>{
  if(!cur)return;if(PZ.on){p.cancel();return}if(cur==='erase'){erase(e);return}
  const x=pt(e);if(cur.t==='line')cur.p[1]=x;else cur.p.push(x);
  redraw(p,build(cur,p));
 };
 const end=()=>{if(cur&&cur!=='erase'){const s=build(cur,p),ok=s.t!=='line'||Math.hypot(s.p[1][0]-s.p[0][0],s.p[1][1]-s.p[0][1])>2;if(ok){p.strokes.push(s);undo.push({k:'add',p,s});setDirty()}redraw(p)}cur=null};
 oc.onpointerup=end;oc.onpointercancel=end;
}
$('#undo').onclick=doUndo;
function doUndo(){const a=undo.pop();if(!a)return;if(a.k==='add'){const i=a.p.strokes.indexOf(a.s);if(i>-1)a.p.strokes.splice(i,1)}else a.p.strokes.splice(a.i,0,a.s);setDirty();redraw(a.p)}
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();doUndo()}});
$('#clr').onclick=()=>{const p=cur_page();if(p&&p.strokes.length&&confirm('Clear all marks on page '+pageNo(p)+'?')){p.strokes.forEach(s=>undo.push({k:'del',p,s,i:0}));p.strokes.splice(0);setDirty();redraw(p)}};
function cur_page(){const v=$('#view').getBoundingClientRect();let best=null,bd=1e9;for(const p of pages){const r=p.wrap.getBoundingClientRect(),d=Math.abs(r.top+r.height/2-(v.top+v.height/2));if(d<bd){bd=d;best=p}}return best}
function zoom(f){const r=$('#view').getBoundingClientRect();zoomAt(scale*f,r.left+r.width/2,r.top+r.height/2)}
window.addEventListener('resize',()=>{if(pages.length&&!inGrid()){const z=scale/base;base=fitW(pages[0].w);setScale(base*z)}});
function renderNear(){const vr=$('#view').getBoundingClientRect();pages.forEach(p=>{const r=p.wrap.getBoundingClientRect();if(r.bottom>vr.top-300&&r.top<vr.bottom+300)render(p);else if(p.pc)unrender(p)})}
function setScale(ns){if(!pages.length)return;const v=$('#view'),ratio=v.scrollTop/(v.scrollHeight||1);scale=ns;pages.forEach(p=>{p.done=false;size(p)});v.scrollTop=ratio*v.scrollHeight;renderNear();upd()}
const ZK='ms.zoom';function savedZoom(){try{const z=+localStorage.getItem(ZK);return z>0.2&&z<20?z:1}catch(e){return 1}}
function saveZoom(){try{localStorage.setItem(ZK,String(scale/base))}catch(e){}}
/* zoom about a screen point; the same zoom applies to every page */
function zoomAt(ns,cx,cy){
 if(!pages.length)return;ns=Math.max(.25,Math.min(6,ns));if(Math.abs(ns-scale)<1e-4)return;const v=$('#view');
 let tp=null,fx=0,fy=0;for(const p of pages){const r=p.wrap.getBoundingClientRect();if(cy>=r.top-7&&cy<=r.bottom+7){tp=p;fx=(cx-r.left)/r.width;fy=Math.max(0,Math.min(1,(cy-r.top)/r.height));break}}
 if(!tp){setScale(ns);zoomed=true;saveZoom();return}
 scale=ns;zoomed=true;pages.forEach(p=>{p.done=false;size(p)});
 const r=tp.wrap.getBoundingClientRect();v.scrollLeft+=r.left+fx*r.width-cx;v.scrollTop+=r.top+fy*r.height-cy;
 renderNear();saveZoom();upd()}
const PZ={on:false,f:1};
$('#view').addEventListener('touchstart',e=>{if(e.touches.length!==2||!pages.length||inGrid())return;const[a,b]=e.touches;PZ.on=true;PZ.f=1;PZ.d0=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)||1;PZ.cx=(a.clientX+b.clientX)/2;PZ.cy=(a.clientY+b.clientY)/2;const r=host.getBoundingClientRect();host.style.transformOrigin=(PZ.cx-r.left)+'px '+(PZ.cy-r.top)+'px';window.__pinchAt=performance.now();pages.forEach(p=>p.cancel&&p.cancel())},{passive:true});
$('#view').addEventListener('touchmove',e=>{if(!PZ.on||e.touches.length<2)return;e.preventDefault();const[a,b]=e.touches,d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);PZ.f=Math.max(.25/scale,Math.min(6/scale,d/PZ.d0));host.style.transform='scale('+PZ.f+')';window.__pinchAt=performance.now()},{passive:false});
const pinchEnd=e=>{if(!PZ.on||e.touches.length>=2)return;PZ.on=false;host.style.transform='';window.__pinchAt=performance.now();if(Math.abs(PZ.f-1)>.02)zoomAt(scale*PZ.f,PZ.cx,PZ.cy)};
$('#view').addEventListener('touchend',pinchEnd);$('#view').addEventListener('touchcancel',pinchEnd);
$('#view').addEventListener('dblclick',e=>{if(tool!=='scroll'||!pages.length)return;const z=scale/base;zoomAt(z>1.05?base:base*2,e.clientX,e.clientY)});
$('#zi').onclick=()=>zoom(1.2);$('#zo').onclick=()=>zoom(1/1.2);
function upd(){const p=inGrid()?null:cur_page();$('#info').textContent=pages.length?`Page ${p?pageNo(p):1} / ${BOOK?BOOK.recs.length:pages.length} · ${Math.round(scale/base*100)}%`:''}
/* page number as printed in the list: in a big book, the page number in the whole book */
function pageNo(p){return BOOK?p.pn:pages.indexOf(p)+1}
window.__pageNo=pageNo;

/* ---------- big books: shown in parts of a few hundred pages ---------- */
let BOOK=null;
const SPLITMIN=MEM.low?40e6:80e6;
function message(html){host.innerHTML='';const d=document.createElement('div');d.id='pmsg';d.innerHTML=html;host.appendChild(d);syncEmpty();$('#empty').style.display='none'}
async function openSplitBook(f,want){
 window.__beforeReplace&&window.__beforeReplace();pages.forEach(rm);pages=[];undo=[];setDirty(false);closeBook();
 const ps=partSize(),first=Math.floor(want/ps);let info=null,failed=null;const ready={},waits={};
 docPrimary=f._nid;docName=(f.name||'document').replace(/\.[^.]+$/,'');setTool('scroll');
 message('<b>Preparing the book for smooth reading…</b><br><small>Big books are cut once into parts. The first part opens in a moment; the rest is prepared in the background and kept for next time.</small><div id="pmsgp"></div>');
 const setup=j=>{if(BOOK)return;const n=j.n;
  const recs=Array.from({length:n},(_,i)=>({kind:'pdf',pn:i+1,w:595,h:842,strokes:[],nid:f._nid,sidx:i+1,fname:f.name,src:{url:f._url,size:f.size},osize:f.size/n,doc:null}));
  BOOK={recs,size:j.partSize,parts:j.parts,part:-1,split:true,files:[],ready,waits,key:j.key,outline:j.outline||[],src:{url:f._url,size:f.size}};
  pb.hidden=false;document.body.classList.add('book')};
 const gotPart=(k,path)=>{BOOK.files[k]={path,id:0};ready[k]=true;if(waits[k]){waits[k].forEach(r=>r());delete waits[k]}};
 const job=window.__pdfJob({op:'prepare',src:f._nid,partSize:ps,first},d=>{const m=$('#pmsgp');if(m)m.textContent=d.msg||''},(type,d)=>{
  if(type==='info')setup(d);
  if(type==='part'&&BOOK){gotPart(d.k,d.path);const m=$('#pmsgp');if(m)m.textContent=`Part ${d.done} of ${d.parts} ready`;window.__toastPrep&&window.__toastPrep(d)}});
 job.then(j=>{info=j;if(!BOOK)setup(j);(j.files||[]).forEach((p,k)=>{if(!ready[k])gotPart(k,p)})}).catch(e=>{failed=e;if(BOOK&&BOOK.split){BOOK.prepFailed=e;Object.keys(waits).forEach(k=>{waits[k].forEach(r=>r());delete waits[k]});window.__toast&&window.__toast('Preparing the book stopped: '+e.message,7000)}});
 /* wait for the first part (or for an error: then the book is opened the ordinary way) */
 await new Promise(res=>{const t=setInterval(()=>{if(failed||(BOOK&&ready[Math.min(first,BOOK.parts-1)])){clearInterval(t);res()}},150)});
 if(!BOOK||failed&&!ready[first]){host.innerHTML='';window.__toast&&window.__toast((failed?failed.message+'. ':'')+'Opening the book directly instead (may be slow).',6000);BOOK=null;pb.hidden=true;return false}
 const zr=savedZoom();base=scale=fitW(595);zoomed=zr!==1;scale=base*zr;
 await showPart(Math.min(first,BOOK.parts-1),want-first*BOOK.size,0);
 window.__docChanged&&window.__docChanged(true,pages);
 return true}
function partReady(k){return new Promise(r=>{if(BOOK.ready[k]||BOOK.prepFailed)return r();(BOOK.waits[k]=BOOK.waits[k]||[]).push(r)})}
/* a part file is small enough to be read in one go (one copy, inside the PDF engine) */
async function openPartDoc(k){const f=BOOK.files[k];if(!f.id)f.id=Android.registerFile(f.path);
 const r=await fetch('/__file/'+f.id,{cache:'no-store'});if(!r.ok)throw new Error('part '+(k+1)+' could not be read');
 const ab=new Uint8Array(await r.arrayBuffer());return pdfjsLib.getDocument({data:ab}).promise}
/* a page of the book for searching / reading ahead, without disturbing the part on screen */
const aux={doc:null,k:-9,uses:0};
async function closeAux(){if(aux.doc){const d=aux.doc;aux.doc=null;aux.k=-9;try{await d.destroy()}catch(e){}}}
async function bookPage(rec){
 if(!BOOK){await ensure(rec);return{pg:rec.page,own:false}}
 const k=Math.floor((rec.pn-1)/BOOK.size);
 if(BOOK.split){if(k===BOOK.part&&rec.doc){await ensure(rec);return{pg:rec.page,own:false}}
  if(aux.k!==k){await closeAux();await partReady(k);aux.doc=await openPartDoc(k);aux.k=k}
  return{pg:await aux.doc.getPage(rec.pn-k*BOOK.size),own:true}}
 if(BOOK.src&&BOOK.src.size>BIGPDF){if(!aux.doc||aux.uses>=120){await closeAux();aux.doc=await pdfjsLib.getDocument({url:BOOK.src.url,disableAutoFetch:true,disableStream:true,rangeChunkSize:262144}).promise;aux.uses=0;aux.k=-2}
  aux.uses++;return{pg:await aux.doc.getPage(rec.pn),own:true}}
 await ensure(rec);return{pg:rec.page,own:false}}
window.__bookPage=bookPage;window.__bookPageDone=closeAux;
const partSize=()=>{let v='';try{v=window.Android?Android.getPref('partSize',''):localStorage.getItem('ms.partSize')||''}catch(e){}if(v==='')return MEM.low?200:300;return +v||0};
const pb=document.createElement('div');pb.id='pbar';pb.hidden=true;
pb.innerHTML='<button id="pbp" title="Previous part">◀</button><span id="pbt"></span><input id="pbg" type="number" min="1" placeholder="Go to page" aria-label="Go to page"><button id="pbn" title="Next part">▶</button>';
$('#view').prepend(pb);
const pnav=(cls)=>{const b=document.createElement('button');b.className='pnav '+cls;return b};
const pTop=pnav('top'),pEnd=pnav('end');
function partRange(k){const n=BOOK.recs.length,a=k*BOOK.size;return[a,Math.min(n,a+BOOK.size)]}
function syncBack(){for(const p of pages)if(p.rec&&p.rec!==p)p.rec.strokes=p.strokes}
async function reloadEngine(){                       // a fresh PDF engine for every part: memory from earlier parts is given back
 const src=BOOK.src;if(!src||!src.url||src.size<=BIGPDF)return;
 const old=BOOK.doc;try{BOOK.doc=await pdfjsLib.getDocument({url:src.url,disableAutoFetch:true,disableStream:true,rangeChunkSize:262144}).promise}catch(e){return}
 for(const r of BOOK.recs){r.doc=BOOK.doc;r.page=null;r.read=null;r.bands=null}
 try{await old.destroy()}catch(e){}}
async function showPart(k,at,frac){
 if(!BOOK)return;k=Math.max(0,Math.min(BOOK.parts-1,k));
 const same=k===BOOK.part&&pages.length;
 if(!same){syncBack();window.__partLeaving&&window.__partLeaving();pages.forEach(rm);pages=[];undo=[];pTop.remove();pEnd.remove();
  const[a,b]=partRange(k);
  if(BOOK.split){                                    // load this part's own file; the previous part's engine is closed
   if(!BOOK.ready[k]){message(`<b>Preparing part ${k+1} of ${BOOK.parts}…</b><br><small>It opens by itself when ready.</small>`);await partReady(k)}
   if(!BOOK.ready[k]){message(`<b>Part ${k+1} could not be prepared.</b><br><small>${BOOK.prepFailed?BOOK.prepFailed.message:''}</small>`);return false}
   host.innerHTML='';const old=BOOK.partDoc;BOOK.partDoc=null;for(const r of BOOK.recs)if(r.doc){r.doc=null;r.page=null;r.read=null;r.bands=null}
   if(old)try{await old.destroy()}catch(e){}
   if(aux.k===k)await closeAux();
   let d;try{d=await openPartDoc(k)}catch(e){message(`<b>Part ${k+1} could not be opened.</b><br><small>${e.message||e}</small>`);return false}
   BOOK.partDoc=d;let w=595,h=842;try{const p1=await d.getPage(1),v=p1.getViewport({scale:1});w=v.width;h=v.height}catch(e){}
   for(let i=a;i<b;i++){const r=BOOK.recs[i];r.doc=d;r.lpn=i-a+1;if(!r.sized){r.w=w;r.h=h}}
  }else if(BOOK.part>=0)await reloadEngine();
  BOOK.part=k;
  addPages(BOOK.recs.slice(a,b),0);
  if(k>0){const[x,y]=partRange(k-1);pTop.textContent=`◀ Part ${k} · pages ${x+1}–${y}`;pTop.onclick=()=>showPart(k-1,BOOK.size-1,1);host.prepend(pTop)}
  if(k<BOOK.parts-1){const[x,y]=partRange(k+1);pEnd.textContent=`Continue: part ${k+2} · pages ${x+1}–${y} ▶`;pEnd.onclick=()=>showPart(k+1,0,0);host.appendChild(pEnd)}}
 const[a,b]=partRange(k);$('#pbt').textContent=`Part ${k+1}/${BOOK.parts} · p. ${a+1}–${b} of ${BOOK.recs.length}`;
 $('#pbp').disabled=k===0;$('#pbn').disabled=k===BOOK.parts-1;
 const v=$('#view'),t=pages[Math.max(0,Math.min(pages.length-1,at||0))];
 requestAnimationFrame(()=>{if(t){const vr=v.getBoundingClientRect(),r=t.wrap.getBoundingClientRect();v.scrollTop+=r.top-vr.top-(pb.offsetHeight||0)+(frac||0)*r.height}upd();renderNear()});
 if(!same)window.__partChanged&&window.__partChanged();return true}
function openBook(recs,size,want){
 BOOK={recs,size,parts:Math.ceil(recs.length/size),part:-1,doc:recs[0].doc,src:recs[0].src};
 pb.hidden=false;document.body.classList.add('book');
 const k=Math.floor(Math.max(0,Math.min(recs.length-1,want))/size);showPart(k,want-k*size,0)}
function closeBook(){if(!BOOK)return;const d=BOOK.partDoc;if(d)try{d.destroy()}catch(e){}closeAux();BOOK=null;pb.hidden=true;document.body.classList.remove('book');pTop.remove();pEnd.remove()}
/* go to a page of the whole book (0-based), switching part when needed */
async function gotoGlobal(i,frac){if(!BOOK){const t=pages[i];if(t){const v=$('#view'),vr=v.getBoundingClientRect(),r=t.wrap.getBoundingClientRect();v.scrollTop+=r.top-vr.top+(frac||0)*r.height}return}
 i=Math.max(0,Math.min(BOOK.recs.length-1,i));const k=Math.floor(i/BOOK.size);await showPart(k,i-k*BOOK.size,frac||0)}
window.__book=()=>BOOK;window.__gotoGlobal=gotoGlobal;window.__showPart=showPart;
window.__nextPart=async()=>{if(!BOOK||BOOK.part>=BOOK.parts-1)return false;await showPart(BOOK.part+1,0,0);return true};
window.__allPages=()=>{if(!BOOK)return pages;syncBack();return BOOK.recs};
$('#pbp').onclick=()=>BOOK&&showPart(BOOK.part-1,BOOK.size-1,0);$('#pbn').onclick=()=>BOOK&&showPart(BOOK.part+1,0,0);
$('#pbg').addEventListener('keydown',e=>{if(e.key==='Enter'){const n=+e.target.value;e.target.value='';e.target.blur();if(n>0)gotoGlobal(n-1,0)}});
$('#pbg').addEventListener('change',e=>{const n=+e.target.value;if(n>0){e.target.value='';gotoGlobal(n-1,0)}});
$('#view').addEventListener('scroll',upd,{passive:true});

/* ---------- page manager (thumbnails) ---------- */
$('#pgs').onclick=()=>{if(!pages.length)return;$('#pop').hidden=true;document.body.classList.add('grid');buildGrid()};
function closeGrid(go){document.body.classList.remove('grid');gq++;const t=go||pages.find(p=>p.sel);requestAnimationFrame(()=>{if(t&&pages.includes(t))t.wrap.scrollIntoView({block:'start'});upd()})}
$('#gdone').onclick=()=>closeGrid();
let gq=0;
function buildGrid(){
 const g=$('#tgrid'),st=g.scrollTop;g.innerHTML='';
 pages.forEach((p,i)=>{const d=document.createElement('div');d.className='th'+(p.sel?' sel':'');p.thEl=d;
  if(p.thumb)d.appendChild(p.thumb);else{const h=document.createElement('div');h.className='ph';h.style.aspectRatio=p.w+'/'+p.h;d.appendChild(h)}
  const n=document.createElement('span');n.textContent=pageNo(p);d.appendChild(n);
  d.onclick=e=>{if(e.shiftKey&&lastSel>=0){const[a,b]=[Math.min(lastSel,i),Math.max(lastSel,i)];for(let k=a;k<=b;k++){pages[k].sel=true;pages[k].thEl.classList.add('sel')}}else{p.sel=!p.sel;d.classList.toggle('sel',p.sel)}lastSel=i;cnt()};
  d.ondblclick=()=>closeGrid(p);g.appendChild(d)});
 g.scrollTop=st;cnt();fillThumbs()}
const cnt=()=>{const n=pages.filter(p=>p.sel).length;$('#gcnt').textContent=n?n+' selected':pages.length+' pages'};
async function fillThumbs(){const id=++gq;
 for(const p of pages.slice()){if(id!==gq)return;if(p.thumb)continue;
  try{await ensure(p);const tw=150,c=document.createElement('canvas');c.width=tw;c.height=Math.max(1,Math.round(tw*p.h/p.w));const x=c.getContext('2d');await paint(p,x,tw/p.w,null);
   const os=scale,od=dpr;scale=tw/p.w;dpr=1;p.strokes.forEach(s=>drawS(x,s));scale=os;dpr=od;p.thumb=c;
   if(p.thEl&&p.thEl.isConnected){const h=p.thEl.querySelector('.ph');if(h)h.remove();p.thEl.prepend(c)}}catch(e){}}}
$('#gall').onclick=()=>{pages.forEach(p=>{p.sel=true;p.thEl&&p.thEl.classList.add('sel')});cnt()};
$('#gnone').onclick=()=>{pages.forEach(p=>{p.sel=false;p.thEl&&p.thEl.classList.remove('sel')});cnt()};
const bookLock=()=>{if(!BOOK)return false;alert('This big book is shown in parts, so pages cannot be moved, added or deleted here.\nUse Export → parts / page range to make a smaller copy.');return true};
function move(dir){if(bookLock())return;const n=pages.length;
 if(dir<0){for(let i=1;i<n;i++)if(pages[i].sel&&!pages[i-1].sel)[pages[i-1],pages[i]]=[pages[i],pages[i-1]]}
 else{for(let i=n-2;i>=0;i--)if(pages[i].sel&&!pages[i+1].sel)[pages[i+1],pages[i]]=[pages[i],pages[i+1]]}
 reorderDOM();setDirty();buildGrid()}
$('#gup').onclick=()=>move(-1);$('#gdn').onclick=()=>move(1);
$('#gdel').onclick=()=>{if(bookLock())return;const del=pages.filter(p=>p.sel);if(!del.length||!confirm('Delete '+del.length+' page(s)?'))return;
 del.forEach(rm);pages=pages.filter(p=>!p.sel);undo=undo.filter(a=>pages.includes(a.p));setDirty();syncEmpty();upd();if(!pages.length){closeGrid();return}buildGrid()};
$('#gadd').onclick=()=>{if(bookLock())return;const ref=pages.find(p=>p.sel)||pages[pages.length-1]||{w:A4[0],h:A4[1]};addPages([{kind:'blank',w:ref.w,h:ref.h}],insIdx());setDirty();buildGrid()};
$('#gdup').onclick=()=>{if(bookLock())return;for(let i=pages.length-1;i>=0;i--){const p=pages[i];if(!p.sel)continue;const c=addPages([{kind:p.kind,doc:p.doc,bytes:p.bytes,src:p.src,osize:p.osize,pn:p.pn,page:p.page,cv:p.cv,lines:p.lines,w:p.w,h:p.h,nid:p.nid,sidx:p.sidx,fname:p.fname}],i+1)[0];c.strokes=JSON.parse(JSON.stringify(p.strokes))}setDirty();buildGrid()};

/* ---------- export ---------- */
let docName='document',dls=null,docPrimary=0;
const JSZIP='libs/jszip.min.js',PDFLIB='libs/pdf-lib.min.js',PPTX='libs/pptxgen.bundle.js';
const noEx=()=>{$('#exbtn').style.display=$('#gexp').style.display='none'};
if(window.claude)window.claude.use('downloads').then(d=>{dls=d;if(!d)noEx()}).catch(noEx);else noEx();
const blobOf=(c,t,q)=>new Promise(r=>c.toBlob(r,t,q));
const b2u=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(b)});
async function pageCanvas(p,k){
 await ensure(p);k=Math.min(k,4800/Math.max(p.w,p.h));
 const c=document.createElement('canvas');c.width=Math.round(p.w*k);c.height=Math.round(p.h*k);const x=c.getContext('2d');await paint(p,x,k,null);
 const a=document.createElement('canvas');a.width=c.width;a.height=c.height;const ax=a.getContext('2d'),os=scale,od=dpr;scale=k;dpr=1;
 try{p.strokes.forEach(s=>drawS(ax,s))}finally{scale=os;dpr=od}
 x.globalCompositeOperation='multiply';x.drawImage(a,0,0);x.globalCompositeOperation='source-over';return c}
async function textOf(p){if(p.kind==='txt')return p.lines.join('\n');if(p.kind==='pdf'){try{await ensure(p)}catch(e){return '(this page could not be read)'}const tc=await p.page.getTextContent();return tc.items.map(i=>i.str+(i.hasEOL?'\n':'')).join('')}return '(no text on this page)'}
let openExp=function(){if(!pages.length)return;const tot=BOOK?BOOK.recs.length:pages.length;if(!$('#efrom').value)$('#efrom').value=1;if(!$('#eto').value)$('#eto').value=tot;$('#efrom').max=$('#eto').max=tot;$('#efrom').onchange=$('#eto').onchange=updSz;const sel=pages.some(p=>p.sel);$('#escope').querySelector('[value=sel]').disabled=!sel;$('#escope').value=inGrid()&&sel?'sel':'all';$('#est').textContent='';$('#ego').disabled=false;$('#exp').hidden=false}
$('#exbtn').onclick=openExp;$('#gexp').onclick=openExp;$('#ex').onclick=()=>$('#exp').hidden=true;
async function mkDocx(J){
 await lib(JSZIP);const z=new JSZip(),W=J[0].w,H=J[0].h,E=12700,R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 let body='',rels='';
 J.forEach((j,i)=>{const n=i+1,f=Math.min(W/j.w,H/j.h)*.97,cx=Math.round(j.w*f*E),cy=Math.round(j.h*f*E);z.file(`word/media/p${n}.jpg`,j.b);
  rels+=`<Relationship Id="rI${n}" Type="${R}/image" Target="media/p${n}.jpg"/>`;
  body+=`<w:p><w:pPr>${i?'<w:pageBreakBefore/>':''}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Page ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="p${n}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rI${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`});
 const X='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 z.file('[Content_Types].xml',X+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 z.file('_rels/.rels',X+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
 z.file('word/_rels/document.xml.rels',X+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
 z.file('word/document.xml',X+`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="${Math.round(W*20)}" w:h="${Math.round(H*20)}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
 return z.generateAsync({type:'blob'})}
async function mkPptx(J){
 await lib(PPTX);const P=new PptxGenJS(),W=J[0].w/72,H=J[0].h/72;P.defineLayout({name:'PG',width:W,height:H});P.layout='PG';
 for(const j of J){const s=P.addSlide(),f=Math.min(W/(j.w/72),H/(j.h/72)),w=j.w/72*f,h=j.h/72*f;s.addImage({data:(await b2u(j.b)).slice(5),x:(W-w)/2,y:(H-h)/2,w,h})}
 return P.write({outputType:'blob'})}
/* ---------- export size: 100% = original quality, lower = smaller file with the least visible loss ---------- */
let epct=100;
/* compression speed: fewer tries and smaller pictures = faster */
const SPD={instant:{tries:1,cap:4e6,off:0},quickest:{tries:2,cap:6e6,off:0},quick:{tries:3,cap:1e7,off:-1},normal:{tries:12,cap:16e6,off:-2}};
const spd=()=>SPD[$('#espd').value]||SPD.quick;
try{const v=localStorage.getItem('ms.espd');if(v&&SPD[v])$('#espd').value=v;else $('#espd').value='quick'}catch(e){$('#espd').value='quick'}
$('#espd').onchange=()=>{try{localStorage.setItem('ms.espd',$('#espd').value)}catch(e){}};
const fmtB=b=>b>=1048576?(b/1048576).toFixed(b>=104857600?0:1)+' MB':Math.max(1,Math.round(b/1024))+' KB';
const expList=()=>{const sc=$('#escope').value,all=BOOK?window.__allPages():pages;
 if(sc==='range'){let a=(+$('#efrom').value||1)-1,b=(+$('#eto').value||all.length)-1;if(a>b)[a,b]=[b,a];return all.slice(Math.max(0,a),Math.min(all.length,b+1))}
 return sc==='all'?all.slice():sc==='sel'?pages.filter(p=>p.sel):[inGrid()?(pages.find(p=>p.sel)||pages[0]):cur_page()].filter(Boolean)};
let eparts=10;const partsOn=()=>$('#emode').value==='n'&&$('#efmt').value==='pdf';
$('#emode').onchange=()=>updSz();$('#epm').onclick=()=>{eparts=Math.max(2,eparts-1);updSz()};$('#epp').onclick=()=>{eparts=Math.min(50,eparts+1);updSz()};
/* big books go through the phone's own PDF tools (they use storage instead of memory) */
const JSBIG=MEM.low?60e6:120e6;
const nativeBig=l=>!!(window.__pdfJob&&l.length&&l.every(p=>p.kind==='pdf'&&p.nid&&p.nid===l[0].nid)&&(BOOK||origOf(l)>JSBIG||l.length>400));
const marksOf=l=>{const m={};for(const p of l)if(p.strokes&&p.strokes.length)m[p.pn]=p.strokes;return m};
const origOf=l=>l.reduce((a,p)=>a+(p.osize||0),0);
function updSz(){const fmt=$('#efmt').value,row=$('#eszrow'),info=$('#eszi');$('#esz').textContent=epct+'%';
 $('#espr').style.display=fmt==='txt'||epct>=100?'none':'';$('#erng').style.display=$('#escope').value==='range'?'':'none';
 $('#eparts').style.display=fmt==='pdf'?'':'none';$('#epn').textContent=eparts;$('#epm').style.display=$('#epp').style.display=$('#epn').style.display=partsOn()?'':'none';
 if(fmt==='txt'){row.style.display='none';info.textContent='';return}row.style.display='';
 const o=origOf(expList());
 info.textContent=epct>=100?(fmt==='pdf'?'Original quality'+(o?' · about '+fmtB(o):'')+' · text stays selectable':'Full quality'):(o?'Original '+fmtB(o)+' → about '+fmtB(o*epct/100):'Smaller file, lower picture quality')}
$('#esm').onclick=()=>{epct=Math.max(10,epct-10);updSz()};$('#esp').onclick=()=>{epct=Math.min(100,epct+10);updSz()};
$('#efmt').onchange=updSz;$('#escope').onchange=updSz;
const _openExp=openExp;openExp=function(){_openExp();updSz()};$('#exbtn').onclick=openExp;$('#gexp').onclick=openExp;
/* several parts from a normal-size document (done here, in the page) */
async function exportPartsJs(list,pct,say,E,n){
 n=Math.min(n,list.length);const t0=performance.now(),out=[];let bad=0;
 for(let k=0;k<n;k++){const a=Math.floor(list.length*k/n),b=Math.floor(list.length*(k+1)/n),ch=list.slice(a,b);
  const r=await exportPdf(ch,pct,t=>say(`Part ${k+1} of ${n}: ${t}`),E);bad+=r.bad||0;
  const name=`${docName}-part${String(k+1).padStart(2,'0')}-of-${String(n).padStart(2,'0')}.pdf`;await dls.save({filename:name,data:r.data});out.push(name)}
 say(`Saved ✓ ${n} parts (${out[0]} …) · ${((performance.now()-t0)/1000).toFixed(0)} s`+(bad?` · ${bad} damaged page(s) left blank`:''))}
/* a big book: the phone's PDF tools cut it into pieces; each piece is compressed here if asked; pieces are joined again when one file is wanted */
async function exportBig(list,pct,say,E,n){
 const t0=performance.now(),nid=list[0].nid,pn=list.map(p=>p.pn),marks=marksOf(list),base=docName+(pct<100?'-'+pct+'pc':'-marked');
 const prog=pre=>(x=>say(pre+(x.msg||'')));
 if(pct>=100){const r=await window.__pdfJob({op:'export',src:nid,pages:pn,marks,parts:n,name:base},prog(''));
  say(`Saved ✓ ${r.files.length>1?r.files.length+' parts in '+r.files[0].replace(/[^/]*$/,''):r.files[0]} · ${((performance.now()-t0)/1000).toFixed(0)} s`+(r.bad?` · ${r.bad} damaged page(s) left blank`:''));return}
 await lib(PDFLIB);
 const avg=Math.max(1,origOf(list)/list.length),per=n>1?Math.ceil(list.length/n):Math.max(10,Math.floor((MEM.low?25e6:45e6)/avg));
 const chunks=[];for(let a=0;a<list.length;a+=per)chunks.push(pn.slice(a,a+per));
 const temps=[];let before=0,after=0;
 try{
  for(let k=0;k<chunks.length;k++){const tag=`Piece ${k+1} of ${chunks.length}: `,ch=chunks[k],mk={};for(const x of ch)if(marks[x])mk[x]=marks[x];
   const r=await window.__pdfJob({op:'export',src:nid,pages:ch,marks:mk,parts:1,dest:'temp',name:'piece'},prog(tag));
   const path=r.files[0],id=Android.registerFile(path);let bytes=new Uint8Array(await (await fetch('/__file/'+id,{cache:'no-store'})).arrayBuffer());Android.deleteTemp(path);
   before+=bytes.length;say(tag+'compressing…');
   const doc=await PDFLib.PDFDocument.load(bytes,{ignoreEncryption:true,updateMetadata:false});const size0=bytes.length;bytes=null;
   await shrinkImages(doc,size0,size0*pct/100,t=>say(tag+t),E);
   const outb=await doc.save({useObjectStreams:true});after+=outb.length;
   if(n>1){const name=`${base}-part${String(k+1).padStart(2,'0')}-of-${String(chunks.length).padStart(2,'0')}.pdf`;await dls.save({filename:name,data:outb})}
   else{const w=await window.__saveBlob(new Blob([outb],{type:'application/pdf'}),'temp','piece.pdf',0);temps.push(w.where)}
   await new Promise(r=>setTimeout(r,30))}
  if(n<=1){say('Joining the pieces into one file…');const r=await window.__pdfJob({op:'merge',files:temps,name:base,deleteSources:true},prog('Joining: '));temps.length=0;say(`Saved ✓ ${r.files[0]} · ${fmtB(after)} (from ${fmtB(before)}) · ${((performance.now()-t0)/1000).toFixed(0)} s`)}
  else say(`Saved ✓ ${chunks.length} parts · ${fmtB(after)} (from ${fmtB(before)}) · ${((performance.now()-t0)/1000).toFixed(0)} s`)
 }finally{for(const t of temps)try{Android.deleteTemp(t)}catch(e){}}}
/* render a page and encode it at the best quality that fits the byte budget */
async function encodeFit(p,budget,mime,S,E){
 E=E||SPD.normal;
 if(!S.k){S.k=Math.max(.45,Math.min(2.5,Math.sqrt(budget/.22/(p.w*p.h))));S.q=.8}   // first guess from the byte budget
 let k=S.k,q=S.q,c=null,ck=0,b=null,t=0;
 for(;t<Math.max(1,E.tries);t++){
  if(!c||ck!==k){c=await pageCanvas(p,k);ck=k}
  b=await blobOf(c,mime,q);
  if(b.size<=budget||(k<=.45&&q<=.35))break;
  const r=budget/b.size;
  if(mime!=='image/png'&&q>.5&&r>.5)q=Math.max(.35,q-.12);else k=Math.max(.45,k*Math.max(.5,Math.sqrt(r)*.95))}
 if(b.size<budget*.6){S.k=Math.min(2.5,k*1.2);S.q=Math.min(.9,q+.05)}else if(b.size>budget){const r=Math.sqrt(budget/b.size);S.k=Math.max(.45,k*r);S.q=q}else{S.k=k;S.q=q}
 return b}
const img2u8=async b=>new Uint8Array(await b.arrayBuffer());
function loadImg(blob){return new Promise((ok,no)=>{const u=URL.createObjectURL(blob),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);ok(i)};i.onerror=()=>{URL.revokeObjectURL(u);no(new Error('img'))};i.src=u})}
/* shrink the JPEG pictures inside the PDF; text and drawings stay sharp and selectable */
async function shrinkImages(doc,estSize,target,st,E){
 E=E||SPD.normal;
 const L=PDFLib,N=n=>L.PDFName.of(n),ctx=doc.context,imgs=[];let tot=0;
 for(const[ref,obj]of ctx.enumerateIndirectObjects()){
  if(!(obj instanceof L.PDFRawStream))continue;const d=obj.dict;
  if(d.get(N('Subtype'))!==N('Image')||d.get(N('ImageMask'))||d.get(N('Decode')))continue;
  const f=d.lookup(N('Filter'));let jpg=null;
  if(f===N('DCTDecode'))jpg=obj.contents;
  else if(f instanceof L.PDFArray&&f.size()>=1&&f.lookup(f.size()-1)===N('DCTDecode')){const pre=[];for(let i=0;i<f.size()-1;i++)pre.push(f.lookup(i));
   if(pre.every(x=>['ASCII85Decode','ASCIIHexDecode','FlateDecode','LZWDecode','RunLengthDecode'].some(n=>x===N(n)))){try{const dd=d.clone(ctx);if(pre.length)dd.set(N('Filter'),ctx.obj(pre));else dd.delete(N('Filter'));dd.delete(N('DecodeParms'));jpg=pre.length?L.decodePDFRawStream(L.PDFRawStream.of(dd,obj.contents)).decode():obj.contents}catch(e){jpg=null}}}
  let raw=null;
  if(!jpg){                                   // zip-compressed / plain pictures: unpack the pixels (only simple 8-bit RGB or grey ones)
   const plain=!f||f===N('FlateDecode')||(f instanceof L.PDFArray&&f.size()===1&&f.lookup(0)===N('FlateDecode'));
   const dp=d.lookup(N('DecodeParms')),pred=dp&&dp.lookup&&dp.lookup(N('Predictor'));
   if(plain&&!(pred&&pred.asNumber&&pred.asNumber()>1)){const w=d.lookup(N('Width')),h=d.lookup(N('Height'));raw={w:w&&w.asNumber(),h:h&&h.asNumber()};if(!raw.w||!raw.h||raw.w*raw.h>2.5e7)raw=null}}
  if(!raw&&(!jpg||jpg[0]!==0xFF||jpg[1]!==0xD8))continue;
  const bpc=d.lookup(N('BitsPerComponent'));if(bpc&&bpc.asNumber&&bpc.asNumber()!==8)continue;
  const cs=d.lookup(N('ColorSpace'));let okc=cs===N('DeviceRGB')||cs===N('DeviceGray');
  if(!okc&&cs instanceof L.PDFArray&&cs.lookup(0)===N('ICCBased')){try{const n=cs.lookup(1).dict.lookup(N('N')).asNumber();okc=n===1||n===3}catch(e){}}
  if(!okc||obj.contents.length<12000)continue;
  if(raw){raw.comps=cs===N('DeviceGray')||(cs instanceof L.PDFArray&&(()=>{try{return cs.lookup(1).dict.lookup(N('N')).asNumber()===1}catch(e){return false}})())?1:3}
  imgs.push({ref,obj,jpg,raw});tot+=obj.contents.length}
 if(!imgs.length)return false;
 const other=Math.max(0,estSize-tot);let budget=target-other;if(budget<tot*.03)return false;
 const LAD=[[1,.92],[1,.85],[1,.75],[1,.65],[.85,.6],[.72,.55],[.6,.5],[.5,.45],[.4,.42],[.32,.4],[.25,.38],[.2,.36]];
 let left=tot,changed=false;
 for(let i=0;i<imgs.length;i++){const{ref,obj,jpg,raw}=imgs[i],n=obj.contents.length,r=Math.min(1,budget/left),want=n*r;left-=n;
  st(`Compressing pictures ${i+1} of ${imgs.length}…`);
  if(r>=.97){budget-=n;continue}
  let im;
  if(raw){try{const px=(obj.dict.get(N('Filter'))?L.decodePDFRawStream(obj).decode():obj.contents);if(px.length<raw.w*raw.h*raw.comps)throw 0;
    const c=document.createElement('canvas');c.width=raw.w;c.height=raw.h;const x=c.getContext('2d'),id=x.createImageData(raw.w,raw.h),o=id.data;
    for(let p=0,q=0,e=raw.w*raw.h;p<e;p++,q+=4){if(raw.comps===1){o[q]=o[q+1]=o[q+2]=px[p]}else{o[q]=px[p*3];o[q+1]=px[p*3+1];o[q+2]=px[p*3+2]}o[q+3]=255}
    x.putImageData(id,0,0);im={naturalWidth:raw.w,naturalHeight:raw.h,_c:c}}catch(e){budget-=n;continue}}
  else{try{im=await loadImg(new Blob([jpg],{type:'image/jpeg'}))}catch(e){budget-=n;continue}}
  const w0=im.naturalWidth,h0=im.naturalHeight,cap=Math.min(1,Math.sqrt(E.cap/(w0*h0)));let tries=0;
  let li=Math.max(0,(r>=.7?1:r>=.5?2:r>=.35?3:r>=.25?4:r>=.18?5:r>=.12?6:r>=.08?7:8)+E.off),best=null,bw=0,bh=0;
  for(;li<LAD.length;li++){const[sc,q]=LAD[li],w=Math.max(8,Math.round(w0*sc*cap)),h=Math.max(8,Math.round(h0*sc*cap)),c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(im._c||im,0,0,w,h);
   const b=await blobOf(c,'image/jpeg',q);c.width=c.height=1;tries++;if(!best||b.size<best.size){best=b;bw=w;bh=h}if(b.size<=want||tries>=E.tries)break}
  if(!best||best.size>=n){budget-=n;continue}
  const dict={Type:'XObject',Subtype:'Image',Width:bw,Height:bh,ColorSpace:'DeviceRGB',BitsPerComponent:8,Filter:'DCTDecode'},sm=obj.dict.get(N('SMask'));if(sm)dict.SMask=sm;
  ctx.assign(ref,ctx.stream(await img2u8(best),dict));budget-=best.size;changed=true;if(im._c)im._c.width=im._c.height=0}
 return changed}
async function rasterPdf(list,target,st,E){
 const d=await PDFLib.PDFDocument.create(),S={};let used=0;d.__bad=0;
 for(let i=0;i<list.length;i++){st(`Compressing page ${i+1} of ${list.length}…`);const rem=list.length-i,bud=Math.max(5000,(target-used-1200*rem)/rem),p=list[i];let b=null;try{b=await encodeFit(p,bud,'image/jpeg',S,E)}catch(e){b=null}
  if(!b){d.addPage([p.w||595,p.h||842]);d.__bad++;continue}used+=b.size+1200;
  const im=await d.embedJpg(await img2u8(b));d.addPage([p.w,p.h]).drawImage(im,{x:0,y:0,width:p.w,height:p.h})}
 const out=await d.save({useObjectStreams:true});out.__bad=d.__bad;return out;
 return d.save({useObjectStreams:true})}
async function exportPdf(list,pct,st,E){
 await lib(PDFLIB);st('Building PDF…');
 const raster=async p=>img2u8(await blobOf(await pageCanvas(p,2),'image/jpeg',.9));
 const orig=origOf(list);st('Reading the document…');return withBytes(list,async()=>{st('Building PDF…');const doc=await MarkupSaver.buildDoc(PDFLib,list,raster,refOf);let bad=doc.__bad||0;
 if(pct>=100||!orig)return{data:await doc.save({useObjectStreams:true}),how:'',bad};
 const target=orig*pct/100;let how='';
 if(await shrinkImages(doc,orig,target,st,E))how='pictures compressed, text kept';
 st('Saving…');let best=await doc.save({useObjectStreams:true});
 if(best.length>target*1.1){try{const r=await rasterPdf(list,target,st,E);if(r.length<best.length){best=r;bad=r.__bad||0;how='pages turned into pictures to reach this size'}}catch(e){}}
 return{data:best,how,bad}})}
$('#ego').onclick=async()=>{
 const st=$('#est'),fmt=$('#efmt').value,pct=epct,say=t=>{st.textContent=t};
 if(!dls){say('Saving is not available in this view.');return}
 const list=expList();
 if(!list.length||!list[0])return;$('#ego').disabled=true;
 if(fmt==='pdf'&&nativeBig(list)){try{await exportBig(list,pct,say,spd(),partsOn()?eparts:1)}catch(e){say('Export failed: '+(e&&e.message||e))}$('#ego').disabled=false;return}
 if(fmt!=='pdf'&&list.length>300){say('For more than 300 pages please choose PDF, or export a smaller page range.');$('#ego').disabled=false;return}
 if(fmt==='pdf'&&partsOn()){try{await exportPartsJs(list,pct,say,spd(),eparts)}catch(e){say('Export failed: '+(e&&e.message||e))}$('#ego').disabled=false;return}
 const nm=i=>`${docName}-p${pageNo(list[i])}`,prog=i=>say(`Preparing page ${i+1} of ${list.length}…`),orig=origOf(list),target=orig*pct/100,small=pct<100&&orig>0;
 const IM={png:['image/png','png'],jpg:['image/jpeg','jpg'],webp:['image/webp','webp']},S={},E=spd(),t0=performance.now();
 const pageBlob=async(i,mime,q)=>small?encodeFit(list[i],Math.max(4000,target/list.length),mime,S,E):blobOf(await pageCanvas(list[i],2),mime,q);
 try{
  let out,name,how='',bad=0;
  if(IM[fmt]){const[m,ex]=IM[fmt];let zip=null;if(list.length>1){await lib(JSZIP);zip=new JSZip()}
   for(let i=0;i<list.length;i++){prog(i);let b;try{b=await pageBlob(i,m,.92)}catch(e){bad++;continue}if(zip)zip.file(nm(i)+'.'+ex,b);else{out=b;name=nm(0)+'.'+ex}}
   if(!zip&&!out)throw new Error('this page could not be read');
   if(zip){out=await zip.generateAsync({type:'blob'});name=docName+'-pages.zip'}}
  else if(fmt==='txt'){const T=[];for(let i=0;i<list.length;i++){prog(i);T.push('--- Page '+(pages.indexOf(list[i])+1)+' ---\n'+await textOf(list[i]))}out=T.join('\n\n');name=docName+'.txt'}
  else if(fmt==='pdf'){const r=await exportPdf(list,pct,say,E);out=r.data;how=r.how;bad=r.bad||0;name=docName+(pct<100?'-'+pct+'pc':'-marked')+'.pdf'}
  else{const J=[];for(let i=0;i<list.length;i++){prog(i);const p=list[i];let b;try{b=await pageBlob(i,'image/jpeg',.9)}catch(e){bad++;continue}J.push({w:p.w,h:p.h,b})}
   if(!J.length)throw new Error('the pages could not be read');
   say('Building file…');
   if(fmt==='docx'){out=await mkDocx(J);name=docName+'.docx'}
   else if(fmt==='pptx'){out=await mkPptx(J);name=docName+'.pptx'}
   else{const U=[];for(const j of J)U.push(await b2u(j.b));out='<!DOCTYPE html><meta charset="utf-8"><title>'+docName.replace(/[<>&]/g,'')+'</title><body style="margin:0;background:#888;display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px">'+U.map(u=>`<img src="${u}" style="max-width:100%;background:#fff">`).join('');name=docName+'.html'}}
  const size=out.size!=null?out.size:out.length!=null?(out.byteLength||out.length):0;
  await dls.save({filename:name,data:out});say('Saved ✓ '+name+(size?' · '+fmtB(size)+(orig?' (original '+fmtB(orig)+')':''):'')+(how?' · '+how:'')+' · '+((performance.now()-t0)/1000).toFixed(1)+' s'+(bad?' · '+bad+' damaged page'+(bad>1?'s':'')+' could not be read and '+(bad>1?'were':'was')+' '+(fmt==='pdf'?'left blank':'left out'):''));
 }catch(e){say(e&&e.code==='declined'?'Cancelled.':'Export failed: '+((e&&(e.message||e.code))||'unknown error'))}
 $('#ego').disabled=false};
