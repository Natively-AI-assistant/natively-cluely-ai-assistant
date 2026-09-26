import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import { loadGeminiKeysFromEnv, extractText } from './corpusLoader.mjs';
const keys=loadGeminiKeysFromEnv();
const env={...process.env,NATIVELY_E2E:'1',NATIVELY_API_URL:'http://localhost:3000',NODE_ENV:'development',NATIVELY_DEV_BYPASS_SCREEN_TCC:'1',NATIVELY_E2E_LOCAL_TEST_TOKEN:'local-test',OPENAI_API_KEY:'',OLLAMA_URL:'http://127.0.0.1:1',NATIVELY_GEMINI_EMBED_DIMS:'768',NATIVELY_MODE_INDEX_EMBED_BATCH:'50'};
keys.forEach((k,i)=>{env[i===0?'GEMINI_API_KEY':`GEMINI_API_KEY_${i+1}`]=k;});
if(keys[0])env.GOOGLE_API_KEY=keys[0];
console.log('gemini pool size:',keys.length);
const app=await electron.launch({args:['dist-electron/electron/main.js'],env,timeout:60000});
const provLines=[];
app.process().stdout.on('data',d=>{for(const l of d.toString().split('\n'))if(/Selected provider|embedded \d+\/|key pool|rate-limited|cooling|sub-batch|partial index|indexFile failed|timed out|fallback/i.test(l))provLines.push(l.trim());}); app.process().stderr.on('data',d=>{for(const l of d.toString().split('\n'))if(/embed|batch|429|timeout|fallback|space|dim/i.test(l))provLines.push('ERR:'+l.trim());});
const win=await app.firstWindow({timeout:30000}); await win.waitForLoadState('domcontentloaded').catch(()=>{});
const R=async(ch,...a)=>{for(let k=0;k<4;k++){try{const w=app.windows()[0]||await app.firstWindow();return await w.evaluate(async({ch,a})=>(window.electronAPI||window.api).e2eInvoke(ch,...a),{ch,a});}catch(e){if(k===3)throw e;await new Promise(r=>setTimeout(r,1500));}}};
try{
  await R('__e2e__:enable-pro');
  const draft=JSON.parse(fs.readFileSync('test-results/modes-autopilot/generated-modes/data-analyst.json','utf8')).draft;
  const modeId=await app.windows()[0].evaluate(async(d)=>{const api=window.electronAPI||window.api;const c=await api.modesCreate({name:d.name,templateType:d.templateType});await api.modesUpdate(c.mode.id,{customContext:d.customContext});await api.modesSetActive(c.mode.id);return c.mode.id;},draft);
  const {text}=await extractText('datasets/gdp_worldbank.csv');
  console.log('worldbank CSV chars:',text.length);
  await R('__e2e__:add-reference-file',{modeId,fileName:'gdp_worldbank.csv',content:text});
  // wait longer for large embed
  let st;
  for(let i=0;i<60;i++){st=await R('__e2e__:index-status',modeId);const ss=(st?.statuses||[]);if(ss.length&&ss.every(s=>s.status==='ready'||s.status==='failed'||s.status==='lexical_only'))break;await new Promise(r=>setTimeout(r,2000));}
  const reidx=await R('__e2e__:reindex-embeddings',modeId);
  console.log('final index:',JSON.stringify((reidx?.statuses||st?.statuses||[]).map(s=>s.status+':'+s.chunkCount)));
  console.log('provider/progress lines:'); [...new Set(provLines)].slice(-10).forEach(l=>console.log('  '+l));
}catch(e){console.log('ERROR:',e.message);}finally{await app.close().catch(()=>{});console.log('CLOSED');}
