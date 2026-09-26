// PHASE 23 — measure against an ALREADY-RUNNING app (launch decoupled from
// measurement, so a launch problem cannot masquerade as a benchmark result).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const ROOT='/Users/evin/natively-cluely-ai-assistant';
const require = createRequire(`${ROOT}/package.json`);
const { chromium } = require('playwright');
const PORT = Number(process.argv[2] || 9441);
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname),'fixtures');
const manifest = JSON.parse(readFileSync(path.join(FIX,'manifest.json'),'utf8'));

const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`,{timeout:10000});
const pages = b.contexts().flatMap(c=>c.pages()).filter(p=>!p.url().startsWith('chrome-error'));
let p=null;
for (const pg of pages) {
  const ok = await Promise.race([
    pg.evaluate(()=>!!(window.electronAPI&&window.electronAPI.e2eInvoke)).catch(()=>false),
    new Promise(r=>setTimeout(()=>r(false),3000))]);
  if (ok) { p=pg; break; }
}
if(!p) throw new Error('no page with the e2e bridge');
console.log('attached.');
const inv=(ch,...a)=>p.evaluate(([c,x])=>window.electronAPI.e2eInvoke(c,...x),[ch,a]);
const call=(fn,...a)=>p.evaluate(([f,x])=>window.electronAPI[f](...x),[fn,a]);

const modes = await call('modesGetAll').catch(e=>({err:String(e).slice(0,120)}));
const list = Array.isArray(modes)?modes:(modes?.modes||modes?.data||[]);
console.log('modes:', JSON.stringify(list.map(m=>({id:m.id,name:m.name}))).slice(0,220));
let modeId = list[0]?.id;
if(!modeId){
  const c = await call('modesCreate',{name:'E2E Bench',templateType:'general',customContext:''}).catch(e=>({err:String(e).slice(0,150)}));
  console.log('create:', JSON.stringify(c).slice(0,200));
  modeId = c?.id ?? c?.mode?.id;
}
if(!modeId) throw new Error('no mode');
console.log('modeId:', modeId);

const rows=[];
for (const size of ['tiny','small','medium','large','xlarge','huge']) {
  const meta = manifest.find(m=>m.name===size);
  const t0=Date.now();
  const up = await inv('__e2e__:upload-reference-file-from-path',{modeId,filePath:path.join(FIX,`${size}.txt`)});
  const uploadMs=Date.now()-t0;
  if(!up?.success){ console.log(`  ${size}: upload FAILED ${JSON.stringify(up).slice(0,160)}`); continue; }
  const fid = up.file.id;
  const tIdx=Date.now(); let st=null, firstProgress=null;
  while(Date.now()-tIdx < 420000){
    const s = await inv('__e2e__:index-status', modeId);
    st = (s?.statuses||[]).find(x=>(x.fileId||x.id)===fid) || null;
    if(st && !firstProgress && (st.chunkCount??0)>0) firstProgress=Date.now()-tIdx;
    if(st && ['ready','failed','lexical_only','ocr_required'].includes(st.status)) break;
    await new Promise(r=>setTimeout(r,1000));
  }
  const indexMs=Date.now()-tIdx;
  const qs = meta.facts.slice(0,6).map(f=>({q:`What is the calibration constant of ${f.code}?`, expect:String(f.volts)}));
  let hit=0; const lat=[];
  for(const {q,expect} of qs){
    const t=Date.now();
    const r = await inv('__e2e__:inspect-retrieval',{modeId,query:q,forceDocumentGrounding:true}).catch(e=>({err:String(e).slice(0,80)}));
    lat.push(Date.now()-t);
    if(JSON.stringify(r||'').includes(expect)) hit++;
  }
  lat.sort((a,b)=>a-b);
  const row={file:`${size}.txt`,chars:meta.chars,tokens:meta.tokens,uploadMs,indexMs,firstProgressMs:firstProgress,
    status:st?.status??'timeout',chunks:st?.chunkCount??null,embedded:st?.embeddedChunkCount??null,
    retrieval:`${hit}/${qs.length}`,retrievalP50:lat[Math.floor(lat.length/2)]};
  rows.push(row);
  console.log(`  ${row.file.padEnd(12)} ${String(row.chars).padStart(7)}ch | upload ${String(uploadMs).padStart(5)}ms | index ${String(indexMs).padStart(6)}ms | ${String(row.status).padEnd(12)} | chunks ${String(row.chunks).padStart(4)} emb ${String(row.embedded).padStart(4)} | retrieval ${row.retrieval} p50 ${row.retrievalP50}ms`);
}
writeFileSync(`${ROOT}/benchmarks/results/phase23-single-session.json`, JSON.stringify(rows,null,1));
console.log('\nsaved benchmarks/results/phase23-single-session.json');
await b.close();
