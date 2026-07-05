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
  const draft=JSON.parse(fs.readFileSync('test-results/modes-autopilot/generated-modes/support-escalation.json','utf8')).draft;
  const modeId=await app.windows()[0].evaluate(async(d)=>{const api=window.electronAPI||window.api;const c=await api.modesCreate({name:d.name,templateType:d.templateType});await api.modesUpdate(c.mode.id,{customContext:d.customContext});await api.modesSetActive(c.mode.id);return c.mode.id;},draft);
  const {text}=await extractText('docs/rfc8259_json.txt');
  console.log('RFC chars:',text.length);
  await R('__e2e__:add-reference-file',{modeId,fileName:'rfc8259_json.txt',content:text});
  for(let i=0;i<20;i++){const st=await R('__e2e__:index-status',modeId);if((st?.statuses||[]).length>=1)break;await new Promise(r=>setTimeout(r,1000));}
  const reidx=await R('__e2e__:reindex-embeddings',modeId);
  console.log('index:',JSON.stringify((reidx?.statuses||[]).map(s=>s.status+':'+s.chunkCount)));
  const queries={
    'LC1(BOM MUST NOT)':'Per RFC 8259, is an implementation permitted to add a byte order mark to the start of JSON text',
    'LC3(ECMA-404)':'which standards document does RFC 8259 cite as a normative reference for JSON grammar',
    'SE1(UTF-8 MUST)':'which text encoding must be used for JSON exchanged outside a closed ecosystem',
    'SE4(unique names SHOULD)':'must the names within a single JSON object be unique',
  };
  for(const [label,q] of Object.entries(queries)){
    const insp=await R('__e2e__:inspect-retrieval',{modeId,query:q,forceDocumentGrounding:true});
    const block=insp?.block||'';
    // which target facts appear in the retrieved block?
    const facts={'byte order mark':/byte order mark/i.test(block),'MUST NOT':/MUST NOT/i.test(block),'ECMA-404':/ECMA-404/i.test(block),'UTF-8':/UTF-8/i.test(block),'SHOULD be unique':/SHOULD be unique|names within|unique/i.test(block)};
    console.log('\n['+label+'] blockLen='+insp?.blockLength+' topScore='+insp?.topScore);
    console.log('  facts in retrieved block:', JSON.stringify(facts));
    console.log('  block head:', block.replace(/\s+/g,' ').slice(0,220));
  }
}catch(e){console.log('ERROR:',e.message);}finally{await app.close().catch(()=>{});console.log('CLOSED');}
