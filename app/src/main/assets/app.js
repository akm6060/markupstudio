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
const SL=[['#e11d48','#dc2626','#f97316','#be123c','#fb7185','#831843'],['#facc15','#fde047','#f59e0b','#eab308','#fb923c','#a3e635'],['#16a34a','#22c55e','#84cc16','#15803d','#14b8a6','#065f46'],['#111827','#2563eb','#7c3aed','#0ea5e9','#6b7280','#92400e']];
const ls=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return v==null?d:v}catch(e){return d}},lset=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
/* settings for pens and for text: one slim bar above the toolbar (⚙): 4 colour dots, size / width, opacity, P|T */
let TX=Object.assign({f:'sans',sz:16,b:false,u:false,c:'#111827',a:1},ls('ms.tx',{}));TX.f='sans';
const saveTX=()=>lset('ms.tx',TX);
let chosen=ls('ms.dots',null);if(!Array.isArray(chosen)||chosen.length!==4)chosen=SL.map(o=>o[0]);
const S={pen:{w:3,a:1},line:{w:3,a:1},hl:{w:14,a:.4}};{const v=ls('ms.pens',null);if(v)for(const k in S)Object.assign(S[k],v[k]||{});color=ls('ms.pcol',color)}
const savePens=()=>{lset('ms.pens',S);lset('ms.pcol',color)};
let ptool='pen',target='p',erPrev=null,erLP=false;
/* eraser: whole stroke, or only the area touched; width in screen pixels. Long-press ⌫ shows its bar */
const ER=Object.assign({mode:'stroke',w:20},ls('ms.er',{}));
function updEbar(){const b=$('#ebar');if(!b)return;$('#ems').classList.toggle('on',ER.mode==='stroke');$('#ema').classList.toggle('on',ER.mode==='area');$('#ewv').textContent=ER.w;lset('ms.er',ER)}
let erDiv=null;function erCur(e){if(!e){if(erDiv)erDiv.style.display='none';return}if(!erDiv){erDiv=document.createElement('div');erDiv.id='ercur';document.body.appendChild(erDiv)}const d=ER.w;erDiv.style.cssText='display:block;width:'+d+'px;height:'+d+'px;left:'+(e.clientX-d/2)+'px;top:'+(e.clientY-d/2)+'px'}
/* the part of a mark under the eraser circle (c, radius r, page units) taken out; returns the mark itself if untouched */
function cutStroke(s,c,r){
 if(s.t==='tx')return dist(c,s)<=0?[]:s;
 if(s.t==='wu'||s.t==='hl'){const segs=[];let hit=false,rr=s.t==='wu'?r+s.w/2:r;
  for(const g of s.segs){const y0=s.t==='wu'?g[2]:g[1],y1=s.t==='wu'?g[2]:g[3],x0=g[0],x1=s.t==='wu'?g[1]:g[2];
   const dy=c[1]<y0?y0-c[1]:c[1]>y1?c[1]-y1:0;if(dy>=rr||c[0]+rr<x0||c[0]-rr>x1){segs.push(g);continue}
   const dx=Math.sqrt(rr*rr-dy*dy),a=c[0]-dx,b=c[0]+dx;if(b<=x0||a>=x1){segs.push(g);continue}hit=true;
   const mk=(u,v)=>s.t==='wu'?[u,v,g[2]]:[u,g[1],v,g[3]];if(a-x0>.8)segs.push(mk(x0,a));if(x1-b>.8)segs.push(mk(b,x1))}
  return hit?(segs.length?[Object.assign({},s,{segs})]:[]):s}
 const q=s.p;if(!q||!q.length)return s;const rr=r+(s.w||2)/2,inC=pt=>Math.hypot(pt[0]-c[0],pt[1]-c[1])<rr;
 if(q.length===1)return inC(q[0])?[]:s;
 const P=[q[0]];for(let i=1;i<q.length;i++){const a=q[i-1],b=q[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(L/Math.max(.5,r/3));for(let k=1;k<=n;k++)P.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n])}
 if(!P.some(inC))return s;
 const out=[];let run=[];const flush=()=>{if(run.length>=2)out.push(Object.assign({},s,{p:s.t==='line'?[run[0],run[run.length-1]]:run}));run=[]};
 for(const pt of P){if(inC(pt))flush();else run.push(pt)}flush();return out}
const sbar=$('#sbar'),sdots=$('#sdots'),penT=()=>S[tool]?tool:ptool;
const cm=document.createElement('div');cm.id='cm';cm.hidden=true;document.body.appendChild(cm);
function updBar(){const isT=target==='t',pt=S[penT()],col=isT?TX.c:color;
 $('#stp').classList.toggle('on',!isT);$('#stt').classList.toggle('on',isT);
 [...sdots.children].forEach((b,i)=>{b.style.background=chosen[i];b.classList.toggle('on',chosen[i].toLowerCase()===String(col).toLowerCase())});
 $('#ssl').textContent=isT?'Size':'Width';$('#ssv').textContent=isT?TX.sz:pt.w;$('#sov').textContent=Math.round((isT?(TX.a==null?1:TX.a):pt.a)*100)+'%';
 $('#cfg').classList.toggle('on',!sbar.hidden)}
function setColor(c){if(target==='t'){TX.c=c;txApply('c')}else{color=c;savePens()}updBar()}
/* colour mixer for one of the 4 dots: shades + Hue / Strength / Light sliders (works for pens and for text) */
const hex2hsl=h=>{const f=String(h).replace('#','');let r=parseInt(f.slice(0,2),16)/255,g=parseInt(f.slice(2,4),16)/255,b=parseInt(f.slice(4,6),16)/255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2;let hh=0,ss=0;
 if(mx!==mn){const d=mx-mn;ss=l>.5?d/(2-mx-mn):d/(mx+mn);hh=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;hh*=60}return[Math.round(hh),Math.round(ss*100),Math.round(l*100)]};
const hsl2hex=(h,s,l)=>{s/=100;l/=100;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return'#'+[f(0),f(8),f(4)].map(x=>('0'+Math.round(x*255).toString(16)).slice(-2)).join('')};
function shades(i){cm.innerHTML='';const top=document.createElement('div');top.className='cmr';
 SL[i].concat(['#000000','#ffffff']).forEach(c=>{const x=document.createElement('button');x.className='sw';x.style.background=c;x.onclick=()=>pick(c,true);top.appendChild(x)});cm.appendChild(top);
 let hsl=hex2hsl(/^#[0-9a-f]{6}$/i.test(chosen[i])?chosen[i]:'#000000');
 const pv=document.createElement('div');pv.className='cmpv';
 const mkS=(name,max,bg,idx)=>{const row=document.createElement('div');row.className='cms';row.innerHTML='<span>'+name+'</span><div class="trk"><i></i></div>';const trk=row.querySelector('.trk'),knob=row.querySelector('i');
  const show=()=>{knob.style.left=(hsl[idx]/max*100)+'%';trk.style.background=bg()};
  const at=e=>{const r=trk.getBoundingClientRect();hsl[idx]=Math.round(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*max);pick(hsl2hex(...hsl),false)};
  trk.addEventListener('pointerdown',e=>{e.preventDefault();trk.setPointerCapture(e.pointerId);at(e)});trk.addEventListener('pointermove',e=>{if(trk.hasPointerCapture(e.pointerId))at(e)});
  row._show=show;cm.appendChild(row);return row};
 const rows=[mkS('Hue',360,()=>'linear-gradient(90deg,'+[0,60,120,180,240,300,360].map(h=>hsl2hex(h,Math.max(hsl[1],40),Math.min(Math.max(hsl[2],30),70))).join(',')+')',0),
  mkS('Strength',100,()=>'linear-gradient(90deg,'+hsl2hex(hsl[0],0,hsl[2])+','+hsl2hex(hsl[0],100,hsl[2])+')',1),
  mkS('Light',100,()=>'linear-gradient(90deg,#000,'+hsl2hex(hsl[0],hsl[1],50)+',#fff)',2)];
 cm.appendChild(pv);
 function pick(c,fromShade){chosen[i]=c;lset('ms.dots',chosen);setColor(c);if(fromShade)hsl=hex2hsl(c);pv.style.background=c;rows.forEach(r=>r._show())}
 pv.style.background=chosen[i];rows.forEach(r=>r._show());cm.hidden=false}
chosen.forEach((c,i)=>{const b=document.createElement('button');b.className='sw';b.setAttribute('aria-label','Colour '+(i+1));let lt=0,lp=false;
 b.addEventListener('pointerdown',()=>{lp=false;clearTimeout(lt);lt=setTimeout(()=>{lp=true;setColor(chosen[i]);shades(i)},450)});['pointerup','pointercancel','pointerleave'].forEach(n=>b.addEventListener(n,()=>clearTimeout(lt)));
 b.onclick=()=>{if(lp){lp=false;return}const col=target==='t'?TX.c:color;if(chosen[i].toLowerCase()===String(col).toLowerCase()){if(cm.hidden)shades(i);else cm.hidden=true}else{cm.hidden=true;setColor(chosen[i])}};sdots.appendChild(b)});
document.addEventListener('pointerdown',e=>{if(!cm.contains(e.target)&&!sdots.contains(e.target))cm.hidden=true});
const clampN=(v,a,b)=>Math.max(a,Math.min(b,v));
function sizeStep(d){if(target==='t'){TX.sz=clampN(TX.sz+(d*(TX.sz+d>=20?2:1)),4,50);txApply('sz')}else{const pt=S[penT()];pt.w=clampN(pt.w+d*(pt.w+d<6?1:2),1,40);savePens()}updBar()}
function opac(d){if(target==='t'){TX.a=clampN(Math.round(((TX.a==null?1:TX.a)+d*.1)*10)/10,.1,1);txApply('a')}else{const pt=S[penT()];pt.a=clampN(Math.round((pt.a+d*.1)*10)/10,.1,1);savePens()}updBar()}
$('#ssm').onclick=()=>sizeStep(-1);$('#ssp').onclick=()=>sizeStep(1);$('#som').onclick=()=>opac(-1);$('#sop').onclick=()=>opac(1);
$('#stp').onclick=()=>{target='p';updBar()};$('#stt').onclick=()=>{target='t';updBar()};
function openBar(t){sbar.hidden=false;{const e2=$('#ebar');if(e2)e2.hidden=true}const ib=$('#ibar');if(ib&&!ib.hidden){ib.hidden=true;$('#pic').classList.toggle('on',(document.body.style.getPropertyValue('--pf')||'none')!=='none')}target=t||((tool==='text'||(typeof ED!=='undefined'&&ED))?'t':'p');cm.hidden=true;updBar()}
$('#cfg').onclick=()=>{if(sbar.hidden)openBar();else{sbar.hidden=true;cm.hidden=true;updBar()}};
/* tapping the bars never takes the cursor out of a text box (the keyboard stays) */
['#bar','#sbar'].forEach(q=>$(q).addEventListener('pointerdown',e=>{if(typeof ED!=='undefined'&&ED&&!(e.target.closest&&e.target.closest('input,select,textarea')))e.preventDefault()}));
cm.addEventListener('pointerdown',e=>{if(typeof ED!=='undefined'&&ED)e.preventDefault()});
function setTool(t){if(t==='scroll'&&typeof txClose==='function')txClose();if(t==='erase'&&tool!=='erase')erPrev=tool;else if(t!=='erase')erPrev=null;tool=t;if(S[t])ptool=t;if(!sbar.hidden)target=t==='text'?'t':S[t]?'p':target;
 [...$('#tools').children].forEach(x=>x.classList.toggle('on',x.dataset.t===t));document.body.classList.forEach(c=>{if(c.startsWith('t-'))document.body.classList.remove(c)});document.body.classList.add('t-'+t);pages.forEach(p=>p.cancel&&p.cancel());updBar();txMark()}
function txMark(){const b=$('#ttx');if(b)b.classList.toggle('txon',typeof ED!=='undefined'&&!!ED&&tool!=='text')}
window.__setTool=setTool;
$('#tools').onclick=e=>{const b=e.target.closest('button');if(!b||b.id==='ttx')return;if(b.dataset.t==='erase'&&erLP){erLP=false;return}setTool(b.dataset.t)};
updBar();

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
  const p1=await doc.getPage(1);patchOC(p1);const v=p1.getViewport({scale:1}),sz=ab?ab.length:src.size;
  return Array.from({length:doc.numPages},(_,i)=>({kind:'pdf',doc,bytes:ab,src,pn:i+1,page:i?null:p1,w:v.width,h:v.height,osize:sz/doc.numPages}))}
 if(t.startsWith('image/'))return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const k=Math.min(1,2400/Math.max(im.naturalWidth,im.naturalHeight)),c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*k);c.height=Math.round(im.naturalHeight*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);ok([{kind:'cv',cv:c,w:612,h:Math.round(612*c.height/c.width)}])};im.onerror=no;im.src=r.result};r.onerror=no;r.readAsDataURL(f)});
 if(n.endsWith('.docx')){await lib('libs/mammoth.browser.min.js');const r=await mammoth.extractRawText({arrayBuffer:await f.arrayBuffer()});return textPages(r.value,f.name)}
 if(/\.(xlsx|xls|xlsm|ods)$/.test(n)){await lib('libs/xlsx.full.min.js');const wb=XLSX.read(new Uint8Array(await f.arrayBuffer()),{type:'array'});return wb.SheetNames.flatMap(s=>textPages(XLSX.utils.sheet_to_csv(wb.Sheets[s]),f.name+' · '+s))}
 const txt=await f.text();if(/[\x00-\x08\x0e-\x1f]/.test(txt.slice(0,3000)))throw new Error('binary');
 return textPages(txt,n.endsWith('.txt')?null:f.name)}
async function openFiles(files,replace){
 if(window.__flushSave)await window.__flushSave();          // the open document's last changes are saved first
 /* a really big book from the phone: cut once into part files, then only one part is ever in memory */
 const f0=files[0];
 if(files.length===1&&(replace||!pages.length)&&f0._url&&f0._nid&&window.__pdfJob&&/\.pdf$/i.test(f0.name||'')&&f0.size>SPLITMIN){
  if(await openSplitBook(f0,window.__wantPage||0)){window.__wantPage=0;return}}
 let all=[],bad=[];for(const f of files){try{const ps=await ingest(f);ps.forEach((p,i)=>{p.nid=f._nid;p.sidx=i+1;p.fname=f.name;if(!p.osize)p.osize=(f.size||0)/ps.length});all.push(...ps)}catch(e){bad.push(f.name)}}
 if(bad.length)alert('Unsupported or unreadable: '+bad.join(', '));
 if(!all.length)return;
 if(replace||BOOK){window.__beforeReplace&&window.__beforeReplace();pages.forEach(rm);pages=[];undo=[];setDirty(false);closeBook()}
 const fresh=!pages.length;if(fresh){window.__fromGrid=false;docPrimary=all[0].nid||0;docName=(files[0].name||'document').replace(/\.[^.]+$/,'');base=scale=fitW(all[0].w);const zr=savedZoom();zoomed=zr!==1;scale=base*zr;$('#view').scrollTop=0;$('#view').scrollLeft=0;setTool('scroll')}
 const added=addPages(all,inGrid()?insIdx():pages.length);
 if(!fresh)setDirty();
 if(inGrid())buildGrid();
 window.__docChanged&&window.__docChanged(fresh,added);thumbLoop()}
function insIdx(){let k=-1;pages.forEach((p,i)=>{if(p.sel)k=i});return k<0?pages.length:k+1}
const fitW=w=>Math.max(.3,Math.min(4,($('#view').clientWidth-16)/w));
$('#open2').onclick=()=>$('#file').click();$('#gfile').onclick=()=>$('#file2').click();
$('#file').onchange=e=>{const fs=[...e.target.files];e.target.value='';if(fs.length)openFiles(fs,pages.length?confirm('Replace the current document?\nOK = replace · Cancel = add to the end'):true)};
$('#file2').onchange=e=>{const fs=[...e.target.files];e.target.value='';if(fs.length)openFiles(fs,false)};
['dragover','drop'].forEach(n=>document.addEventListener(n,e=>{e.preventDefault();if(n==='drop'&&e.dataTransfer.files.length)openFiles([...e.dataTransfer.files],false)}));

/* ---------- pages ---------- */
const io=new IntersectionObserver(es=>es.forEach(en=>{const p=en.target._p;if(!p)return;p.vis=en.isIntersecting;if(en.isIntersecting){showPreview(p);showHi(p)}else{hidePreview(p);hideHi(p)}}),{root:$('#view'),rootMargin:'700px 0px'});
/* layers inside a page frame, bottom to top: small preview 0, sharp picture 1, live canvas 2, marks 3, anything else above */
function place(p,el,rk){el._rk=rk;const w=p.wrap;let b=null;for(const c of w.children){if(c===el)continue;if((c._rk==null?9:c._rk)>rk){b=c;break}}w.insertBefore(el,b)}
/* sharp picture of a page kept as a compact JPEG while the page is within 10 pages of the place you read */
function showHi(p){if(!p.hurl||!p.vis||p.pc)return;if(!p.him){const im=document.createElement('img');im.className='pim';p.him=im;im.src=p.hurl;place(p,im,1)}else if(p.him.src!==p.hurl)p.him.src=p.hurl;if(p.strokes.length&&!p.oc)redraw(p)}
function hideHi(p){if(p.him){p.him.removeAttribute('src');p.him.remove();p.him=null}if(p.oc&&!p.pc){p.oc.width=p.oc.height=0;p.oc.remove();p.oc=null}}
function dropHi(p){unrender(p);hideHi(p);if(p.hurl){URL.revokeObjectURL(p.hurl);p.hurl=null}p.hscale=0}
const isFresh=p=>(p.pc&&p.pcs===scale)||(p.hurl&&p.hscale===scale);
const drawn=new Set();
/* free a page's pictures and the PDF engine's cached data for it */
function unrender(p){if(p.task)try{p.task.cancel()}catch(e){}p.task=null;p.done=false;drawn.delete(p);
 if(p.pc){p.pc.width=p.pc.height=0;p.pc.remove();p.pc=null}
 if(p.oc){p.oc.width=p.oc.height=0;p.oc.remove();p.oc=null}
 if(p.page)try{p.page.cleanup()}catch(e){}
 showHi(p)}
/* keep only a few pages drawn: drop the ones furthest from the screen */
function trimDrawn(){if(drawn.size<=MEM.keep)return;const vr=$('#view').getBoundingClientRect(),mid=(vr.top+vr.bottom)/2;
 const list=[...drawn].map(p=>{const r=p.wrap.getBoundingClientRect();return{p,d:Math.abs((r.top+r.bottom)/2-mid)}}).sort((a,b)=>b.d-a.d);
 while(list.length>MEM.keep){const x=list.shift();unrender(x.p)}}
window.__lowMemory=()=>{const vr=$('#view').getBoundingClientRect();pages.forEach(p=>{const r=p.wrap.getBoundingClientRect();if(r.bottom<vr.top-50||r.top>vr.bottom+50){unrender(p);if(r.bottom<vr.top-3000||r.top>vr.bottom+3000)dropHi(p)}p.thumb=null;if(!r||r.bottom<vr.top-50||r.top>vr.bottom+50){p.read=null}})};
function mkPage(d){const wrap=document.createElement('div');wrap.className='pg';
 const p={...d,rec:d.rec||d,wrap,pc:null,oc:null,him:null,hurl:null,hscale:0,pimg:null,rendering:null,strokes:d.strokes||(d.strokes=[]),done:false,task:null,sel:false,words:null,thumb:null};wrap._p=p;bind(p);size(p);return p}
function addPages(ds,idx){const ps=ds.map(mkPage);pages.splice(idx,0,...ps);reorderDOM();ps.forEach(p=>io.observe(p.wrap));syncEmpty();upd();settle(60);return ps}
const reorderDOM=()=>pages.forEach(p=>host.appendChild(p.wrap));
function rm(p){dropHi(p);hidePreview(p);io.unobserve(p.wrap);p.wrap.remove()}
const syncEmpty=()=>{$('#empty').style.display=pages.length?'none':''};
/* frame size only; the pictures keep their pixels (stretched) until the page is drawn again */
function size(p){const W=p.w*scale,H=p.h*scale;p.pr=Math.min(dpr,Math.sqrt(MEM.px/Math.max(1,W*H)));p.wrap.style.width=W+'px';p.wrap.style.height=H+'px';for(const c of [p.pc,p.oc])if(c){c.style.width=W+'px';c.style.height=H+'px'}}
function canvasFor(p,cls){const c=document.createElement('canvas');if(cls)c.className=cls;c.style.position='absolute';c.style.left=c.style.top='0';c.style.width=p.w*scale+'px';c.style.height=p.h*scale+'px';c.width=Math.max(1,Math.round(p.w*scale*p.pr));c.height=Math.max(1,Math.round(p.h*scale*p.pr));return c}
/* PDFs saved by this app keep the marks as an optional layer: hidden here, the marks are drawn from their list */
let ocPatched=false;
function patchOC(pg){if(ocPatched||!pg)return;const P=Object.getPrototypeOf(pg),R=P&&P.render;if(!R)return;ocPatched=true;
 P.render=function(o){const t=this._transport;if(o&&!o.optionalContentConfigPromise&&t&&t.getOptionalContentConfig){if(!t.__msOC)t.__msOC=t.getOptionalContentConfig().then(cfg=>{try{const g=cfg.getGroups()||{};for(const id in g)if(g[id]&&g[id].name==='Markup Studio marks')cfg.setVisibility(id,false)}catch(e){}return cfg});o=Object.assign({},o,{optionalContentConfigPromise:t.__msOC})}return R.call(this,o)}}
async function ensure(p){if(p.kind==='pdf'&&!p.page){if(!p.doc){if(BOOK&&p.part!=null)p.doc=await partDocFor(p.part);else throw new Error('page not loaded')}p.page=await p.doc.getPage(p.lpn||p.pn);patchOC(p.page);const v=p.page.getViewport({scale:1});p.w=v.width;p.h=v.height}}
/* pdf.js object number of a page, so the saver can find it even in a damaged page tree */
const refOf=async p=>{try{await ensure(p);return p.page&&p.page.ref||null}catch(e){return null}};
window.__refOf=refOf;
async function paint(p,ctx,k,reg){
 ctx.fillStyle='#fff';ctx.fillRect(0,0,p.w*k,p.h*k);
 if(p.kind==='pdf'){await ensure(p);const t=p.page.render({canvasContext:ctx,viewport:p.page.getViewport({scale:k})});if(reg)reg.task=t;await t.promise}
 else if(p.kind==='cv')ctx.drawImage(p.cv,0,0,p.w*k,p.h*k);
 else if(p.kind==='txt'){ctx.fillStyle='#111';ctx.font=`${9*k}px "Courier New",Courier,monospace`;ctx.textBaseline='top';p.lines.forEach((l,i)=>ctx.fillText(l,40*k,(40+i*12)*k))}}
function render(p){if(p.rendering&&p.rsc===scale)return p.rendering;const r=p.rendering=render1(p);p.rsc=scale;r.finally(()=>{if(p.rendering===r)p.rendering=null});return r}
async function render1(p){
 p.done=true;if(p.task)try{p.task.cancel()}catch(e){}
 try{await ensure(p)}catch(e){p.done=false;return}
 if(!pages.includes(p))return;
 const sc=scale;size(p);const c=canvasFor(p);drawn.add(p);
 try{await paint(p,c.getContext('2d'),sc*p.pr,p)}catch(e){c.width=c.height=0;drawn.delete(p);p.done=false;return}
 if(!p.done||!pages.includes(p)||sc!==scale){c.width=c.height=0;drawn.delete(p);return}
 if(p.pc){p.pc.width=p.pc.height=0;p.pc.remove()}p.pc=c;p.pcs=sc;place(p,c,2);
 if(p.him){p.him.removeAttribute('src');p.him.remove();p.him=null}
 if(p.oc){p.oc.width=p.oc.height=0;p.oc.remove();p.oc=null}
 redraw(p);
 /* keep a compact copy so the page stays sharp after its canvas is freed */
 try{const b=await blobOf(c,'image/jpeg',.9);if(b&&p.pc===c&&sc===scale){if(p.hurl)URL.revokeObjectURL(p.hurl);p.hurl=URL.createObjectURL(b);p.hscale=sc}}catch(e){}
 trimDrawn()}
function drawS(ctx,s){
 const k=scale*dpr;
 if(s.t==='tx'){drawTx(ctx,s,k);return}
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
 if(!p.oc||p.oc.width!==Math.max(1,Math.round(p.w*scale*p.pr))){if(p.oc){p.oc.width=p.oc.height=0;p.oc.remove()}p.oc=canvasFor(p,'oc');place(p,p.oc,3)}
 const c=p.oc.getContext('2d'),od=dpr;dpr=p.pr||dpr;try{c.clearRect(0,0,p.oc.width,p.oc.height);p.strokes.forEach(s=>{if(!ED||ED.s!==s)drawS(c,s)});if(extra)drawS(c,extra)}finally{dpr=od}}
function dist(pt,s){
 let m=1e9;
 if(s.t==='tx')return Math.hypot(Math.max(s.x-pt[0],0,pt[0]-s.x-s.w),Math.max(s.y-pt[1],0,pt[1]-s.y-s.h));
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
 let erSnap=null;
 const erase=e=>{const x=pt(e),r=ER.w/2/scale;erCur(e);
  if(ER.mode==='stroke'){for(let i=p.strokes.length-1;i>=0;i--){const s=p.strokes[i];if(ED&&ED.s===s)continue;if(dist(x,s)<=(s.t==='tx'?0:s.w/2)+r){p.strokes.splice(i,1);undo.push({k:'del',p,s,i});edited(p);redraw(p);break}}return}
  let ch=false;const out=[];for(const s of p.strokes){if(ED&&ED.s===s){out.push(s);continue}const res=cutStroke(s,x,r);if(res===s)out.push(s);else{ch=true;out.push(...res)}}
  if(ch){if(!erSnap)erSnap=p.strokes.slice();p.strokes.splice(0,p.strokes.length,...out);edited(p);redraw(p)}};
 oc.onpointerdown=e=>{
  if(tool==='text'){if(e.isPrimary&&!(e.target&&e.target.classList&&e.target.classList.contains('txed')))txDown={p,x:e.clientX,y:e.clientY,pt:pt(e)};return}
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
 const end=()=>{if(cur==='erase'){erCur(null);if(erSnap){undo.push({k:'rep',p,before:erSnap});erSnap=null}cur=null;if(erPrev&&erPrev!=='erase'){const t=erPrev;erPrev=null;setTool(t)}return}
  if(cur&&cur!=='erase'){const s=build(cur,p),ok=s.t!=='line'||Math.hypot(s.p[1][0]-s.p[0][0],s.p[1][1]-s.p[0][1])>2;if(ok){p.strokes.push(s);undo.push({k:'add',p,s});edited(p)}redraw(p)}cur=null};
 oc.onpointerup=e=>{if(tool==='text'){const d=txDown;txDown=null;if(d&&d.p===p&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<12)txTap(p,d.pt);return}end()};oc.onpointercancel=()=>{txDown=null;end()};
}
$('#undo').onclick=doUndo;
function doUndo(){txClose();const a=undo.pop();if(!a)return;
 if(a.k==='pages'){const keep=new Set(a.before);for(const p of pages)if(!keep.has(p))rm(p);const had=new Set(pages);for(const p of a.before)if(!had.has(p))io.observe(p.wrap);pages=a.before;reorderDOM();syncEmpty();changed(true);if(inGrid())buildGrid();upd();settle(0);return}
 if(!pages.includes(a.p)){doUndo();return}
 if(a.k==='rep'){a.p.strokes.splice(0,a.p.strokes.length,...a.before);edited(a.p);redraw(a.p);return}
 if(a.k==='add'){const i=a.p.strokes.indexOf(a.s);if(i>-1)a.p.strokes.splice(i,1)}else if(a.k==='tx'){restoreTx(a.s,a.before);if(a.p.strokes.indexOf(a.s)<0)a.p.strokes.push(a.s)}else a.p.strokes.splice(a.i,0,a.s);edited(a.p);redraw(a.p)}
/* a page's marks changed: saved by itself a moment later */
function edited(p){p.ver=(p.ver||0)+1;p.tstale=true;setDirty()}
window.__edited=edited;
/* ---------- text: tap T, touch the page where the text starts, type.
   Each letter keeps its own size, colour and opacity: a change in the ⚙ bar applies to what is typed next
   (or to the letters selected), never to the whole box. A text mark = lines of runs {t, sz, c, a}. ---------- */
let ED=null,txDown=null;
const txFont=(sz,k,b)=>(b?'700 ':'400 ')+(sz*k).toFixed(2)+'px sans-serif';
const mctx=document.createElement('canvas').getContext('2d');
const rgbaOf=(c,a)=>{const h=String(c||'#000').replace('#',''),f=h.length===3?h.split('').map(x=>x+x).join(''):h;return`rgba(${parseInt(f.slice(0,2),16)},${parseInt(f.slice(2,4),16)},${parseInt(f.slice(4,6),16)},${a==null?1:a})`};
const hexOf=css=>{const m=String(css).match(/[\d.]+/g)||[0,0,0];const h=n=>('0'+Math.round(+n).toString(16)).slice(-2);return{c:'#'+h(m[0])+h(m[1])+h(m[2]),a:m.length>3?Math.round(+m[3]*100)/100:1}};
function runsOf(s){if(s.runs)return s.runs;return String(s.text||'').split('\n').map(l=>l?[{t:l,sz:s.sz||16,c:s.c||'#111827',a:s.a==null?1:s.a}]:[])}
const lineSz=(L,s)=>L.length?Math.max(...L.map(r=>r.sz)):(s.sz||16);
function txLayout(s){const R=runsOf(s);let w=0,h=0;for(const L of R){let lw=0;for(const r of L){mctx.font=txFont(r.sz,4,s.b);lw+=mctx.measureText(r.t).width/4}w=Math.max(w,lw);h+=lineSz(L,s)*1.3}
 const m=R.length?lineSz(R[0],s):s.sz||16;s.w=Math.max(w,m*.4)+m*.15;s.h=Math.max(h,m*1.3)+m*.15;s.text=R.map(L=>L.map(r=>r.t).join('')).join('\n')}
function drawTx(ctx,s,k){const R=runsOf(s);if(!R.some(L=>L.length))return;ctx.save();ctx.textBaseline='alphabetic';let y=s.y;
 for(const L of R){const m=lineSz(L,s),yb=(y+m*1.02)*k;let x=s.x*k;
  for(const r of L){ctx.font=txFont(r.sz,k,s.b);ctx.fillStyle=r.c;ctx.globalAlpha=r.a==null?1:r.a;ctx.fillText(r.t,x,yb);const w=ctx.measureText(r.t).width;if(s.u)ctx.fillRect(x,yb+r.sz*.14*k,w,Math.max(1,r.sz*.07*k));x+=w}
  y+=m*1.3}
 ctx.restore()}
window.__txFonts=list=>{};
/* the text as a picture for the saved file (Hindi joins letters correctly) */
window.__txImg=s=>{txLayout(s);if(!s.text)return null;const k=4;const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(s.w*k));c.height=Math.max(1,Math.ceil(s.h*k));const x=c.getContext('2d');x.translate(-s.x*k,-s.y*k);drawTx(x,s,k);const u=c.toDataURL('image/png');c.width=c.height=0;return u};
/* the editing box: spans with their own size / colour */
const spanCss=(sz,c,a)=>'font-size:'+(sz*scale).toFixed(2)+'px;color:'+rgbaOf(c,a);
function txBuild(s){const d=ED.ta;d.innerHTML='';const R=runsOf(s);
 R.forEach((L,i)=>{const line=i?document.createElement('div'):d;if(i)d.appendChild(line);
  if(!L.length&&i){line.appendChild(document.createElement('br'));return}
  for(const r of L){const sp=document.createElement('span');sp.style.cssText=spanCss(r.sz,r.c,r.a);sp.textContent=r.t;line.appendChild(sp)}})}
function txToks(){const d=ED.ta,toks=[];
 (function walk(n){for(const ch of n.childNodes){if(ch.nodeType===3){const t=ch.nodeValue.replace(/​/g,'');if(t){const cs=getComputedStyle(ch.parentElement),o=hexOf(cs.color);toks.push({t,sz:Math.round(parseFloat(cs.fontSize)/scale*10)/10,c:o.c,a:o.a,n:ch})}}
  else if(ch.nodeName==='BR')toks.push('BR');else if(ch.nodeType===1){const bl=/^(DIV|P)$/.test(ch.nodeName);if(bl)toks.push('BS');walk(ch);if(bl)toks.push('BE')}}})(d);
 return toks}
/* (line, column) of a point of the editing box */
function txPos(node,off){const toks=txToks();let line=0,col=0;const pt=document.createRange();pt.setStart(node,off);
 for(const k of toks){if(k==='BR'){line++;col=0;continue}if(k==='BS'||k==='BE'){if(col){line++;col=0}continue}
  const v=k.n.nodeValue;let before;if(k.n===node)before=v.slice(0,off).replace(/​/g,'').length;else before=pt.comparePoint(k.n,0)<0?k.t.length:0;
  if(before<k.t.length)return{l:line,c:col+before};col+=k.t.length}
 return{l:line,c:col}}
function txRead(){const toks=txToks(),lines=[[]];const cur=()=>lines[lines.length-1];
 for(const k of toks){if(k==='BR')lines.push([]);else if(k==='BS'||k==='BE'){if(cur().length)lines.push([])}
  else{const L=cur(),l=L[L.length-1];if(l&&l.sz===k.sz&&l.c===k.c&&l.a===k.a)l.t+=k.t;else L.push({t:k.t,sz:k.sz,c:k.c,a:k.a})}}
 while(lines.length>1&&!lines[lines.length-1].length)lines.pop();
 return lines}
/* change one property (size, colour or opacity) of the letters from a to b, nothing else */
function txRestyle(R,a,b,prop,val){for(let l=a.l;l<=b.l&&l<R.length;l++){const c0=l===a.l?a.c:0,c1=l===b.l?b.c:1e9,out=[];let c=0;
  for(const r of R[l]){const s0=c,s1=c+r.t.length;c=s1;const x0=Math.max(s0,c0),x1=Math.min(s1,c1);
   if(x1<=x0){out.push(r);continue}
   if(x0>s0)out.push(Object.assign({},r,{t:r.t.slice(0,x0-s0)}));out.push(Object.assign({},r,{t:r.t.slice(x0-s0,x1-s0),[prop]:val}));if(s1>x1)out.push(Object.assign({},r,{t:r.t.slice(x1-s0)}))}
  const m=[];for(const r of out){const p=m[m.length-1];if(p&&p.sz===r.sz&&p.c===r.c&&p.a===r.a)p.t+=r.t;else m.push(r)}R[l]=m}}
/* DOM point for (line, column) after the box was built again */
function txPoint(pos){const d=ED.ta,lines=[[...d.childNodes].filter(n=>n.nodeName==='SPAN')].concat([...d.children].filter(n=>n.nodeName==='DIV').map(x=>[...x.querySelectorAll('span')]));
 const L=lines[Math.min(pos.l,lines.length-1)]||[];let c=pos.c;for(const sp of L){const t=sp.firstChild;if(!t)continue;if(c<=t.nodeValue.length)return[t,c];c-=t.nodeValue.length}
 const last=L[L.length-1];return last&&last.firstChild?[last.firstChild,last.firstChild.nodeValue.length]:[d,0]}
function txSync(){if(!ED)return;const s=ED.s;s.runs=txRead();txLayout(s)}
function txStyle(){if(!ED)return;const s=ED.s,d=ED.ta;d.style.left=s.x*scale+'px';d.style.top=(s.y*scale)+'px';d.style.cssText+=';'+spanCss(TX.sz,TX.c,TX.a)+';min-width:'+(TX.sz*2*scale)+'px';d.style.fontWeight=s.b?'700':'400'}
let txT=0;
const plainOf=d=>(d.innerText||'').replace(/​/g,'');
function txOpen(p,s,isNew){
 txClose();const d=document.createElement('div');d.className='txed';d.contentEditable='true';d.setAttribute('autocapitalize','sentences');d.setAttribute('spellcheck','false');d._rk=8;p.wrap.appendChild(d);
 ED={p,s,ta:d,isNew,before:isNew?null:JSON.parse(JSON.stringify(s)),range:null,pend:null};txMark();if(isNew)p.strokes.push(s);txStyle();txBuild(s);redraw(p);
 d.addEventListener('input',()=>{txSync();clearTimeout(txT);txT=setTimeout(()=>{if(ED&&ED.s===s&&s.text)edited(p)},500)});
 d.addEventListener('paste',e=>{e.preventDefault();const t=(e.clipboardData||window.clipboardData).getData('text');document.execCommand('insertText',false,t)});
 d.addEventListener('pointerdown',e=>e.stopPropagation());
 d.focus();try{const r=document.createRange();r.selectNodeContents(d);r.collapse(false);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);ED.range=r.cloneRange()}catch(e){}}
document.addEventListener('selectionchange',()=>{if(!ED)return;const sel=getSelection();if(sel.rangeCount&&ED.ta.contains(sel.getRangeAt(0).commonAncestorContainer))ED.range=sel.getRangeAt(0).cloneRange()});
/* a size / colour / opacity change while typing: only for the letters selected, or for what is typed next */
function txStyleAt(kind){if(!ED)return;const d=ED.ta,sel=getSelection();let r=sel.rangeCount&&d.contains(sel.getRangeAt(0).commonAncestorContainer)?sel.getRangeAt(0):ED.range;
 if(!r||!d.contains(r.commonAncestorContainer)){r=document.createRange();r.selectNodeContents(d);r.collapse(false)}
 const full=spanCss(TX.sz,TX.c,TX.a);
 if(!r.collapsed){const a=txPos(r.startContainer,r.startOffset),b=txPos(r.endContainer,r.endOffset),R=txRead();
  txRestyle(R,a,b,kind,kind==='sz'?TX.sz:kind==='c'?TX.c:TX.a);ED.s.runs=R;txBuild(ED.s);
  const p0=txPoint(a),p1=txPoint(b),nr=document.createRange();try{nr.setStart(p0[0],p0[1]);nr.setEnd(p1[0],p1[1])}catch(e){nr.selectNodeContents(d);nr.collapse(false)}sel.removeAllRanges();sel.addRange(nr);ED.range=nr.cloneRange();ED.pend=null}
 else{let sp=ED.pend;
  if(!(sp&&sp.isConnected&&sp.textContent==='​')){sp=document.createElement('span');sp.textContent='​';r.insertNode(sp);ED.pend=sp}
  sp.style.cssText=full;const nr=document.createRange();nr.setStart(sp.firstChild,1);nr.collapse(true);sel.removeAllRanges();sel.addRange(nr);ED.range=nr.cloneRange()}
 txSync();clearTimeout(txT);txT=setTimeout(()=>{if(ED&&ED.s.text)edited(ED.p)},500)}
const restoreTx=(s,b)=>{for(const k of Object.keys(s))if(!(k in b))delete s[k];Object.assign(s,b)};
function txClose(){if(!ED)return;txSync();const{p,s,ta,isNew,before}=ED;ED=null;txMark();clearTimeout(txT);ta.blur();ta.remove();
 if(s.runs){const L=s.runs[s.runs.length-1];if(L&&L.length){L[L.length-1].t=L[L.length-1].t.replace(/\s+$/,'');if(!L[L.length-1].t)L.pop()}while(s.runs.length&&!s.runs[s.runs.length-1].length)s.runs.pop();txLayout(s)}
 const i=p.strokes.indexOf(s);
 if(!s.text.trim()){if(i>-1)p.strokes.splice(i,1);if(!isNew){restoreTx(s,before);undo.push({k:'del',p,s,i:Math.max(0,i)})}if(!isNew||before)edited(p)}
 else{if(isNew)undo.push({k:'add',p,s});else if(JSON.stringify(before)!==JSON.stringify(s))undo.push({k:'tx',p,s,before});edited(p)}
 redraw(p)}
window.__txClose=txClose;
function txHit(p,pt){for(let i=p.strokes.length-1;i>=0;i--){const s=p.strokes[i];if(s.t==='tx'&&pt[0]>=s.x-4&&pt[0]<=s.x+s.w+4&&pt[1]>=s.y-4&&pt[1]<=s.y+s.h+4)return s}return null}
function txNew(x,y){return{t:'tx',x,y,runs:[[]],text:'',f:'sans',sz:TX.sz,b:false,u:false,c:TX.c,a:TX.a==null?1:TX.a,w:0,h:0}}
function txTap(p,pt){const hit=txHit(p,pt);
 if(hit){if(ED&&ED.s===hit){ED.ta.focus();return}txOpen(p,hit,false);return}
 if(ED&&!plainOf(ED.ta).trim()&&ED.p===p){ED.s.x=pt[0];ED.s.y=pt[1]-TX.sz*.75;txStyle();ED.ta.focus();return}   // empty box: just move it
 txOpen(p,txNew(pt[0],pt[1]-TX.sz*.75),true)}
/* T pressed: a text box opens on the page you are looking at (touch anywhere to start the text there instead) */
function txStart(){const p=cur_page();if(!p)return;const vr=$('#view').getBoundingClientRect(),r=p.wrap.getBoundingClientRect();
 const y=Math.max(10,Math.min(p.h-30,(vr.top+vr.height*.3-r.top)/scale)),x=Math.max(10,Math.min(p.w*.08,p.w-60));txOpen(p,txNew(x,y),true)}
function txApply(kind){saveTX();if(ED)txStyleAt(kind||'c')}
/* T: once = a text box with the keyboard (touch anywhere to start there instead); again = done.
   Pens, highlighter and eraser stay usable while the text box is open; long-press T = settings for text */
(function(){const tb=$('#ttx');let lt=0,lp=false;
 tb.addEventListener('pointerdown',()=>{lp=false;clearTimeout(lt);lt=setTimeout(()=>{lp=true;if(tool!=='text')setTool('text');openBar('t')},480)});
 ['pointerup','pointercancel','pointerleave'].forEach(n=>tb.addEventListener(n,()=>clearTimeout(lt)));
 tb.addEventListener('click',e=>{e.stopPropagation();if(lp){lp=false;return}
  if(tool==='text'){setTool('scroll');return}
  setTool('text');if(ED){ED.ta.focus()}else txStart()})})();

document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();doUndo()}});
$('#clr').onclick=()=>{const p=cur_page();if(p&&p.strokes.length&&confirm('Clear all marks on page '+pageNo(p)+'?')){txClose();p.strokes.slice().reverse().forEach(s=>undo.push({k:'del',p,s,i:0}));p.strokes.splice(0);edited(p);redraw(p)}};
function cur_page(){return pages[curIndex()]||null}
function zoom(f){const r=$('#view').getBoundingClientRect();zoomAt(scale*f,r.left+r.width/2,r.top+r.height/2)}
window.addEventListener('resize',()=>{if(pages.length&&!inGrid()){const z=scale/base;base=fitW(pages[0].w);setScale(base*z)}});
/* while you scroll only the small previews show; when scrolling stops the pages on screen are drawn
   sharp at once, then 10 pages above and below, one by one; pages further away go back to previews */
const RANGE=3;let SG=0,settleT=0;
function renderNear(){settle(0)}
function settle(ms){clearTimeout(settleT);settleT=setTimeout(runSettle,ms==null?150:ms)}
window.__settle=settle;
async function runSettle(){
 if(!pages.length||inGrid()||PZ.on)return;
 const g=++SG,i=curIndex(),v=$('#view'),vr=v.getBoundingClientRect(),n=pages.length;
 for(const p of [...drawn]){const k=pages.indexOf(p),r=p.wrap.getBoundingClientRect();if(k<0||r.bottom<vr.top-200||r.top>vr.bottom+200)unrender(p)}
 pages.forEach((p,k)=>{if((p.hurl||p.pc)&&Math.abs(k-i)>RANGE+2)dropHi(p)});
 const order=[];let a=i;while(a>0&&pages[a-1].wrap.getBoundingClientRect().bottom>vr.top)a--;
 for(let k=a;k<n;k++){const r=pages[k].wrap.getBoundingClientRect();if(r.top>=vr.bottom)break;order.push(pages[k])}
 for(let d=0;d<=RANGE;d++)for(const k of [i+d,i-d]){const p=pages[k];if(p&&order.indexOf(p)<0)order.push(p)}
 for(const p of order){if(g!==SG)return;if(isFresh(p)){showHi(p);continue}
  TH.pause=performance.now()+2000;await render(p);if(g!==SG)return;await sleep(MEM.low?25:8)}
 TH.pause=0}
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
$('#view').addEventListener('dblclick',e=>{if(window.Android||tool!=='scroll'||!pages.length||!window.__fromGrid)return;$('#pgs').click()});

function upd(){const p=inGrid()?null:cur_page();$('#info').textContent=pages.length?`Page ${p?pageNo(p):1} / ${pages.length} · ${Math.round(scale/base*100)}%`+(saveNote?' · '+saveNote:''):''}
let saveNote='';window.__saveNote=t=>{saveNote=t;upd()};
/* page number as printed in the list: in a big book, the page number in the whole book */
function pageNo(p){return pages.indexOf(p)+1}
window.__pageNo=pageNo;

/* ---------- big books: cut once into hidden part files, shown as ONE continuous book ----------
   only the part files around the place you read are open (2-3 at most); every page has a frame;
   pages near the screen are drawn, all others show a small preview made slowly in the background */
let BOOK=null;
const SPLITMIN=MEM.low?40e6:80e6,PART=MEM.low?150:250,MAXDOCS=MEM.low?2:3;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function message(html){host.innerHTML='';const d=document.createElement('div');d.id='pmsg';d.innerHTML=html;host.appendChild(d);syncEmpty();$('#empty').style.display='none'}
async function openSplitBook(f,want){
 window.__beforeReplace&&window.__beforeReplace();pages.forEach(rm);pages=[];undo=[];setDirty(false);closeBook();
 const ps=PART,first=Math.floor(want/ps);let failed=null,recs=null;const ready={},waits={};
 docPrimary=f._nid;docName=(f.name||'document').replace(/\.[^.]+$/,'');setTool('scroll');
 message('<b>Opening the book…</b><br><small>The first time, a big book is prepared once (kept for next time). The page you were reading opens first.</small><div id="pmsgp"></div>');
 const setup=j=>{if(BOOK)return;const n=j.n,sz=j.sizes||[];
  recs=Array.from({length:n},(_,i)=>{const s=sz[i]||sz[0]||[595,842];return{kind:'pdf',pn:i+1,part:Math.floor(i/j.partSize),lpn:i%j.partSize+1,w:s[0],h:s[1],strokes:[],nid:f._nid,sidx:i+1,fname:f.name,src:{url:f._url,size:f.size},osize:f.size/n,doc:null}});
  BOOK={size:j.partSize,parts:j.parts,files:[],ready,waits,key:j.key,outline:j.outline||[],src:{url:f._url,size:f.size},docs:new Map(),split:true,n}};
 const gotPart=(k,path)=>{BOOK.files[k]={path,id:0};ready[k]=true;if(waits[k]){waits[k].forEach(r=>r());delete waits[k]}};
 const job=window.__pdfJob({op:'prepare',src:f._nid,partSize:ps,first},d=>{const m=$('#pmsgp');if(m)m.textContent=d.msg||''},(type,d)=>{
  if(type==='info')setup(d);
  if(type==='part'&&BOOK){gotPart(d.k,d.path);const m=$('#pmsgp');if(m)m.textContent=`Prepared ${d.done} of ${d.parts}`}});
 job.then(j=>{if(!BOOK)setup(j);(j.files||[]).forEach((p,k)=>{if(!ready[k])gotPart(k,p)})}).catch(e=>{failed=e;if(BOOK){BOOK.prepFailed=e;Object.keys(waits).forEach(k=>{waits[k].forEach(r=>r());delete waits[k]});window.__toast&&window.__toast('Preparing the book stopped: '+e.message,7000)}});
 await new Promise(res=>{const t=setInterval(()=>{if(failed||(BOOK&&ready[Math.min(first,BOOK.parts-1)])){clearInterval(t);res()}},150)});
 if(!BOOK||(failed&&!ready[first])){host.innerHTML='';window.__toast&&window.__toast((failed?failed.message+'. ':'')+'Opening the book directly instead (may be slow).',6000);BOOK=null;return false}
 host.innerHTML='';const zr=savedZoom();base=scale=fitW(recs[0].w);zoomed=zr!==1;scale=base*zr;
 addPages(recs,0);
 await gotoGlobal(Math.max(0,Math.min(recs.length-1,want)),0);
 window.__docChanged&&window.__docChanged(true,pages);thumbLoop();
 return true}
function partReady(k){return new Promise(r=>{if(BOOK.ready[k]||BOOK.prepFailed)return r();(BOOK.waits[k]=BOOK.waits[k]||[]).push(r)})}
/* a part file is small enough to be read in one go (one copy, inside the PDF engine) */
async function openPartDoc(k){const f=BOOK.files[k];if(!f.id)f.id=Android.registerFile(f.path);
 const r=await fetch('/__file/'+f.id,{cache:'no-store'});if(!r.ok)throw new Error('part '+(k+1)+' could not be read');
 const ab=new Uint8Array(await r.arrayBuffer());return pdfjsLib.getDocument({data:ab}).promise}
const nearParts=()=>{const i=curIndex(),s=new Set();for(let k=Math.max(0,i-10);k<=Math.min(pages.length-1,i+10);k++){const p=pages[k];if(p.part!=null)s.add(p.part)}return s};
/* the PDF engine for one part; least-recently-used parts are closed (and their pages forgotten) */
function partDocFor(k){
 const D=BOOK.docs;let e=D.get(k);if(e){e.t=performance.now();return e.p}
 const B=BOOK;e={t:performance.now(),p:(async()=>{await partReady(k);if(!B.ready[k])throw new Error('This part of the book could not be prepared');return openPartDoc(k)})()};
 e.p.catch(()=>{if(B.docs.get(k)===e)B.docs.delete(k)});D.set(k,e);
 if(D.size>MAXDOCS){const keep=nearParts();keep.add(k);const old=[...D.entries()].filter(([x])=>!keep.has(x)).sort((a,b)=>a[1].t-b[1].t);
  while(D.size>MAXDOCS&&old.length){const[x,o]=old.shift();D.delete(x);
   for(const p of pages)if(p.part===x&&p.doc){unrender(p);p.doc=null;p.page=null;p.read=null;p.bands=null;p.words=null}
   o.p.then(d=>d.destroy()).catch(()=>{})}}
 return e.p}
/* a page for searching / previews; nothing is kept */
async function bookPage(rec){
 if(BOOK&&rec.part!=null){if(rec.page)return{pg:rec.page,own:false};const d=await partDocFor(rec.part),pg=await d.getPage(rec.lpn);patchOC(pg);return{pg,own:true}}
 await ensure(rec);return{pg:rec.page,own:false}}
window.__bookPage=bookPage;window.__bookPageDone=async()=>{};
function closeBook(){if(!BOOK)return;for(const e of BOOK.docs.values())e.p.then(d=>d.destroy()).catch(()=>{});BOOK=null}
/* fast "which page is on screen" (binary search on the frame positions) */
let lastCi=0;
function curIndex(){const v=$('#view');if(!v.clientHeight)return Math.min(lastCi,Math.max(0,pages.length-1));   // hidden (page arranger open): the page last seen
 const y=v.scrollTop+v.clientHeight*0.3;let lo=0,hi=pages.length-1;if(hi<0)return 0;
 while(lo<hi){const m=(lo+hi+1)>>1;if(pages[m].wrap.offsetTop<=y)lo=m;else hi=m-1}return lastCi=lo}
window.__curIndex=curIndex;
async function gotoGlobal(i,frac){const t=pages[Math.max(0,Math.min(pages.length-1,i))];if(!t)return;const v=$('#view');
 v.scrollTop=t.wrap.offsetTop-6+(frac||0)*t.wrap.offsetHeight;await sleep(30);v.scrollTop=t.wrap.offsetTop-6+(frac||0)*t.wrap.offsetHeight;upd();renderNear()}
window.__book=()=>BOOK;window.__gotoGlobal=gotoGlobal;window.__nextPart=async()=>false;
window.__allPages=()=>pages;

/* ---------- small previews of every page, made slowly in the background ---------- */
const TH={w:MEM.low?96:130,busy:false,pause:0,ci:-1,d:0,prio:[]};
window.__thumbPause=ms=>{TH.pause=performance.now()+(ms||800)};
function showPreview(p){if(!p.timg||p.pimg||!p.vis)return;const im=document.createElement('img');im.className='pim';im.src=p.timg;p.pimg=im;place(p,im,0)}
function hidePreview(p){if(p.pimg){p.pimg.remove();p.pimg=null}}
function nextThumb(){
 while(TH.prio.length){const p=TH.prio.shift();if(pages.includes(p)&&(!p.timg||p.tstale)&&(p.tfail||0)<2)return p}
 const n=pages.length,ci=curIndex();if(ci!==TH.ci){TH.ci=ci;TH.d=0}
 while(TH.d<n){const d=TH.d,cand=[pages[ci+d],d?pages[ci-d]:null];for(const p of cand)if(p&&(!p.timg||p.tstale)&&(p.tfail||0)<2&&p.kind!=='blank')return p;TH.d++}
 return null}
async function makeThumb(p){
 const tw=TH.w,th=Math.max(1,Math.round(tw*p.h/p.w)),c=document.createElement('canvas');c.width=tw;c.height=th;const x=c.getContext('2d');
 x.fillStyle='#fff';x.fillRect(0,0,tw,th);
 if(p.kind==='pdf'){const{pg,own}=await bookPage(p);await pg.render({canvasContext:x,viewport:pg.getViewport({scale:tw/p.w})}).promise;if(own&&!p.pc)try{pg.cleanup()}catch(e){}}
 else await paint(p,x,tw/p.w,null);
 const os=scale,od=dpr;scale=tw/p.w;dpr=1;try{p.strokes.forEach(s=>drawS(x,s))}finally{scale=os;dpr=od}
 const b=await blobOf(c,'image/jpeg',.6);c.width=c.height=0;
 if(p.timg)URL.revokeObjectURL(p.timg);p.timg=URL.createObjectURL(b);p.tstale=false;
 if(p.pimg){p.pimg.src=p.timg}else showPreview(p);
 if(p.thEl&&p.thEl.isConnected)tileImg(p)}
async function thumbLoop(){if(TH.busy)return;TH.busy=true;
 try{while(pages.length){
  if(performance.now()<TH.pause||PZ.on||window.__searchRunning||document.hidden){await sleep(500);continue}
  const p=nextThumb();if(!p){await sleep(2000);if(!nextThumb())break;continue}
  try{await makeThumb(p)}catch(e){p.tfail=(p.tfail||0)+1}
  await sleep(inGrid()?10:(MEM.low?35:15))}}finally{TH.busy=false}}
window.__thumbLoop=thumbLoop;
$('#view').addEventListener('scroll',()=>{upd();TH.pause=performance.now()+800;SG++;settle()},{passive:true});

/* ---------- page arranger: tap = select, swipe across = select many, size 4 .. ~100 per screen ---------- */
const tg=$('#tgrid');let gq=0,gcols=4;try{gcols=+localStorage.getItem('ms.gcols')||4}catch(e){}
const gio=new IntersectionObserver(es=>es.forEach(en=>{const p=en.target._p;if(en.isIntersecting&&p&&(!p.timg||p.tstale)){TH.prio.push(p);thumbLoop()}}),{root:tg,rootMargin:'300px 0px'});
function setCols(n){gcols=Math.max(2,Math.min(12,n));tg.style.setProperty('--cols',gcols);tg.style.setProperty('--gap',gcols>8?'2px':gcols>5?'5px':'10px');tg.classList.toggle('tiny',gcols>8);$('#gsize').value=14-gcols;try{localStorage.setItem('ms.gcols',gcols)}catch(e){}}
const firstTile=()=>{const gr=tg.getBoundingClientRect();let lo=0,hi=pages.length-1;while(lo<hi){const m=(lo+hi)>>1,t=pages[m].thEl;if(t&&t.offsetTop+t.offsetHeight<tg.scrollTop)lo=m+1;else hi=m}return pages[lo]};
$('#gsize').oninput=e=>{const a=firstTile();setCols(14-(+e.target.value));if(a&&a.thEl)tg.scrollTop=a.thEl.offsetTop-8};
$('#pgs').onclick=()=>{if(!pages.length)return;window.__fromGrid=false;$('#pop').hidden=true;document.body.classList.add('grid');setCols(gcols);buildGrid(true)};
function closeGrid(go){setPick(false);document.body.classList.remove('grid');gq++;gio.disconnect();const t=go||pages.find(p=>p.sel);requestAnimationFrame(()=>{if(t&&pages.includes(t))gotoGlobal(pages.indexOf(t),0);upd();settle(0)})}
$('#gdone').onclick=()=>closeGrid();
function tileImg(p){const d=p.thEl;if(!d)return;const im=d.firstChild;if(p.timg&&im.getAttribute('src')!==p.timg)im.src=p.timg}
function buildGrid(jump){
 gio.disconnect();const st=tg.scrollTop,fr=document.createDocumentFragment();tg.innerHTML='';
 pages.forEach((p,i)=>{const d=document.createElement('div');d.className='th'+(p.sel?' sel':'');d._p=p;d._i=i;p.thEl=d;
  const im=document.createElement('img');im.className='tp';im.alt='';im.style.aspectRatio=p.w+'/'+p.h;if(p.timg)im.src=p.timg;d.appendChild(im);
  const n=document.createElement('span');n.textContent=i+1;d.appendChild(n);fr.appendChild(d);gio.observe(d)});
 tg.appendChild(fr);cnt();
 if(jump){const c=pages[curIndex()];const go=()=>{if(c&&c.thEl)tg.scrollTop=c.thEl.offsetTop-tg.clientHeight/3};go();requestAnimationFrame(go);setTimeout(go,120)}else tg.scrollTop=st}
const cnt=()=>{const n=pages.filter(p=>p.sel).length;$('#gcnt').textContent=n?n+' selected':pages.length+' pages'};
function setSel(i,v){const p=pages[i];if(!p||p.sel===v)return;p.sel=v;p.thEl&&p.thEl.classList.toggle('sel',v)}
/* gestures: tap toggles one page; a sideways swipe starts "select by swiping" (then move freely, the list scrolls at the edges);
   an up/down swipe just scrolls; double tap opens that page */
let gs=null,lastTap={i:-1,t:0};
tg.addEventListener('pointerdown',e=>{const t=e.target.closest&&e.target.closest('.th');if(!t)return;gs={x:e.clientX,y:e.clientY,i:t._i,mode:null,cur:t._i,snap:null,val:false,id:e.pointerId,onSel:!!pages[t._i].sel}});
/* selected pages: swipe up / down starting on one of them to move them; a line shows where they will go */
let dropT=null;const clearDrop=()=>{if(dropT){dropT.el.classList.remove('dropb','dropa');dropT=null}};
function dropAt(x,y){const el=document.elementFromPoint(x,y),t=el&&el.closest&&el.closest('.th');clearDrop();if(!t)return;const r=t.getBoundingClientRect(),after=x>r.left+r.width/2;t.classList.add(after?'dropa':'dropb');dropT={el:t,i:t._i,after}}
tg.addEventListener('pointermove',e=>{
 if(!gs)return;const dx=e.clientX-gs.x,dy=e.clientY-gs.y;
 if(!gs.mode){if(gs.onSel&&Math.abs(dy)>9&&Math.abs(dy)>Math.abs(dx)){gs.mode='move';try{tg.setPointerCapture(gs.id)}catch(x){}pages.forEach(p=>p.sel&&p.thEl&&p.thEl.classList.add('mv'))}
  else if(Math.abs(dx)>9&&Math.abs(dx)>Math.abs(dy)*0.8){gs.mode='drag';gs.snap=pages.map(p=>p.sel);gs.val=!pages[gs.i].sel;try{tg.setPointerCapture(gs.id)}catch(x){}setSel(gs.i,gs.val)}else if(Math.abs(dy)>9){gs.mode='scroll';return}else return}
 if(gs.mode==='move'){e.preventDefault();dropAt(e.clientX,e.clientY);const r=tg.getBoundingClientRect();if(e.clientY>r.bottom-60)tg.scrollTop+=16;else if(e.clientY<r.top+60)tg.scrollTop-=16;return}
 if(gs.mode!=='drag')return;e.preventDefault();
 const el=document.elementFromPoint(e.clientX,e.clientY),t=el&&el.closest&&el.closest('.th');
 if(t&&t._i!==gs.cur){const a0=Math.min(gs.i,gs.cur),b0=Math.max(gs.i,gs.cur),a1=Math.min(gs.i,t._i),b1=Math.max(gs.i,t._i);
  for(let k=a0;k<=b0;k++)if(k<a1||k>b1)setSel(k,gs.snap[k]);for(let k=a1;k<=b1;k++)setSel(k,gs.val);gs.cur=t._i;cnt()}
 const r=tg.getBoundingClientRect();if(e.clientY>r.bottom-50)tg.scrollTop+=14;else if(e.clientY<r.top+50)tg.scrollTop-=14},{passive:false});
const gend=e=>{if(!gs)return;const g=gs;gs=null;
 if(g.mode==='move'){const d=dropT;clearDrop();pages.forEach(p=>p.thEl&&p.thEl.classList.remove('mv'));
  if(d&&e.type==='pointerup'){let t=d.i+(d.after?1:0);while(t<pages.length&&pages[t].sel)t++;const st=tg.scrollTop;if(moveTo(t<pages.length?t:null)){buildGrid();tg.scrollTop=st;cnt()}}return}
 if(!g.mode&&e.type==='pointerup'){const now=performance.now();
  if(gpick){setPick(false);if(moveTo(g.i)){buildGrid();const f=pages.find(p=>p.sel);if(f&&f.thEl)tg.scrollTop=f.thEl.offsetTop-tg.clientHeight/3}return}
  if(lastTap.i===g.i&&now-lastTap.t<420){setSel(g.i,!pages[g.i].sel);lastTap.i=-1;closeGrid(pages[g.i]);window.__fromGrid=true;return}
  lastTap={i:g.i,t:now};setSel(g.i,!pages[g.i].sel);lastSel=g.i;cnt()}};
tg.addEventListener('pointerup',gend);tg.addEventListener('pointercancel',gend);
$('#gall').onclick=()=>{pages.forEach((p,i)=>setSel(i,true));cnt()};
$('#gnone').onclick=()=>{pages.forEach((p,i)=>setSel(i,false));cnt()};
const changed=noUndo=>{window.__structChanged&&window.__structChanged();setDirty()};
const snapPages=()=>undo.push({k:'pages',before:pages.slice()});
function move(dir){const n=pages.length;if(!pages.some(p=>p.sel))return;snapPages();
 if(dir<0){for(let i=1;i<n;i++)if(pages[i].sel&&!pages[i-1].sel)[pages[i-1],pages[i]]=[pages[i],pages[i-1]]}
 else{for(let i=n-2;i>=0;i--)if(pages[i].sel&&!pages[i+1].sel)[pages[i+1],pages[i]]=[pages[i],pages[i+1]]}
 reorderDOM();changed();buildGrid();const f=pages.find(p=>p.sel);if(f&&f.thEl){const r=f.thEl.getBoundingClientRect(),gr=tg.getBoundingClientRect();if(r.top<gr.top||r.bottom>gr.bottom)tg.scrollTop+=r.top-gr.top-gr.height/3}}
$('#gup').onclick=()=>move(-1);$('#gdn').onclick=()=>move(1);
function deletePages(del){if(!del.length)return false;if(del.length>=pages.length){window.__toast&&window.__toast('At least one page must stay');return false}
 snapPages();txClose();del.forEach(p=>{p.sel=false;rm(p)});pages=pages.filter(p=>!del.includes(p));changed();syncEmpty();upd();settle(0);return true}
$('#gdel').onclick=()=>{const del=pages.filter(p=>p.sel);if(!del.length)return;if(deletePages(del)){buildGrid();cnt();window.__toast&&window.__toast(del.length+' page'+(del.length>1?'s':'')+' deleted · ↶ undo brings them back')}};
/* move the selected pages to any place: tap "Move to", then the page they should go before (or "To the end") */
function moveTo(t){const sel=pages.filter(p=>p.sel);if(!sel.length)return false;const target=t==null?null:pages[t];if(target&&target.sel)return false;
 snapPages();const rest=pages.filter(p=>!p.sel),i=target?rest.indexOf(target):rest.length;pages=rest.slice(0,i).concat(sel,rest.slice(i));reorderDOM();changed();settle(0);return true}
let gpick=false;const setPick=v=>{gpick=v;document.body.classList.toggle('gpick',v);$('#gmv').textContent=v?'✕ Cancel':'⇢ Move to…';if(v)$('#gcnt').textContent='Tap the page to put them before';else cnt()};
$('#gmv').onclick=()=>{if(gpick){setPick(false);return}if(!pages.some(p=>p.sel)){window.__toast&&window.__toast('Select pages first');return}setPick(true)};
$('#gend').onclick=()=>{setPick(false);if(moveTo(null))buildGrid()};
function blankAfter(i){snapPages();const ref=pages[i]||pages[pages.length-1]||{w:A4[0],h:A4[1]};const b=addPages([{kind:'blank',w:ref.w,h:ref.h}],i+1)[0];changed();return b}
$('#gadd').onclick=()=>{blankAfter(insIdx()-1);buildGrid()};
function copyOf(p){return{opn:p.opn,og:p.og,fo:0,ver:1,vO:0,vC:0,kind:p.kind,doc:p.doc,bytes:p.bytes,src:p.src,osize:p.osize,pn:p.pn,part:p.part,lpn:p.lpn,page:null,cv:p.cv,lines:p.lines,w:p.w,h:p.h,nid:p.nid,sidx:p.sidx,fname:p.fname,timg:null,strokes:JSON.parse(JSON.stringify(p.strokes)).map(s=>{delete s.inOrig;delete s.inCopy;return s})}}
function duplicate(list){snapPages();for(let i=pages.length-1;i>=0;i--){const p=pages[i];if(list.includes(p))addPages([copyOf(p)],i+1)}changed()}
$('#gdup').onclick=()=>{const l=pages.filter(p=>p.sel);if(!l.length)return;duplicate(l);buildGrid()};
window.__pageOps={move:(p,d)=>{pages.forEach(q=>q.sel=q===p);move(d);pages.forEach(q=>q.sel=false)},
 moveTo:(p,n)=>{pages.forEach(q=>q.sel=q===p);const rest=pages.filter(q=>q!==p),t=rest[Math.max(0,Math.min(rest.length,n))];moveTo(t?pages.indexOf(t):null);pages.forEach(q=>q.sel=false)},del:p=>deletePages([p]),dup:p=>duplicate([p]),blank:p=>blankAfter(pages.indexOf(p)),closeGrid};
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
let openExp=function(){if(!pages.length)return;const tot=pages.length;if(!$('#efrom').value)$('#efrom').value=1;if(!$('#eto').value)$('#eto').value=tot;$('#efrom').max=$('#eto').max=tot;$('#efrom').onchange=$('#eto').onchange=updSz;const sel=pages.some(p=>p.sel);$('#escope').querySelector('[value=sel]').disabled=!sel;$('#escope').value=inGrid()&&sel?'sel':'all';$('#est').textContent='';$('#ego').disabled=false;$('#exp').hidden=false}
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
const fpn=p=>p.opn||p.pn;
const marksOf=l=>{const m={};for(const p of l)if(p.strokes&&p.strokes.length)m[fpn(p)]=p.strokes.map(s=>s.t==='tx'?Object.assign({},s,{img:window.__txImg(s)}):s);return m};
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
 const t0=performance.now(),nid=list[0].nid,pn=list.map(fpn),marks=marksOf(list),base=docName+(pct<100?'-'+pct+'pc':'-marked');
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

/* no long-press menus (copy / select all…) on buttons, bars or pages */
document.addEventListener('contextmenu',e=>{if(!(e.target.closest&&e.target.closest('input,textarea,select,.txed')))e.preventDefault()});

/* ---------- picture: brightness, contrast and colour of the pages (faint old books); ☀ shows / hides the bar ---------- */
(function(){let P=Object.assign({b:100,c:100,s:100},ls('ms.pic',{}));const ib=$('#ibar');
 const apply=()=>{const none=P.b===100&&P.c===100&&P.s===100;document.body.style.setProperty('--pf',none?'none':`brightness(${P.b/100}) contrast(${P.c/100}) saturate(${P.s/100})`);
  $('#ibv').textContent=P.b+'%';$('#icv').textContent=P.c+'%';$('#isv').textContent=P.s+'%';$('#pic').classList.toggle('on',!ib.hidden||!none);lset('ms.pic',P)};
 const step=(k,d,lo,hi)=>{P[k]=clampN(P[k]+d,lo,hi);apply()};
 $('#ibm').onclick=()=>step('b',-10,30,200);$('#ibp').onclick=()=>step('b',10,30,200);
 $('#icm').onclick=()=>step('c',-10,50,300);$('#icp').onclick=()=>step('c',10,50,300);
 $('#ism').onclick=()=>step('s',-10,0,300);$('#isp').onclick=()=>step('s',10,0,300);
 [['#ibr','b'],['#icr','c'],['#isr','s']].forEach(([q,k])=>$(q).onclick=()=>{P[k]=100;apply()});     // tap the number: back to 100%
 $('#pic').onclick=()=>{ib.hidden=!ib.hidden;if(!ib.hidden){sbar.hidden=true;cm.hidden=true;updBar()}apply()};
 const oc=$('#cfg').onclick;$('#cfg').onclick=()=>{ib.hidden=true;oc();apply()};
 apply()})();

/* eraser bar: long-press ⌫ */
(function(){const eb=document.querySelector('[data-t=erase]'),bar=$('#ebar');let lt=0;
 eb.addEventListener('pointerdown',()=>{erLP=false;clearTimeout(lt);lt=setTimeout(()=>{erLP=true;const open=bar.hidden;document.querySelectorAll('.mini').forEach(m=>m.hidden=true);bar.hidden=!open;if(open){setTool('erase');updEbar()}$('#pic').classList.toggle('on',(document.body.style.getPropertyValue('--pf')||'none')!=='none');$('#cfg').classList.toggle('on',!$('#sbar').hidden)},480)});
 ['pointerup','pointercancel','pointerleave'].forEach(n=>eb.addEventListener(n,()=>clearTimeout(lt)));
 $('#ems').onclick=()=>{ER.mode='stroke';updEbar()};$('#ema').onclick=()=>{ER.mode='area';updEbar()};
 $('#ewm').onclick=()=>{ER.w=clampN(ER.w-(ER.w>24?8:4),6,96);updEbar()};$('#ewp').onclick=()=>{ER.w=clampN(ER.w+(ER.w>=24?8:4),6,96);updEbar()};
 ['#cfg','#pic'].forEach(q=>$(q).addEventListener('click',()=>{bar.hidden=true}));
 updEbar()})();
