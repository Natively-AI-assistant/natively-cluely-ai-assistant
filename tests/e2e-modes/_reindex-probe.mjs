import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
async function extract(rel){ const {PDFParse}=await import('pdf-parse'); const buf=fs.readFileSync('test-fixtures/modes-corpus/'+rel); const p=new PDFParse({data:buf}); const r=await p.getText(); let t=''; if(r.pages?.length){r.pages.forEach((pg,i)=>t+=`[Page ${i+1}]\n${pg.text||''}\n`);} else t=r.text||''; return {text:t, pages:r.total||r.pages?.length||0}; }
const papers=['papers/attention_is_all_you_need_1706.03762.pdf','papers/bert_1810.04805.pdf','papers/resnet_1512.03385.pdf'];
const app=await electron.launch({args:['dist-electron/electron/main.js'],env:{...process.env,NATIVELY_E2E:'1',NATIVELY_API_URL:'http://localhost:3000',NODE_ENV:'development',NATIVELY_DEV_BYPASS_SCREEN_TCC:'1',NATIVELY_E2E_LOCAL_TEST_TOKEN:'local-test'},timeout:60000});
const win=await app.firstWindow({timeout:30000}); await win.waitForLoadState('domcontentloaded').catch(()=>{});
const w=()=>app.windows()[0]; const R=(ch,...a)=>w().evaluate(async({ch,a})=>(window.electronAPI||window.api).e2eInvoke(ch,...a),{ch,a});
await R('__e2e__:enable-pro');
const draft=JSON.parse(fs.readFileSync('test-results/modes-autopilot/generated-modes/conference-talk.json','utf8')).draft;
const modeId=await w().evaluate(async(d)=>{const api=window.electronAPI||window.api;const c=await api.modesCreate({name:d.name,templateType:d.templateType});await api.modesUpdate(c.mode.id,{customContext:d.customContext});await api.modesSetActive(c.mode.id);return c.mode.id;},draft);
for(const rel of papers){const {text,pages}=await extract(rel);await R('__e2e__:add-reference-file',{modeId,fileName:rel.split('/').pop(),content:text,pageCount:pages});}
for(let i=0;i<20;i++){const st=await R('__e2e__:index-status',modeId);if((st?.statuses||[]).length>=3)break;await new Promise(r=>setTimeout(r,1000));}
const reidx=await R('__e2e__:reindex-embeddings',modeId);
console.log('after reindex:',JSON.stringify((reidx?.statuses||[]).map(s=>s.status+':'+s.chunkCount)));
// clean-transcript ask (no priorTurns)
const ans=await R('__e2e__:ask',{question:'What BLEU score did the Transformer big model achieve on WMT 2014 English-to-German?',timeoutMs:75000});
const txt=ans?.answer||ans?.streamedTokens||'';
console.log('answer len:',txt.length,'contains 28.4:',/28\.4/.test(txt));
console.log('ANSWER:',txt.slice(0,250));
await app.close();console.log('CLOSED');
