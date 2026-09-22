import { readFileSync, writeFileSync } from 'node:fs';
import { buildCorpus, chunk, buildQuestions } from './corpus.mjs';

const ROOT='/Users/evin/natively-cluely-ai-assistant';
const readEnv=(f,k)=>{const l=readFileSync(f,'utf8').split('\n').find(x=>x.startsWith(k+'='));return l?l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,''):null};
const KEY = readEnv(`${ROOT}/.env`,'NATIVELY_API_KEY') || readEnv(`${ROOT}/natively-api/.env`,'NATIVELY_API_KEY');
const BASE = process.env.BENCH_BASE || 'https://api.natively.software';
const H = {'Content-Type':'application/json','x-natively-key':KEY};

// Stay well under the server's 120 req/min limit: a token bucket at 1.5 req/s.
let last = 0;
const MIN_GAP_MS = 660;
async function paced(fn){
  const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
  last = Date.now() + wait;
  if (wait) await new Promise(r=>setTimeout(r,wait));
  return fn();
}
const LAT = { embedDoc:[], embedQuery:[], rerank:[] };
const record=(k,ms)=>LAT[k].push(ms);

async function call(path, body, latKey, tries=3){
  for (let a=1;a<=tries;a++){
    const t0=Date.now();
    try{
      const r=await paced(()=>fetch(`${BASE}${path}`,{method:'POST',headers:H,body:JSON.stringify(body)}));
      const ms=Date.now()-t0;
      const j=await r.json();
      if(!r.ok){ if((r.status===429||r.status>=500)&&a<tries){await new Promise(x=>setTimeout(x,1500*a));continue;} throw new Error(`${r.status} ${j.error||''} ${j.message||''}`);}
      record(latKey,ms);
      return j;
    }catch(e){ if(a>=tries) throw e; await new Promise(x=>setTimeout(x,1200*a)); }
  }
}
const cos=(a,b)=>{let d=0;for(let i=0;i<a.length;i++)d+=a[i]*b[i];return d};  // vectors are unit-norm
const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n)};
const pct=(a,p)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p/100*s.length))]};

const SIZES = [
  { tokens:4000,   questions:60  },
  { tokens:8000,   questions:80  },
  { tokens:32000,  questions:140 },
  { tokens:100000, questions:160 },
];
const TOP_K_VECTOR = 20;   // candidates handed to the reranker
const results = [];

for (const cfg of SIZES) {
  const corpus = buildCorpus({ targetTokens: cfg.tokens });
  const chunks = chunk(corpus.text);
  const questions = buildQuestions({ facts:corpus.facts, families:corpus.families, chunks, limit:cfg.questions });
  console.log(`\n${'='.repeat(78)}\nCORPUS ${cfg.tokens} tokens — ${corpus.text.length} chars, ${chunks.length} chunks, ${questions.length} questions`);
  console.log('='.repeat(78));

  // 1. Embed the corpus (documents)
  process.stdout.write('  embedding corpus');
  const vecs = new Array(chunks.length);
  let embedTokens = 0;
  for (let i=0;i<chunks.length;i+=32){
    const slice = chunks.slice(i,i+32);
    const j = await call('/v1/embed', { input: slice.map(c=>c.text), model:'voyage-4', input_type:'document' }, 'embedDoc');
    j.embeddings.forEach((v,k)=>{ vecs[slice[k].idx]=norm(v); });
    embedTokens += j.tokens||0;
    process.stdout.write('.');
  }
  console.log(` done (${embedTokens} tokens)`);

  // 2. Run the questions
  const tally = {};
  const T = t => (tally[t] ||= { n:0, v1:0, v5:0, v10:0, vK:0, vMRR:0, r1:0, rMRR:0, rerankTokens:0, e2e:[] });
  let done=0;
  for (const q of questions) {
    const t0=Date.now();
    const qe = await call('/v1/embed', { text:q.q, model:'voyage-4', input_type:'query' }, 'embedQuery');
    const qv = norm(qe.embedding);
    const scored = vecs.map((v,idx)=>({idx, s:cos(qv,v)})).sort((a,b)=>b.s-a.s);
    const goldSet = new Set(q.gold);
    const vRank = scored.findIndex(x=>goldSet.has(x.idx)) + 1;

    const cand = scored.slice(0, TOP_K_VECTOR);
    const rr = await call('/v1/rerank', { query:q.q, documents:cand.map(c=>chunks[c.idx].text), model:'rerank-2.5-lite' }, 'rerank');
    const reranked = rr.results.map(r=>cand[r.index].idx);
    const rRank = reranked.findIndex(i=>goldSet.has(i)) + 1;

    const t = T(q.tier);
    t.n++;
    if (vRank===1) t.v1++;
    if (vRank>0 && vRank<=5) t.v5++;
    if (vRank>0 && vRank<=10) t.v10++;
    if (vRank>0 && vRank<=TOP_K_VECTOR) t.vK++;   // the reranker's hard ceiling
    t.vMRR += vRank>0 ? 1/vRank : 0;
    if (rRank===1) t.r1++;
    t.rMRR += rRank>0 ? 1/rRank : 0;
    t.rerankTokens += rr.tokens||0;
    t.e2e.push(Date.now()-t0);
    if (++done % 20 === 0) process.stdout.write(`  ${done}/${questions.length}\r`);
  }

  console.log(`\n  tier     |  n  | vec@1  vec@5  vec@10 vec@${TOP_K_VECTOR} vecMRR | rr@1   rrMRR  | lift  | of ceiling | e2e p50/p95`);
  console.log('  ---------+-----+-------------------------------------+---------------+-------+------------+------------');
  for (const tier of ['easy','medium','hard','extreme']) {
    const t = tally[tier]; if(!t) continue;
    const p=(x)=>`${(100*x/t.n).toFixed(1)}%`.padStart(6);
    const ceil = t.vK ? `${(100*t.r1/t.vK).toFixed(1)}%` : 'n/a';
    console.log(`  ${tier.padEnd(8)} | ${String(t.n).padStart(3)} | ${p(t.v1)} ${p(t.v5)} ${p(t.v10)} ${p(t.vK)} ${(t.vMRR/t.n).toFixed(3)} | ${p(t.r1)} ${(t.rMRR/t.n).toFixed(3)} | ${(((100*(t.r1-t.v1)/t.n)>=0?'+':'')+(100*(t.r1-t.v1)/t.n).toFixed(1)+'%').padStart(6)}| ${ceil.padStart(9)}  | ${pct(t.e2e,50)}/${pct(t.e2e,95)}ms`);
  }
  const all = Object.values(tally);
  const sum=(k)=>all.reduce((a,x)=>a+x[k],0);
  const n=sum('n');
  console.log(`  OVERALL  | ${String(n).padStart(3)} | ${`${(100*sum('v1')/n).toFixed(1)}%`.padStart(6)} ${`${(100*sum('v5')/n).toFixed(1)}%`.padStart(6)} ${`${(100*sum('v10')/n).toFixed(1)}%`.padStart(6)} ${`${(100*sum('vK')/n).toFixed(1)}%`.padStart(6)} ${(sum('vMRR')/n).toFixed(3)} | ${`${(100*sum('r1')/n).toFixed(1)}%`.padStart(6)} ${(sum('rMRR')/n).toFixed(3)} | ${(((100*(sum('r1')-sum('v1'))/n)>=0?'+':'')+(100*(sum('r1')-sum('v1'))/n).toFixed(1)+'%').padStart(6)}| ${`${(100*sum('r1')/sum('vK')).toFixed(1)}%`.padStart(9)}  |`);
  results.push({ tokens:cfg.tokens, chars:corpus.text.length, chunks:chunks.length, embedTokens, tally:Object.fromEntries(Object.entries(tally).map(([k,v])=>[k,{...v,e2e:undefined,e2eP50:pct(v.e2e,50),e2eP95:pct(v.e2e,95)}])) });
}

console.log(`\n${'='.repeat(78)}\nLATENCY (client-observed round trip, production)\n${'='.repeat(78)}`);
console.log('  call            |  n  |  p50 |  p95 |  p99 |  max');
for (const [k,a] of Object.entries(LAT)) {
  if(!a.length) continue;
  console.log(`  ${k.padEnd(15)} | ${String(a.length).padStart(3)} | ${String(pct(a,50)).padStart(4)} | ${String(pct(a,95)).padStart(4)} | ${String(pct(a,99)).padStart(4)} | ${String(Math.max(...a)).padStart(4)}  ms`);
}
writeFileSync('/private/tmp/claude-501/-Users-evin-natively-cluely-ai-assistant/468975f7-ed71-40c7-9509-5ba357a4e991/scratchpad/bench/results.json', JSON.stringify({results,LAT},null,1));
console.log('\nsaved results.json');
