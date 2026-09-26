// PHASE 1 — where does input actually stop being read?
//
// The decisive test is not "how many tokens were billed" (a truncated request
// bills the truncated amount and looks normal). It is: take two texts that are
// IDENTICAL for the first N characters and DIFFERENT after. If the tail was
// dropped, the two vectors are identical. Cosine 1.000000 is proof of
// truncation; anything below proves the tail was read.
import { readFileSync } from 'node:fs';
const ROOT='/Users/evin/natively-cluely-ai-assistant';
const KEY = readFileSync(`${ROOT}/.env`,'utf8').split('\n').find(l=>l.startsWith('NATIVELY_API_KEY='))?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'')
  || readFileSync(`${ROOT}/natively-api/.env`,'utf8').split('\n').find(l=>l.startsWith('NATIVELY_API_KEY=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
const BASE='https://api.natively.software';
const H={'Content-Type':'application/json','x-natively-key':KEY};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cos=(a,b)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]**2;y+=b[i]**2}return d/Math.sqrt(x*y)};

async function embed(text, input_type='document'){
  const t0=Date.now();
  const r=await fetch(`${BASE}/v1/embed`,{method:'POST',headers:H,body:JSON.stringify({text,model:'voyage-4',input_type})});
  const j=await r.json();
  return {status:r.status, ms:Date.now()-t0, vec:j.embedding, tokens:j.tokens, err:j.error, msg:j.message};
}
async function rerank(query, documents){
  const t0=Date.now();
  const r=await fetch(`${BASE}/v1/rerank`,{method:'POST',headers:H,body:JSON.stringify({query,documents})});
  const j=await r.json();
  return {status:r.status, ms:Date.now()-t0, results:j.results, tokens:j.tokens, err:j.error, msg:j.message};
}

// Neutral filler with no distinctive tail, so the only difference is the marker.
const filler = (n) => {
  const s='The subsystem records telemetry at a fixed interval and forwards it to the collector for aggregation. ';
  return s.repeat(Math.ceil(n/s.length)).slice(0,n);
};

console.log('PHASE 1 — EFFECTIVE INPUT LIMIT, MEASURED\n');
console.log('A. EMBEDDING: identical prefix, different tail. cosine 1.0 => the tail was dropped.\n');
console.log('  prefix chars | tokens A | tokens B | cosine(A,B) | verdict');
console.log('  -------------+----------+----------+-------------+--------------------------');
for (const n of [1000, 4000, 7900, 8000, 12000, 32000, 100000]) {
  const a = filler(n) + ' TERMINALMARKER ALPHA QUETZAL.';
  const b = filler(n) + ' TERMINALMARKER BRAVO NARWHAL.';
  const ra = await embed(a); await sleep(600);
  const rb = await embed(b); await sleep(600);
  if (!ra.vec || !rb.vec) { console.log(`  ${String(n).padStart(12)} | ERROR ${ra.err||rb.err} ${ra.msg||rb.msg||''}`); continue; }
  const c = cos(ra.vec, rb.vec);
  const dropped = c > 0.9999995;
  console.log(`  ${String(n).padStart(12)} | ${String(ra.tokens).padStart(8)} | ${String(rb.tokens).padStart(8)} | ${c.toFixed(9)} | ${dropped?'TAIL DROPPED (truncated)':'tail was read'}`);
}

console.log('\nB. EMBEDDING: how many tokens does the server actually bill as input grows?');
console.log('   (a flat line = the input stopped being read there)\n');
console.log('  input chars | ~input tokens | billed tokens | latency ms');
console.log('  ------------+---------------+---------------+-----------');
for (const n of [1000, 4000, 8000, 16000, 32000, 64000, 100000, 400000]) {
  const r = await embed(filler(n)); await sleep(600);
  console.log(`  ${String(n).padStart(11)} | ${String(Math.round(n/4)).padStart(13)} | ${String(r.tokens ?? r.err).padStart(13)} | ${String(r.ms).padStart(10)}`);
}

console.log('\nC. RERANK: does a document get read past the cap?');
console.log('   Two candidates: one whose ANSWER sits early, one whose answer sits late.\n');
const Q = 'What is the calibration constant of the Halden relay?';
const ANSWER = ' The calibration constant of the Halden relay is 0.4471 volts. ';
for (const depth of [0, 4000, 7500, 9000, 20000, 50000]) {
  const doc = filler(depth) + ANSWER + filler(2000);
  const decoy = filler(1000) + ' The collector aggregates telemetry every thirty seconds. ' + filler(500);
  const r = await rerank(Q, [decoy, doc]); await sleep(600);
  if (!r.results) { console.log(`  answer at char ${depth}: ERROR ${r.err} ${r.msg||''}`); continue; }
  const rankOfDoc = r.results.findIndex(x=>x.index===1)+1;
  const scoreDoc = r.results.find(x=>x.index===1)?.relevance_score;
  const scoreDecoy = r.results.find(x=>x.index===0)?.relevance_score;
  console.log(`  answer at char ${String(depth).padStart(6)} | doc rank ${rankOfDoc}/2 | score ${scoreDoc?.toFixed(4)} vs decoy ${scoreDecoy?.toFixed(4)} | tokens ${r.tokens} | ${r.ms}ms | ${rankOfDoc===1?'FOUND':'*** MISSED — answer not visible ***'}`);
}

console.log('\nD. RERANK: request-level caps');
const many = Array.from({length:201},(_,i)=>`Document number ${i} about telemetry collection.`);
const rMany = await rerank('telemetry', many); await sleep(600);
console.log(`  201 documents -> status ${rMany.status} ${rMany.err||''} ${rMany.msg||''}`);
const r200 = await rerank('telemetry', many.slice(0,200)); await sleep(600);
console.log(`  200 documents -> status ${r200.status} results=${r200.results?.length} tokens=${r200.tokens} ${r200.ms}ms`);
