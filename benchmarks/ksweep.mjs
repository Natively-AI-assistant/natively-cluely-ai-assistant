// The reranker scored 99.3% of its ceiling at 100k tokens — it is not the
// bottleneck. The ceiling is vector recall@K: a gold chunk outside the top-K is
// one the reranker never sees. This sweeps K to find what it costs to reach 100%.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCorpus, chunk, buildQuestions } from './corpus.mjs';
const ROOT='/Users/evin/natively-cluely-ai-assistant';
const readEnv=(f,k)=>{const l=readFileSync(f,'utf8').split('\n').find(x=>x.startsWith(k+'='));return l?l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,''):null};
const KEY=readEnv(`${ROOT}/.env`,'NATIVELY_API_KEY')||readEnv(`${ROOT}/natively-api/.env`,'NATIVELY_API_KEY');
const BASE='https://api.natively.software';
const H={'Content-Type':'application/json','x-natively-key':KEY};
let last=0; const GAP=660;
const paced=async fn=>{const w=Math.max(0,last+GAP-Date.now());last=Date.now()+w;if(w)await new Promise(r=>setTimeout(r,w));return fn()};
const LAT={};
async function call(path,body,lk,tries=3){
  for(let a=1;a<=tries;a++){const t0=Date.now();
    try{const r=await paced(()=>fetch(`${BASE}${path}`,{method:'POST',headers:H,body:JSON.stringify(body)}));
      const j=await r.json();
      if(!r.ok){if((r.status===429||r.status>=500)&&a<tries){await new Promise(x=>setTimeout(x,1500*a));continue}throw new Error(`${r.status} ${j.error||''}`)}
      (LAT[lk]||=[]).push(Date.now()-t0); return j;
    }catch(e){if(a>=tries)throw e;await new Promise(x=>setTimeout(x,1200*a))}}
}
const dot=(a,b)=>{let d=0;for(let i=0;i<a.length;i++)d+=a[i]*b[i];return d};
const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n)};
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p/100*s.length))]};

const corpus=buildCorpus({targetTokens:100000});
const chunks=chunk(corpus.text);
const questions=buildQuestions({facts:corpus.facts,families:corpus.families,chunks,limit:160});
console.log(`K-SWEEP — 100k-token corpus, ${chunks.length} chunks, ${questions.length} questions\n`);

process.stdout.write('embedding corpus');
const vecs=new Array(chunks.length);
for(let i=0;i<chunks.length;i+=32){
  const sl=chunks.slice(i,i+32);
  const j=await call('/v1/embed',{input:sl.map(c=>c.text),model:'voyage-4',input_type:'document'},'embedDoc');
  j.embeddings.forEach((v,k)=>{vecs[sl[k].idx]=norm(v)}); process.stdout.write('.');
}
console.log(' done');

process.stdout.write('embedding queries');
for(const q of questions){
  const j=await call('/v1/embed',{text:q.q,model:'voyage-4',input_type:'query'},'embedQuery');
  q.vec=norm(j.embedding);
  q.ranked=vecs.map((v,idx)=>({idx,s:dot(q.vec,v)})).sort((a,b)=>b.s-a.s);
}
console.log(' done\n');

const KS=[20,50,100,200];
console.log('   K  | vec recall@K | rerank@1 | % of ceiling | rerank latency p50/p95 | tokens/query');
console.log('  ----+--------------+----------+--------------+------------------------+-------------');
const out=[];
for(const K of KS){
  let inK=0, hit=0, toks=0; const lat=[];
  LAT[`rr${K}`]=[];
  for(const q of questions){
    const gold=new Set(q.gold);
    const cand=q.ranked.slice(0,K);
    if(cand.some(c=>gold.has(c.idx))) inK++;
    const t0=Date.now();
    const rr=await call('/v1/rerank',{query:q.q,documents:cand.map(c=>chunks[c.idx].text),model:'rerank-2.5-lite'},`rr${K}`);
    lat.push(Date.now()-t0); toks+=rr.tokens||0;
    if(gold.has(cand[rr.results[0].index].idx)) hit++;
  }
  const n=questions.length;
  const ceil=inK?100*hit/inK:0;
  console.log(`  ${String(K).padStart(3)} | ${`${(100*inK/n).toFixed(1)}%`.padStart(12)} | ${`${(100*hit/n).toFixed(1)}%`.padStart(8)} | ${`${ceil.toFixed(1)}%`.padStart(12)} | ${String(pct(lat,50)).padStart(9)}/${String(pct(lat,95)).padStart(5)} ms   | ${String(Math.round(toks/n)).padStart(11)}`);
  out.push({K,recallAtK:100*inK/n,rerank1:100*hit/n,ofCeiling:ceil,p50:pct(lat,50),p95:pct(lat,95),tokensPerQuery:Math.round(toks/n)});
}
writeFileSync('/private/tmp/claude-501/-Users-evin-natively-cluely-ai-assistant/468975f7-ed71-40c7-9509-5ba357a4e991/scratchpad/bench/ksweep.json',JSON.stringify(out,null,1));
console.log('\nsaved ksweep.json');
