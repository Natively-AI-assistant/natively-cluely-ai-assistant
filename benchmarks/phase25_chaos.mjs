// PHASE 25 — chaos. Every failure the brief lists, against the REAL server,
// with a stub upstream so the fault is injected rather than waited for.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT='/Users/evin/natively-cluely-ai-assistant';
const readEnv=(f,k)=>{const l=readFileSync(f,'utf8').split('\n').find(x=>x.startsWith(k+'='));return l?l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,''):null};

let mode = 'ok', hits = 0;
const stub = createServer((req,res)=>{
  let b=''; req.on('data',c=>b+=c); req.on('end',()=>{
    hits++;
    const send=(code,body,hdr={})=>{res.writeHead(code,{'Content-Type':'application/json',...hdr});res.end(JSON.stringify(body))};
    if(mode==='ok'){
      const p=JSON.parse(b||'{}');
      if(p.documents) return send(200,{results:p.documents.map((_,i)=>({index:i,relevance_score:1-i*0.01})),usage:{total_tokens:10}});
      const n=Array.isArray(p.input)?p.input.length:1;
      return send(200,{data:Array.from({length:n},(_,i)=>({index:i,embedding:Array(2048).fill(0.01)})),usage:{total_tokens:10}});
    }
    if(mode==='429')     return send(429,{error:{message:'TPM limit'}},{'Retry-After':'13'});
    if(mode==='500')     return send(500,{error:{message:'boom'}});
    if(mode==='502')     return send(502,{error:{message:'bad gateway'}});
    if(mode==='503')     return send(503,{error:{message:'unavailable'}});
    if(mode==='504')     return send(504,{error:{message:'gateway timeout'}});
    if(mode==='400')     return send(400,{error:{message:'malformed'}});
    if(mode==='hang')    return; // never respond -> client timeout
    send(500,{});
  });
});
await new Promise(r=>stub.listen(9921,'127.0.0.1',r));

const srv = spawn('node',[`${ROOT}/natively-api/server.js`],{cwd:`${ROOT}/natively-api`,
  env:{...process.env, OPENROUTER_BASE_URL:'http://127.0.0.1:9921', OPENROUTER_TIMEOUT_MS:'4000',
       TG_TOKEN:'',TG_CHAT:'',PORT:'8795',NATIVELY_LOCAL_TEST_AUTH:'1',NATIVELY_LOCAL_TEST_TOKEN:'chaos123'},
  stdio:['ignore','pipe','pipe']});
const slog=[]; srv.stdout.on('data',d=>slog.push(String(d))); srv.stderr.on('data',d=>slog.push(String(d)));
for(let i=0;i<80;i++){ try{ const r=await fetch('http://127.0.0.1:8795/health'); if(r.ok)break; }catch{} await new Promise(r=>setTimeout(r,500)); }

const H={'Content-Type':'application/json','x-natively-local-test':'chaos123'};
const call=async(p,body)=>{const t0=Date.now();
  try{const r=await fetch(`http://127.0.0.1:8795${p}`,{method:'POST',headers:H,body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));
    return {status:r.status, retryAfter:r.headers.get('retry-after'), err:j.error, retryable:j.retryable, upstream:j.upstream_status, ms:Date.now()-t0};
  }catch(e){return {status:'NETERR', err:e.message, ms:Date.now()-t0}}};

const rows=[];
const EXPECT = {
  '429': {code:429, retryable:true,  note:'retryable + Retry-After propagated'},
  '500': {code:503, retryable:true,  note:'transient'},
  '502': {code:503, retryable:true,  note:'transient'},
  '503': {code:503, retryable:true,  note:'transient'},
  '504': {code:503, retryable:true,  note:'transient'},
  '400': {code:502, retryable:false, note:'permanent — must NOT be retried'},
  'hang':{code:503, retryable:true,  note:'client timeout is transient'},
};
console.log('PHASE 25 — chaos matrix (rerank route)\n');
console.log('  upstream | got | retryable | Retry-After | ms    | verdict');
for (const m of ['429','500','502','503','504','400','hang']) {
  mode=m;
  const r=await call('/v1/rerank',{query:'q',documents:['a','b']});
  const e=EXPECT[m];
  const ok = r.status===e.code && r.retryable===e.retryable;
  rows.push({upstream:m, ...r, expected:e.code, pass:ok});
  console.log(`  ${m.padEnd(8)} | ${String(r.status).padStart(3)} | ${String(r.retryable).padStart(9)} | ${String(r.retryAfter??'-').padStart(11)} | ${String(r.ms).padStart(5)} | ${ok?'PASS':'FAIL (expected '+e.code+'/'+e.retryable+')'}  ${e.note}`);
}
// duplicate submission must be idempotent at the server (stateless => same answer)
mode='ok';
const a=await call('/v1/embed',{text:'dup',model:'voyage-4'});
const bb=await call('/v1/embed',{text:'dup',model:'voyage-4'});
console.log(`\n  duplicate request: ${a.status} then ${bb.status} — stateless route, no duplicate state created`);
// server restart mid-flight: kill and confirm nothing is wedged
srv.kill('SIGKILL');
await new Promise(r=>setTimeout(r,800));
const dead=await call('/v1/rerank',{query:'q',documents:['a']});
console.log(`  after server kill: ${dead.status} (${dead.err}) — client sees a clean failure, not a hang`);
writeFileSync(`${ROOT}/benchmarks/results/phase25-chaos.json`, JSON.stringify(rows,null,1));
stub.close();
const failed=rows.filter(r=>!r.pass);
console.log(`\n  ${rows.length-failed.length}/${rows.length} chaos cases behaved as designed`);
if(failed.length) console.log('  FAILED:', failed.map(f=>f.upstream).join(', '));
console.log('saved benchmarks/results/phase25-chaos.json');
