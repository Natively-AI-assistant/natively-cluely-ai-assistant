// PHASE 4/29 — does chunk SIZE change retrieval quality on Natively's workload?
// Boundary strategy held constant; only the target size varies, so the effect
// measured is size alone. Sizes in TOKENS (~4 chars/token).
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCorpus, chunk as chunkAt, buildQuestions, goldChunksFor } from './corpus.mjs';
const ROOT='/Users/evin/natively-cluely-ai-assistant';
const readEnv=(f,k)=>{const l=readFileSync(f,'utf8').split('\n').find(x=>x.startsWith(k+'='));return l?l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,''):null};
const KEY=readEnv(`${ROOT}/natively-api/.env`,'NATIVELY_API_KEY');
const H={'Content-Type':'application/json','x-natively-key':KEY};
let last=0; const GAP=Number(process.env.SWEEP_GAP_MS)||680;
const paced=async fn=>{const w=Math.max(0,last+GAP-Date.now());last=Date.now()+w;if(w)await new Promise(r=>setTimeout(r,w));return fn()};
async function api(p,body,tries=Number(process.env.SWEEP_TRIES)||5){
  let lastErr=null;
  for(let a=1;a<=tries;a++){
    try{
      const r=await paced(()=>fetch(`https://api.natively.software${p}`,{method:'POST',headers:H,body:JSON.stringify(body)}));
      const j=await r.json().catch(()=>({}));
      if(r.ok) return j;
      if(j?.retryable!==false&&a<tries){await new Promise(x=>setTimeout(x,(Number(j?.retry_after)||2)*1000*(0.75+Math.random()*0.5)));continue}
      throw new Error(`${r.status} ${j.error||''}`);
    }catch(e){
      // A thrown fetch (ECONNRESET, DNS, socket hangup) is transient too — the
      // first run of this sweep died on one because only non-ok RESPONSES retried.
      lastErr=e;
      if(a>=tries) throw e;
      await new Promise(x=>setTimeout(x,1500*a*(0.75+Math.random()*0.5)));
    }
  }
  throw lastErr;
}
const dot=(a,b)=>{let d=0;for(let i=0;i<a.length;i++)d+=a[i]*b[i];return d};
const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n)};

const corpus=buildCorpus({targetTokens:32000, seed:7});
const N_Q=60, TOP_K=20;
console.log('PHASE 4 — chunk-size sweep (32k corpus, %d questions, top-%d -> rerank)\n', N_Q, TOP_K);
console.log('  target tok | chars | chunks | vec@1  vec@20 | rerank@1 | embed tokens | rerank p50');
console.log('  -----------+-------+--------+---------------+----------+--------------+-----------');
const out=[];
const SIZES=(process.env.SWEEP_SIZES||'500,800,1000,1200,1500,2000').split(',').map(Number);
for (const tok of SIZES) {
  const size = tok*4, overlap = Math.round(size*0.17);
  const chunks = chunkAt(corpus.text, size, overlap);
  const qs = buildQuestions({facts:corpus.facts, families:corpus.families, chunks, limit:N_Q});
  if (qs.length===0){ console.log(`  ${tok}: no questions`); continue; }
  const vecs=new Array(chunks.length); let embTok=0;
  for(let i=0;i<chunks.length;i+=32){
    const sl=chunks.slice(i,i+32);
    const j=await api('/v1/embed',{input:sl.map(c=>c.text),model:'voyage-4',input_type:'document'});
    j.embeddings.forEach((v,k)=>{vecs[sl[k].idx]=norm(v)}); embTok+=j.tokens||0;
  }
  let v1=0,vK=0,r1=0; const lat=[];
  for(const q of qs){
    const qe=await api('/v1/embed',{text:q.q,model:'voyage-4',input_type:'query'});
    const ranked=vecs.map((v,idx)=>({idx,s:dot(norm(qe.embedding),v)})).sort((a,b)=>b.s-a.s);
    const gold=new Set(q.gold);
    const rank=ranked.findIndex(x=>gold.has(x.idx))+1;
    if(rank===1)v1++; if(rank>0&&rank<=TOP_K)vK++;
    const cand=ranked.slice(0,TOP_K);
    const t=Date.now();
    const rr=await api('/v1/rerank',{query:q.q,documents:cand.map(c=>chunks[c.idx].text),model:'rerank-2.5-lite'});
    lat.push(Date.now()-t);
    if(gold.has(cand[rr.results[0].index].idx))r1++;
  }
  lat.sort((a,b)=>a-b);
  const n=qs.length;
  const row={targetTokens:tok, chars:size, chunks:chunks.length, questions:n,
    vec1:100*v1/n, vecK:100*vK/n, rerank1:100*r1/n, embedTokens:embTok, rerankP50:lat[Math.floor(lat.length/2)]};
  out.push(row);
  console.log(`  ${String(tok).padStart(10)} | ${String(size).padStart(5)} | ${String(chunks.length).padStart(6)} | ${`${row.vec1.toFixed(1)}%`.padStart(6)} ${`${row.vecK.toFixed(1)}%`.padStart(6)} | ${`${row.rerank1.toFixed(1)}%`.padStart(8)} | ${String(embTok).padStart(12)} | ${String(row.rerankP50).padStart(9)}ms`);
}
writeFileSync(`${ROOT}/benchmarks/results/phase4-chunk-sweep${process.env.SWEEP_TAG||''}.json`, JSON.stringify(out,null,1));
console.log('\nsaved benchmarks/results/phase4-chunk-sweep.json');
