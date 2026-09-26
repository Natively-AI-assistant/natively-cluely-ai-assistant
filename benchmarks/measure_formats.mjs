// PHASE 29 — every format SafeDocumentTextExtractor accepts, same facts in each,
// through the real app on the Natively API. Scores extraction AND retrieval:
// a format that parses but loses its content is worse than one that is refused.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const ROOT='/Users/evin/natively-cluely-ai-assistant';
const require = createRequire(`${ROOT}/package.json`);
const { chromium } = require('playwright');
const PORT = Number(process.argv[2]||9491);
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname),'fixtures');
const facts = JSON.parse(readFileSync(path.join(FIX,'fmt-manifest.json'),'utf8'));

const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`,{timeout:10000});
const pages = b.contexts().flatMap(c=>c.pages()).filter(p=>!p.url().startsWith('chrome-error'));
let p=null;
for (const pg of pages){ const ok=await Promise.race([pg.evaluate(()=>!!(window.electronAPI?.e2eInvoke)).catch(()=>false), new Promise(r=>setTimeout(()=>r(false),3000))]); if(ok){p=pg;break;} }
if(!p) throw new Error('no bridge');
const inv=(ch,...a)=>p.evaluate(([c,x])=>window.electronAPI.e2eInvoke(c,...x),[ch,a]);
const call=(fn,...a)=>p.evaluate(([f,x])=>window.electronAPI[f](...x),[fn,a]);
const st0 = await call('getEmbeddingStatus');
console.log('provider:', st0?.active?.space);
const modes = await call('modesGetAll');
const modeId = (Array.isArray(modes)?modes:[])[0]?.id;

const rows=[];
for (const ext of ['txt','md','json','csv','tsv','xml','html','log','pdf','docx']) {
  const f = path.join(FIX, `fmt.${ext}`);
  const t0=Date.now();
  const up = await inv('__e2e__:upload-reference-file-from-path',{modeId,filePath:f});
  const parseMs=Date.now()-t0;
  if(!up?.success){ rows.push({ext,ok:false,error:up?.error}); console.log(`  ${ext.padEnd(5)} REFUSED: ${up?.error}`); continue; }
  const chars = (up.file?.content||'').length;
  const fid = up.file.id;
  const tIdx=Date.now(); let s=null;
  while(Date.now()-tIdx<180000){
    const q = await inv('__e2e__:index-status', modeId);
    s = (q?.statuses||[]).find(x=>(x.fileId||x.id)===fid)||null;
    if(s && ['ready','failed','lexical_only','ocr_required'].includes(s.status)) break;
    await new Promise(r=>setTimeout(r,700));
  }
  // Does the extracted text actually still contain the facts?
  let present=0;
  for (const fa of facts) if ((up.file?.content||'').includes(String(fa.volts))) present++;
  // And can retrieval find them?
  let hit=0; const lat=[];
  for (const fa of facts.slice(0,4)) {
    const t=Date.now();
    const r = await inv('__e2e__:inspect-retrieval',{modeId,query:`What is the calibration constant of ${fa.code}?`,forceDocumentGrounding:true}).catch(()=>null);
    lat.push(Date.now()-t);
    if(JSON.stringify(r||'').includes(String(fa.volts))) hit++;
  }
  lat.sort((a,b)=>a-b);
  const row={ext, ok:true, parseMs, chars, status:s?.status, chunks:s?.chunkCount, embedded:s?.embeddedChunkCount,
              factsExtracted:`${present}/${facts.length}`, retrieval:`${hit}/4`, retrievalP50:lat[Math.floor(lat.length/2)]};
  rows.push(row);
  console.log(`  ${ext.padEnd(5)} parse ${String(parseMs).padStart(5)}ms | ${String(chars).padStart(6)}ch | ${String(row.status).padEnd(11)} | chunks ${String(row.chunks).padStart(3)} emb ${String(row.embedded).padStart(3)} | facts ${row.factsExtracted} | retrieval ${row.retrieval} p50 ${row.retrievalP50}ms`);
}
writeFileSync(`${ROOT}/benchmarks/results/phase29-formats.json`, JSON.stringify(rows,null,1));
console.log('\nsaved benchmarks/results/phase29-formats.json');
await b.close();
