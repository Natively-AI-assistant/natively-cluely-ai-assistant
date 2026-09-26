import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import { pickWorkingGeminiEmbedKey, extractText } from './corpusLoader.mjs';
const picked = await pickWorkingGeminiEmbedKey();
console.log('working gemini key:', picked ? ('yes, model='+picked.model+' len='+picked.key.length) : 'NONE');
const env={...process.env,NATIVELY_E2E:'1',NATIVELY_API_URL:'http://localhost:3000',NODE_ENV:'development',NATIVELY_DEV_BYPASS_SCREEN_TCC:'1',NATIVELY_E2E_LOCAL_TEST_TOKEN:'local-test',OPENAI_API_KEY:'',OLLAMA_URL:'http://127.0.0.1:1'};
if(picked){env.GEMINI_API_KEY=picked.key;env.GOOGLE_API_KEY=picked.key;env.NATIVELY_GEMINI_EMBED_MODEL=picked.model;env.NATIVELY_GEMINI_EMBED_DIMS='768';}
const app=await electron.launch({args:['dist-electron/electron/main.js'],env,timeout:60000});
const provLines=[];
app.process().stdout.on('data',d=>{for(const l of d.toString().split('\n'))if(/EmbeddingProviderResolver|Selected provider|GeminiEmbedding|LocalEmbedding|Ollama.*unavailable/i.test(l))provLines.push(l.trim());});
const win=await app.firstWindow({timeout:30000}); await win.waitForLoadState('domcontentloaded').catch(()=>{});
const R=async(ch,...a)=>{for(let k=0;k<4;k++){try{const w=app.windows()[0]||await app.firstWindow();return await w.evaluate(async({ch,a})=>(window.electronAPI||window.api).e2eInvoke(ch,...a),{ch,a});}catch(e){if(k===3)throw e;await new Promise(r=>setTimeout(r,1500));}}};
try {
  await R('__e2e__:enable-pro');
  const draft=JSON.parse(fs.readFileSync('test-results/modes-autopilot/generated-modes/conference-talk.json','utf8')).draft;
  const modeId=await app.windows()[0].evaluate(async(d)=>{const api=window.electronAPI||window.api;const c=await api.modesCreate({name:d.name,templateType:d.templateType});await api.modesUpdate(c.mode.id,{customContext:d.customContext});await api.modesSetActive(c.mode.id);return c.mode.id;},draft);
  const {text,pages}=await extractText('papers/attention_is_all_you_need_1706.03762.pdf');
  await R('__e2e__:add-reference-file',{modeId,fileName:'attention.pdf',content:text,pageCount:pages});
  for(let i=0;i<20;i++){const st=await R('__e2e__:index-status',modeId);if((st?.statuses||[]).length>=1)break;await new Promise(r=>setTimeout(r,1000));}
  const reidx=await R('__e2e__:reindex-embeddings',modeId);
  await new Promise(r=>setTimeout(r,1500));
  console.log('reindex:',JSON.stringify((reidx?.statuses||[]).map(s=>s.status+':'+s.chunkCount)));
  const ans=await R('__e2e__:ask',{question:'What BLEU score did the Transformer big model achieve on WMT 2014 English-to-German?',timeoutMs:70000});
  const t=ans?.answer||ans?.streamedTokens||'';
  console.log('answer 28.4?',/28\.4/.test(t),'len',t.length);
  console.log('PROVIDER LINES:'); [...new Set(provLines)].slice(-6).forEach(l=>console.log('  '+l));
} catch(e){ console.log('ERROR:',e.message); } finally { await app.close().catch(()=>{}); console.log('CLOSED'); }
