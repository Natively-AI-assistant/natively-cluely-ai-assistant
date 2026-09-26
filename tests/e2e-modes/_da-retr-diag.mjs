import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import { loadGeminiKeysFromEnv, extractText } from './corpusLoader.mjs';
const keys=loadGeminiKeysFromEnv();
const env={...process.env,NATIVELY_E2E:'1',NATIVELY_API_URL:'http://localhost:3000',NODE_ENV:'development',NATIVELY_DEV_BYPASS_SCREEN_TCC:'1',NATIVELY_E2E_LOCAL_TEST_TOKEN:'local-test',OPENAI_API_KEY:'',OLLAMA_URL:'http://127.0.0.1:1',NATIVELY_GEMINI_EMBED_DIMS:'768'};
keys.forEach((k,i)=>{env[i===0?'GEMINI_API_KEY':`GEMINI_API_KEY_${i+1}`]=k;});
if(keys[0])env.GOOGLE_API_KEY=keys[0];
const app=await electron.launch({args:['dist-electron/electron/main.js'],env,timeout:60000});
const win=await app.firstWindow({timeout:30000}); await win.waitForLoadState('domcontentloaded').catch(()=>{});
const R=async(ch,...a)=>{for(let k=0;k<4;k++){try{const w=app.windows()[0]||await app.firstWindow();return await w.evaluate(async({ch,a})=>(window.electronAPI||window.api).e2eInvoke(ch,...a),{ch,a});}catch(e){if(k===3)throw e;await new Promise(r=>setTimeout(r,1500));}}};
try{
  await R('__e2e__:enable-pro');
  const d=JSON.parse(fs.readFileSync('test-results/modes-autopilot/generated-modes/data-analyst.json','utf8')).draft;
  const modeId=await app.windows()[0].evaluate(async(x)=>{const api=window.electronAPI||window.api;const c=await api.modesCreate({name:x.name,templateType:x.templateType});await api.modesUpdate(c.mode.id,{customContext:x.customContext});await api.modesSetActive(c.mode.id);return c.mode.id;},d);
  for(const rel of ['datasets/gapminder2007.csv','datasets/gdp_worldbank.csv']){const {text}=await extractText(rel);await R('__e2e__:add-reference-file',{modeId,fileName:rel.split('/').pop(),content:text});}
  for(let i=0;i<40;i++){const st=await R('__e2e__:index-status',modeId);if((st?.statuses||[]).length>=2 && st.statuses.every(s=>s.status==='ready'))break;await R('__e2e__:reindex-embeddings',modeId).catch(()=>{});await new Promise(r=>setTimeout(r,2000));}
  const insp=await R('__e2e__:inspect-retrieval',{modeId,query:'United States population life expectancy GDP per capita Gapminder 2007',forceDocumentGrounding:true});
  const b=insp?.block||'';
  console.log('block len:',insp?.blockLength,'has United States:',/United States/.test(b),'has 301139947:',/301139947/.test(b),'has 42951:',/42951/.test(b));
}catch(e){console.log('ERROR:',e.message);}finally{await app.close().catch(()=>{});console.log('CLOSED');}
