// PHASE 30 — reranker bake-off on Natively's own workload.
//
// The production default is the bundled local cross-encoder. rerank-2.5-lite was
// added without ever comparing the two, so the default currently rests on no
// evidence. This measures both against the SAME candidates and the same ground
// truth, and drives the local model through its REAL production path — the
// localRerankerWorker worker thread, same ONNX config and tokenizer the app uses.
import { readFileSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { buildCorpus, chunk, buildQuestions } from './corpus.mjs';

const ROOT = '/Users/evin/natively-cluely-ai-assistant';
const readEnv=(f,k)=>{const l=readFileSync(f,'utf8').split('\n').find(x=>x.startsWith(k+'='));return l?l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,''):null};
const KEY = readEnv(`${ROOT}/natively-api/.env`,'NATIVELY_API_KEY');
const BASE = 'https://api.natively.software';
const H = {'Content-Type':'application/json','x-natively-key':KEY};

let last=0; const GAP=680;
const paced=async fn=>{const w=Math.max(0,last+GAP-Date.now());last=Date.now()+w;if(w)await new Promise(r=>setTimeout(r,w));return fn()};
async function api(path, body, tries=4){
  for(let a=1;a<=tries;a++){
    const r=await paced(()=>fetch(`${BASE}${path}`,{method:'POST',headers:H,body:JSON.stringify(body)}));
    const j=await r.json().catch(()=>({}));
    if(r.ok) return j;
    // The server now says whether it is worth retrying, and how long to wait.
    if(j?.retryable !== false && a<tries){
      const wait=(Number(j?.retry_after)||2)*1000*(0.75+Math.random()*0.5);
      await new Promise(x=>setTimeout(x,wait)); continue;
    }
    throw new Error(`${r.status} ${j.error||''}`);
  }
}
const dot=(a,b)=>{let d=0;for(let i=0;i<a.length;i++)d+=a[i]*b[i];return d};
const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n)};
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p/100*s.length))]};

// ── the local cross-encoder, through its production worker ──────────────────
function makeLocalReranker(modelId, dtype){
  const w = new Worker(path.join(ROOT,'dist-electron/electron/rag/localRerankerWorker.js'));
  let seq=0; const pending=new Map();
  w.on('message',(m)=>{const p=pending.get(m.requestId); if(!p)return; pending.delete(m.requestId);
    m.type==='error'?p.reject(new Error(m.error)):p.resolve(m);});
  w.on('error',(e)=>{for(const p of pending.values())p.reject(e);pending.clear();});
  const post=(msg,timeout=180000)=>new Promise((resolve,reject)=>{
    const requestId=++seq; pending.set(requestId,{resolve,reject});
    const t=setTimeout(()=>{pending.delete(requestId);reject(new Error('worker timeout'))},timeout);
    const done=(f)=>(v)=>{clearTimeout(t);f(v)};
    pending.set(requestId,{resolve:done(resolve),reject:done(reject)});
    w.postMessage({...msg,requestId});
  });
  return {
    init: () => post({type:'init', modelId, modelPath: path.join(ROOT,'resources/models'), isPackaged:false, dtype}),
    rerank: (query,passages) => post({type:'rerank',query,passages}),
    close: () => w.terminate(),
  };
}

const CORPUS_TOKENS = 32000, N_QUESTIONS = 100, TOP_K = 20;
const corpus = buildCorpus({targetTokens:CORPUS_TOKENS});
const chunks = chunk(corpus.text);
const questions = buildQuestions({facts:corpus.facts,families:corpus.families,chunks,limit:N_QUESTIONS});
console.log(`PHASE 30 — reranker bake-off\ncorpus ${CORPUS_TOKENS} tok, ${chunks.length} chunks, ${questions.length} questions, top-${TOP_K} candidates\n`);

process.stdout.write('embedding corpus');
const vecs=new Array(chunks.length);
for(let i=0;i<chunks.length;i+=32){
  const sl=chunks.slice(i,i+32);
  const j=await api('/v1/embed',{input:sl.map(c=>c.text),model:'voyage-4',input_type:'document'});
  j.embeddings.forEach((v,k)=>{vecs[sl[k].idx]=norm(v)}); process.stdout.write('.');
}
console.log(' done');
process.stdout.write('embedding queries');
for(const q of questions){
  const j=await api('/v1/embed',{text:q.q,model:'voyage-4',input_type:'query'});
  q.cand=vecs.map((v,idx)=>({idx,s:dot(norm(j.embedding),v)})).sort((a,b)=>b.s-a.s).slice(0,TOP_K);
}
console.log(' done\n');

const results=[];
function score(label, perQuestionTop, lat){
  let hit=0, inK=0;
  questions.forEach((q,i)=>{
    const gold=new Set(q.gold);
    if(q.cand.some(c=>gold.has(c.idx))) inK++;
    if(gold.has(perQuestionTop[i])) hit++;
  });
  const n=questions.length;
  const row={label, top1:100*hit/n, ofCeiling:inK?100*hit/inK:0, p50:pct(lat,50), p95:pct(lat,95), p99:pct(lat,99)};
  results.push(row);
  console.log(`  ${label.padEnd(34)} top1=${row.top1.toFixed(1).padStart(5)}%  ofCeiling=${row.ofCeiling.toFixed(1).padStart(5)}%  latency p50/p95/p99 = ${String(row.p50).padStart(5)}/${String(row.p95).padStart(5)}/${String(row.p99).padStart(5)} ms`);
}

// baseline: no reranking
score('vector only (no rerank)', questions.map(q=>q.cand[0].idx), [0]);

// hosted rerank-2.5-lite
{
  const tops=[], lat=[];
  for(const q of questions){
    const t0=Date.now();
    const rr=await api('/v1/rerank',{query:q.q,documents:q.cand.map(c=>chunks[c.idx].text),model:'rerank-2.5-lite'});
    lat.push(Date.now()-t0);
    tops.push(q.cand[rr.results[0].index].idx);
  }
  score('hosted rerank-2.5-lite', tops, lat);
}

// local cross-encoders, real worker
for (const [modelId,dtype] of [['Xenova/ms-marco-MiniLM-L-6-v2','q8'], ['Xenova/bge-reranker-large','q8']]) {
  let r;
  try {
    r = makeLocalReranker(modelId,dtype);
    const t0=Date.now(); await r.init();
    console.log(`  (${modelId} cold load ${Date.now()-t0}ms)`);
    const tops=[], lat=[];
    for(const q of questions){
      const t=Date.now();
      const out=await r.rerank(q.q, q.cand.map(c=>chunks[c.idx].text));
      lat.push(Date.now()-t);
      let best=0; out.scores.forEach((s,i)=>{if(s>out.scores[best])best=i});
      tops.push(q.cand[best].idx);
    }
    score(`local ${modelId.split('/')[1]}`, tops, lat);
  } catch(e){ console.log(`  local ${modelId}: FAILED — ${e.message}`); }
  finally { try{ await r?.close(); }catch{} }
}

writeFileSync(path.join(ROOT,'benchmarks/results/rerank-bakeoff.json'), JSON.stringify({corpusTokens:CORPUS_TOKENS,questions:questions.length,topK:TOP_K,results},null,1));
console.log('\nsaved benchmarks/results/rerank-bakeoff.json');
