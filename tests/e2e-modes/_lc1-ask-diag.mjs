import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import { loadGeminiKeysFromEnv, extractText } from './corpusLoader.mjs';
const keys=loadGeminiKeysFromEnv();
const env={...process.env,NATIVELY_E2E:'1',NATIVELY_API_URL:'http://localhost:3000',NODE_ENV:'development',NATIVELY_DEV_BYPASS_SCREEN_TCC:'1',NATIVELY_E2E_LOCAL_TEST_TOKEN:'local-test',OPENAI_API_KEY:'',OLLAMA_URL:'http://127.0.0.1:1',NATIVELY_GEMINI_EMBED_DIMS:'768'};
keys.forEach((k,i)=>{env[i===0?'GEMINI_API_KEY':`GEMINI_API_KEY_${i+1}`]=k;});
if(keys[0])env.GOOGLE_API_KEY=keys[0];
const app=await electron.launch({args:['dist-electron/electron/main.js'],env,timeout:60000});
app.process().stdout.on('data',d=>{const s=d.toString();for(const l of s.split(String.fromCharCode(10)))if(/hybrid retrieval|forceDocumentGrounding|rag_|misfire|not enough context|exceeded.*ms|embedding|Selected provider|assistant.voice/i.test(l))console.log('APP:'+l.trim());});app.process().stderr.on('data',d=>{const s=d.toString();for(const l of s.split(String.fromCharCode(10)))if(/hybrid|retrieval|misfire|context|embed|exceeded/i.test(l))console.log('ERR:'+l.trim());});
  const win=await app.firstWindow({timeout:30000}); await win.waitForLoadState('domcontentloaded').catch(()=>{});
const R=async(ch,...a)=>{for(let k=0;k<4;k++){try{const w=app.windows()[0]||await app.firstWindow();return await w.evaluate(async({ch,a})=>(window.electronAPI||window.api).e2eInvoke(ch,...a),{ch,a});}catch(e){if(k===3)throw e;await new Promise(r=>setTimeout(r,1500));}}};
try{
  await R('__e2e__:enable-pro');
  const draft=JSON.parse(fs.readFileSync('test-results/modes-autopilot/generated-modes/legal-compliance.json','utf8')).draft;
  const modeId=await app.windows()[0].evaluate(async(d)=>{const api=window.electronAPI||window.api;const c=await api.modesCreate({name:d.name,templateType:d.templateType});await api.modesUpdate(c.mode.id,{customContext:d.customContext});await api.modesSetActive(c.mode.id);return c.mode.id;},draft);
  for(const rel of ['docs/rfc8259_json.txt','thesis/institutional_thesis.pdf']){const {text,pages}=await extractText(rel);await R('__e2e__:add-reference-file',{modeId,fileName:rel.split('/').pop(),content:text,pageCount:pages});}
  for(let i=0;i<25;i++){const st=await R('__e2e__:index-status',modeId);if((st?.statuses||[]).length>=2)break;await new Promise(r=>setTimeout(r,1000));}
  await R('__e2e__:reindex-embeddings',modeId);
  const q='Per RFC 8259, is an implementation permitted to add a byte order mark to the start of JSON text?';
  const ans=await R('__e2e__:ask',{question:q,timeoutMs:70000});
  const t=ans?.answer||ans?.streamedTokens||'';
  console.log('ANSWER len:',t.length,'has MUST NOT:',/MUST NOT|must not|not permitted|prohibited/i.test(t));
  console.log('ANSWER:',t.slice(0,300));
}catch(e){console.log('ERROR:',e.message);}finally{await app.close().catch(()=>{});console.log('CLOSED');}
