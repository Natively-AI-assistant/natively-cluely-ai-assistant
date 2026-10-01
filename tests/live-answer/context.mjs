// node context.mjs <label> [--models=..] [--surfaces=hotkey,typed] [--only=CB1,..]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { connect, setup, setMode, askTyped, askHotkey } from './cdp.mjs';
const require = createRequire(import.meta.url);
const { CONTEXT, RESUME } = require('./dataset.cjs');
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = process.argv[2];
const models = arg('models', 'gemini-3.1-flash-lite,deepseek-flash').split(',');
const surfaces = arg('surfaces', 'hotkey,typed').split(',');
const only = arg('only', '');
const items = only ? CONTEXT.filter(i => only.split(',').includes(i.id)) : CONTEXT;
const RESULTS = new URL('./results/', import.meta.url);
fs.mkdirSync(RESULTS, { recursive: true });
const out = new URL(`${label}.jsonl`, RESULTS);
const c = await connect();
async function ensureCvMode() {
  const modes = await c.evaluate(`window.electronAPI.modesGetAll()`);
  let m = modes.find(x => x.name === 'LFW CV');
  if (!m) {
    const r = await c.evaluate(`window.electronAPI.modesCreate({ name: 'LFW CV', templateType: 'looking-for-work' })`);
    m = r?.mode ?? r;
    if (!m?.id) { const again = await c.evaluate(`window.electronAPI.modesGetAll()`); m = again.find(x => x.name === 'LFW CV'); }
    const add = await c.invoke('__e2e__:add-reference-file', { modeId: m.id, fileName: 'priya_raman_resume.txt', content: RESUME });
    console.log('attached résumé:', add?.success, add?.error || '');
    await c.invoke('__e2e__:prewarm-mode', m.id);
  }
  return m;
}
const cv = await ensureCvMode();
console.log('cv mode', cv.id, cv.templateType);
for (const model of models) {
  await setup(c, model);
  for (const it of items) for (const surface of surfaces) {
    if (it.mode === 'cv') await c.evaluate(`window.electronAPI.modesSetActive(${JSON.stringify(cv.id)})`); else await setMode(c, it.mode);
    let r;
    try { r = surface === 'hotkey' ? await askHotkey(c, null, it.q, it.prior || []) : await askTyped(c, it.q, {}, it.prior || []); }
    catch (e) { r = { surface, ok: false, err: String(e).slice(0, 300), final: '', raw: '' }; }
    const rec = { label, id: it.id, ctx: it.ctx, kind: it.kind, q: it.q, model, mode: it.mode, surface, sample: 1, ...r };
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
    console.log(`${it.id} ${surface} ${model} ${r.ok ? 'ok' : 'ERR ' + r.err} ${r.ms}ms ${JSON.stringify((r.final || '').slice(0, 100))}`);
  }
}
await setMode(c, 'general');
c.close(); process.exit(0);
