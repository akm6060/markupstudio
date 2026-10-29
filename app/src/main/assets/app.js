/* app.js — the viewer: pages, pen / underline / highlighter, zoom, page manager, export */
pdfjsLib.GlobalWorkerOptions.workerSrc='libs/pdf.worker.min.js';
const $=s=>document.querySelector(s);let dpr=Math.min(window.devicePixelRatio||1,2);
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
const A4=[595,842];
function textPages(txt,title){const cols=95,per=63,L=[];if(title)L.push('▸ '+title,'');
 for(const raw of txt.replace(/\t/g,'    ').split(/\r?\n/).slice(0,60000)){let l=raw;if(!l.length){L.push('');continue}while(l.length>cols){L.push(l.slice(0,cols));l=l.slice(cols)}L.push(l)}
 const out=[];for(let i=0;i<L.length;i+=per)out.push({kind:'txt',w:A4[0],h:A4[1],lines:L.slice(i,i+per)});
 return out.length?out:[{kind:'txt',w:A4[0],h:A4[1],lines:['(empty)']}]}
async function ingest(f){
 const n=f.name.toLowerCase(),t=f.type||'';
 if(t==='application/pdf'||n.endsWith('.pdf')){
  const ab=new Uint8Array(await f.arrayBuffer()),doc=await pdfjsLib.getDocument({data:ab.slice()}).promise,p1=await doc.getPage(1),v=p1.getViewport({scale:1});
  return Array.from({length:doc.numPages},(_,i)=>({kind:'pdf',doc,bytes:ab,pn:i+1,page:i?null:p1,w:v.width,h:v.height,osize:ab.length/doc.numPages}))}
 if(t.startsWith('image/'))return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const k=Math.min(1,2400/Math.max(im.naturalWidth,im.naturalHeight)),c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*k);c.height=Math.round(im.naturalHeight*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);ok([{kind:'cv',cv:c,w:612,h:Math.round(612*c.height/c.width)}])};im.onerror=no;im.src=r.result};r.onerror=no;r.readAsDataURL(f)});
 if(n.endsWith('.docx')){await lib('libs/mammoth.browser.min.js');const r=await mammoth.extractRawText({arrayBuffer:await f.arrayBuffer()});return textPages(r.value,f.name)}
 if(/\.(xlsx|xls|xlsm|ods)$/.test(n)){await lib('libs/xlsx.full.min.js');const wb=XLSX.read(new Uint8Array(await f.arrayBuffer()),{type:'array'});return wb.SheetNames.flatMap(s=>textPages(XLSX.utils.sheet_to_csv(wb.Sheets[s]),f.name+' · '+s))}
 const txt=await f.text();if(/[\x00-\x08\x0e-\x1f]/.test(txt.slice(0,3000)))throw new Error('binary');
 return textPages(txt,n.endsWith('.txt')?null:f.name)}
async function openFiles(files,replace){
 let all=[],bad=[];for(const f of files){try{const ps=await ingest(f);ps.forEach((p,i)=>{p.nid=f._nid;p.sidx=i+1;p.fname=f.name;if(!p.osize)p.osize=(f.size||0)/ps.length});all.push(...ps)}catch(e){bad.push(f.name)}}
 if(bad.length)alert('Unsupported or unreadable: '+bad.join(', '));
 if(!all.length)return;
 if(replace){window.__beforeReplace&&window.__beforeReplace();pages.forEach(rm);pages=[];undo=[];setDirty(false)}
 const fresh=!pages.length;if(fresh){docPrimary=all[0].nid||0;docName=(files[0].name||'document').replace(/\.[^.]+$/,'');base=scale=fitW(all[0].w);const zr=savedZoom();zoomed=zr!==1;scale=base*zr;$('#view').scrollTop=0;$('#view').scrollLeft=0;setTool('scroll')}
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
const io=new IntersectionObserver(es=>es.forEach(en=>{const p=en.target._p;if(!p)return;if(en.isIntersecting){if(!p.done)render(p)}else if(p.done&&Math.abs(en.boundingClientRect.top)>4000){p.done=false;p.pc.width=p.pc.height=1}}),{root:$('#view'),rootMargin:'500px 0px'});
function mkPage(d){const wrap=document.createElement('div');wrap.className='pg';const pc=document.createElement('canvas'),oc=document.createElement('canvas');oc.className='oc';wrap.append(pc,oc);
 const p={...d,wrap,pc,oc,strokes:[],done:false,task:null,sel:false,words:null,thumb:null};wrap._p=p;bind(p);size(p);return p}
function addPages(ds,idx){const ps=ds.map(mkPage);pages.splice(idx,0,...ps);reorderDOM();ps.forEach(p=>io.observe(p.wrap));syncEmpty();upd();return ps}
const reorderDOM=()=>pages.forEach(p=>host.appendChild(p.wrap));
function rm(p){try{p.task&&p.task.cancel()}catch(e){}io.unobserve(p.wrap);p.wrap.remove()}
const syncEmpty=()=>{$('#empty').style.display=pages.length?'none':''};
function size(p){const W=p.w*scale,H=p.h*scale;p.pr=Math.min(dpr,Math.sqrt(8e6/Math.max(1,W*H)));p.wrap.style.width=W+'px';p.wrap.style.height=H+'px';for(const c of [p.pc,p.oc]){c.style.width=W+'px';c.style.height=H+'px'}p.oc.width=p.pc.width=Math.max(1,Math.round(W*p.pr));p.oc.height=p.pc.height=Math.max(1,Math.round(H*p.pr))}
async function ensure(p){if(p.kind==='pdf'&&!p.page){p.page=await p.doc.getPage(p.pn);const v=p.page.getViewport({scale:1});p.w=v.width;p.h=v.height}}
async function paint(p,ctx,k,reg){
 ctx.fillStyle='#fff';ctx.fillRect(0,0,p.w*k,p.h*k);
 if(p.kind==='pdf'){await ensure(p);const t=p.page.render({canvasContext:ctx,viewport:p.page.getViewport({scale:k})});if(reg)reg.task=t;await t.promise}
 else if(p.kind==='cv')ctx.drawImage(p.cv,0,0,p.w*k,p.h*k);
 else if(p.kind==='txt'){ctx.fillStyle='#111';ctx.font=`${9*k}px "Courier New",Courier,monospace`;ctx.textBaseline='top';p.lines.forEach((l,i)=>ctx.fillText(l,40*k,(40+i*12)*k))}}
async function render(p){
 p.done=true;if(p.task)try{p.task.cancel()}catch(e){}
 try{await ensure(p)}catch(e){p.done=false;return}
 size(p);try{await paint(p,p.pc.getContext('2d'),scale*p.pr,p)}catch(e){return}
 redraw(p);getWords(p)}
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
function redraw(p,extra){if(!extra)p.thumb=null;const c=p.oc.getContext('2d'),od=dpr;dpr=p.pr||dpr;try{c.clearRect(0,0,p.oc.width,p.oc.height);p.strokes.forEach(s=>drawS(c,s));if(extra)drawS(c,extra)}finally{dpr=od}}
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
 const oc=p.oc;let cur=null;p.cancel=()=>{if(cur&&cur!=='erase'){cur=null;redraw(p)}else cur=null};
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
$('#clr').onclick=()=>{const p=cur_page();if(p&&p.strokes.length&&confirm('Clear all marks on page '+(pages.indexOf(p)+1)+'?')){p.strokes.forEach(s=>undo.push({k:'del',p,s,i:0}));p.strokes=[];setDirty();redraw(p)}};
function cur_page(){const v=$('#view').getBoundingClientRect();let best=null,bd=1e9;for(const p of pages){const r=p.wrap.getBoundingClientRect(),d=Math.abs(r.top+r.height/2-(v.top+v.height/2));if(d<bd){bd=d;best=p}}return best}
function zoom(f){const r=$('#view').getBoundingClientRect();zoomAt(scale*f,r.left+r.width/2,r.top+r.height/2)}
window.addEventListener('resize',()=>{if(pages.length&&!inGrid()){const z=scale/base;base=fitW(pages[0].w);setScale(base*z)}});
function renderNear(){const vr=$('#view').getBoundingClientRect();pages.forEach(p=>{const r=p.wrap.getBoundingClientRect();if(r.bottom>vr.top-800&&r.top<vr.bottom+800)render(p)})}
function setScale(ns){if(!pages.length)return;const v=$('#view'),ratio=v.scrollTop/(v.scrollHeight||1);scale=ns;pages.forEach(p=>{p.done=false;size(p);redraw(p)});v.scrollTop=ratio*v.scrollHeight;renderNear();upd()}
const ZK='ms.zoom';function savedZoom(){try{const z=+localStorage.getItem(ZK);return z>0.2&&z<20?z:1}catch(e){return 1}}
function saveZoom(){try{localStorage.setItem(ZK,String(scale/base))}catch(e){}}
/* zoom about a screen point; the same zoom applies to every page */
function zoomAt(ns,cx,cy){
 if(!pages.length)return;ns=Math.max(.25,Math.min(6,ns));if(Math.abs(ns-scale)<1e-4)return;const v=$('#view');
 let tp=null,fx=0,fy=0;for(const p of pages){const r=p.wrap.getBoundingClientRect();if(cy>=r.top-7&&cy<=r.bottom+7){tp=p;fx=(cx-r.left)/r.width;fy=Math.max(0,Math.min(1,(cy-r.top)/r.height));break}}
 if(!tp){setScale(ns);zoomed=true;saveZoom();return}
 scale=ns;zoomed=true;pages.forEach(p=>{p.done=false;size(p);redraw(p)});
 const r=tp.wrap.getBoundingClientRect();v.scrollLeft+=r.left+fx*r.width-cx;v.scrollTop+=r.top+fy*r.height-cy;
 renderNear();saveZoom();upd()}
const PZ={on:false,f:1};
$('#view').addEventListener('touchstart',e=>{if(e.touches.length!==2||!pages.length||inGrid())return;const[a,b]=e.touches;PZ.on=true;PZ.f=1;PZ.d0=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)||1;PZ.cx=(a.clientX+b.clientX)/2;PZ.cy=(a.clientY+b.clientY)/2;const r=host.getBoundingClientRect();host.style.transformOrigin=(PZ.cx-r.left)+'px '+(PZ.cy-r.top)+'px';window.__pinchAt=performance.now();pages.forEach(p=>p.cancel&&p.cancel())},{passive:true});
$('#view').addEventListener('touchmove',e=>{if(!PZ.on||e.touches.length<2)return;e.preventDefault();const[a,b]=e.touches,d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);PZ.f=Math.max(.25/scale,Math.min(6/scale,d/PZ.d0));host.style.transform='scale('+PZ.f+')';window.__pinchAt=performance.now()},{passive:false});
const pinchEnd=e=>{if(!PZ.on||e.touches.length>=2)return;PZ.on=false;host.style.transform='';window.__pinchAt=performance.now();if(Math.abs(PZ.f-1)>.02)zoomAt(scale*PZ.f,PZ.cx,PZ.cy)};
$('#view').addEventListener('touchend',pinchEnd);$('#view').addEventListener('touchcancel',pinchEnd);
$('#view').addEventListener('dblclick',e=>{if(tool!=='scroll'||!pages.length)return;const z=scale/base;zoomAt(z>1.05?base:base*2,e.clientX,e.clientY)});
$('#zi').onclick=()=>zoom(1.2);$('#zo').onclick=()=>zoom(1/1.2);
function upd(){const p=inGrid()?null:cur_page();$('#info').textContent=pages.length?`Page ${p?pages.indexOf(p)+1:1} / ${pages.length} · ${Math.round(scale/base*100)}%`:''}
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
  const n=document.createElement('span');n.textContent=i+1;d.appendChild(n);
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
function move(dir){const n=pages.length;
 if(dir<0){for(let i=1;i<n;i++)if(pages[i].sel&&!pages[i-1].sel)[pages[i-1],pages[i]]=[pages[i],pages[i-1]]}
 else{for(let i=n-2;i>=0;i--)if(pages[i].sel&&!pages[i+1].sel)[pages[i+1],pages[i]]=[pages[i],pages[i+1]]}
 reorderDOM();setDirty();buildGrid()}
$('#gup').onclick=()=>move(-1);$('#gdn').onclick=()=>move(1);
$('#gdel').onclick=()=>{const del=pages.filter(p=>p.sel);if(!del.length||!confirm('Delete '+del.length+' page(s)?'))return;
 del.forEach(rm);pages=pages.filter(p=>!p.sel);undo=undo.filter(a=>pages.includes(a.p));setDirty();syncEmpty();upd();if(!pages.length){closeGrid();return}buildGrid()};
$('#gadd').onclick=()=>{const ref=pages.find(p=>p.sel)||pages[pages.length-1]||{w:A4[0],h:A4[1]};addPages([{kind:'blank',w:ref.w,h:ref.h}],insIdx());setDirty();buildGrid()};
$('#gdup').onclick=()=>{for(let i=pages.length-1;i>=0;i--){const p=pages[i];if(!p.sel)continue;const c=addPages([{kind:p.kind,doc:p.doc,bytes:p.bytes,pn:p.pn,page:p.page,cv:p.cv,lines:p.lines,w:p.w,h:p.h,nid:p.nid,sidx:p.sidx,fname:p.fname}],i+1)[0];c.strokes=JSON.parse(JSON.stringify(p.strokes))}setDirty();buildGrid()};

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
async function textOf(p){if(p.kind==='txt')return p.lines.join('\n');if(p.kind==='pdf'){await ensure(p);const tc=await p.page.getTextContent();return tc.items.map(i=>i.str+(i.hasEOL?'\n':'')).join('')}return '(no text on this page)'}
let openExp=function(){if(!pages.length)return;const sel=pages.some(p=>p.sel);$('#escope').querySelector('[value=sel]').disabled=!sel;$('#escope').value=inGrid()&&sel?'sel':'all';$('#est').textContent='';$('#ego').disabled=false;$('#exp').hidden=false}
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
const fmtB=b=>b>=1048576?(b/1048576).toFixed(b>=104857600?0:1)+' MB':Math.max(1,Math.round(b/1024))+' KB';
const expList=()=>{const sc=$('#escope').value;return sc==='all'?pages.slice():sc==='sel'?pages.filter(p=>p.sel):[inGrid()?(pages.find(p=>p.sel)||pages[0]):cur_page()].filter(Boolean)};
const origOf=l=>l.reduce((a,p)=>a+(p.osize||0),0);
function updSz(){const fmt=$('#efmt').value,row=$('#eszrow'),info=$('#eszi');$('#esz').textContent=epct+'%';
 if(fmt==='txt'){row.style.display='none';info.textContent='';return}row.style.display='';
 const o=origOf(expList());
 info.textContent=epct>=100?(fmt==='pdf'?'Original quality'+(o?' · about '+fmtB(o):'')+' · text stays selectable':'Full quality'):(o?'Original '+fmtB(o)+' → about '+fmtB(o*epct/100):'Smaller file, lower picture quality')}
$('#esm').onclick=()=>{epct=Math.max(10,epct-10);updSz()};$('#esp').onclick=()=>{epct=Math.min(100,epct+10);updSz()};
$('#efmt').onchange=updSz;$('#escope').onchange=updSz;
const _openExp=openExp;openExp=function(){_openExp();updSz()};$('#exbtn').onclick=openExp;$('#gexp').onclick=openExp;
/* render a page and encode it at the best quality that fits the byte budget */
async function encodeFit(p,budget,mime,S){
 let k=S.k,q=S.q,c=null,ck=0,b=null,t=0;
 for(;t<9;t++){
  if(!c||ck!==k){c=await pageCanvas(p,k);ck=k}
  b=await blobOf(c,mime,q);
  if(b.size<=budget||(k<=.45&&q<=.35))break;
  const r=budget/b.size;
  if(mime!=='image/png'&&q>.5&&r>.5)q=Math.max(.35,q-.12);else k=Math.max(.45,k*Math.max(.5,Math.sqrt(r)*.95))}
 if(t===0&&b.size<budget*.6){S.k=Math.min(2.5,k*1.2);S.q=Math.min(.9,q+.05)}else{S.k=k;S.q=q}
 return b}
const img2u8=async b=>new Uint8Array(await b.arrayBuffer());
function loadImg(blob){return new Promise((ok,no)=>{const u=URL.createObjectURL(blob),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);ok(i)};i.onerror=()=>{URL.revokeObjectURL(u);no(new Error('img'))};i.src=u})}
/* shrink the JPEG pictures inside the PDF; text and drawings stay sharp and selectable */
async function shrinkImages(doc,estSize,target,st){
 const L=PDFLib,N=n=>L.PDFName.of(n),ctx=doc.context,imgs=[];let tot=0;
 for(const[ref,obj]of ctx.enumerateIndirectObjects()){
  if(!(obj instanceof L.PDFRawStream))continue;const d=obj.dict;
  if(d.get(N('Subtype'))!==N('Image')||d.get(N('ImageMask'))||d.get(N('Decode')))continue;
  const f=d.lookup(N('Filter'));let jpg=null;
  if(f===N('DCTDecode'))jpg=obj.contents;
  else if(f instanceof L.PDFArray&&f.size()>=1&&f.lookup(f.size()-1)===N('DCTDecode')){const pre=[];for(let i=0;i<f.size()-1;i++)pre.push(f.lookup(i));
   if(pre.every(x=>['ASCII85Decode','ASCIIHexDecode','FlateDecode','LZWDecode','RunLengthDecode'].some(n=>x===N(n)))){try{const dd=d.clone(ctx);if(pre.length)dd.set(N('Filter'),ctx.obj(pre));else dd.delete(N('Filter'));dd.delete(N('DecodeParms'));jpg=pre.length?L.decodePDFRawStream(L.PDFRawStream.of(dd,obj.contents)).decode():obj.contents}catch(e){jpg=null}}}
  if(!jpg||jpg[0]!==0xFF||jpg[1]!==0xD8)continue;
  const bpc=d.lookup(N('BitsPerComponent'));if(bpc&&bpc.asNumber&&bpc.asNumber()!==8)continue;
  const cs=d.lookup(N('ColorSpace'));let okc=cs===N('DeviceRGB')||cs===N('DeviceGray');
  if(!okc&&cs instanceof L.PDFArray&&cs.lookup(0)===N('ICCBased')){try{const n=cs.lookup(1).dict.lookup(N('N')).asNumber();okc=n===1||n===3}catch(e){}}
  if(!okc||obj.contents.length<12000)continue;imgs.push({ref,obj,jpg});tot+=obj.contents.length}
 if(!imgs.length)return false;
 const other=Math.max(0,estSize-tot);let budget=target-other;if(budget<tot*.03)return false;
 const LAD=[[1,.92],[1,.85],[1,.75],[1,.65],[.85,.6],[.72,.55],[.6,.5],[.5,.45],[.4,.42],[.32,.4],[.25,.38],[.2,.36]];
 let left=tot,changed=false;
 for(let i=0;i<imgs.length;i++){const{ref,obj,jpg}=imgs[i],n=obj.contents.length,r=Math.min(1,budget/left),want=n*r;left-=n;
  st(`Compressing pictures ${i+1} of ${imgs.length}…`);
  if(r>=.97){budget-=n;continue}
  let im;try{im=await loadImg(new Blob([jpg],{type:'image/jpeg'}))}catch(e){budget-=n;continue}
  const w0=im.naturalWidth,h0=im.naturalHeight,cap=Math.min(1,Math.sqrt(16e6/(w0*h0)));
  let li=Math.max(0,(r>=.7?0:r>=.5?1:r>=.35?2:r>=.25?3:r>=.18?4:r>=.12?5:r>=.08?6:7)-2),best=null,bw=0,bh=0;
  for(;li<LAD.length;li++){const[sc,q]=LAD[li],w=Math.max(8,Math.round(w0*sc*cap)),h=Math.max(8,Math.round(h0*sc*cap)),c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(im,0,0,w,h);
   const b=await blobOf(c,'image/jpeg',q);c.width=c.height=1;if(!best||b.size<best.size){best=b;bw=w;bh=h}if(b.size<=want)break}
  if(!best||best.size>=n){budget-=n;continue}
  const dict={Type:'XObject',Subtype:'Image',Width:bw,Height:bh,ColorSpace:'DeviceRGB',BitsPerComponent:8,Filter:'DCTDecode'},sm=obj.dict.get(N('SMask'));if(sm)dict.SMask=sm;
  ctx.assign(ref,ctx.stream(await img2u8(best),dict));budget-=best.size;changed=true}
 return changed}
async function rasterPdf(list,target,st){
 const d=await PDFLib.PDFDocument.create(),S={k:2,q:.82};let used=0;
 for(let i=0;i<list.length;i++){st(`Compressing page ${i+1} of ${list.length}…`);const rem=list.length-i,bud=Math.max(5000,(target-used-1200*rem)/rem),b=await encodeFit(list[i],bud,'image/jpeg',S);used+=b.size+1200;
  const im=await d.embedJpg(await img2u8(b)),p=list[i];d.addPage([p.w,p.h]).drawImage(im,{x:0,y:0,width:p.w,height:p.h})}
 return d.save({useObjectStreams:true})}
async function exportPdf(list,pct,st){
 await lib(PDFLIB);st('Building PDF…');
 const raster=async p=>img2u8(await blobOf(await pageCanvas(p,2),'image/jpeg',.9));
 const orig=origOf(list),doc=await MarkupSaver.buildDoc(PDFLib,list,raster);
 if(pct>=100||!orig)return{data:await doc.save({useObjectStreams:true}),how:''};
 const target=orig*pct/100;let how='';
 if(await shrinkImages(doc,orig,target,st))how='pictures compressed, text kept';
 st('Saving…');let best=await doc.save({useObjectStreams:true});
 if(best.length>target*1.1){const r=await rasterPdf(list,target,st);if(r.length<best.length){best=r;how='pages turned into pictures to reach this size'}}
 return{data:best,how}}
$('#ego').onclick=async()=>{
 const st=$('#est'),fmt=$('#efmt').value,pct=epct,say=t=>{st.textContent=t};
 if(!dls){say('Saving is not available in this view.');return}
 const list=expList();
 if(!list.length||!list[0])return;$('#ego').disabled=true;
 const nm=i=>`${docName}-p${pages.indexOf(list[i])+1}`,prog=i=>say(`Preparing page ${i+1} of ${list.length}…`),orig=origOf(list),target=orig*pct/100,small=pct<100&&orig>0;
 const IM={png:['image/png','png'],jpg:['image/jpeg','jpg'],webp:['image/webp','webp']},S={k:2,q:.82};
 const pageBlob=async(i,mime,q)=>small?encodeFit(list[i],Math.max(4000,target/list.length),mime,S):blobOf(await pageCanvas(list[i],2),mime,q);
 try{
  let out,name,how='';
  if(IM[fmt]){const[m,ex]=IM[fmt];let zip=null;if(list.length>1){await lib(JSZIP);zip=new JSZip()}
   for(let i=0;i<list.length;i++){prog(i);const b=await pageBlob(i,m,.92);if(zip)zip.file(nm(i)+'.'+ex,b);else{out=b;name=nm(0)+'.'+ex}}
   if(zip){out=await zip.generateAsync({type:'blob'});name=docName+'-pages.zip'}}
  else if(fmt==='txt'){const T=[];for(let i=0;i<list.length;i++){prog(i);T.push('--- Page '+(pages.indexOf(list[i])+1)+' ---\n'+await textOf(list[i]))}out=T.join('\n\n');name=docName+'.txt'}
  else if(fmt==='pdf'){const r=await exportPdf(list,pct,say);out=r.data;how=r.how;name=docName+(pct<100?'-'+pct+'pc':'-marked')+'.pdf'}
  else{const J=[];for(let i=0;i<list.length;i++){prog(i);const p=list[i];J.push({w:p.w,h:p.h,b:await pageBlob(i,'image/jpeg',.9)})}
   say('Building file…');
   if(fmt==='docx'){out=await mkDocx(J);name=docName+'.docx'}
   else if(fmt==='pptx'){out=await mkPptx(J);name=docName+'.pptx'}
   else{const U=[];for(const j of J)U.push(await b2u(j.b));out='<!DOCTYPE html><meta charset="utf-8"><title>'+docName.replace(/[<>&]/g,'')+'</title><body style="margin:0;background:#888;display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px">'+U.map(u=>`<img src="${u}" style="max-width:100%;background:#fff">`).join('');name=docName+'.html'}}
  const size=out.size!=null?out.size:out.length!=null?(out.byteLength||out.length):0;
  await dls.save({filename:name,data:out});say('Saved ✓ '+name+(size?' · '+fmtB(size)+(orig?' (original '+fmtB(orig)+')':''):'')+(how?' · '+how:''));
 }catch(e){say(e&&e.code==='declined'?'Cancelled.':'Export failed: '+((e&&(e.message||e.code))||'unknown error'))}
 $('#ego').disabled=false};
