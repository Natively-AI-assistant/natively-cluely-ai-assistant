import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
const attn = JSON.parse(fs.readFileSync('/tmp/attn.json','utf8'));
const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: { ...process.env, NATIVELY_E2E:'1', NATIVELY_API_URL:'http://localhost:3000', NODE_ENV:'development', NATIVELY_DEV_BYPASS_SCREEN_TCC:'1', NATIVELY_E2E_LOCAL_TEST_TOKEN:'local-test' },
  timeout: 60000,
});
const win = await app.firstWindow({ timeout: 30000 });
await win.waitForLoadState('domcontentloaded').catch(()=>{});
const w = () => app.windows()[0];
const R = (ch, ...a) => w().evaluate(async ({ch,a}) => (window.electronAPI||window.api).e2eInvoke(ch, ...a), {ch,a});
await R('__e2e__:enable-pro');
const draft = JSON.parse(fs.readFileSync('test-results/modes-autopilot/generated-modes/conference-talk.json','utf8')).draft;
const modeId = await w().evaluate(async (d) => {
  const api = window.electronAPI||window.api;
  const c = await api.modesCreate({ name: d.name, templateType: d.templateType });
  await api.modesUpdate(c.mode.id, { customContext: d.customContext });
  await api.modesSetActive(c.mode.id);
  return c.mode.id;
}, draft);
const ing = await R('__e2e__:add-reference-file', { modeId, fileName:'attention.pdf', content: attn.text, pageCount: attn.pages });
console.log('ingest ok:', ing?.success, 'fileId:', ing?.file?.id);
await new Promise(r=>setTimeout(r, 2000)); // let async index settle
await R('__e2e__:prewarm-mode', modeId).catch(()=>{});
await new Promise(r=>setTimeout(r, 2000));
console.log('index status:', JSON.stringify(await R('__e2e__:index-status', modeId)));
const insp = await R('__e2e__:inspect-retrieval', { modeId, query: 'BLEU score WMT 2014 English-to-German Transformer big', forceDocumentGrounding: true });
console.log('retrieval topScore:', insp?.topScore, 'blockLen:', insp?.blockLength);
console.log('block contains 28.4:', /28\.4/.test(insp?.block||''));
console.log('BLOCK SAMPLE:', (insp?.block||'').slice(0, 400));
await app.close();
console.log('CLOSED');
