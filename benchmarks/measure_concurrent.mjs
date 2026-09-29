// PHASE 24/35 — three REAL concurrent Natively clients sharing one API key.
// A uploads a 100k-token document; B and C upload small ones AT THE SAME TIME.
// If A monopolises, B and C's time-to-ready tracks A's.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const ROOT='/Users/evin/natively-cluely-ai-assistant';
const require = createRequire(`${ROOT}/package.json`);
const { chromium } = require('playwright');
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname),'fixtures');
const T0 = Date.now();

async function bind(port){
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:10000});
  const pages = b.contexts().flatMap(c=>c.pages()).filter(p=>!p.url().startsWith('chrome-error'));
  for (const pg of pages) {
    const ok = await Promise.race([
      pg.evaluate(()=>!!(window.electronAPI&&window.electronAPI.e2eInvoke)).catch(()=>false),
      new Promise(r=>setTimeout(()=>r(false),3000))]);
    if (ok) return { b, p: pg };
  }
  throw new Error(`no bridge on ${port}`);
}

async function runUser({id, port, file}){
  const { b, p } = await bind(port);
  const inv=(ch,...a)=>p.evaluate(([c,x])=>window.electronAPI.e2eInvoke(c,...x),[ch,a]);
  const call=(fn,...a)=>p.evaluate(([f,x])=>window.electronAPI[f](...x),[fn,a]);
  const modes = await call('modesGetAll').catch(()=>[]);
  const list = Array.isArray(modes)?modes:(modes?.modes||[]);
  const modeId = list[0]?.id;
  if(!modeId) { await b.close(); return {id,file,error:'no mode'}; }

  const tUp=Date.now();
  const up = await inv('__e2e__:upload-reference-file-from-path',{modeId,filePath:path.join(FIX,file)});
  if(!up?.success){ await b.close(); return {id,file,error:'upload failed '+JSON.stringify(up).slice(0,120)}; }
  const uploadReturnedAt = Date.now()-T0;
  const fid=up.file.id;
  let st=null, firstProgressAt=null;
  const tIdx=Date.now();
  while(Date.now()-tIdx < 600000){
    const s = await inv('__e2e__:index-status', modeId);
    st = (s?.statuses||[]).find(x=>(x.fileId||x.id)===fid) || null;
    if(st && !firstProgressAt && (st.chunkCount??0)>0) firstProgressAt=Date.now()-T0;
    if(st && ['ready','failed','lexical_only','ocr_required'].includes(st.status)) break;
    await new Promise(r=>setTimeout(r,500));
  }
  const readyAt=Date.now()-T0;
  await b.close();
  return {id,file,uploadReturnedAt,firstProgressAt,readyAt,status:st?.status,chunks:st?.chunkCount,embedded:st?.embeddedChunkCount,
          uploadLatencyMs:Date.now()-tUp-(readyAt-(Date.now()-T0))};
}

const USERS=[{id:'A',port:9481,file:'huge.txt'},{id:'B',port:9482,file:'tiny.txt'},{id:'C',port:9483,file:'small.txt'}];
console.log('PHASE 24 — 3 concurrent real clients, one shared API key\n');
const out = await Promise.all(USERS.map(runUser));
for(const r of out){
  if(r.error){ console.log(`  ${r.id} (${r.file}): ERROR ${r.error}`); continue; }
  console.log(`  ${r.id} (${r.file.padEnd(10)}) upload returned +${String(r.uploadReturnedAt).padStart(5)}ms | first progress +${String(r.firstProgressAt).padStart(6)}ms | READY +${String(r.readyAt).padStart(6)}ms | ${r.status} ${r.embedded}/${r.chunks}`);
}
const A=out.find(x=>x.id==='A'), B=out.find(x=>x.id==='B'), C=out.find(x=>x.id==='C');
if(A?.readyAt&&B?.readyAt&&C?.readyAt){
  console.log(`\n  FAIRNESS`);
  console.log(`    A (${A.chunks} chunks) ready at ${A.readyAt}ms`);
  console.log(`    B (${B.chunks} chunks) ready at ${B.readyAt}ms  ${B.readyAt<A.readyAt?'— finished BEFORE the large job':'— waited for A'}`);
  console.log(`    C (${C.chunks} chunks) ready at ${C.readyAt}ms  ${C.readyAt<A.readyAt?'— finished BEFORE the large job':'— waited for A'}`);
  console.log(`    small jobs starved by the large one? ${(B.readyAt<A.readyAt&&C.readyAt<A.readyAt)?'NO':'YES — investigate'}`);
}
writeFileSync(`${ROOT}/benchmarks/results/phase24-concurrent.json`, JSON.stringify(out,null,1));
console.log('\nsaved benchmarks/results/phase24-concurrent.json');
