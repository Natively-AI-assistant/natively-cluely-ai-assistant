import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
const img = JSON.parse(fs.readFileSync('/tmp/imgpdf.json','utf8'));
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
const draft = JSON.parse(fs.readFileSync('test-results/modes-autopilot/generated-modes/support-escalation.json','utf8')).draft;
const modeId = await w().evaluate(async (d) => {
  const api = window.electronAPI||window.api;
  const c = await api.modesCreate({ name: d.name, templateType: d.templateType });
  await api.modesUpdate(c.mode.id, { customContext: d.customContext });
  await api.modesSetActive(c.mode.id);
  return c.mode.id;
}, draft);
const ing = await R('__e2e__:add-reference-file', { modeId, fileName:'imageonly_scanned.pdf', content: img.text, pageCount: img.pages });
console.log('ingest:', JSON.stringify({ ok: ing?.success, err: ing?.error }));
await new Promise(r=>setTimeout(r,1500));
console.log('index:', JSON.stringify((await R('__e2e__:index-status', modeId))?.statuses));
const started = Date.now();
const ans = await R('__e2e__:ask', { question: 'Summarize the contents of the uploaded PDF and list its key findings.', timeoutMs: 40000 });
console.log('latency_ms:', Date.now()-started);
console.log('result:', JSON.stringify({ success: ans?.success, timedOut: ans?.timedOut, discarded: ans?.discarded, len:(ans?.answer||'').length }));
console.log('ANSWER:', (ans?.answer||ans?.streamedTokens||'(none)').slice(0,300));
await app.close();
console.log('CLOSED');
